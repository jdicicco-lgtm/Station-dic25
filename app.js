/* ==========================
   Station-dic25 Dashboard
   app.js — FINAL STABLE
   ========================== */

/* --------------------------
   Date ranges
-------------------------- */
const TREND_MIN = "2025-12-01";
const TREND_MAX = "2026-01-04";
const DEC_MIN = "2025-12-01";
const DEC_MAX = "2025-12-31";

/* --------------------------
   State
-------------------------- */
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

/* --------------------------
   Utils
-------------------------- */
const fmtEUR = (n) =>
  Number(n || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR" });

const fmtNum = (n) => Number(n || 0).toLocaleString("it-IT");

const pct = (v) => (Number(v || 0) * 100).toFixed(1) + "%";

const norm = (v) => String(v ?? "").trim();

const dOnly = (v) => String(v ?? "").slice(0, 10);

const inRange = (d, f, t) => d && d >= f && d <= t;

const BASE = new URL(".", location.href);
const url = (p) => new URL(p, BASE).toString();

/* --------------------------
   Fetch JSON (safe)
-------------------------- */
async function loadJSON(p) {
  const r = await fetch(url(p) + "?v=" + Date.now());
  const t = await r.text();
  if (!r.ok) throw new Error(`${p} → ${r.status}`);
  return JSON.parse(t);
}

/* --------------------------
   Init
-------------------------- */
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

    /* ---------- BOOKINGS ---------- */
    const bookings = bookingsRaw.map((r) => ({
      id: Number(r["Booking ID"] ?? r["ID Booking"] ?? r.id),
      pickup: dOnly(r["Pickup Date"] ?? r["Pick-up Date"]),
      dropoff: dOnly(r["Dropoff Date"] ?? r["Drop-off Date"]),
      branch: norm(r["Branch Office"] ?? r["Branch"] ?? r["Station"]),
      agent: norm(r["Agent"] ?? r["Agente"] ?? r["Agent Name"]),
      channel: norm(r["Channel"] ?? r["Canale"]),
      provider: norm(r["Provider"] ?? r["Car Provider"]),
      revenue: Number(
        String(r["Revenue"] ?? r["Total Price"] ?? "0").replace(",", ".")
      ),
      anc: Number(
        String(r["Ancillaries"] ?? r["Additional Services"] ?? "0").replace(",", ".")
      ),
      days: Number(r["Duration Days"] ?? r["Days"] ?? 0)
    }));

    /* ---------- OCCUPATION (FIXED, % SAFE) ---------- */
    const occMap = {};
    occupationRaw.forEach((r) => {
      const raw = String(r["Occupation"] ?? "").replace("%", "").replace(",", ".");
      const val = Number(raw);
      const branch = norm(r["Branch Offices"] ?? r["Branch Office"]);
      if (branch && Number.isFinite(val)) {
        occMap[branch] = val / 100;
      }
    });

    const occupation = Object.entries(occMap).map(([branch, value]) => ({
      branch,
      value
    }));

    /* ---------- FLEET ---------- */
    const fleet = fleetRaw
      .map((r) => ({
        plate: norm(r["License Plate"] ?? r["Targa"]),
        provider: norm(r["Provider"] ?? r["Car Provider"] ?? r["Supplier"])
      }))
      .filter((f) => f.provider);

    /* ---------- SERVICE ---------- */
    const service = serviceRaw.map((r) => ({
      type: norm(r["Service Type"]),
      status: norm(r["Status"])
    }));

    /* ---------- INCIDENTS ---------- */
    const incidents = incidentsRaw.map((r) => ({
      bookingId: Number(r["Booking ID"]),
      value: Number(String(r["Total Price"] ?? "0").replace(",", "."))
    }));

    state.data = { bookings, occupation, fleet, service, incidents };

    initFilters();
    renderAll();

    $("dataStatus").textContent = "Dati caricati";
  } catch (e) {
    console.error(e);
    $("dataStatus").textContent = "Errore caricamento dati";
  }
}

/* --------------------------
   Filters UI
-------------------------- */
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

  const branches = [...new Set(
    state.data.bookings.map((b) => b.branch).filter(Boolean)
  )].sort();

  const agents = [...new Set(
    state.data.bookings.map((b) => b.agent).filter(Boolean)
  )].sort();

  const bSel = $("branchSelect");
  const aSel = $("agentSelect");

  bSel.innerHTML = branches.map((b) => `<option>${b}</option>`).join("");
  aSel.innerHTML = agents.map((a) => `<option>${a}</option>`).join("");

  new Choices(bSel, { removeItemButton: true, shouldSort: false });
  new Choices(aSel, { removeItemButton: true, shouldSort: false });

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

/* --------------------------
   Helpers
-------------------------- */
function resetChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}

function getFilteredBookings() {
  const { from, to, branches, agents } = state.filters;

  return state.data.bookings.filter((b) => {
    if (b.pickup && !inRange(b.pickup, from, to)) return false;
    if (branches.length && !branches.includes(b.branch)) return false;
    if (agents.length && !agents.includes(b.agent)) return false;
    return true;
  });
}

/* --------------------------
   Render
-------------------------- */
function renderAll() {
  renderOccupation();
  renderFleet();
  renderMaintenance();
  renderKPIs();
  renderCharts();
}

/* ---------- FIXED ---------- */
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
  resetChart("maintenance");

  const byType = {};
  state.data.service.forEach((s) => {
    if (s.type) byType[s.type] = (byType[s.type] || 0) + 1;
  });

  state.charts.maintenance = new Chart($("maintenanceChart"), {
    type: "bar",
    data: {
      labels: Object.keys(byType),
      datasets: [{ data: Object.values(byType) }]
    },
    options: { plugins: { legend: { display: false } } }
  });
}

/* ---------- FILTERED ---------- */
function renderKPIs() {
  const b = getFilteredBookings();

  $("revTotal").textContent = fmtEUR(b.reduce((a, x) => a + x.revenue, 0));
  $("ancTotal").textContent = fmtEUR(b.reduce((a, x) => a + x.anc, 0));
  $("bookingsTotal").textContent = fmtNum(b.length);

  const days = b.reduce((a, x) => a + x.days, 0);
  $("avgDuration").textContent =
    b.length ? (days / b.length).toFixed(1) + " gg" : "—";

  const inc = state.data.incidents
    .filter((i) => b.some((x) => x.id === i.bookingId))
    .reduce((a, x) => a + x.value, 0);

  $("incidentsValue").textContent = fmtEUR(inc);
}

function renderCharts() {
  const b = getFilteredBookings();

  /* CHANNEL DONUT */
  resetChart("channel");
  const byCh = {};
  b.forEach((x) => {
    if (x.channel) byCh[x.channel] = (byCh[x.channel] || 0) + 1;
  });

  state.charts.channel = new Chart($("channelDonut"), {
    type: "doughnut",
    data: { labels: Object.keys(byCh), datasets: [{ data: Object.values(byCh) }] }
  });

  /* PROVIDER BAR */
  resetChart("provider");
  const byProv = {};
  b.forEach((x) => {
    if (x.provider) byProv[x.provider] = (byProv[x.provider] || 0) + 1;
  });

  state.charts.provider = new Chart($("providerBar"), {
    type: "bar",
    data: {
      labels: Object.keys(byProv),
      datasets: [{
        label: "%",
        data: Object.values(byProv).map(v =>
          ((v / (b.length || 1)) * 100).toFixed(1)
        )
      }]
    }
  });

  /* FLEET PIE */
  resetChart("fleet");
  const byFleet = {};
  state.data.fleet.forEach((x) => {
    if (x.provider) byFleet[x.provider] = (byFleet[x.provider] || 0) + 1;
  });

  state.charts.fleet = new Chart($("fleetPie"), {
    type: "pie",
    data: { labels: Object.keys(byFleet), datasets: [{ data: Object.values(byFleet) }] }
  });
}

/* --------------------------
   Start
-------------------------- */
init();
