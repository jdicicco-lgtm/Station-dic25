// Dashboard Performance — Dicembre 2025
// Static site friendly for GitHub Pages (no build step)
// Data sources: /data/*.json

const fmtEUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const fmtPct = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat('it-IT');

const DATE_MIN = '2025-12-01';
const DATE_MAX = '2026-01-04';
const DEC_MIN = '2025-12-01';
const DEC_MAX = '2025-12-31';

const els = {
  status: document.getElementById('dataStatus'),
  dateRange: document.getElementById('dateRange'),
  branchSelect: document.getElementById('branchSelect'),
  agentSelect: document.getElementById('agentSelect'),
  resetBtn: document.getElementById('resetBtn'),
  applyBtn: document.getElementById('applyBtn'),

  occupationKpis: document.getElementById('occupationKpis'),
  occAvg: document.getElementById('occAvg'),
  fleetTotal: document.getElementById('fleetTotal'),
  fleetInService: document.getElementById('fleetInService'),

  revTotal: document.getElementById('revTotal'),
  revDay: document.getElementById('revDay'),
  ancTotal: document.getElementById('ancTotal'),
  ancDay: document.getElementById('ancDay'),
  incidentsValue: document.getElementById('incidentsValue'),
  bookingsTotal: document.getElementById('bookingsTotal'),
  avgDuration: document.getElementById('avgDuration'),
};

let DATA = null;

let choicesBranch = null;
let choicesAgent = null;
let fp = null;

let charts = {
  channelDonut: null,
  providerBar: null,
  fleetPie: null,
  maintenance: null,
  trend: null,
  decDaily: null,
};

let table = null;

function parseISODate(d) {
  // 'YYYY-MM-DD' -> Date at local midnight
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day);
}
function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function clampDateStr(dStr) {
  if (!dStr) return null;
  if (dStr < DATE_MIN) return DATE_MIN;
  if (dStr > DATE_MAX) return DATE_MAX;
  return dStr;
}
function sum(arr, f) {
  let s = 0;
  for (const x of arr) s += (f ? f(x) : x);
  return s;
}
function groupBy(arr, keyFn) {
  const m = new Map();
  for (const row of arr) {
    const k = keyFn(row);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function groupSum(arr, keyFn, valFn) {
  const m = new Map();
  for (const row of arr) {
    const k = keyFn(row);
    m.set(k, (m.get(k) || 0) + (valFn(row) || 0));
  }
  return m;
}
function unique(arr) {
  return Array.from(new Set(arr)).filter(Boolean);
}

async function loadJSON(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Errore caricamento: ${path}`);
  return r.json();
}

async function init() {
  try {
    const [bookings, occupation, fleet, service, incidents, manifest] = await Promise.all([
      loadJSON('./data/bookings.json'),
      loadJSON('./data/occupation.json'),
      loadJSON('./data/fleet.json'),
      loadJSON('./data/service.json'),
      loadJSON('./data/incidents.json'),
      loadJSON('./data/manifest.json'),
    ]);

    DATA = { bookings, occupation, fleet, service, incidents, manifest };

    els.status.textContent = `Dati OK • ${manifest.records.bookings} bookings`;
    els.status.classList.add('ok');

    initFilters();
    renderFixedBlocks();
    renderAll(); // initial render
  } catch (e) {
    console.error(e);
    els.status.textContent = 'Errore nel caricamento dati';
  }
}

function initFilters() {
  // Date range: pick-up date, limited to [DATE_MIN, DATE_MAX]
  fp = flatpickr(els.dateRange, {
    mode: 'range',
    dateFormat: 'd/m/Y',
    defaultDate: [parseISODate(DATE_MIN), parseISODate(DATE_MAX)],
    minDate: parseISODate(DATE_MIN),
    maxDate: parseISODate(DATE_MAX),
    allowInput: true,
  });

  // Branch / Agent options from bookings
  const branches = unique(DATA.bookings.map(b => b.branchOffice)).sort((a,b)=>a.localeCompare(b));
  const agents = unique(DATA.bookings.map(b => b.agent)).sort((a,b)=>a.localeCompare(b));

  els.branchSelect.innerHTML = branches.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
  els.agentSelect.innerHTML = agents.map(a => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join('');

  choicesBranch = new Choices(els.branchSelect, {
    removeItemButton: true,
    placeholderValue: 'Tutti',
    searchPlaceholderValue: 'Cerca branch…',
    shouldSort: false,
  });
  choicesAgent = new Choices(els.agentSelect, {
    removeItemButton: true,
    placeholderValue: 'Tutti',
    searchPlaceholderValue: 'Cerca agente…',
    shouldSort: false,
  });

  els.resetBtn.addEventListener('click', () => {
    fp.setDate([parseISODate(DATE_MIN), parseISODate(DATE_MAX)], true);
    choicesBranch.removeActiveItems();
    choicesAgent.removeActiveItems();
    renderAll();
  });
  els.applyBtn.addEventListener('click', () => renderAll());
}

function getFilterState() {
  // Date range
  let start = DATE_MIN;
  let end = DATE_MAX;
  const sel = fp.selectedDates || [];
  if (sel.length >= 1) start = clampDateStr(iso(sel[0])) || DATE_MIN;
  if (sel.length >= 2) end = clampDateStr(iso(sel[1])) || DATE_MAX;

  // Multi-selects
  const branches = choicesBranch.getValue(true); // array
  const agents = choicesAgent.getValue(true);

  return { start, end, branches, agents };
}

function filterBookings() {
  const { start, end, branches, agents } = getFilterState();
  return DATA.bookings.filter(b => {
    const d = b.pickupDate; // pick-up date
    if (d < start || d > end) return false;
    if (branches.length && !branches.includes(b.branchOffice)) return false;
    if (agents.length && !agents.includes(b.agent)) return false;
    return true;
  });
}

function filterBookingsForDecemberDaily() {
  // Ignores the date-range picker; uses only Branch/Agent selections.
  const { branches, agents } = getFilterState();
  return DATA.bookings.filter(b => {
    const d = b.pickupDate;
    if (d < DEC_MIN || d > DEC_MAX) return false;
    if (branches.length && !branches.includes(b.branchOffice)) return false;
    if (agents.length && !agents.includes(b.agent)) return false;
    return true;
  });
}

function mapIncidentsToFilteredBookings(filteredBookings) {
  const ids = new Set(filteredBookings.map(b => b.id));
  return DATA.incidents.filter(i => i.bookingId != null && ids.has(i.bookingId));
}

function renderFixedBlocks() {
  // Occupation cards
  const occ = DATA.occupation
    .filter(r => r.branchOffice && Number.isFinite(r.occupation))
    .sort((a,b)=> String(a.branchOffice).localeCompare(String(b.branchOffice)));

  // Top KPI grid (fixed)
  els.occupationKpis.innerHTML = occ.map(r => {
    const v = fmtPct.format(r.occupation || 0);
    return `
      <div class="mini">
        <div class="mini__top">
          <div class="mini__name" title="${escapeHtml(r.branchOffice)}">${escapeHtml(r.branchOffice)}</div>
          <div class="mini__tag">Occup.</div>
        </div>
        <div class="mini__value">${v}</div>
      </div>
    `;
  }).join('');

  const avg = occ.length ? sum(occ, r => r.occupation || 0) / occ.length : 0;
  els.occAvg.textContent = fmtPct.format(avg);

  // Fleet (fixed)
  const fleetTotal = DATA.fleet.length;
  // inService: unique plates currently in SERVICE (status In Progress) if licensePlate exists, else by car field
  const svcInProgress = DATA.service.filter(s => String(s.status).toLowerCase().includes('progress'));
  const uniquePlates = new Set(svcInProgress.map(s => s.licensePlate).filter(Boolean));
  const inService = uniquePlates.size || new Set(svcInProgress.map(s => s.car).filter(Boolean)).size;

  els.fleetTotal.textContent = fmtNum.format(fleetTotal);
  els.fleetInService.textContent = `In service: ${fmtNum.format(inService)}`;

  // Fixed charts: fleet pie & maintenance by type
  drawFleetPie();
  drawMaintenanceChart();
}

function renderAll() {
  const filtered = filterBookings();
  const incFiltered = mapIncidentsToFilteredBookings(filtered);

  // December daily line: always Dec 01..Dec 31, ignores the date-range filter but respects Branch/Agent.
  const decDaily = filterBookingsForDecemberDaily();

  renderKPIs(filtered, incFiltered);
  drawChannelDonut(filtered);
  drawProviderBar(filtered);
  drawTrend(filtered);
  renderTable(filtered);
  drawDecemberDaily(decDaily);
}

function renderKPIs(bookings, incidents) {
  const rev = sum(bookings, b => b.revenue || 0);
  const anc = sum(bookings, b => b.ancillaries || 0);
  const dur = sum(bookings, b => b.durationDays || 0) || 0;

  // per day normalized on rental days (duration)
  const revDay = dur > 0 ? rev / dur : 0;
  const ancDay = dur > 0 ? anc / dur : 0;

  const incidentValue = sum(incidents, i => i.totalPrice || 0);

  els.revTotal.textContent = fmtEUR.format(rev);
  els.revDay.textContent = `Revenue/day: ${fmtEUR.format(revDay)}`;

  els.ancTotal.textContent = fmtEUR.format(anc);
  els.ancDay.textContent = `Ancillaries/day: ${fmtEUR.format(ancDay)}`;
  els.incidentsValue.textContent = `Incidenti: ${fmtEUR.format(incidentValue)}`;

  els.bookingsTotal.textContent = fmtNum.format(bookings.length);
  els.avgDuration.textContent = bookings.length ? `Durata media: ${fmtNum.format(dur / bookings.length)} gg` : 'Durata media: —';
}

function destroyChart(ch) {
  if (ch) ch.destroy();
  return null;
}

function drawChannelDonut(bookings) {
  const counts = groupBy(bookings, b => (b.channel || 'N/D'));
  const labels = Array.from(counts.keys());
  const data = labels.map(l => counts.get(l));

  const walkInIndex = labels.findIndex(l => String(l).toLowerCase().includes('walk'));
  const offsets = labels.map((_, idx) => (idx === walkInIndex ? 16 : 0));

  const ctx = document.getElementById('channelDonut').getContext('2d');
  charts.channelDonut = destroyChart(charts.channelDonut);
  charts.channelDonut = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, offset: offsets }] },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { color: 'rgba(255,255,255,.75)', boxWidth: 10 } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${fmtNum.format(c.parsed)}` } },
      },
      cutout: '62%',
    }
  });
}

function drawProviderBar(bookings) {
  const counts = groupBy(bookings, b => (b.provider || 'N/D'));
  const entries = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]);
  const total = bookings.length || 1;
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => Math.round((e[1] / total) * 1000) / 10); // %
  const ctx = document.getElementById('providerBar').getContext('2d');

  charts.providerBar = destroyChart(charts.providerBar);
  charts.providerBar = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data }] },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,.75)' }, grid: { color: 'rgba(255,255,255,.06)' } },
        y: { ticks: { color: 'rgba(255,255,255,.75)', callback: (v)=> `${v}%` }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
      },
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: (c)=> `${c.parsed.y}%` } }
      }
    }
  });
}

function drawFleetPie() {
  const counts = groupBy(DATA.fleet, f => (f.provider || 'N/D'));
  const labels = Array.from(counts.keys()).sort((a,b)=>a.localeCompare(b));
  const data = labels.map(l => counts.get(l));
  const ctx = document.getElementById('fleetPie').getContext('2d');

  charts.fleetPie = destroyChart(charts.fleetPie);
  charts.fleetPie = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data }] },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color:'rgba(255,255,255,.75)', boxWidth: 10 } },
        tooltip: { callbacks: { label: (c)=> `${c.label}: ${fmtNum.format(c.parsed)}` } },
      }
    }
  });
}

function drawMaintenanceChart() {
  const counts = groupBy(DATA.service, s => (s.type || 'N/D'));
  const entries = Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);
  const ctx = document.getElementById('maintenanceChart').getContext('2d');

  charts.maintenance = destroyChart(charts.maintenance);
  charts.maintenance = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data }] },
    options: {
      responsive: true,
      indexAxis: 'y',
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,.75)' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
        y: { ticks: { color: 'rgba(255,255,255,.75)' }, grid: { display:false } },
      },
      plugins: {
        legend: { display:false },
        tooltip: { callbacks: { label: (c)=> `${fmtNum.format(c.parsed.x)}` } }
      }
    }
  });
}

function drawTrend(bookings) {
  // Always show full timeline DATE_MIN..DATE_MAX, filtered data affects series values.
  const start = parseISODate(DATE_MIN);
  const end = parseISODate(DATE_MAX);

  // fleet shown: total; if exactly 1 branch selected, show fleet count for that branch
  const st = getFilterState();
  let fleetShown = DATA.fleet.length;
  if (st.branches.length === 1) {
    fleetShown = DATA.fleet.filter(f => f.branchOffice === st.branches[0]).length || fleetShown;
  }

  const byDateCount = groupBy(bookings, b => b.pickupDate);
  const byDateRevenue = groupSum(bookings, b => b.pickupDate, b => b.revenue || 0);

  const labels = [];
  const counts = [];
  const revenues = [];
  const fleets = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = iso(d);
    labels.push(k);
    counts.push(byDateCount.get(k) || 0);
    revenues.push(byDateRevenue.get(k) || 0);
    fleets.push(fleetShown);
  }

  const ctx = document.getElementById('trendChart').getContext('2d');
  charts.trend = destroyChart(charts.trend);
  charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Prenotazioni',
        data: counts,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,.75)', maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,.06)' } },
        y: { ticks: { color: 'rgba(255,255,255,.75)' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
      },
      plugins: {
        legend: { display:false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => {
              const idx = item.dataIndex;
              return [
                `Prenotazioni: ${fmtNum.format(counts[idx])}`,
                `Revenue: ${fmtEUR.format(revenues[idx])}`,
                `Flotta: ${fmtNum.format(fleets[idx])}`,
              ];
            }
          }
        }
      }
    }
  });
}

function drawDecemberDaily(bookings) {
  // Line chart for Dec 01..Dec 31 (always full month, values reflect Branch/Agent filter)
  const start = parseISODate(DEC_MIN);
  const end = parseISODate(DEC_MAX);

  const byDateCount = groupBy(bookings, b => b.pickupDate);

  const labels = [];
  const counts = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = iso(d);
    labels.push(k);
    counts.push(byDateCount.get(k) || 0);
  }

  const ctx = document.getElementById('decDailyChart').getContext('2d');
  charts.decDaily = destroyChart(charts.decDaily);
  charts.decDaily = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Prenotazioni',
        data: counts,
        tension: 0.25,
        pointRadius: 0,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: 'rgba(255,255,255,.75)', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,.06)' } },
        y: { ticks: { color: 'rgba(255,255,255,.75)' }, grid: { color: 'rgba(255,255,255,.06)' }, beginAtZero: true },
      },
      plugins: {
        legend: { display:false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => `Prenotazioni: ${fmtNum.format(item.parsed.y)}`
          }
        }
      }
    }
  });
}

function renderTable(bookings) {
  // Aggregate by Branch + Agent
  const key = (b) => `${b.branchOffice}|||${b.agent}`;
  const agg = new Map();
  for (const b of bookings) {
    const k = key(b);
    const prev = agg.get(k) || { branchOffice: b.branchOffice, agent: b.agent, revenue:0, ancillaries:0, bookings:0 };
    prev.revenue += b.revenue || 0;
    prev.ancillaries += b.ancillaries || 0;
    prev.bookings += 1;
    agg.set(k, prev);
  }
  const rows = Array.from(agg.values())
    .sort((a,b)=> b.revenue - a.revenue)
    .map(r => [r.branchOffice, r.agent, fmtEUR.format(r.revenue), fmtEUR.format(r.ancillaries), fmtNum.format(r.bookings)]);

  const container = document.getElementById('gridTable');
  if (!table) {
    table = new gridjs.Grid({
      columns: [
        { name: 'Branch Office', sort: true },
        { name: 'Agente', sort: true },
        { name: 'Revenue', sort: true },
        { name: 'Ancillaries', sort: true },
        { name: 'Prenotazioni', sort: true },
      ],
      data: rows,
      sort: true,
      search: true,
      pagination: { limit: 10 },
    }).render(container);
  } else {
    table.updateConfig({ data: rows }).forceRender();
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

init();
