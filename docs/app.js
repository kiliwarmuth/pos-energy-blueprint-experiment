/* Leaderboard — GitHub submission source only (manifest-only). */

const STATUS = {
  set(t) { const e = document.getElementById("status"); if (e) e.textContent = String(t); },
  add(l) {
    const e = document.getElementById("status"); if (!e) return;
    e.textContent = (e.textContent || "") + (e.textContent ? "\n" : "") + String(l);
  },
};

// quiet debug to console only if verbose=true
const dbg = (...a) => { if ((window.APP_CFG || {}).verbose) console.log("[lb]", ...a); };

function cfgFromUrl(base) {
  const u = new URL(location.href), p = u.searchParams, c = { ...base };
  if (p.get("owner")) c.gh_owner = p.get("owner");
  if (p.get("repo")) c.gh_repo = p.get("repo");
  if (p.get("branch")) c.gh_branch = p.get("branch");
  if (p.get("path")) c.gh_path = p.get("path");
  if (p.get("verbose")) c.verbose = p.get("verbose") !== "false";
  return c;
}

async function ghJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }
function ghContentsUrl(c, path) {
  return `https://api.github.com/repos/${c.gh_owner}/${c.gh_repo}/contents/` +
    `${encodeURIComponent(path)}?ref=${encodeURIComponent(c.gh_branch)}`;
}
async function ghListDir(cfg, path) { return ghJson(ghContentsUrl(cfg, path)); }

async function ghListRuns(cfg) {
  const runs = [];
  const root = await ghListDir(cfg, cfg.gh_path);
  for (const user of root.filter((x) => x.type === "dir")) {
    const userDir = await ghListDir(cfg, `${cfg.gh_path}/${user.name}`);
    for (const run of userDir.filter((x) => x.type === "dir")) {
      runs.push({ user: user.name, path: `${cfg.gh_path}/${user.name}/${run.name}` });
    }
  }
  return runs;
}

/* ---------- helpers for manifest fields ---------- */

function normalizeAuthor(author, fallbackUser) {
  if (!author || typeof author !== "object") {
    return {
      display_name: fallbackUser || "unknown", handle: fallbackUser || "unknown",
      orcid: "", affiliation_name: "", affiliation_ror: ""
    };
  }
  const display = author.display_name || author.name ||
    [author.givenName, author.familyName].filter(Boolean).join(" ") ||
    author.alternateName || fallbackUser || "unknown";
  const handle = author.handle || author.alternateName || fallbackUser || "unknown";
  return {
    display_name: display, handle,
    orcid: author.orcid || "",
    affiliation_name: author.affiliation_name || "",
    affiliation_ror: author.affiliation_ror || "",
  };
}

function summarizeProcessors(procList) {
  const arr = Array.isArray(procList) ? procList : [];
  const first = arr[0] || {};
  const vendor = first.vendor || "";
  const model = first.model || "";
  const label = [vendor, model].filter(Boolean).join(" ").trim() || "unknown";
  const total_cores = arr.reduce((s, p) => s + (Number.isFinite(p.cores) ? p.cores : 0), 0);
  const total_threads = arr.reduce((s, p) => s + (Number.isFinite(p.threads) ? p.threads : 0), 0);
  return { label, total_cores, total_threads, sockets: arr.length, sockets_list: arr };
}

async function ghReadRun(cfg, run) {
  // manifest.json (required)
  const m = await ghJson(ghContentsUrl(cfg, `${run.path}/manifest.json`));
  const txt = await (await fetch(m.download_url)).text();
  const manifest = JSON.parse(txt);

  // metrics: prefer explicit energy/metrics.json if present
  let metrics = manifest.metrics || {};
  try {
    const mm = await ghJson(ghContentsUrl(cfg, `${run.path}/energy/metrics.json`));
    metrics = JSON.parse(await (await fetch(mm.download_url)).text()) || metrics;
  } catch (_) { /* optional */ }

  // images: canonical names, case-insensitive
  const want = [
    "power-over-time.png",
    "total-energy-per-node.png",
    "current-over-time.png",
    "smoothed-voltage.png",
  ];
  let images = [];
  try {
    const energyItems = await ghListDir(cfg, `${run.path}/energy`);
    const byLower = Object.fromEntries(
      energyItems
        .filter((it) => it.type === "file" && it.name.toLowerCase().endsWith(".png") && it.download_url)
        .map((it) => [it.name.toLowerCase(), it.download_url]),
    );
    images = want.map((name) => byLower[name] || "");
  } catch (_) { images = []; }

  // author + cpu
  const author = normalizeAuthor(manifest.author, manifest.username || run.user);
  const { label: cpuLabel, total_cores, total_threads, sockets, sockets_list } =
    summarizeProcessors(manifest.processor);
  const ht = manifest.threading_enabled;
  const htBadge = typeof ht === "boolean" ? (ht ? "" : " (HT off)") : "";

  const created = manifest.created || "";
  const run_id = manifest.run_id || run.path.split("/").pop();
  const zenodo = manifest.zenodo_html || "";

  return {
    id: run_id,
    user: author.handle || run.user,
    user_display: author.display_name || author.handle || run.user,
    affiliation_name: author.affiliation_name || "",
    affiliation_ror: author.affiliation_ror || "",
    cpu_label: cpuLabel,
    cores: total_cores,
    threads: total_threads,
    sockets,
    sockets_list,
    ht_badge: htBadge,
    avg_power_w: metrics.avg_power_w,
    peak_power_w: metrics.peak_power_w,
    energy_wh: metrics.energy_wh,
    created,
    zenodo,
    images,
  };
}

/* ---------- UI helpers ---------- */

function scoreNum(row, key, dir) {
  const v = +(row[key] ?? NaN);
  if (Number.isNaN(v)) return dir === "asc" ? +Infinity : -Infinity;
  return v;
}

function populateUserFilter(rows) {
  const sel = document.getElementById("userFilter");
  if (!sel) return;
  const seen = new Map(); // handle -> display
  rows.forEach((r) => {
    if (!seen.has(r.user)) seen.set(r.user, r.user_display || r.user);
  });
  const cur = sel.value;
  sel.innerHTML = `<option value="">All</option>` +
    [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([handle, name]) => `<option value="${handle}">${name}</option>`)
      .join("");
  if ([...seen.keys()].includes(cur)) sel.value = cur;
}

function render(rows) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";

  const stats = document.getElementById("stats");
  if (stats) {
    const users = new Set(rows.map((r) => r.user));
    stats.textContent = `${rows.length} runs · ${users.size} users`;
  }

  rows.forEach((r) => {
    const el = document.createElement("article");
    el.className = "card";

    const imgs = r.images.map((u) =>
      `<a href="${u}" target="_blank" rel="noopener">
         <img src="${u}" alt="energy plot" loading="lazy"
              onerror="this.style.outline='2px solid #f77';this.alt='missing';">
       </a>`).join("");

    const aff = r.affiliation_name
      ? (r.affiliation_ror
        ? `<a href="${r.affiliation_ror}" target="_blank" rel="noopener">${r.affiliation_name}</a>`
        : r.affiliation_name)
      : "";

    const socketsBadge = r.sockets > 1 ? ` <span class="badge">${r.sockets}× sockets</span>` : "";

    const socketsList = (r.sockets_list && r.sockets_list.length > 1)
      ? `<ul class="cpu-sockets">${r.sockets_list.map((p) =>
        `<li>${[p.vendor, p.model].filter(Boolean).join(" ")} (${p.cores ?? "?"}/${p.threads ?? "?"})</li>`
      ).join("")
      }</ul>` : "";

    const meta = `
      <div class="meta">
        <div><strong>User:</strong> ${r.user_display}${aff ? ` · ${aff}` : ""}</div>
        <div><strong>CPU:</strong> ${r.cpu_label} (${r.cores}/${r.threads})${r.ht_badge}${socketsBadge}</div>
        ${socketsList}
        <div><strong>Power / Energy:</strong>
          ${r.avg_power_w ?? "–"} W avg ·
          ${r.peak_power_w ?? "–"} W peak ·
          ${r.energy_wh ?? "–"} Wh</div>
        ${r.zenodo ? `<div><a href="${r.zenodo}" target="_blank" rel="noopener">Results on Zenodo</a></div>` : ""}
      </div>`;

    el.innerHTML = `<h3>Run ${r.id}</h3>${meta}<div class="imgs">${imgs}</div>`;
    grid.appendChild(el);
  });
}

/* ---------- main ---------- */

async function loadAndRender() {
  const cfg = cfgFromUrl({ ...window.APP_CFG });
  const kw = document.getElementById("kw");
  if (kw) kw.textContent = `${cfg.gh_owner}/${cfg.gh_repo}:${cfg.gh_path}`;

  try {
    STATUS.set("Listing submissions…");
    const runs = await ghListRuns(cfg);

    const allRows = [];
    for (const r of runs) {
      try { allRows.push(await ghReadRun(cfg, r)); }
      catch (e) { dbg("skip", r.path, e.message); }
    }

    // Populate user filter once we have data
    populateUserFilter(allRows);

    // Apply filters + sorting
    const sortSel = document.getElementById("sort");
    const cpuInp = document.getElementById("cpuFilter");
    const userSel = document.getElementById("userFilter");

    const sel = sortSel ? sortSel.value : "created:desc";
    const [k, dir] = sel.split(":");

    const cpuFilt = (cpuInp ? cpuInp.value : "").trim().toLowerCase();
    const userFilt = userSel ? (userSel.value || "") : "";

    const filtered = allRows.filter((r) => {
      const okUser = userFilt ? (r.user === userFilt) : true;
      const okCpu = cpuFilt ? (r.cpu_label || "").toLowerCase().includes(cpuFilt) : true;
      return okUser && okCpu;
    });

    filtered.sort((a, b) => {
      if (k === "created") {
        const ta = Date.parse(a.created || 0), tb = Date.parse(b.created || 0);
        return dir === "asc" ? ta - tb : tb - ta;
      }
      const sa = scoreNum(a, k, dir), sb = scoreNum(b, k, dir);
      return dir === "asc" ? sa - sb : sb - sa;
    });

    render(filtered);
    STATUS.add("Done.");
  } catch (e) {
    console.error(e);
    STATUS.add(`ERROR: ${e.message}`);
    const grid = document.getElementById("grid");
    if (grid) grid.innerHTML = `<p class="error">Failed: ${e.message}</p>`;
  }
}

function wireUi() {
  const refresh = document.getElementById("refresh");
  if (refresh) refresh.addEventListener("click", loadAndRender);

  const sort = document.getElementById("sort");
  if (sort) sort.addEventListener("change", loadAndRender);

  const cpu = document.getElementById("cpuFilter");
  if (cpu) cpu.addEventListener("input", () => {
    clearTimeout(window._t); window._t = setTimeout(loadAndRender, 250);
  });

  const userSel = document.getElementById("userFilter");
  if (userSel) userSel.addEventListener("change", loadAndRender);
}

window.addEventListener("DOMContentLoaded", () => { wireUi(); loadAndRender(); });