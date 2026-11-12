// Page shell and Live map view: fetching, Leaflet markers, station panel, hash routing. Logic lives in app-logic.js.
import {stationRisk} from './predict.js';
import {NETWORKS, parseHash, weatherFrom, stationsFrom, historyFromLatest, riskInput, markerState, stateWords,
  topRisk, statusText, dockInfo, subtitle, sparkPaths} from './app-logic.js';

export {NETWORKS};

const RISK_THRESHOLD = 0.5;
const REFRESH_MS = 60000;
const LATEST_URL = 'https://raw.githubusercontent.com/agaszner/Bike_Sharing_Availability_Predictor/data/latest/';
const COLORS = {ok: '#2E9E5B', empty: '#E8590C', full: '#5F3DC4', off: '#868E96'};
const UNKNOWN = {state: 'unknown', pEmpty: null, pFull: null};
const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const initial = parseHash(location.hash);
export const state = {
  network: initial.network, view: initial.view,
  stations: [], risks: new Map(), model: null, profiles: null, weather: null, flows: null,
  latest: null, updated: null, failed: false, selected: null,
};

const listeners = [];
export function onViewChange(fn) {
  listeners.push(fn);
  fn(state);
}
const notify = () => listeners.forEach((fn) => fn(state));

const $ = (sel) => document.querySelector(sel);
const city = () => NETWORKS.find((n) => n.id === state.network);

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
const orNull = (p) => p.catch(() => null);

// ---- Map ----
const map = L.map('map', {preferCanvas: true, zoomAnimation: !REDUCED, fadeAnimation: !REDUCED,
  markerZoomAnimation: !REDUCED}).setView([city().lat, city().lon], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · '
    + 'Live data <a href="https://citybik.es">CityBikes</a> · Weather <a href="https://open-meteo.com">Open-Meteo</a>',
}).addTo(map);
const renderer = L.canvas({padding: 0.5});
const layer = L.layerGroup().addTo(map);
const markers = new Map(); // station id -> circleMarker, current network only
const halo = L.circleMarker([0, 0], {renderer, radius: 12, weight: 2, fill: false, interactive: false});

function tooltipNode(s) {
  const el = document.createElement('div');
  el.className = 'tip';
  const name = document.createElement('strong');
  name.textContent = s.name;
  const info = document.createElement('span');
  info.textContent = `${s.bikes} bikes · ${stateWords(state.risks.get(s.id)?.risk ?? UNKNOWN, s.bikes)}`;
  el.append(name, info);
  return el;
}

function renderMarkers() {
  const seen = new Set();
  for (const s of state.stations) {
    seen.add(s.id);
    let m = markers.get(s.id);
    if (!m) {
      m = L.circleMarker([s.lat, s.lon], {renderer, radius: 6, weight: 1.5, color: '#fff', fillOpacity: 1})
        .bindTooltip((l) => tooltipNode(l.station), {direction: 'top', offset: [0, -6]})
        .on('click', () => select(s.id))
        .addTo(layer);
      markers.set(s.id, m);
    } else {
      m.setLatLng([s.lat, s.lon]);
    }
    m.station = s;
    m.setStyle({fillColor: COLORS[markerState(state.risks.get(s.id).risk, s.bikes)]});
  }
  for (const [id, m] of markers) {
    if (!seen.has(id)) { layer.removeLayer(m); markers.delete(id); }
  }
}

function renderHalo() {
  const s = state.stations.find((x) => x.id === state.selected);
  if (!s) { halo.remove(); return; }
  halo.setLatLng([s.lat, s.lon]).setStyle({color: COLORS[markerState(state.risks.get(s.id).risk, s.bikes)]});
  if (!map.hasLayer(halo)) halo.addTo(map);
}

// ---- Panel ----
function setRow(row, p) {
  row.hidden = p == null;
  if (p == null) return;
  const pct = `${Math.round(p * 100)}%`;
  row.querySelector('.pct').textContent = pct;
  row.querySelector('.fill').style.width = pct;
}

function renderStation(s) {
  const {risk, history} = state.risks.get(s.id);
  const netProfiles = state.profiles?.[state.network];
  const flows = state.flows?.[state.network];
  const zoneId = flows?.station_zone?.[s.id];
  const zone = flows?.zones?.find((z) => z.id === zoneId)?.name;
  const {docks, free} = dockInfo(s, netProfiles?.[s.id]);
  $('#st-name').textContent = s.name;
  $('#st-sub').textContent = subtitle(city().name, zone, docks);
  $('#st-bikes').textContent = s.bikes ?? '—';
  $('#st-free').textContent = free ?? '—';

  const message = risk.state === 'unknown' ? 'Prediction not available yet'
    : risk.state === 'off' ? (s.bikes === 0 ? 'Already empty' : 'Already full') : '';
  $('#st-message').textContent = message;
  $('#st-message').hidden = !message;
  setRow($('#row-empty'), message ? null : risk.pEmpty);
  setRow($('#row-full'), message ? null : risk.pFull);

  const now = Date.now();
  const paths = sparkPaths([...history, {t: now, bikes: s.bikes}], now, 320, 60);
  const svg = $('#spark');
  svg.hidden = !paths;
  $('#spark-empty').hidden = Boolean(paths);
  if (paths) {
    const color = COLORS[markerState(risk, s.bikes)];
    svg.querySelector('.line').setAttribute('d', paths.line);
    svg.querySelector('.line').setAttribute('stroke', color);
    svg.querySelector('.area').setAttribute('d', paths.area);
    svg.querySelector('.area').setAttribute('fill', color);
    const counts = [...history.map((h) => h.bikes), s.bikes];
    svg.setAttribute('aria-label',
      `Bikes over the last 3 hours, between ${Math.min(...counts)} and ${Math.max(...counts)}; now ${s.bikes}`);
  }
}

function renderRiskList() {
  const top = topRisk(state.stations.map((s) => ({station: s, risk: state.risks.get(s.id).risk})));
  $('#risk').hidden = top.length === 0;
  $('#risk-title').textContent = `Most at risk in ${city().name}`;
  $('#risk-list').replaceChildren(...top.map(({station, kind, p}) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = station.name;
    const pill = document.createElement('span');
    pill.className = `pill ${kind}`;
    pill.textContent = `${kind} ${Math.round(p * 100)}%`;
    btn.append(name, pill);
    btn.addEventListener('click', () => {
      select(station.id);
      map.panTo([station.lat, station.lon], {animate: !REDUCED});
    });
    li.append(btn);
    return li;
  }));
}

function renderPanel() {
  const s = state.stations.find((x) => x.id === state.selected);
  $('#hint').hidden = Boolean(s);
  $('#station').hidden = !s;
  if (s) renderStation(s);
  renderRiskList();
}

function renderStatus() {
  $('#status-text').textContent = statusText(state);
  $('#demo-badge').hidden = !DEMO;
}

function select(id) {
  state.selected = id;
  renderHalo();
  renderPanel();
}

// ---- Data ----
function computeRisks() {
  const now = new Date();
  const netProfiles = state.profiles?.[state.network];
  state.risks = new Map(state.stations.map((s) => {
    const {all, recent} = historyFromLatest(state.latest, s.id, now.getTime());
    const input = riskInput(s, netProfiles, recent, state.weather, now, RISK_THRESHOLD);
    let risk = UNKNOWN;
    try {
      if (input) risk = stationRisk(input, state.model);
    } catch { /* malformed model or profile: degrade to live counts */ }
    return [s.id, {risk, history: all}];
  }));
}

function render() {
  computeRisks();
  renderMarkers();
  renderHalo();
  renderPanel();
  renderStatus();
}

async function loadStatic() {
  let model, profiles;
  if (DEMO) {
    const fx = await orNull(getJSON('./predict.fixture.json'));
    // ponytail: the fixture has one synthetic network; reuse it for all four (station ids never match)
    model = fx?.model ?? null;
    profiles = fx ? Object.fromEntries(NETWORKS.map((n) => [n.id, fx.profiles.n1])) : null;
  } else {
    [model, profiles] = await Promise.all([orNull(getJSON('./model.json')), orNull(getJSON('./profiles.json'))]);
  }
  Object.assign(state, {model, profiles, flows: await orNull(getJSON('./flows.json'))});
}

let seq = 0;
async function loadLive() {
  const my = ++seq;
  const net = city();
  const [stations, weather, latest] = await Promise.all([
    getJSON(`https://api.citybik.es/v2/networks/${net.id}`).then(stationsFrom).catch(() => null),
    orNull(getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${net.lat}&longitude=${net.lon}`
      + '&current=temperature_2m,precipitation,wind_speed_10m').then(weatherFrom)),
    orNull(getJSON(`${LATEST_URL}${net.id}.json`)),
  ]);
  if (my !== seq) return; // a newer load (city switch or refresh) owns the state
  if (!stations) {
    state.failed = true;
    renderStatus();
    return;
  }
  Object.assign(state, {stations, weather, latest, updated: new Date(), failed: false});
  render();
}

// ---- Routing ----
function switchNetwork(network) {
  ++seq; // drop any in-flight response for the previous city
  Object.assign(state, {network, stations: [], risks: new Map(), latest: null, weather: null, updated: null,
    failed: false, selected: null});
  layer.clearLayers();
  markers.clear();
  map.setView([city().lat, city().lon], 13, {animate: false});
  render();
  loadLive();
}

function route() {
  const {network, view} = parseHash(location.hash);
  const canonical = `#${network}/${view}`;
  if (location.hash !== canonical) history.replaceState(null, '', canonical);
  const changed = network !== state.network || view !== state.view;
  if (network !== state.network) switchNetwork(network);
  state.view = view;
  document.querySelectorAll('[data-network]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.network === network));
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.view === view));
  for (const v of ['map', 'flows', 'model']) $(`#view-${v}`).hidden = v !== view;
  if (view === 'map') map.invalidateSize();
  if (changed) notify();
}

document.querySelectorAll('[data-network]').forEach((b) =>
  b.addEventListener('click', () => { location.hash = `${b.dataset.network}/${state.view}`; }));
document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => { location.hash = `${state.network}/${b.dataset.view}`; }));
addEventListener('hashchange', route);

route();
renderStatus();
loadLive();
setInterval(loadLive, REFRESH_MS);
loadStatic().then(() => {
  if (state.stations.length) render();
  notify(); // views that registered before model/profiles/flows arrived
});
