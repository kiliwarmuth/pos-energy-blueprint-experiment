/* Leaderboard — static-only (reads docs/leaderboard.json). */

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

/* ---------- load static index ---------- */

async function fetchIndexJson() {
  try {
    const r = await fetch("leaderboard.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    throw new Error(`Failed to load leaderboard.json: ${e.message}`);
  }
}

function rowsFromIndexJson(idx) {
  return Array.isArray(idx?.runs) ? idx.runs : [];
}

/* ---------- theme manager (bullet-proof via injected <style>) ---------- */

const THEME_KEY = "pos-leaderboard-theme"; // 'auto' | 'light' | 'dark'
const THEME_STYLE_ID = "theme-override-vars";

const THEME_CSS = {
  light: `
:root{
  --bg:#f5f7fb; --card:#ffffff; --text:#0f172a; --muted:#52607a;
  --accent:#2a6df0; --border:#d9e0ef;
  --shadow:0 2px 24px rgba(0,0,0,.08);
  --badge-ok:#e7f5ee; --badge-warn:#fdeaea; --badge:#edf1f7;
}
`,
  dark: `
:root{
  --bg:#0b1020; --card:#111730; --text:#e8eefc; --muted:#a7b0c6;
  --accent:#6aa1ff; --border:#26304d;
  --shadow:0 2px 24px rgba(0,0,0,.25);
  --badge-ok:#1f3b2e; --badge-warn:#4a2c2c; --badge:#2a3344;
}
`,
};

function setThemeStyle(cssText) {
  let tag = document.getElementById(THEME_STYLE_ID);
  if (!tag) {
    tag = document.createElement("style");
    tag.id = THEME_STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = cssText || "";
}

function applyTheme(mode) {
  const root = document.documentElement;

  if (mode === "light") {
    root.setAttribute("data-theme", "light");
    setThemeStyle(THEME_CSS.light);
  } else if (mode === "dark") {
    root.setAttribute("data-theme", "dark");
    setThemeStyle(THEME_CSS.dark);
  } else {
    root.removeAttribute("data-theme");
    setThemeStyle("");
  }

  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  console.log("theme->", mode, "bg:", bg);
}

function initTheme() {
  const saved =
    (localStorage.getItem(THEME_KEY) || "auto").toLowerCase().trim();
  applyTheme(saved);

  const sel = document.getElementById("theme");
  if (sel) sel.value = ["light", "dark"].includes(saved) ? saved : "auto";

  const mm = window.matchMedia("(prefers-color-scheme: dark)");
  mm.addEventListener("change", () => {
    const cur = (localStorage.getItem(THEME_KEY) || "auto").toLowerCase();
    if (cur === "auto") applyTheme("auto");
  });
}

/* ---------- helpers ---------- */

function formatNum(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "–";
  return Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) :
    n.toFixed(1);
}

function formatDateLocal(iso) {
  if (!iso) return "Unknown time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown time";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------- cache + filtering ---------- */

let ALL_ROWS = [];
let CURRENT_SORT = "created:desc";

/* Build CPU list once */
function uniqueCpuList(rows) {
  const set = new Set(
    rows.map((r) => (r.cpu_label || "").trim()).filter(Boolean)
  );
  return [...set].sort((a, b) => a.localeCompare(b));
}

function scoreNum(row, key, dir) {
  const v = +(row[key] ?? NaN);
  if (Number.isNaN(v)) return dir === "asc" ? +Infinity : -Infinity;
  return v;
}

function cpuMatches(rowCpu, filterRaw) {
  if (!filterRaw) return true;
  const hay = (rowCpu || "").toLowerCase();
  const q = filterRaw.toLowerCase().trim();
  if (!q) return true;
  if (hay === q) return true;
  if (hay.includes(q)) return true;
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

function updateStatsSummary(rows) {
  const el = document.getElementById("stats");
  if (!el) return;
  const users = new Set(rows.map((r) => r.user).filter(Boolean));
  const cpus = new Set(rows.map((r) => r.cpu_label).filter(Boolean));
  const nodes = new Set(rows.map((r) => r.node).filter(Boolean));

  const nums = (key) =>
    rows.map((r) => +(r[key] ?? NaN)).filter((v) => Number.isFinite(v));
  const min = (arr) => (arr.length ? Math.min(...arr) : NaN);
  const max = (arr) => (arr.length ? Math.max(...arr) : NaN);

  const avgList = nums("avg_power_w");
  const peakList = nums("peak_power_w");
  const whList = nums("energy_wh");

  el.innerHTML =
    `${rows.length} runs · ${users.size} users · ${cpus.size} CPUs · ` +
    `${nodes.size} nodes — ` +
    `Avg W: ${formatNum(min(avgList))}–${formatNum(max(avgList))} · ` +
    `Peak W: ${formatNum(min(peakList))}–${formatNum(max(peakList))} · ` +
    `Wh: ${formatNum(min(whList))}–${formatNum(max(whList))}`;
}

/* ---------- AUTOCOMPLETE (CPU) ---------- */

const AC = {
  items: [],
  filtered: [],
  open: false,
  hi: -1, // highlighted index
};

function acOpen() {
  const panel = document.getElementById("cpu-ac-panel");
  if (!panel) return;
  panel.classList.add("open");
  document.getElementById("cpuFilter")?.setAttribute("aria-expanded", "true");
  AC.open = true;
}

function acClose() {
  const panel = document.getElementById("cpu-ac-panel");
  if (!panel) return;
  panel.classList.remove("open");
  document.getElementById("cpuFilter")?.setAttribute("aria-expanded", "false");
  AC.open = false;
  AC.hi = -1;
}

function acRender() {
  const panel = document.getElementById("cpu-ac-panel");
  if (!panel) return;
  panel.innerHTML = AC.filtered
    .map(
      (cpu, i) =>
        `<div class="ac-item${i === AC.hi ? " active" : ""}" role="option" data-i="${i}">${cpu}</div>`
    )
    .join("");
}

function acFilter(q) {
  const query = (q || "").toLowerCase().trim();
  if (!query) {
    AC.filtered = AC.items.slice(0, 200); // cap just in case
  } else {
    AC.filtered = AC.items.filter((c) => c.toLowerCase().includes(query));
  }
  AC.hi = AC.filtered.length ? 0 : -1;
  acRender();
}

function acSelect(index) {
  if (index < 0 || index >= AC.filtered.length) return;
  const value = AC.filtered[index];
  const input = document.getElementById("cpuFilter");
  if (!input) return;
  input.value = value;
  acClose();
  renderFiltered();
}

function acWire() {
  const input = document.getElementById("cpuFilter");
  const panel = document.getElementById("cpu-ac-panel");
  if (!input || !panel) return;

  input.addEventListener("focus", () => {
    acFilter(input.value); // show all or filtered
    acOpen();
  });

  input.addEventListener("input", () => {
    acFilter(input.value);
    if (!AC.open) acOpen();
    renderFiltered(); // live filter list below
  });

  input.addEventListener("keydown", (e) => {
    if (!AC.open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      AC.hi = Math.min(AC.hi + 1, AC.filtered.length - 1);
      acRender();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      AC.hi = Math.max(AC.hi - 1, 0);
      acRender();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      acSelect(AC.hi);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      acClose();
    }
  });

  panel.addEventListener("mousedown", (e) => {
    const t = e.target.closest(".ac-item");
    if (!t) return;
    e.preventDefault(); // avoid input blur before we set value
    const i = Number(t.getAttribute("data-i"));
    acSelect(i);
  });

  document.addEventListener("click", (e) => {
    if (!AC.open) return;
    if (!panel.contains(e.target) && e.target !== input) {
      acClose();
    }
  });
}

/* ---------- AUTOCOMPLETE (USER) ---------- */

const UAC = {
  items: [],
  filtered: [],
  open: false,
  hi: -1, // highlighted index
};

function uniqueUserList(rows) {
  const set = new Set(
    rows
      .map((r) => (r.user_display || r.user || "").trim())
      .filter(Boolean)
  );
  return [...set].sort((a, b) => a.localeCompare(b));
}

function userMatches(row, filterRaw) {
  if (!filterRaw) return true;
  const q = filterRaw.toLowerCase().trim();
  if (!q) return true;

  const hay1 = (row.user_display || "").toLowerCase();
  const hay2 = (row.user || "").toLowerCase();

  if (hay1 === q || hay2 === q) return true;
  if (hay1.includes(q) || hay2.includes(q)) return true;

  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every((t) => hay1.includes(t) || hay2.includes(t));
}

function uacOpen() {
  const panel = document.getElementById("user-ac-panel");
  if (!panel) return;
  panel.classList.add("open");
  document.getElementById("userFilter")?.setAttribute("aria-expanded", "true");
  UAC.open = true;
}

function uacClose() {
  const panel = document.getElementById("user-ac-panel");
  if (!panel) return;
  panel.classList.remove("open");
  document.getElementById("userFilter")?.setAttribute("aria-expanded", "false");
  UAC.open = false;
  UAC.hi = -1;
}

function uacRender() {
  const panel = document.getElementById("user-ac-panel");
  if (!panel) return;
  panel.innerHTML = UAC.filtered
    .map(
      (name, i) =>
        `<div class="ac-item${i === UAC.hi ? " active" : ""}"
              role="option" data-i="${i}">${name}</div>`
    )
    .join("");
}

function uacFilter(q) {
  const query = (q || "").toLowerCase().trim();
  if (!query) {
    UAC.filtered = UAC.items.slice(0, 200);
  } else {
    UAC.filtered = UAC.items.filter((n) => n.toLowerCase().includes(query));
  }
  UAC.hi = UAC.filtered.length ? 0 : -1;
  uacRender();
}

function uacSelect(index) {
  if (index < 0 || index >= UAC.filtered.length) return;
  const value = UAC.filtered[index];
  const input = document.getElementById("userFilter");
  if (!input) return;
  input.value = value;
  uacClose();
  renderFiltered();
}

function uacWire() {
  const input = document.getElementById("userFilter");
  const panel = document.getElementById("user-ac-panel");
  if (!input || !panel) return;

  input.addEventListener("focus", () => {
    uacFilter(input.value);
    uacOpen();
  });

  input.addEventListener("input", () => {
    uacFilter(input.value);
    if (!UAC.open) uacOpen();
    renderFiltered();
  });

  input.addEventListener("keydown", (e) => {
    if (!UAC.open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      UAC.hi = Math.min(UAC.hi + 1, UAC.filtered.length - 1);
      uacRender();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      UAC.hi = Math.max(UAC.hi - 1, 0);
      uacRender();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      uacSelect(UAC.hi);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      uacClose();
    }
  });

  panel.addEventListener("mousedown", (e) => {
    const t = e.target.closest(".ac-item");
    if (!t) return;
    e.preventDefault();
    const i = Number(t.getAttribute("data-i"));
    uacSelect(i);
  });

  document.addEventListener("click", (e) => {
    if (!UAC.open) return;
    if (!panel.contains(e.target) && e.target !== input) {
      uacClose();
    }
  });
}


/* ---------- filtering + rendering ---------- */

function renderFiltered() {
  if (!Array.isArray(ALL_ROWS)) ALL_ROWS = [];

  const sortSel = document.getElementById("sort");
  const cpuInp = document.getElementById("cpuFilter");
  const userInp = document.getElementById("userFilter");

  const sel = sortSel ? sortSel.value : "created:desc";
  CURRENT_SORT = sel;
  const [k, dir] = sel.split(":");

  const cpuFilt = (cpuInp ? cpuInp.value : "").trim();
  const userFilt = (userInp ? userInp.value : "").trim();

  const filtered = ALL_ROWS
    .filter((r) => cpuMatches(r.cpu_label, cpuFilt))
    .filter((r) => userMatches(r, userFilt));

  filtered.sort((a, b) => {
    if (k === "created") {
      const ta = Date.parse(a.created || 0);
      const tb = Date.parse(b.created || 0);
      return dir === "asc" ? ta - tb : tb - ta;
    }
    if (k === "user") {
      const ua = (a.user_display || a.user || "").toLowerCase();
      const ub = (b.user_display || b.user || "").toLowerCase();
      return dir === "asc" ? ua.localeCompare(ub) : ub.localeCompare(ua);
    }
    const sa = scoreNum(a, k, dir);
    const sb = scoreNum(b, k, dir);
    return dir === "asc" ? sa - sb : sb - sa;
  });

  updateStatsSummary(filtered);

  const isDateSort = k === "created";
  render(filtered, { groupByDate: isDateSort });
}


/* ---------- render ---------- */

function render(rows, opts = {}) {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";

  if (opts.groupByDate) {
    const groups = new Map();
    rows.forEach((r) => {
      const d = (r.created || "").slice(0, 10) || "Unknown date";
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(r);
    });

    for (const [date, runs] of groups) {
      const section = document.createElement("section");
      section.className = "day-group";
      section.innerHTML = `
        <details open>
          <summary><strong>${date}</strong> (${runs.length} runs)</summary>
          <div class="day-grid"></div>
        </details>
      `;
      const innerGrid = section.querySelector(".day-grid");
      runs.forEach((r) => innerGrid.appendChild(renderCard(r)));
      grid.appendChild(section);
    }
  } else {
    rows.forEach((r) => grid.appendChild(renderCard(r)));
  }
}

function renderCard(r) {
  const el = document.createElement("article");
  el.className = "card";

  const imgs = (r.images || [])
    .map(
      (u) =>
        `<a href="${u}" target="_blank" rel="noopener">
           <img src="${u}" alt="energy plot" loading="lazy"
                onerror="this.style.outline='2px solid #f77';this.alt='missing';">
         </a>`
    )
    .join("");

  const aff = r.affiliation_name
    ? r.affiliation_ror
      ? `<a href="${r.affiliation_ror}" target="_blank" rel="noopener">${r.affiliation_name}</a>`
      : r.affiliation_name
    : "";

  const htIsOff =
    typeof r.ht_badge === "string" &&
    r.ht_badge.toLowerCase().includes("off");
  const htBadgeHtml = htIsOff
    ? `<span class="badge warn" title="Hyperthreading disabled">HT off</span>`
    : `<span class="badge ok" title="Hyperthreading enabled">HT on</span>`;

  const sockets =
    r.sockets ?? (Array.isArray(r.sockets_list) ? r.sockets_list.length : 1);

  let socketsInline = "";
  if (sockets > 1 && Array.isArray(r.sockets_list) && r.sockets_list.length > 1) {
    const list = r.sockets_list
      .map((p, i) => {
        const label = [p.vendor, p.model].filter(Boolean).join(" ");
        const cores = Number.isFinite(p.cores) ? p.cores : "?";
        const th = Number.isFinite(p.threads) ? p.threads : "?";
        return (
          `<li>` +
          `<div class="socket-head"><span class="muted">Socket ${i}:</span></div>` +
          `<div class="socket-line">${label}</div>` +
          `<div class="socket-line">${cores} cores · ${th} threads</div>` +
          `</li>`
        );
      })
      .join("");
    socketsInline = `
    <details class="sockets-inline">
      <summary class="chip sockets-chip" title="Show per-socket details">
        <span class="chev-sock" aria-hidden="true">▸</span>
        ${sockets}× sockets
      </summary>
      <ul class="cpu-sockets compact">${list}</ul>
    </details>`;
  } else if (sockets > 1) {
    socketsInline =
      ` <span class="chip sockets-chip" title="Number of CPU packages">` +
      `${sockets}× sockets</span>`;
  }


  const nodeChip = r.node
    ? `<span class="chip node" title="Compute node">${r.node}</span>`
    : "";

  const name = r.user_display || r.user || "unknown";
  const orcidHtml = r.orcid
    ? ` <span class="dot" aria-hidden="true">·</span> ` +
    `<a class="orcid" href="${r.orcid}" target="_blank" rel="noopener">` +
    `ORCID</a>`
    : "";

  const meta = `
  <div class="meta">
    <div><strong>User:</strong> ${name}${orcidHtml}</div>
    ${aff ? `<div class="muted">${aff}</div>` : ""}

    <div class="section">
      <div><strong>CPU:</strong> ${r.cpu_label || "unknown"}</div>
      <div class="muted badges-row">
        ${r.cores ?? "?"} cores · ${r.threads ?? "?"} threads
        ${htBadgeHtml}
        ${socketsInline}
      </div>
    </div>

    <div class="section">
      <div><strong>Energy Metrics:</strong> Power Consumption</div>
      <div class="metric-line">
        <span class="metric">${formatNum(r.avg_power_w)} W avg</span> ·
        <span class="metric">${formatNum(r.peak_power_w)} W peak</span> ·
        <span class="metric">${formatNum(r.energy_wh)} Wh</span>
      </div>
    </div>

    ${r.zenodo
      ? `<div class="section results-link">
             <strong>Results:</strong>
             <a href="${r.zenodo}" target="_blank" rel="noopener">
               Zenodo Deposition
             </a>
           </div>`
      : ""
    }

    <div class="section">
      <div>
        <strong>Energy Plots:</strong>
        <span class="secondary">power and energy over time</span>
      </div>
    </div>
  </div>`;

  el.innerHTML = `
    <div class="card-head">
      <div class="title-row">
        <span>Run</span>
        <span class="run-id">${r.id}</span>
      </div>
      <div class="node-row">
        <span class="muted">on node</span> ${nodeChip}
      </div>
    </div>
    ${meta}
    <div class="imgs">${imgs}</div>
  `;

  return el;
}



/* ---------- main ---------- */

async function loadAndRender() {
  try {
    const kw = document.getElementById("kw");
    if (kw) kw.textContent = "static · leaderboard.json";

    STATUS.set("Loading index…");
    const idx = await fetchIndexJson();
    ALL_ROWS = rowsFromIndexJson(idx);

    // init autocomplete CPU list
    AC.items = uniqueCpuList(ALL_ROWS);
    AC.filtered = AC.items.slice(0, 200);
    acRender();

    // init autocomplete USER list
    UAC.items = uniqueUserList(ALL_ROWS);
    UAC.filtered = UAC.items.slice(0, 200);
    uacRender();

    renderFiltered();
    STATUS.set("Done.");
  } catch (e) {
    console.error(e);
    STATUS.set(`ERROR: ${e.message}`);
    const grid = document.getElementById("grid");
    if (grid) {
      grid.innerHTML = `<p class="error">Failed: ${e.message}</p>`;
    }
  }
}

function wireUi() {
  const refresh = document.getElementById("refresh");
  if (refresh) refresh.addEventListener("click", loadAndRender);

  const sort = document.getElementById("sort");
  if (sort) sort.addEventListener("change", renderFiltered);

  acWire(); // wire the custom CPU autocomplete
  uacWire();  // USER AC

  const themeSel = document.getElementById("theme");
  if (themeSel) {
    themeSel.addEventListener("change", (e) => {
      const mode = (e.target.value || "auto").toLowerCase();
      localStorage.setItem("pos-leaderboard-theme", mode);
      applyTheme(mode);
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  wireUi();
  loadAndRender();
});

function updateStatsSummary(rows) {
  const root = document.getElementById("stats");
  const head = document.getElementById("statsSummary");
  const body = document.getElementById("statsDetails");

  // Back-compat: if old <div id="stats"> exists, still fill it.
  if (!root || !head || !body) {
    const el = document.getElementById("stats");
    if (!el) return;
    const users = new Set(rows.map((r) => r.user).filter(Boolean));
    const cpus = new Set(rows.map((r) => r.cpu_label).filter(Boolean));
    const nodes = new Set(rows.map((r) => r.node).filter(Boolean));
    const nums = (k) =>
      rows.map((r) => +(r[k] ?? NaN)).filter(Number.isFinite);
    const min = (a) => (a.length ? Math.min(...a) : NaN);
    const max = (a) => (a.length ? Math.max(...a) : NaN);
    el.innerHTML =
      `${rows.length} runs · ${users.size} users · ${cpus.size} CPUs · ` +
      `${nodes.size} nodes — ` +
      `Avg W: ${formatNum(min(nums("avg_power_w")))}–${formatNum(max(nums("avg_power_w")))} · ` +
      `Peak W: ${formatNum(min(nums("peak_power_w")))}–${formatNum(max(nums("peak_power_w")))} · ` +
      `Wh: ${formatNum(min(nums("energy_wh")))}–${formatNum(max(nums("energy_wh")))}`;
    return;
  }

  const users = new Set(rows.map((r) => r.user).filter(Boolean));
  const cpus = new Set(rows.map((r) => r.cpu_label).filter(Boolean));
  const nodes = new Set(rows.map((r) => r.node).filter(Boolean));

  const nums = (k) =>
    rows.map((r) => +(r[k] ?? NaN)).filter(Number.isFinite);
  const min = (a) => (a.length ? Math.min(...a) : NaN);
  const max = (a) => (a.length ? Math.max(...a) : NaN);

  // Optional: date span
  const ts = rows
    .map((r) => Date.parse(r.created || ""))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const first = ts.length ? new Date(ts[0]).toLocaleDateString() : "–";
  const last = ts.length ? new Date(ts[ts.length - 1]).toLocaleDateString() : "–";

  // Summary (always visible)
  head.innerHTML = `<span class="stat-pill">${rows.length} runs</span>`;

  // Details (on expand)
  const detailHtml = `
    <div class="stats-grid">
      <div><span class="stat-label">Users</span><div class="stat-value">${users.size}</div></div>
      <div><span class="stat-label">CPUs</span><div class="stat-value">${cpus.size}</div></div>
      <div><span class="stat-label">Nodes</span><div class="stat-value">${nodes.size}</div></div>
      <div><span class="stat-label">Avg power (W)</span>
           <div class="stat-value">${formatNum(min(nums("avg_power_w")))}–${formatNum(max(nums("avg_power_w")))}</div></div>
      <div><span class="stat-label">Peak power (W)</span>
           <div class="stat-value">${formatNum(min(nums("peak_power_w")))}–${formatNum(max(nums("peak_power_w")))}</div></div>
      <div><span class="stat-label">Energy (Wh)</span>
           <div class="stat-value">${formatNum(min(nums("energy_wh")))}–${formatNum(max(nums("energy_wh")))}</div></div>
      <div><span class="stat-label">Time range</span>
           <div class="stat-value">${first} → ${last}</div></div>
    </div>
  `;
  body.innerHTML = detailHtml;
}
