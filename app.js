/* ==========================
   Station-dic25 Dashboard
   app.js — aligned to real columns & HTML
   ========================== */

const TREND_MIN = "2025-12-01";
const TREND_MAX = "2026-01-04";
const DEC_MIN = "2025-12-01";
const DEC_MAX = "2025-12-31";

const state = {
  data: {},
  filters: {
    from: TREND_MIN,
    to: TREND_MAX,
    branches: [],
    agents: []
  },
  charts: {}
};

const $ = (id) => document.getElementById(id);

/* ==========================
   Utils
   ========================== */
const fmtEUR = (n) =>
  Number(n || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
const fmtNum = (n) => Number(n || 0).toLocaleString("it-IT");
const pct = (v) => (Number(v || 0) * 100).toFixed(1) + "%";
const norm = (v) => String(v ?? "").trim();
const dOnly = (v) => String(v ?? "").slice(0, 10);
const inRange = (d, f, t) => d && d >= f && d <= t;

const BASE = new URL(".", location.href);
const url = (p) => new URL(p, BASE).toString();

async function loadJSON(p) {
  const r = await fetch(url(p) + "?v=" + Date.now());
  const t = await r.text();
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return JSON.parse(t);
}

/* ==========================
   Load + normalize data
   ========================== */
async function init() {
  try {
    $("dataStatus").textContent = "Caricamento dati…";

    const [
      bookingsRaw,
      occupationRaw,
      fleetRaw,
      serviceRaw,
      incidentsRaw
    ] = await Promise.all([
      loadJSON("bookings.json"),
      loadJSON("occupation.json"),
      loadJSON("fleet.json"),
      loadJSON("service.json"),
      loadJSON("incidents.json")
    ]);

    /* ---- BOOKINGS ---- */
    const bookings = bookingsRaw.map((r) => ({
      id: Number(r["Booking ID"] ?? r.id),
      pickup: dOnly(r["Pickup Date"]),
      dropoff: dOnly(r["Dropoff Date"]),
      branch: norm(r["Branch Office"]),
      agent: norm(r["Agent"]),
      channel: norm(r["Channel"]),
      provider: norm(r["Provider"]),
      revenue: Number(r["Revenue"] || 0),
      anc: Number(r["Ancillaries"] || 0),
      days: Number(r["Duration Days"] || 0)
    }));

    /* ---- OCCUPATION (FIXED) ---- */
    const occupation = occupationRaw
      .map((r) => ({
        branch: norm(r["Branch Offices"]),
        value: Number(r["Occupation"])
      }))
      .filter((r) => r.branch && Number.isFinite(r.value));

    /* ---- FLEET (FIXED) ---- */
    const fleet = fleetRaw.map((r) => ({
      plate: norm(r["Plate"]),
      provider: norm(r["Provider"])
    }));

    /* ---- SERVICE / MAINTENANCE (FIXED) ---- */
    const service = serviceRaw.map((r) => ({
      type: norm(r["Service Type"]),
      status: norm(r["Status"])
    }));

    /* ---- INCIDENTS (FILTERED) ---- */
    const incidents = incidentsRaw.map((r) => ({
      bookingId: Number(r["Booking ID"]),
      value: Number(r["Total Price"] || 0)
    }));

    state.data = { bookings, occupation, fleet, service, incidents };

    initFilters();
    renderAll();

    $("dataStatus").textContent = "Dati caricati";
  } catch (e) {
    console.error(e);
    $("dataStatus").textContent = "Errore dati";
  }
}

/* ==========================
   Filters UI
   ========================== */
function initFilters() {
  flatpickr("#dateRange", {
    mode: "range",
    dateFormat: "Y-m-d",
    defaultDate: [TREND_MIN, TREND_MAX],
    onClose: (d) => {
      if (d.length === 2) {
        state.filters.from = dOnly(d[0]);
        state.filters.to = dOnly(d[1]);
      }
    }
  });

  const branches = [...new Set(state.data.bookings.map((b) => b.branch))];
  const agents = [...new Set(state.data.bookings.map((b) => b.agent))];

  const bSel = $("branchSelect");
  const aSel = $("agentSelect");

  bSel.innerHTML = branches.map((b) => `<option>${b}</option>`).join("");
  aSel.innerHTML = agents.map((a) => `<option>${a}</option>`).join("");

  new Choices(bSel, { removeItemButton: true });
  new Choices(aSel, { removeItemButton: true });

  $("applyBtn").onclick = () => {
    state.filters.branches = [...bSel.selectedOptions].map((o) => o.value);
    state.filters.agents = [...aSel.selectedOptions].map((o) => o.value);
    renderAll();
  };

  $("resetBtn").onclick = () => {
    state.filters = { from: TREND_MIN, to: TREND_MAX, branches: [], agents: [] };
    renderAll();
  };
}

/* ==========================
   Rendering
   ========================== */
function getFilteredBookings() {
  const { from, to, branches, agents } = state.filters;
  return state.data.bookings.filter((b) => {
    if (!inRange(b.pickup, from, to)) return false;
    if (branches.length && !branches.includes(b.branch)) return false;
    if (agents.length && !agents.includes(b.agent)) return false;
    return true;
  });
}

function renderAll() {
  renderOccupation();
  renderFleet();
  renderMaintenance();
  renderKPIs();
  renderCharts();
}

/* ---- FIXED ---- */
function renderOccupation() {
  const wrap = $("occupationKpis");
  wrap.innerHTML = "";

  state.data.occupation.forEach((o) => {
    wrap.innerHTML += `
      <div class="kpi-mini">
        <div>${o.branch}</div>
        <strong>${pct(o.value)}</strong>
      </div>`;
  });

  const avg =
    state.data.occupation.reduce((a, x) => a + x.value, 0) /
    state.data.occupation.length;
  $("occAvg").textContent = pct(avg);
}

function renderFleet() {
  $("fleetTotal").textContent = fmtNum(state.data.fleet.length);

  const inService = state.data.service.filter((s) =>
    s.status.toLowerCase().includes("progress")
  ).length;

  $("fleetInService").textContent = `In service: ${fmtNum(inService)}`;
}

function renderMaintenance() {
  const byType = {};
  state.data.service.forEach((s) => {
    byType[s.type] = (byType[s.type] || 0) + 1;
  });

  new Chart($("maintenanceChart"), {
    type: "bar",
    data: {
      labels: Object.keys(byType),
      datasets: [{ data: Object.values(byType) }]
    },
    options: { plugins: { legend: { display: false } } }
  });
}

/* ---- FILTERED ---- */
function renderKPIs() {
  const b = getFilteredBookings();

  $("revTotal").textContent = fmtEUR(b.reduce((a, x) => a + x.revenue, 0));
  $("ancTotal").textContent = fmtEUR(b.reduce((a, x) => a + x.anc, 0));
  $("bookingsTotal").textContent = fmtNum(b.length);

  const days = b.reduce((a, x) => a + x.days, 0);
  $("avgDuration").textContent = days ? (days / b.length).toFixed(1) + " gg" : "—";

  const inc = state.data.incidents
    .filter((i) => b.some((x) => x.id === i.bookingId))
    .reduce((a, x) => a + x.value, 0);

  $("incidentsValue").textContent = fmtEUR(inc);
}

function renderCharts() {
  /* CHANNEL DONUT */
  const b = getFilteredBookings();
  const byCh = {};
  b.forEach((x) => (byCh[x.channel] = (byCh[x.channel] || 0) + 1));

  new Chart($("channelDonut"), {
    type: "doughnut",
    data: { labels: Object.keys(byCh), datasets: [{ data: Object.values(byCh) }] }
  });

  /* PROVIDER BAR */
  const byProv = {};
  b.forEach((x) => (byProv[x.provider] = (byProv[x.provider] || 0) + 1));

  new Chart($("providerBar"), {
    type: "bar",
    data: {
      labels: Object.keys(byProv),
      datasets: [
        {
          label: "%",
          data: Object.values(byProv).map((v) =>
            ((v / b.length) * 100).toFixed(1)
          )
        }
      ]
    }
  });

  /* FLEET PIE */
  const byFleet = {};
  state.data.fleet.forEach(
    (x) => (byFleet[x.provider] = (byFleet[x.provider] || 0) + 1)
  );

  new Chart($("fleetPie"), {
    type: "pie",
    data: { labels: Object.keys(byFleet), datasets: [{ data: Object.values(byFleet) }] }
  });
}

init();
