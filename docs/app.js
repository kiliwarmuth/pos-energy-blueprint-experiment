/* Client-side Zenodo ingestion and rendering (no dependencies). */

async function zenodoSearch(cfg, page = 1, size = 50) {
  const base = `${cfg.zenodoApi}/records`;
  let q = "";
  if (cfg.mode === "keyword") {
    // Prefer keyword field; also search description as fallback
    q = `keywords:"${cfg.keyword}" OR "${cfg.keyword}"`;
  } else if (cfg.mode === "community") {
    q = `communities:"${cfg.community}"`;
  }
  const url = `${base}?q=${encodeURIComponent(q)}&size=${size}&page=${page}`;
  const rsp = await fetch(url);
  if (!rsp.ok) throw new Error(`Zenodo ${rsp.status}`);
  return rsp.json();
}

function filesMap(rec) {
  const out = {};
  (rec.files || []).forEach((f) => {
    if (f.key && f.links && f.links.self) out[f.key] = f.links.self;
  });
  return out;
}

async function fetchText(url) {
  const rsp = await fetch(url);
  if (!rsp.ok) throw new Error(`GET ${url} -> ${rsp.status}`);
  return rsp.text();
}

async function readJsonIf(map, key) {
  if (!map[key]) return null;
  try {
    const txt = await fetchText(map[key]);
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function extractAuthorUsername(meta) {
  const g = meta["@graph"] || [];
  const persons = g.filter((e) => {
    const t = e["@type"];
    return t === "Person" || (Array.isArray(t) && t.includes("Person"));
  });
  const byRole = persons.find(
    (p) => (p.tags || []).includes("author") || (p.roles || []).length > 0,
  );
  const ent = byRole || persons[0];
  if (!ent) return "unknown";
  const rid = ent["@id"] || "";
  const m = /^user:([A-Za-z0-9._-]+)$/.exec(rid);
  if (m) return m[1].toLowerCase();
  const gn = (ent.givenName || "").trim().toLowerCase();
  const fn = (ent.familyName || "").trim().toLowerCase();
  if (gn || fn) {
    return `${gn}-${fn}`.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
      "unknown";
  }
  const nm = (ent.name || "").trim().toLowerCase();
  return nm.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function extractCpuInfo(hw) {
  const cpu = (hw && (hw.cpu_model || hw.model)) || "";
  const cores = +(hw && (hw.cpu_cores || hw.cores) || 0);
  const threads = +(hw && (hw.cpu_threads || hw.threads || cores || 0));
  return { cpu, cores, threads };
}

function pickPngs(recId, m) {
  const want = [
    "energy/power.png",
    "energy/bar.png",
    "energy/current.png",
    "energy/voltage.png",
  ];
  const urls = [];
  want.forEach((k) => {
    if (m[k]) {
      urls.push(
        `https://sandbox.zenodo.org/record/${recId}/files/${k}?download=1`,
      );
    }
  });
  return urls;
}

function scoreNum(row, key, dir) {
  const v = +(row[key] ?? NaN);
  if (Number.isNaN(v)) return dir === "asc" ? +Infinity : -Infinity;
  return v;
}

function render(rows) {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  document.getElementById("stats").textContent =
    `${rows.length} runs · ${new Set(rows.map((r) => r.user)).size} users`;

  rows.forEach((r) => {
    const el = document.createElement("article");
    el.className = "card";

    const imgs = r.images.map((u) =>
      `<a href="${r.zenodo}" target="_blank" rel="noopener">
         <img src="${u}" alt="energy plot"/>
       </a>`
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

    el.innerHTML = `<h3>Run ${r.id}</h3>${metaHtml}<div class="imgs">${imgs}</div>`;
    grid.appendChild(el);
  });
}

async function loadAndRender() {
  const cfg = window.APP_CFG;
  // Show configured keyword/community in the UI
  const kwEl = document.getElementById("kw");
  const kw2El = document.getElementById("kw2");
  if (cfg.mode === "keyword") {
    kwEl.textContent = cfg.keyword;
    kw2El.textContent = cfg.keyword;
  } else {
    kwEl.textContent = `community:${cfg.community}`;
    kw2El.textContent = `community:${cfg.community}`;
  }

  const raw = await zenodoSearch(cfg, 1, cfg.pageSize || 50);
  const hits = raw.hits?.hits || [];
  const rows = [];

  for (const rec of hits) {
    const id = rec.id;
    const m = filesMap(rec);

    // Required: RO-Crate metadata
    const meta = await readJsonIf(m, "ro-crate-metadata.json");
    if (!meta) continue;

    const user = extractAuthorUsername(meta);

    // Optional: hardware.json under config/<node>/
    let hwJson = null;
    const keys = Object.keys(m);
    const hwKey = keys.find((k) => /^config\/[^/]+\/hardware\.json$/.test(k));
    if (hwKey) hwJson = await readJsonIf(m, hwKey);
    const hw = extractCpuInfo(hwJson || {});

    // Optional metrics for sorting (if you emit energy/metrics.json)
    const metrics = await readJsonIf(m, "energy/metrics.json") || {};

    const images = pickPngs(id, m);

    rows.push({
      id,
      zenodo: `https://zenodo.org/records/${id}`,
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

  // Sort & filter
  const sel = document.getElementById("sort").value;
  const [k, dir] = sel.split(":");
  const cpuFilt = document.getElementById("cpuFilter").value
    .trim().toLowerCase();
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
}

function wireUi() {
  document.getElementById("refresh").onclick = loadAndRender;
  document.getElementById("sort").onchange = loadAndRender;
  document.getElementById("cpuFilter").oninput = () => {
    clearTimeout(window._t);
    window._t = setTimeout(loadAndRender, 250);
  };
}

window.addEventListener("DOMContentLoaded", () => {
  wireUi();
  loadAndRender().catch((err) => {
    document.getElementById("grid").innerHTML =
      `<p class="error">Failed to load: ${err.message}</p>`;
  });
});
