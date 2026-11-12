// Pure helpers for app.js: parsing fetched data, building stationRisk input, and display text. No DOM, no fetch.

const MIN = 60000;
const LAG_WINDOW_MIN = 45;
const SPARK_WINDOW_MIN = 180;

export const NETWORKS = [
  {id: 'mol-bubi', name: 'Budapest', lat: 47.4979, lon: 19.0402},
  {id: 'wienmobil-rad', name: 'Wien', lat: 48.2082, lon: 16.3738},
  {id: 'bicikelj', name: 'Ljubljana', lat: 46.0569, lon: 14.5058},
  {id: 'slovnaft-bajk', name: 'Bratislava', lat: 48.1486, lon: 17.1077},
];
export const VIEWS = ['map', 'flows', 'model'];

export function parseHash(hash) {
  const [network, view] = hash.replace(/^#/, '').split('/');
  return {
    network: NETWORKS.some((n) => n.id === network) ? network : NETWORKS[0].id,
    view: VIEWS.includes(view) ? view : 'map',
  };
}

export function weatherFrom(json) {
  const c = json?.current;
  if (!c || ![c.temperature_2m, c.precipitation, c.wind_speed_10m].every(Number.isFinite)) return null;
  return {temp: c.temperature_2m, precip: c.precipitation, wind: c.wind_speed_10m};
}

// Stations without a numeric bike count are dropped: they would turn into NaN features.
export function stationsFrom(json) {
  return json.network.stations.filter((s) => Number.isFinite(s.free_bikes)).map((s) => ({id: s.id, name: s.name, lat: s.latitude, lon: s.longitude,
    bikes: s.free_bikes, slots: s.empty_slots ?? null, virtual: Boolean(s.extra?.virtual)}));
}

const collator = new Intl.Collator(undefined, {numeric: true});
export function stationOptions(stations) {
  return stations.map((s) => ({value: s.id, label: s.name})).sort((a, b) => collator.compare(a.label, b.label));
}

// all: every known snapshot (sparkline); recent: only the last 45 minutes (lag features).
export function historyFromLatest(latest, id, nowMs) {
  const series = latest?.stations?.[id];
  if (!series) return {all: [], recent: []};
  const all = [];
  series.forEach((v, i) => { if (v) all.push({t: Date.parse(latest.ts[i]), bikes: v[0]}); });
  return {all, recent: all.filter((h) => nowMs - h.t <= LAG_WINDOW_MIN * MIN)};
}

// null when the network has no profiles at all (stationRisk would throw on undefined defaults).
export function riskInput(station, netProfiles, history, weather, now, threshold) {
  if (!netProfiles) return null;
  return {bikes: station.bikes, slots: station.slots, profile: netProfiles[station.id], defaults: netProfiles._default,
    history, weather, now, threshold};
}

export function markerState(risk, bikes) {
  if (risk.state !== 'unknown') return risk.state;
  return bikes > 0 ? 'ok' : 'off';
}

const WORDS = {ok: 'Available', empty: 'Likely empty within 30 min', full: 'Likely full within 30 min'};
export function stateWords(risk, bikes) {
  const s = markerState(risk, bikes);
  return s === 'off' ? (bikes > 0 ? 'Full now' : 'Empty now') : WORDS[s];
}

export function topRisk(entries, n = 4) {
  return entries
    .filter(({risk}) => risk.pEmpty != null || risk.pFull != null)
    .map(({station, risk}) => {
      const full = (risk.pFull ?? -1) > (risk.pEmpty ?? -1);
      return {station, kind: full ? 'full' : 'empty', p: full ? risk.pFull : risk.pEmpty};
    })
    .sort((a, b) => b.p - a.p)
    .slice(0, n);
}

const timeFmt = new Intl.DateTimeFormat('en-GB',
  {timeZone: 'Europe/Budapest', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});

export function statusText({updated, weather, failed}) {
  if (failed) return 'Live data unavailable — retrying';
  if (!updated) return 'Loading live data…';
  let s = `Updated ${timeFmt.format(updated)}`;
  if (weather) s += ` · ${Math.round(weather.temp) || 0} °C · ${weather.precip > 0 ? 'rain' : 'dry'}`;
  return s;
}

export function dockInfo(station, profile) {
  const dock = profile ? profile.dock : !station.virtual && station.slots != null;
  if (!dock) return {docks: null, free: null};
  return {docks: profile?.cap ?? station.bikes + station.slots, free: station.slots};
}

export function subtitle(city, zone, docks) {
  return [city, zone && `${zone} zone`, docks != null && `${docks} docks`].filter(Boolean).join(' · ');
}

// Line and filled-area SVG paths for bikes over the last 3 hours; x is time, y scales to the max seen.
export function sparkPaths(points, nowMs, w, h) {
  const from = nowMs - SPARK_WINDOW_MIN * MIN;
  const pts = points.filter((p) => p.t >= from);
  if (pts.length < 2) return null;
  const max = Math.max(1, ...pts.map((p) => p.bikes));
  const r = (v) => +v.toFixed(1);
  const xy = pts.map((p) => `${r((p.t - from) / (SPARK_WINDOW_MIN * MIN) * w)},${r(h - p.bikes / max * h)}`);
  const line = 'M' + xy.join(' L');
  const x0 = xy[0].split(',')[0], x1 = xy[xy.length - 1].split(',')[0];
  return {line, area: `${line} L${x1},${h} L${x0},${h} Z`};
}
