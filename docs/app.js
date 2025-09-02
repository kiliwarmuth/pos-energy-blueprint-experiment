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

/* ---------- cache + filtering ---------- */

let ALL_ROWS = [];

function scoreNum(row, key, dir) {
  const v = +(row[key] ?? NaN);
  if (Number.isNaN(v)) return dir === "asc" ? +Infinity : -Infinity;
  return v;
}

function populateUserFilter(rows) {
  const sel = document.getElementById("userFilter");
  if (!sel) return;
  const seen = new Map();
  rows.forEach((r) => {
    const handle = r.user || r.user_display || "unknown";
    const name = r.user_display || r.user || "unknown";
    if (!seen.has(handle)) seen.set(handle, name);
  });
  const cur = sel.value;
  sel.innerHTML =
    `<option value="">All</option>` +
    [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([handle, name]) => `<option value="${handle}">${name}</option>`)
      .join("");
  if ([...seen.keys()].includes(cur)) sel.value = cur;
}

function renderFiltered() {
  if (!Array.isArray(ALL_ROWS)) ALL_ROWS = [];

  const sortSel = document.getElementById("sort");
  const cpuInp = document.getElementById("cpuFilter");
  const userSel = document.getElementById("userFilter");

  const sel = sortSel ? sortSel.value : "created:desc";
  const [k, dir] = sel.split(":");

  const cpuFilt = (cpuInp ? cpuInp.value : "").trim().toLowerCase();
  const userFilt = userSel ? userSel.value || "" : "";

  const filtered = ALL_ROWS.filter((r) => {
    const okUser = userFilt ? r.user === userFilt : true;
    const okCpu = cpuFilt
      ? (r.cpu_label || "").toLowerCase().includes(cpuFilt)
      : true;
    return okUser && okCpu;
  });

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

/* ---------- render ---------- */

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
      ? `<span class="badge warn" title="Simultaneous multithreading disabled">HT off</span>`
      : `<span class="badge ok" title="Simultaneous multithreading enabled">HT on</span>`;

    const sockets =
      r.sockets ?? (Array.isArray(r.sockets_list) ? r.sockets_list.length : 1);
    const socketsBadge =
      sockets > 1
        ? ` <span class="badge" title="Number of CPU packages">${sockets}× sockets</span>`
        : "";

    const socketsList =
      Array.isArray(r.sockets_list) && r.sockets_list.length > 1
        ? `<ul class="cpu-sockets">${r.sockets_list
          .map(
            (p, i) =>
              `<li><span class="muted">Socket ${i}:</span> ${[p.vendor, p.model].filter(Boolean).join(" ")
              } — ${p.cores ?? "?"} cores · ${p.threads ?? "?"} threads</li>`
          )
          .join("")}</ul>`
        : "";

    const meta = `
  <div class="meta">
    <div><strong>User:</strong> ${r.user_display || r.user || "unknown"}</div>
    ${aff ? `<div class="muted">${aff}</div>` : ""}

    <div class="section">
      <div><strong>CPU:</strong> ${r.cpu_label || "unknown"}${socketsBadge} ${htBadgeHtml}</div>
      <div class="muted">Totals: ${r.cores ?? "?"} cores · ${r.threads ?? "?"} threads</div>
      ${socketsList}
    </div>

    <div class="section">
      <div><strong>Power / Energy:</strong></div>
      <div class="metric-line">
        <span class="metric">${r.avg_power_w ?? "–"} W avg</span> ·
        <span class="metric">${r.peak_power_w ?? "–"} W peak</span>
      </div>
      <div class="metric-line">
        <span class="metric">${r.energy_wh ?? "–"} Wh</span>
      </div>
    </div>

    ${r.zenodo
        ? `<div class="section">
             <strong>Results:</strong>
             <a href="${r.zenodo}" target="_blank" rel="noopener">
               Zenodo Deposition
             </a>
           </div>`
        : ""
      }
  </div>`;

    const nodeLine =
      r.node && String(r.node).trim().length
        ? `<div class="muted smaller">on node ${r.node}</div>`
        : "";

    el.innerHTML = `<h3>Run ${r.id}</h3>${nodeLine}${meta}<div class="imgs">${imgs}</div>`;
    grid.appendChild(el);
  });
}

/* ---------- main ---------- */

async function loadAndRender() {
  try {
    STATUS.set("Loading index…");
    const idx = await fetchIndexJson();
    ALL_ROWS = rowsFromIndexJson(idx);

    populateUserFilter(ALL_ROWS);
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

  const cpu = document.getElementById("cpuFilter");
  if (cpu) {
    cpu.addEventListener("input", () => {
      clearTimeout(window._t);
      window._t = setTimeout(renderFiltered, 250);
    });
  }

  const userSel = document.getElementById("userFilter");
  if (userSel) userSel.addEventListener("change", renderFiltered);
}

window.addEventListener("DOMContentLoaded", () => {
  wireUi();
  loadAndRender();
});