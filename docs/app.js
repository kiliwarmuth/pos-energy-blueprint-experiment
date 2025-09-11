/* Leaderboard — static-only (reads docs/leaderboard.json). */

/* ===================== status line ===================== */

const STATUS = {
  set(t) {
    const e = document.getElementById("status");
    if (e) e.textContent = String(t);
  },
  add(l) {
    const e = document.getElementById("status");
    if (!e) return;
    const cur = e.textContent || "";
    e.textContent = cur + (cur ? "\n" : "") + String(l);
  },
};

/* ===================== load static index ===================== */

let currentFetch = null;

async function fetchIndexJson() {
  currentFetch?.abort();
  currentFetch = new AbortController();
  try {
    const r = await fetch("leaderboard.json", {
      cache: "no-store",
      signal: currentFetch.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new Error(`Failed to load leaderboard.json: ${e.message}`);
  } finally {
    currentFetch = null;
  }
}

function rowsFromIndexJson(idx) {
  return Array.isArray(idx?.runs) ? idx.runs : [];
}

/* ========== theme manager (bullet-proof via injected <style>) ========== */

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
  const m = String(mode || "auto").toLowerCase();

  if (m === "light") {
    root.dataset.theme = "light";
    setThemeStyle(THEME_CSS.light);
  } else if (m === "dark") {
    root.dataset.theme = "dark";
    setThemeStyle(THEME_CSS.dark);
  } else {
    delete root.dataset.theme;
    setThemeStyle("");
  }
}

function initTheme() {
  const saved = (localStorage.getItem(THEME_KEY) || "auto")
    .toLowerCase()
    .trim();
  applyTheme(saved);

  const sel = document.getElementById("theme");
  if (sel) sel.value = ["light", "dark"].includes(saved) ? saved : "auto";

  const mm = window.matchMedia("(prefers-color-scheme: dark)");
  mm.addEventListener("change", () => {
    const cur = (localStorage.getItem(THEME_KEY) || "auto").toLowerCase();
    if (cur === "auto") applyTheme("auto");
  });
}

/* ===================== helpers ===================== */

function formatNum(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "–";
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 1e-6 ? String(rounded) : n.toFixed(1);
}

/* ===================== cache + filtering ===================== */

let ALL_ROWS = [];
let CURRENT_SORT = "created:desc";

/* Build CPU & User lists once when data changes */
function uniqueCpuList(rows) {
  const set = new Set(
    rows.map((r) => (r.cpu_label || "").trim()).filter(Boolean)
  );
  return [...set].sort((a, b) => a.localeCompare(b));
}

function uniqueUserList(rows) {
  const set = new Set(
    rows.map((r) => (r.user_display || r.user || "").trim()).filter(Boolean)
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

/* ===================== Generic Autocomplete ===================== */

function makeAutocomplete({
  inputId,
  panelId,
  getItems,
  onSelect,
  filter = (s, q) => s.toLowerCase().includes(q),
}) {
  const state = { items: [], filtered: [], open: false, hi: -1 };
  const input = document.getElementById(inputId);
  const panel = document.getElementById(panelId);
  if (!input || !panel) return { refresh: () => { } };

  function open() {
    panel.classList.add("open");
    input.setAttribute("aria-expanded", "true");
    state.open = true;
  }
  function close() {
    panel.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
    state.open = false;
    state.hi = -1;
  }
  function render() {
    panel.innerHTML = state.filtered
      .map(
        (v, i) =>
          `<div class="ac-item${i === state.hi ? " active" : ""}"
               role="option" data-i="${i}">${v}</div>`
      )
      .join("");
  }
  function refilter(q) {
    const query = (q || "").toLowerCase().trim();
    state.filtered = !query
      ? state.items.slice(0, 200)
      : state.items.filter((v) => filter(v, query));
    state.hi = state.filtered.length ? 0 : -1;
    render();
  }
  function select(i) {
    if (i < 0 || i >= state.filtered.length) return;
    input.value = state.filtered[i];
    close();
    onSelect(input.value);
  }

  input.addEventListener("focus", () => {
    refilter(input.value);
    open();
  });

  input.addEventListener("input", () => {
    refilter(input.value);
    if (!state.open) open();
    onSelect(input.value); // live filter
  });

  input.addEventListener("keydown", (e) => {
    if (!state.open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.hi = Math.min(state.hi + 1, state.filtered.length - 1);
      render();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      state.hi = Math.max(state.hi - 1, 0);
      render();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      select(state.hi);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  panel.addEventListener("mousedown", (e) => {
    const t = e.target.closest(".ac-item");
    if (!t) return;
    e.preventDefault(); // keep input from blurring
    select(Number(t.dataset.i));
  });

  document.addEventListener("click", (e) => {
    if (!state.open) return;
    if (!panel.contains(e.target) && e.target !== input) close();
  });

  return {
    refresh() {
      state.items = getItems();
      refilter(input.value);
    },
  };
}

/* ===================== filtering + rendering ===================== */

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

/* ===================== render ===================== */

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
  if (
    sockets > 1 &&
    Array.isArray(r.sockets_list) &&
    r.sockets_list.length > 1
  ) {
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
    <summary class="badge sockets-chip" title="Show per-socket details">
      <span class="chev-sock" aria-hidden="true">▸</span>
      ${sockets}× sockets
    </summary>
    <ul class="cpu-sockets compact">${list}</ul>
  </details>`;
  } else if (sockets > 1) {
    socketsInline =
      ` <summary class="badge sockets-chip" title="Number of CPU packages">` +
      `${sockets}× sockets</summary>`;
  }

  const nodeChip = r.node
    ? `<span class="chip node" title="Compute node">${r.node}</span>`
    : "";

  const name = r.user_display || r.user || "unknown";
  const orcidHtml = r.orcid
    ? ` <span class="dot" aria-hidden="true">·</span> ` +
    `<a class="orcid" href="${r.orcid}" target="_blank" rel="noopener">ORCID</a>`
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

/* ===================== stats ===================== */

function statsModel(rows) {
  const setOf = (k) => new Set(rows.map((r) => r[k]).filter(Boolean));
  const nums = (k) =>
    rows.map((r) => +(r[k] ?? NaN)).filter(Number.isFinite);
  const range = (k) => {
    const a = nums(k);
    if (!a.length) return [NaN, NaN];
    return [Math.min(...a), Math.max(...a)];
  };
  const ts = rows
    .map((r) => Date.parse(r.created || ""))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return {
    runs: rows.length,
    users: setOf("user").size,
    cpus: setOf("cpu_label").size,
    nodes: setOf("node").size,
    avg: range("avg_power_w"),
    peak: range("peak_power_w"),
    wh: range("energy_wh"),
    first: ts.length ? new Date(ts[0]).toLocaleDateString("en-CA") : "–",
    last: ts.length ? new Date(ts[ts.length - 1]).toLocaleDateString("en-CA") : "–",
  };
}

function updateStatsSummary(rows) {
  const root = document.getElementById("stats");
  const head = document.getElementById("statsSummary");
  const body = document.getElementById("statsDetails");

  // Back-compat: if old <div id="stats"> exists, still fill it.
  if (!root || !head || !body) {
    const el = document.getElementById("stats");
    if (!el) return;
    const m = statsModel(rows);
    el.innerHTML =
      `${m.runs} runs · ${m.users} users · ${m.cpus} CPUs · ${m.nodes} nodes — ` +
      `Avg W: ${formatNum(m.avg[0])}–${formatNum(m.avg[1])} · ` +
      `Peak W: ${formatNum(m.peak[0])}–${formatNum(m.peak[1])} · ` +
      `Wh: ${formatNum(m.wh[0])}–${formatNum(m.wh[1])}`;
    return;
  }

  const m = statsModel(rows);
  head.innerHTML =
    `<span class="stat-pill">${m.runs} runs</span>` +
    `<span class="stats-hint" aria-hidden="true"> - expand for summary</span>`;

  const detailHtml = `
    <div class="stats-grid">
      <div><span class="stat-label">Users</span>
           <div class="stat-value">${m.users}</div></div>
      <div><span class="stat-label">CPUs</span>
           <div class="stat-value">${m.cpus}</div></div>
      <div><span class="stat-label">Nodes</span>
           <div class="stat-value">${m.nodes}</div></div>
      <div><span class="stat-label">Avg power (W)</span>
           <div class="stat-value">${formatNum(m.avg[0])}–${formatNum(m.avg[1])}</div></div>
      <div><span class="stat-label">Peak power (W)</span>
           <div class="stat-value">${formatNum(m.peak[0])}–${formatNum(m.peak[1])}</div></div>
      <div><span class="stat-label">Energy (Wh)</span>
           <div class="stat-value">${formatNum(m.wh[0])}–${formatNum(m.wh[1])}</div></div>
      <div><span class="stat-label">Time range</span>
           <div class="stat-value">${m.first} → ${m.last}</div></div>
    </div>
  `;
  body.innerHTML = detailHtml;
}

/* ===================== main ===================== */

let cpuAC;
let userAC;

async function loadAndRender() {
  try {
    const kw = document.getElementById("kw");
    if (kw) kw.textContent = "static · leaderboard.json";

    STATUS.set("Loading index…");
    const idx = await fetchIndexJson();
    ALL_ROWS = rowsFromIndexJson(idx);

    // refresh autocompletes
    cpuAC?.refresh();
    userAC?.refresh();

    renderFiltered();
    STATUS.set("Done.");
  } catch (e) {
    if (e.name === "AbortError") return;
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

  // Generic autocompletes
  cpuAC = makeAutocomplete({
    inputId: "cpuFilter",
    panelId: "cpu-ac-panel",
    getItems: () => uniqueCpuList(ALL_ROWS),
    onSelect: renderFiltered,
  });

  userAC = makeAutocomplete({
    inputId: "userFilter",
    panelId: "user-ac-panel",
    getItems: () => uniqueUserList(ALL_ROWS),
    onSelect: renderFiltered,
  });

  const clear = document.getElementById("clearFilters");
  if (clear) clear.addEventListener("click", clearFilters);

  const themeSel = document.getElementById("theme");
  if (themeSel) {
    themeSel.addEventListener("change", (e) => {
      const mode = String(e.target?.value ?? "auto").toLowerCase();
      localStorage.setItem(THEME_KEY, mode);
      applyTheme(mode);
    });
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initTheme();
  wireUi();
  loadAndRender();
});

function clearFilters() {
  const cpu = document.getElementById("cpuFilter");
  const user = document.getElementById("userFilter");
  const sort = document.getElementById("sort");

  if (cpu) {
    cpu.value = "";
    const p = document.getElementById("cpu-ac-panel");
    p?.classList.remove("open");
    cpu.setAttribute("aria-expanded", "false");
  }

  if (user) {
    user.value = "";
    const p = document.getElementById("user-ac-panel");
    p?.classList.remove("open");
    user.setAttribute("aria-expanded", "false");
  }

  if (sort) sort.value = "created:desc";

  renderFiltered();
}
