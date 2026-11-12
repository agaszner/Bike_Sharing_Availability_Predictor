// Flows view: zone circles and net-flow arrows on a Leaflet map, hour slider with play, zone x hour heatmap.
import {hourText, signed, zoneRadius, arrowWidth, heatColor, arrowPath, hasFlowData} from './view-logic.js';
import {el, svg} from './dom.js';

const HOURS = 24;
const START_HOUR = 8;
const PLAY_MS = 800;
const ROW_H = 18; // heatmap row height in px, matches .heat-labels div
const AXIS_HOURS = [0, 6, 12, 18, 23];
const MAJOR_TICK = 6; // slider tick every 6 hours is taller
const FIT_PAD = 40;
const BAR_PAD = 110; // keep zones clear of the floating time bar
const MAX_FIT_ZOOM = 14;
const ARROW_GAP = 3; // px between arrowhead tip and target circle
const LABEL_GAP = 13; // px from circle edge to zone-name baseline
const PANE_Z = 450;
const COLORS = {leaving: '#E8590C', arriving: '#0C8599', neutral: '#868E96', arrow: '#6B7480'};
const DAYS = {weekday: 'average weekday', weekend: 'average weekend day'};
const NO_DATA = 'Flow patterns appear after a few days of data collection.';
const NOTE = 'From station bike-count changes between 10-minute snapshots. The feed has no trip records, so arrows show '
  + 'net imbalance between zones, not individual rides. Zones are k-means clusters of stations.';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const PLAY_ICON = 'M5 3 L13 8 L5 13 Z';
const PAUSE_ICON = 'M4 3 H7 V13 H4 Z M9 3 H12 V13 H9 Z';

const ui = {state: null, dom: null, map: null, layer: null, network: null, fitted: false,
  hour: START_HOUR, day: 'weekday', timer: null};

function build(root) {
  const d = {};
  d.map = el('div', {class: 'flow-map', 'aria-label': 'Map of zones with net bike flow for the selected hour'});
  d.play = el('button', {type: 'button', class: 'play'},
    svg('svg', {viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true'}, d.icon = svg('path', {fill: 'currentColor'})));
  d.hourText = el('span', {class: 'hour-text', 'aria-hidden': 'true'});
  d.range = el('input', {id: 'flow-hour', type: 'range', min: 0, max: HOURS - 1, step: 1});
  const ticks = svg('svg', {class: 'ticks', viewBox: `0 0 ${HOURS - 1} 6`, preserveAspectRatio: 'none', 'aria-hidden': 'true'},
    ...Array.from({length: HOURS}, (_, h) => svg('line', {x1: h, x2: h, y1: 0, y2: h % MAJOR_TICK ? 3 : 6})));
  d.days = Object.keys(DAYS).map((day) => el('button', {type: 'button', 'data-day': day},
    day === 'weekday' ? 'Weekdays' : 'Weekend'));
  const bar = el('div', {class: 'timebar'}, d.play,
    el('label', {for: 'flow-hour', class: 'hour'}, el('span', {class: 'cap'}, 'Hour'), d.hourText),
    el('div', {class: 'slider'}, d.range, ticks),
    el('div', {class: 'seg', role: 'group', 'aria-label': 'Day type'}, ...d.days));
  d.wrap = el('div', {class: 'map-wrap'}, d.map, bar);

  d.sub = el('p', {class: 'muted'});
  d.msg = el('p', {class: 'flow-msg muted'}, NO_DATA);
  d.labels = el('div', {class: 'heat-labels'});
  d.heat = svg('svg', {class: 'heat-cells', preserveAspectRatio: 'none', role: 'img'});
  d.chart = el('div', {class: 'heat-wrap'},
    el('div', {class: 'heat'}, d.labels, d.heat,
      el('div', {class: 'heat-axis', 'aria-hidden': 'true'}, ...AXIS_HOURS.map((h) =>
        el('span', {style: `left: ${(h + 0.5) / HOURS * 100}%`}, String(h))))),
    el('ul', {class: 'flow-legend'},
      el('li', {}, el('span', {class: 'swatch leaving', 'aria-hidden': 'true'}), 'Bikes leaving'),
      el('li', {}, el('span', {class: 'swatch arriving', 'aria-hidden': 'true'}), 'Bikes arriving')));
  d.panel = el('aside', {class: 'panel', 'aria-label': 'Daily flow pattern'},
    el('h2', {}, 'Daily flow pattern'), d.sub, d.msg, d.chart,
    el('div', {class: 'note'}, el('h3', {}, 'How this is estimated'), el('p', {}, NOTE)));
  d.only = el('p', {class: 'coming'});
  root.replaceChildren(d.wrap, d.panel, d.only);

  d.range.addEventListener('input', () => { ui.hour = Number(d.range.value); render(); });
  d.play.addEventListener('click', () => (ui.timer ? pause() : play()));
  d.days.forEach((b) => b.addEventListener('click', () => { ui.day = b.dataset.day; render(); }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  ui.dom = d;
}

function createMap() {
  const map = L.map(ui.dom.map, {zoomAnimation: !REDUCED, fadeAnimation: !REDUCED, markerZoomAnimation: !REDUCED});
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · '
      + 'Data <a href="https://citybik.es">CityBikes</a>',
  }).addTo(map);
  const pane = map.createPane('flows');
  pane.style.zIndex = PANE_Z;
  // One SVG at the pane origin drawn in layer-point coordinates: it pans with the map, is hidden by Leaflet
  // during a zoom animation (leaflet-zoom-hide) and redrawn once the zoom ends.
  ui.layer = svg('svg', {class: 'flow-layer leaflet-zoom-hide', width: 1, height: 1});
  pane.append(ui.layer);
  map.on('zoomend viewreset', drawMap);
  ui.map = map;
}

const flowsNow = () => ui.state.flows?.[ui.state.network];
const zonesNow = () => flowsNow()?.zones ?? [];
const netNow = () => flowsNow()?.net?.[ui.day] ?? [];
const maxAbs = (values) => Math.max(0, ...values.map(Math.abs));
const colorOf = (v) => {
  const s = signed(v);
  return s === '0' ? COLORS.neutral : s[0] === '+' ? COLORS.arriving : COLORS.leaving;
};

function drawMap() {
  const {map} = ui;
  const zones = zonesNow(), net = netNow();
  const dayArrows = flowsNow()?.arrows?.[ui.day] ?? [];
  const values = zones.map((_, i) => net[i]?.[ui.hour] ?? 0);
  const rMax = maxAbs(net.flat());
  const wMax = Math.max(0, ...dayArrows.flat().map((a) => a[2]));
  const pts = zones.map((z) => map.latLngToLayerPoint([z.lat, z.lon]));
  const radii = values.map((v) => zoneRadius(v, rMax));
  const index = new Map(zones.map((z, i) => [z.id, i]));

  const arrows = (dayArrows[ui.hour] ?? []).flatMap(([from, to, amount]) => {
    const i = index.get(from), j = index.get(to);
    const d = i != null && j != null && arrowPath(pts[i], pts[j], radii[i], radii[j] + ARROW_GAP);
    if (!d) return [];
    return [svg('path', {d, class: 'arrow leaflet-interactive', 'stroke-width': arrowWidth(amount, wMax),
      'marker-end': 'url(#flow-head)'},
    svg('title', {}, `${zones[i].name} → ${zones[j].name}: ${amount.toFixed(1)} bikes/hour`))];
  });
  const circles = zones.map((z, i) => {
    const {x, y} = pts[i], r = radii[i], v = signed(values[i]);
    return svg('g', {class: 'zone'},
      svg('circle', {cx: x, cy: y, r, fill: colorOf(values[i])}, svg('title', {}, `${z.name} · ${hourText(ui.hour)} · ${v}`)),
      svg('text', {x, y, class: 'zone-value'}, v),
      svg('text', {x, y: y + r + LABEL_GAP, class: 'zone-name'}, z.name));
  });
  const head = svg('marker', {id: 'flow-head', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 3.5, markerHeight: 3.5,
    orient: 'auto'}, svg('path', {d: 'M0 0 L10 5 L0 10 Z', fill: COLORS.arrow}));
  ui.layer.replaceChildren(svg('defs', {}, head), ...arrows, ...circles);
}

function drawHeat(zones, net) {
  const {labels, heat} = ui.dom;
  const max = maxAbs(net.flat());
  labels.replaceChildren(...zones.map((z) => el('div', {title: z.name}, z.name)));
  const cells = zones.flatMap((z, i) => Array.from({length: HOURS}, (_, h) => {
    const v = net[i]?.[h] ?? 0;
    return svg('rect', {x: h, y: i, width: 1, height: 1, fill: heatColor(v, max)},
      svg('title', {}, `${z.name} · ${hourText(h)} · ${signed(v)}`));
  }));
  const outline = svg('rect', {class: 'heat-hour', x: ui.hour, y: 0, width: 1, height: zones.length});
  heat.setAttribute('viewBox', `0 0 ${HOURS} ${zones.length}`);
  heat.style.height = `${zones.length * ROW_H}px`;
  heat.setAttribute('aria-label', `Net bikes per hour for ${zones.length} zones over an ${DAYS[ui.day]}, `
    + `orange for bikes leaving and teal for bikes arriving; ${hourText(ui.hour)} is outlined`);
  heat.replaceChildren(...cells, outline);
}

function renderControls() {
  const d = ui.dom;
  d.range.value = ui.hour;
  d.range.setAttribute('aria-valuetext', hourText(ui.hour));
  d.hourText.textContent = hourText(ui.hour);
  d.days.forEach((b) => b.setAttribute('aria-pressed', b.dataset.day === ui.day));
  d.play.setAttribute('aria-label', ui.timer ? 'Pause' : 'Play');
  d.icon.setAttribute('d', ui.timer ? PAUSE_ICON : PLAY_ICON);
}

function render() {
  const d = ui.dom, s = ui.state;
  renderControls();
  const zones = zonesNow();
  d.wrap.hidden = d.panel.hidden = zones.length === 0;
  d.only.hidden = zones.length > 0;
  d.only.textContent = s.loaded ? NO_DATA : 'Loading…';
  if (!zones.length) return;

  if (!ui.map) createMap();
  ui.map.invalidateSize();
  if (!ui.fitted) {
    ui.map.fitBounds(zones.map((z) => [z.lat, z.lon]), {paddingTopLeft: [FIT_PAD, FIT_PAD],
      paddingBottomRight: [FIT_PAD, BAR_PAD], maxZoom: MAX_FIT_ZOOM, animate: false});
    ui.fitted = true;
  }
  drawMap();

  const data = hasFlowData(flowsNow());
  d.sub.textContent = `Net bikes per hour by zone, ${DAYS[ui.day]}`;
  d.msg.hidden = data;
  d.chart.hidden = !data;
  if (data) drawHeat(zones, netNow());
}

function play() {
  ui.timer = setInterval(() => { ui.hour = (ui.hour + 1) % HOURS; render(); }, PLAY_MS);
  renderControls();
}

function pause() {
  clearInterval(ui.timer);
  ui.timer = null;
  if (ui.dom) renderControls();
}

// Called on every view or network change and after static data loads; builds once, then updates in place.
export function mountFlows(root, state) {
  ui.state = state;
  if (!ui.dom) build(root);
  if (state.network !== ui.network) {
    pause();
    ui.network = state.network;
    ui.fitted = false;
  }
  if (state.view !== 'flows') { pause(); return; }
  render();
}
