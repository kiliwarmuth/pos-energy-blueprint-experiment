/* POS Blueprint Leaderboard — ZIP-only reader (Zenodo sandbox/production)
 * - Searches Zenodo by keyword OR community
 * - For each record: downloads archive, extracts needed files via JSZip
 * - Renders 4 energy PNGs + author + CPU + optional metrics
 * - Status/debug panel + pagination + URL overrides
 */

/* -------------------- Status + debug -------------------- */
const STATUS = {
  set(msg) {
    const el = document.getElementById("status");
    if (el) el.textContent = String(msg);
  },
  add(line) {
    const el = document.getElementById("status");
    if (!el) return;
    const cur = el.textContent || "";
    el.textContent = cur + (cur ? "\n" : "") + String(line);
  },
};
function dbg(...a) {
  if ((window.APP_CFG || {}).verbose) {
    console.log("[leaderboard]", ...a);
    STATUS.add(a.map(String).join(" "));
  }
}

/* -------------------- Config helpers -------------------- */
function cfgFromUrl(base) {
  const url = new URL(window.location.href);
  const p = url.searchParams;
  const cfg = { ...base };
  if (p.get("keyword")) {
    cfg.mode = "keyword";
    cfg.keyword = p.get("keyword");
  }
  if (p.get("community")) {
    cfg.mode = "community";
    cfg.community = p.get("community");
  }
  if (p.get("pages")) cfg.maxPages = Math.max(1, +p.get("pages"));
  if (p.get("pagesize")) cfg.pageSize = Math.max(1, +p.get("pagesize"));
  if (p.get("verbose")) cfg.verbose = p.get("verbose") !== "false";
  if (p.get("api")) cfg.zenodoApi = p.get("api"); // allow override
  return cfg;
}
function resolveZenodoApi(cfg) {
  // If not set, default to production. For sandbox testing, set in index.html
  if (!cfg.zenodoApi) cfg.zenodoApi = "https://sandbox.zenodo.org/api";
  return cfg;
}

/* -------------------- HTTP utils (retry) -------------------- */
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function fetchJson(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      dbg("GET", url);
      const rsp = await fetch(url);
      if (rsp.status === 429 || (rsp.status >= 500 && rsp.status < 600)) {
        lastErr = new Error(`HTTP ${rsp.status}`);
        await sleep(800 * (i + 1)); continue;
      }
      if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`);
      return await rsp.json();
    } catch (e) { lastErr = e; await sleep(800 * (i + 1)); }
  }
  throw lastErr;
}
async function fetchArrayBuffer(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      dbg("GET(bin)", url);
      const rsp = await fetch(url);
      if (rsp.status === 429 || (rsp.status >= 500 && rsp.status < 600)) {
        lastErr = new Error(`HTTP ${rsp.status}`);
        await sleep(800 * (i + 1)); continue;
      }
      if (!rsp.ok) throw new Error(`HTTP ${rsp.status}`);
      return await rsp.arrayBuffer();
    } catch (e) { lastErr = e; await sleep(800 * (i + 1)); }
  }
  throw lastErr;
}

/* -------------------- Zenodo search + pagination -------------------- */
async function zenodoSearchAll(cfg) {
  let q = "";
  if (cfg.mode === "keyword") {
    // Match keyword field; also allow free-text fallback for safety
    q = `keywords:"${cfg.keyword}" OR "${cfg.keyword}"`;
  } else if (cfg.mode === "community") {
    q = `communities:"${cfg.community}"`;
  } else {
    throw new Error("Invalid mode");
  }
  const base = `${cfg.zenodoApi}/records`;
  const size = cfg.pageSize || 50;
  const maxPages = cfg.maxPages || 3;

  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const url =
      `${base}?q=${encodeURIComponent(q)}&size=${size}&page=${page}`;
    const data = await fetchJson(url);
    const hits = data?.hits?.hits || [];
    dbg("page", page, "hits", hits.length);
    if (!hits.length) break;
    out.push(...hits);
    const total = data?.hits?.total || out.length;
    if (out.length >= total) break;
  }
  return out;
}

/* -------------------- ZIP extraction (JSZip) -------------------- */
async function extractFromZip(archiveUrl) {
  dbg("fetching archive", archiveUrl);
  if (!window.JSZip) throw new Error("JSZip not loaded");
  const buf = await fetchArrayBuffer(archiveUrl);
  const zip = await JSZip.loadAsync(buf);
  const entries = Object.keys(zip.files);

  const readJson = async (path) => {
    const f = zip.file(path);
    if (!f) return null;
    try { return JSON.parse(await f.async("string")); }
    catch { return null; }
  };
  const blobUrl = async (path) => {
    const f = zip.file(path);
    if (!f) return null;
    const blob = await f.async("blob");
    return URL.createObjectURL(blob);
  };

  // RO-Crate metadata (json or jsonld; case-insensitive)
  const metaPath = entries.find((p) =>
    /ro-crate-metadata\.json(ld)?$/i.test(p)
  );
  const meta = metaPath ? await readJson(metaPath) : null;

  // First config/<node>/hardware.json
  const hwPath = entries.find((p) =>
    /^config\/[^/]+\/hardware\.json$/i.test(p)
  );
  const hw = hwPath ? await readJson(hwPath) : null;

  // Optional metrics
  const metrics =
    (await readJson("energy/metrics.json")) ||
    (await readJson("Energy/metrics.json")) || {};

  // Energy PNGs
  const want = ["power.png", "bar.png", "current.png", "voltage.png"];
  const images = [];
  for (const n of want) {
    const p = `energy/${n}`;
    if (entries.includes(p)) {
      const url = await blobUrl(p);
      if (url) images.push(url);
    }
  }

  return { meta, hw, metrics, images };
}

/* -------------------- Metadata extraction -------------------- */
function extractAuthorUsername(meta) {
  const g = meta && meta["@graph"];
  if (!Array.isArray(g)) return "unknown";
  const persons = g.filter((e) => {
    const t = e && e["@type"];
    return t === "Person" || (Array.isArray(t) && t.includes("Person"));
  });
  const ent =
    persons.find((p) => (p.tags || []).includes("author") ||
      (p.roles || []).length > 0) || persons[0];
  if (!ent) return "unknown";

  const rid = ent["@id"] || "";
  const m = /^user:([A-Za-z0-9._-]+)$/.exec(rid);
  if (m) return m[1].toLowerCase();

  const norm = (s) =>
    (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const gn = norm(ent.givenName);
  const fn = norm(ent.familyName);
  if (gn || fn) return (gn && fn ? `${gn}-${fn}` : gn || fn) || "unknown";
  return norm(ent.name) || "unknown";
}
function extractCpuInfo(hw) {
  const cpu = (hw && (hw.cpu_model || hw.model)) || "";
  const cores = +(hw && (hw.cpu_cores || hw.cores) || 0);
  const threads = +(hw && (hw.cpu_threads || hw.threads || cores || 0));
  return { cpu, cores, threads };
}

/* -------------------- Rendering -------------------- */
function scoreNum(row, key, dir) {
  const v = +(row[key] ?? NaN);
  if (Number.isNaN(v)) return dir === "asc" ? +Infinity : -Infinity;
  return v;
}
function render(rows) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";

  const stats = document.getElementById("stats");
  if (stats) {
    stats.textContent =
      `${rows.length} runs · ${new Set(rows.map((r) => r.user)).size} users`;
  }

  rows.forEach((r) => {
    const el = document.createElement("article");
    el.className = "card";
    const imgs = r.images.map((u) =>
      `<img src="${u}" alt="energy plot"/>`
    ).join("");
    const metaHtml = `
      <div class="meta">
        <div><strong>User:</strong> ${r.user}</div>
        <div><strong>CPU:</strong> ${r.cpu} (${r.cores}/${r.threads})</div>
        <div><strong>Avg/Peak/E:</strong>
          ${r.avg_power_w ?? "–"} /
          ${r.peak_power_w ?? "–"} /
          ${r.energy_wh ?? "–"}
        </div>
        <div><a href="${r.zenodo}" target="_blank" rel="noopener">
          Zenodo #${r.id}</a></div>
      </div>`;
    el.innerHTML =
      `<h3>Run ${r.id}</h3>${metaHtml}<div class="imgs">${imgs}</div>`;
    grid.appendChild(el);
  });
}

/* -------------------- Main load -------------------- */
async function loadAndRender() {
  STATUS.set("Starting…");

  // Defaults (override in index.html or via URL params)
  const base = {
    mode: "keyword",
    keyword: "pos-blueprint:stress-energy",
    // For sandbox while testing, set in index.html: zenodoApi: "https://sandbox.zenodo.org/api"
    zenodoApi: null,
    pageSize: 100,
    maxPages: 3,
    verbose: true,
  };
  let cfg = cfgFromUrl({ ...base, ...(window.APP_CFG || {}) });
  cfg = resolveZenodoApi(cfg);

  // Reflect filters in UI (if present)
  const kwEl = document.getElementById("kw");
  const kw2El = document.getElementById("kw2");
  if (kwEl && kw2El) {
    if (cfg.mode === "keyword") {
      kwEl.textContent = cfg.keyword;
      kw2El.textContent = cfg.keyword;
    } else {
      kwEl.textContent = `community:${cfg.community}`;
      kw2El.textContent = `community:${cfg.community}`;
    }
  }

  try {
    const hits = await zenodoSearchAll(cfg);
    dbg("total hits", hits.length);

    const rows = [];
    let n = 0;

    for (const rec of hits) {
      n += 1;
      STATUS.set(`Processing ${n}/${hits.length}…`);

      const id = rec.id;
      const baseHtml = rec.links?.self_html ||
        rec.links?.latest_html ||
        `https://sandbox.zenodo.org/records/${id}`;
      const archiveUrl = rec.links?.archive;
      dbg("record", id, "archiveUrl:", archiveUrl);
      if (!archiveUrl) {
        dbg("skip record: no archive link", id);
        continue;
      }

      let meta = null, hwJson = null, metrics = {}, images = [];

      try {
        const z = await extractFromZip(archiveUrl);
        meta = z.meta; hwJson = z.hw; metrics = z.metrics || {};
        images = z.images || [];
      } catch (e) {
        dbg("zip extract failed for", id, e);
        continue;
      }

      if (!meta) {
        dbg("skip record: no ro-crate metadata in zip", id);
        continue;
      }

      const user = extractAuthorUsername(meta);
      const hw = extractCpuInfo(hwJson || {});

      rows.push({
        id,
        zenodo: baseHtml.replace("?preview=1", ""),
        user,
        cpu: hw.cpu || "unknown",
        cores: hw.cores || 0,
        threads: hw.threads || 0,
        avg_power_w: metrics.avg_power_w,
        peak_power_w: metrics.peak_power_w,
        energy_wh: metrics.energy_wh,
        created: rec.created || rec.updated || "",
        images,
      });
    }

    // Sort/filter via controls (if present)
    const sortSel = document.getElementById("sort");
    const cpuInp = document.getElementById("cpuFilter");
    const sel = sortSel ? sortSel.value : "created:desc";
    const [k, dir] = sel.split(":");
    const cpuFilt = (cpuInp ? cpuInp.value : "").trim().toLowerCase();

    const filtered = cpuFilt
      ? rows.filter((r) => (r.cpu || "").toLowerCase().includes(cpuFilt))
      : rows;

    filtered.sort((a, b) => {
      if (k === "created") {
        const ta = Date.parse(a.created || 0);
        const tb = Date.parse(b.created || 0);
        return dir === "asc" ? ta - tb : tb - ta;
      }
      const sa = scoreNum(a, k, dir);
      const sb = scoreNum(b, k, dir);
      return dir === "asc" ? sa - sb : sb - sa;
    });

    render(filtered);
    STATUS.add("\nDone.");
  } catch (e) {
    console.error(e);
    STATUS.add(`\nERROR: ${e.message}`);
    const grid = document.getElementById("grid");
    if (grid) {
      grid.innerHTML =
        `<p class="error">Failed to load: ${e.message}</p>`;
    }
  }
}

/* -------------------- UI wiring -------------------- */
function wireUi() {
  const refreshBtn = document.getElementById("refresh");
  if (refreshBtn) refreshBtn.addEventListener("click", loadAndRender);

  const sort = document.getElementById("sort");
  if (sort) sort.addEventListener("change", loadAndRender);

  const cpu = document.getElementById("cpuFilter");
  if (cpu) {
    cpu.addEventListener("input", () => {
      clearTimeout(window._t);
      window._t = setTimeout(loadAndRender, 250);
    });
  }
}
window.addEventListener("DOMContentLoaded", () => {
  wireUi();
  loadAndRender();
});