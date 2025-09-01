/* Leaderboard — GitHub submission source only (no Zenodo). */

const STATUS = {
  set(t) {
    const e = document.getElementById("status");
    if (e) e.textContent = String(t);
  },
  add(l) {
    const e = document.getElementById("status");
    if (!e) return;
    e.textContent =
      (e.textContent || "") + (e.textContent ? "\n" : "") + String(l);
  },
};

// quiet debug: only logs to console if verbose=true, not to status
const dbg = (...a) => {
  if ((window.APP_CFG || {}).verbose) {
    console.log("[lb]", ...a);
  }
};

function cfgFromUrl(base) {
  const u = new URL(location.href);
  const p = u.searchParams;
  const c = { ...base };
  if (p.get("owner")) c.gh_owner = p.get("owner");
  if (p.get("repo")) c.gh_repo = p.get("repo");
  if (p.get("branch")) c.gh_branch = p.get("branch");
  if (p.get("path")) c.gh_path = p.get("path");
  if (p.get("verbose")) c.verbose = p.get("verbose") !== "false";
  return c;
}

async function ghJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function ghContentsUrl(c, path) {
  return (
    `https://api.github.com/repos/${c.gh_owner}/${c.gh_repo}/contents/` +
    `${encodeURIComponent(path)}?ref=${encodeURIComponent(c.gh_branch)}`
  );
}

async function ghListDir(cfg, path) {
  const url = ghContentsUrl(cfg, path);
  return ghJson(url);
}

async function ghListRuns(cfg) {
  const runs = [];
  const root = await ghJson(ghContentsUrl(cfg, cfg.gh_path));
  for (const user of root.filter((x) => x.type === "dir")) {
    const userDir = await ghJson(
      ghContentsUrl(cfg, `${cfg.gh_path}/${user.name}`),
    );
    for (const run of userDir.filter((x) => x.type === "dir")) {
      runs.push({
        user: user.name,
        path: `${cfg.gh_path}/${user.name}/${run.name}`,
      });
    }
  }
  return runs;
}

async function ghReadRun(cfg, run) {
  let manifest = {};
  let metrics = {};

  try {
    const m = await ghJson(ghContentsUrl(cfg, `${run.path}/manifest.json`));
    const txt = await (await fetch(m.download_url)).text();
    manifest = JSON.parse(txt);
    metrics = manifest.metrics || {};
  } catch (_) { }

  try {
    const mm = await ghJson(
      ghContentsUrl(cfg, `${run.path}/energy/metrics.json`),
    );
    metrics =
      JSON.parse(await (await fetch(mm.download_url)).text()) || metrics;
  } catch (_) { }

  let cpu = "unknown";
  let cores = 0;
  let threads = 0;
  try {
    const cfgDir = await ghJson(ghContentsUrl(cfg, `${run.path}/config`));
    const nodeDir = cfgDir.find((x) => x.type === "dir");
    if (nodeDir) {
      const hw = await ghJson(
        ghContentsUrl(cfg, `${run.path}/config/${nodeDir.name}/hardware.json`),
      );
      const hwObj = JSON.parse(await (await fetch(hw.download_url)).text());
      cpu = hwObj.cpu_model || hwObj.model || "unknown";
      cores = +(hwObj.cpu_cores || hwObj.cores || 0);
      threads = +(hwObj.cpu_threads || hwObj.threads || cores || 0);
    }
  } catch (_) { }

  const want = [
    "power-over-time.png",
    "total-energy-per-node.png",
    "current-over-time.png",
    "smoothed-voltage.png",
  ];
  let imgs = [];
  try {
    const energyItems = await ghListDir(cfg, `${run.path}/energy`);
    const byLower = Object.fromEntries(
      energyItems
        .filter(
          (it) =>
            it.type === "file" &&
            it.name.toLowerCase().endsWith(".png") &&
            it.download_url,
        )
        .map((it) => [it.name.toLowerCase(), it.download_url]),
    );
    imgs = want.map((name) => byLower[name] || "");
  } catch (_) { }

  const created = manifest.created || "";
  const run_id = manifest.run_id || run.path.split("/").pop();
  const user = manifest.username || run.user;
  const zenodo = manifest.zenodo_html || "";

  return {
    id: run_id,
    zenodo,
    user,
    cpu,
    cores,
    threads,
    avg_power_w: metrics.avg_power_w,
    peak_power_w: metrics.peak_power_w,
    energy_wh: metrics.energy_wh,
    created,
    images: imgs,
  };
}

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
    const users = new Set(rows.map((r) => r.user));
    stats.textContent = `${rows.length} runs · ${users.size} users`;
  }

  rows.forEach((r) => {
    const el = document.createElement("article");
    el.className = "card";

    const imgs = r.images
      .map(
        (u) =>
          `<a href="${u}" target="_blank" rel="noopener">
             <img src="${u}" alt="energy plot" loading="lazy"
                  onerror="this.style.outline='2px solid #f77';this.alt='missing';">
           </a>`,
      )
      .join("");

    const meta = `
      <div class="meta">
        <div><strong>User:</strong> ${r.user}</div>
        <div><strong>CPU:</strong> ${r.cpu} (${r.cores}/${r.threads})</div>
        <div><strong>Avg/Peak/E:</strong>
          ${r.avg_power_w ?? "–"} /
          ${r.peak_power_w ?? "–"} /
          ${r.energy_wh ?? "–"}</div>
        ${r.zenodo
        ? `<div><a href="${r.zenodo}" target="_blank" rel="noopener">Zenodo</a></div>`
        : ""
      }
      </div>`;

    el.innerHTML = `<h3>Run ${r.id}</h3>${meta}<div class="imgs">${imgs}</div>`;
    grid.appendChild(el);
  });
}

async function loadAndRender() {
  const cfg = cfgFromUrl({ ...window.APP_CFG });
  const kw = document.getElementById("kw");
  if (kw) kw.textContent = `${cfg.gh_owner}/${cfg.gh_repo}:${cfg.gh_path}`;

  try {
    STATUS.set("Listing submissions…");
    const runs = await ghListRuns(cfg);
    const rows = [];
    for (const r of runs) {
      try {
        rows.push(await ghReadRun(cfg, r));
      } catch (e) {
        dbg("skip", r.path, e.message);
      }
    }

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