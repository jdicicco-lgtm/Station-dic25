/* ==========================
   Station-dic25 Dashboard
   app.js (GitHub Pages safe)
   JSON in ROOT:
   - bookings.json
   - occupation.json
   - fleet.json
   - service.json
   - incidents.json
   ========================== */

/** Range “picchi” */
const TREND_MIN = "2025-12-01";
const TREND_MAX = "2026-01-04";

/** Dicembre completo */
const DEC_MIN = "2025-12-01";
const DEC_MAX = "2025-12-31";

const state = {
  data: null,
  filters: {
    dateFrom: TREND_MIN,
    dateTo: TREND_MAX,
    branches: [],
    agents: []
  },
  charts: {}
};

const $ = (id) => document.getElementById(id);

function setStatus(msg, isError = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = "1";
  el.style.borderColor = isError ? "rgba(255,80,80,.35)" : "rgba(255,255,255,.08)";
}

function fmtEUR(n) {
  const v = Number(n || 0);
  return v.toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString("it-IT");
}
function pct01(x) {
  return (Number(x || 0) * 100).toFixed(1) + "%";
}
function normStr(s) {
  return String(s ?? "").trim();
}
function toDateOnly(s) {
  if (!s) return "";
  return String(s).slice(0, 10);
}
function inRange(dateStr, from, to) {
  return !!dateStr && dateStr >= from && dateStr <= to;
}

/**
 * Base URL robusta per GitHub Pages.
 * Esempio: https://user.github.io/repo/ -> base = https://user.github.io/repo/
 */
const BASE = new URL(".", window.location.href);
const url = (p) => new URL(p, BASE).toString();

/** Carica JSON da path RELATIVO ALLA ROOT del sito */
async function loadJSON(relativePath) {
  const full = url(relativePath);
  const res = await fetch(full, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} su ${full}`);
  return res.json();
}

function getSelectedValues(selectEl) {
  if (!selectEl) return [];
  return [...selectEl.selectedOptions].map((o) => o.value);
}

function destroyChart(canvasId) {
  const c = state.charts[canvasId];
  if (c) {
    c.destroy();
    delete state.charts[canvasId];
  }
}

function dateSeries(from, to) {
  const out = [];
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function groupCount(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x) || "N/D";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

/** Filtra bookings per Branch/Agent (+ opzionale range date) */
function filterBookings({ useDateRange = true } = {}) {
  const { bookings } = state.data;
  const f = state.filters;

  return bookings.filter((b) => {
    if (f.branches.length && !f.branches.includes(b.branchOffice)) return false;
    if (f.agents.length && !f.agents.includes(b.agent)) return false;

    if (useDateRange) {
      if (!inRange(b.pickupDate, f.dateFrom, f.dateTo)) return false;
    }
    return true;
  });
}

/** Incidenti: somma solo per bookingId presenti nel filtro */
function incidentsSumForBookings(filteredBookings) {
  const ids = new Set(filteredBookings.map((b) => b.id));
  let sum = 0;
  for (const inc of state.data.incidents) {
    if (ids.has(inc.bookingId)) sum += inc.totalPrice;
  }
  return sum;
}

/** ==========================
    Rendering
    ========================== */

function renderFixedOccupation() {
  const wrap = $("occupationKpis");
  if (!wrap) return;

  const occ = state.data.occupation || [];
  wrap.innerHTML = "";

  for (const o of occ) {
    const bo = normStr(o.branchOffice ?? o.branch ?? "");
    const val = Number(o.occupation ?? o.occ ?? 0);

    const card = document.createElement("div");
    card.className = "mini-card";
    card.innerHTML = `
      <div class="mini-card__title">${bo || "N/D"}</div>
      <div class="mini-card__value">${pct01(val)}</div>
    `;
    wrap.appendChild(card);
  }

  const avgEl = $("avgOcc");
  if (avgEl) {
    if (!occ.length) avgEl.textContent = "—";
    else {
      const avg = occ.reduce((a, x) => a + Number(x.occupation ?? x.occ ?? 0), 0) / occ.length;
      avgEl.textContent = pct01(avg);
    }
  }
}

function renderFixedFleetAndMaintenance() {
  const fleet = state.data.fleet || [];
  const service = state.data.service || [];

  const fleetTotalEl = $("fleetTotal");
  if (fleetTotalEl) fleetTotalEl.textContent = fmtNum(fleet.length);

  // "in service": status contiene "progress" o "in progress"
  const inServiceCount = service.filter((s) => {
    const st = normStr(s.status).toLowerCase();
    return st.includes("progress") || st.includes("in progress");
  }).length;

  const fleetInServiceEl = $("fleetInService");
  if (fleetInServiceEl) fleetInServiceEl.textContent = fmtNum(inServiceCount);

  // Manutenzione per type (fissa)
  const byType = groupCount(service, (s) => normStr(s.type ?? s.serviceType));
  const typeLabels = [...byType.keys()];
  const typeVals = typeLabels.map((k) => byType.get(k));

  destroyChart("serviceByType");
  const svcCanvas = $("serviceByType");
  if (svcCanvas && window.Chart) {
    state.charts.serviceByType = new Chart(svcCanvas, {
      type: "bar",
      data: { labels: typeLabels, datasets: [{ label: "Interventi", data: typeVals }] },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  // Flotta per provider (fissa)
  const byProv = groupCount(fleet, (f) => normStr(f.provider ?? f.fornitore));
  const provLabels = [...byProv.keys()];
  const provVals = provLabels.map((k) => byProv.get(k));

  destroyChart("fleetPie");
  const fleetCanvas = $("fleetPie");
  if (fleetCanvas && window.Chart) {
    state.charts.fleetPie = new Chart(fleetCanvas, {
      type: "pie",
      data: { labels: provLabels, datasets: [{ data: provVals }] },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } }
    });
  }
}

function renderBoAgentTable(filtered) {
  const table = $("boAgentTable");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  if (!tbody) return;

  const m = new Map();
  for (const b of filtered) {
    const key = `${b.branchOffice}||${b.agent}`;
    if (!m.has(key)) m.set(key, { branchOffice: b.branchOffice, agent: b.agent, revenue: 0, anc: 0, cnt: 0 });
    const r = m.get(key);
    r.revenue += b.revenue;
    r.anc += b.ancillaries;
    r.cnt += 1;
  }

  const rows = [...m.values()].sort((a, b) => b.revenue - a.revenue);
  tbody.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td>${r.branchOffice || "N/D"}</td>
        <td>${r.agent || "N/D"}</td>
        <td class="num">${fmtEUR(r.revenue)}</td>
        <td class="num">${fmtEUR(r.anc)}</td>
        <td class="num">${fmtNum(r.cnt)}</td>
      </tr>`
    )
    .join("");
}

function renderTrend(filtered) {
  const labels = dateSeries(TREND_MIN, TREND_MAX);

  const byDayBookings = new Map(labels.map((d) => [d, 0]));
  const byDayRevenue = new Map(labels.map((d) => [d, 0]));

  for (const b of filtered) {
    if (!inRange(b.pickupDate, TREND_MIN, TREND_MAX)) continue;
    byDayBookings.set(b.pickupDate, (byDayBookings.get(b.pickupDate) || 0) + 1);
    byDayRevenue.set(b.pickupDate, (byDayRevenue.get(b.pickupDate) || 0) + b.revenue);
  }

  const bookingsData = labels.map((d) => byDayBookings.get(d) || 0);
  const revenueData = labels.map((d) => Math.round(byDayRevenue.get(d) || 0));

  const fleetTotal = (state.data.fleet || []).length;

  destroyChart("trendChart");
  const canvas = $("trendChart");
  if (canvas && window.Chart) {
    state.charts.trendChart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "Prenotazioni", data: bookingsData, tension: 0.25 },
          { label: "Revenue", data: revenueData, tension: 0.25, yAxisID: "y1" }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: {
          y: { beginAtZero: true, title: { display: true, text: "Prenotazioni" } },
          y1: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Revenue" } }
        },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: { afterBody: () => `Flotta: ${fleetTotal}` }
          }
        }
      }
    });
  }
}

function renderDecemberDaily() {
  const filtered = filterBookings({ useDateRange: false });

  const labels = dateSeries(DEC_MIN, DEC_MAX);
  const byDay = new Map(labels.map((d) => [d, 0]));

  for (const b of filtered) {
    if (!inRange(b.pickupDate, DEC_MIN, DEC_MAX)) continue;
    byDay.set(b.pickupDate, (byDay.get(b.pickupDate) || 0) + 1);
  }

  const data = labels.map((d) => byDay.get(d) || 0);

  destroyChart("decDailyChart");
  const canvas = $("decDailyChart");
  if (canvas && window.Chart) {
    state.charts.decDailyChart = new Chart(canvas, {
      type: "line",
      data: { labels, datasets: [{ label: "Prenotazioni (Dicembre)", data, tension: 0.25 }] },
      options: {
        responsive: true,
        interaction: { mode: "index", intersect: false },
        scales: { y: { beginAtZero: true } },
        plugins: { legend: { position: "bottom" } }
      }
    });
  }
}

function renderFilteredKPIsAndCharts() {
  const filtered = filterBookings({ useDateRange: true });

  const rev = filtered.reduce((a, b) => a + b.revenue, 0);
  const anc = filtered.reduce((a, b) => a + b.ancillaries, 0);
  const days = filtered.reduce((a, b) => a + (b.durationDays || 0), 0);
  const inc = incidentsSumForBookings(filtered);

  $("revTotal") && ($("revTotal").textContent = fmtEUR(rev));
  $("ancTotal") && ($("ancTotal").textContent = fmtEUR(anc));
  $("bookTotal") && ($("bookTotal").textContent = fmtNum(filtered.length));
  $("incTotal") && ($("incTotal").textContent = fmtEUR(inc));

  $("revDay") && ($("revDay").textContent = days > 0 ? fmtEUR(rev / days) : "—");
  $("ancDay") && ($("ancDay").textContent = days > 0 ? fmtEUR(anc / days) : "—");

  // Donut canali
  const byChannel = groupCount(filtered, (b) => normStr(b.channel));
  const chLabels = [...byChannel.keys()];
  const chVals = chLabels.map((k) => byChannel.get(k));

  destroyChart("channelsDonut");
  const chCanvas = $("channelsDonut");
  if (chCanvas && window.Chart) {
    state.charts.channelsDonut = new Chart(chCanvas, {
      type: "doughnut",
      data: { labels: chLabels, datasets: [{ data: chVals, borderWidth: 0 }] },
      options: { responsive: true, plugins: { legend: { position: "bottom" } } }
    });
  }

  // % provider (bar)
  const byProvider = groupCount(filtered, (b) => normStr(b.provider));
  const prLabels = [...byProvider.keys()];
  const total = filtered.length || 1;
  const prPerc = prLabels.map((k) => Math.round((byProvider.get(k) / total) * 1000) / 10);

  destroyChart("providersBar");
  const prCanvas = $("providersBar");
  if (prCanvas && window.Chart) {
    state.charts.providersBar = new Chart(prCanvas, {
      type: "bar",
      data: { labels: prLabels, datasets: [{ label: "% prenotazioni", data: prPerc }] },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (v) => v + "%" } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  renderBoAgentTable(filtered);
  renderTrend(filtered);
  renderDecemberDaily();
}

/** ==========================
    Init UI
    ========================== */

function initFiltersUI() {
  const df = $("dateFrom");
  const dt = $("dateTo");
  if (df) df.value = state.filters.dateFrom;
  if (dt) dt.value = state.filters.dateTo;

  const branchSelect = $("branchSelect");
  const agentSelect = $("agentSelect");

  const branches = [...new Set(state.data.bookings.map((b) => b.branchOffice).filter(Boolean))].sort();
  const agents = [...new Set(state.data.bookings.map((b) => b.agent).filter(Boolean))].sort();

  if (branchSelect) branchSelect.innerHTML = branches.map((v) => `<option value="${v}">${v}</option>`).join("");
  if (agentSelect) agentSelect.innerHTML = agents.map((v) => `<option value="${v}">${v}</option>`).join("");

  const applyBtn = $("applyBtn");
  const resetBtn = $("resetBtn");

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      state.filters.dateFrom = df?.value || TREND_MIN;
      state.filters.dateTo = dt?.value || TREND_MAX;
      state.filters.branches = getSelectedValues(branchSelect);
      state.filters.agents = getSelectedValues(agentSelect);
      renderAll();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.filters = { dateFrom: TREND_MIN, dateTo: TREND_MAX, branches: [], agents: [] };
      if (df) df.value = state.filters.dateFrom;
      if (dt) dt.value = state.filters.dateTo;
      if (branchSelect) [...branchSelect.options].forEach((o) => (o.selected = false));
      if (agentSelect) [...agentSelect.options].forEach((o) => (o.selected = false));
      renderAll();
    });
  }
}

function renderAll() {
  if (!state.data) return;
  renderFixedOccupation();
  renderFixedFleetAndMaintenance();
  renderFilteredKPIsAndCharts();
}

/** ==========================
    Load data + start
    ========================== */

async function init() {
  try {
    setStatus("Caricamento dati…");

    const [bookingsRaw, occupationRaw, fleetRaw, serviceRaw, incidentsRaw] = await Promise.all([
      loadJSON("bookings.json"),
      loadJSON("occupation.json"),
      loadJSON("fleet.json"),
      loadJSON("service.json"),
      loadJSON("incidents.json")
    ]);

    // Normalizzazione bookings
    const bookings = (bookingsRaw || []).map((x) => ({
      id: Number(x.id),
      pickupDate: toDateOnly(x.pickupDate ?? x.pickupAt),
      dropoffDate: toDateOnly(x.dropoffDate ?? x.dropoffAt),
      branchOffice: normStr(x.branchOffice ?? x["brach office"] ?? x.branch),
      agent: normStr(x.agent ?? x.agente),
      channel: normStr(x.channel ?? x.canale),
      provider: normStr(x.provider ?? x.fornitore),
      revenue: Number(x.revenue ?? x.totalPrice ?? 0),
      ancillaries: Number(x.ancillaries ?? x.additional ?? 0),
      durationDays: Number(x.durationDays ?? x.duration ?? x.days ?? 0)
    }));

    const incidents = (incidentsRaw || []).map((x) => ({
      bookingId: Number(x.bookingId ?? x.id_booking ?? x.booking),
      totalPrice: Number(x.totalPrice ?? x["Total price"] ?? 0)
    }));

    const occupation = (occupationRaw || []).map((x) => ({
      branchOffice: normStr(x.branchOffice ?? x.branch ?? x["Branch Office"]),
      occupation: Number(x.occupation ?? x.occ ?? x["% Occupazione"] ?? 0)
    }));

    const fleet = (fleetRaw || []).map((x) => ({
      licensePlate: normStr(x.licensePlate ?? x.targa ?? x.plate),
      provider: normStr(x.provider ?? x.fornitore ?? x["Provider"] ?? x["Car"])
    }));

    const service = (serviceRaw || []).map((x) => ({
      type: normStr(x.type ?? x["Type"] ?? x.serviceType),
      status: normStr(x.status ?? x["Status"]),
      licensePlate: normStr(x.licensePlate ?? x.targa ?? x.plate)
    }));

    state.data = { bookings, occupation, fleet, service, incidents };

    initFiltersUI();
    renderAll();

    setStatus("Dati caricati ✅");
  } catch (err) {
    console.error(err);
    setStatus(`Errore caricamento: ${err.message}`, true);
    console.warn("Verifica URL JSON:", url("bookings.json"), url("occupation.json"), url("fleet.json"), url("service.json"), url("incidents.json"));
  }
}

// Avvio
init();
