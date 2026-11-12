// Browser mirror of model/features.py (features) and the exported logistic regression (predict). Pure: no DOM/fetch.

const MIN = 60000;
const fmt = new Intl.DateTimeFormat('en-GB',
  {timeZone: 'Europe/Budapest', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'});

export function predict(target, x) {
  if (!target) return null;
  let z = target.intercept;
  for (let i = 0; i < x.length; i++) z += target.coef[i] * (x[i] - target.mean[i]) / target.std[i];
  return 1 / (1 + Math.exp(-z));
}

// Fractional local hour (seconds ignored, as Python timestamps are minute-precision) and weekend flag.
export function localParts(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map(({type, value}) => [type, value]));
  return {hour: Number(p.hour) + Number(p.minute) / 60, isWeekend: p.weekday === 'Sat' || p.weekday === 'Sun'};
}

// bikesNow minus bikes at the snapshot whose age is closest to idealMin within [minAgeMin, maxAgeMin]
// ((minAgeMin, maxAgeMin] when minExclusive); ties go to the older snapshot; 0 when none qualifies.
export function lagDelta(history, nowMs, bikesNow, minAgeMin, maxAgeMin, idealMin, minExclusive = false) {
  let best = null;
  for (const h of history) {
    const age = (nowMs - h.t) / MIN;
    if ((minExclusive ? age <= minAgeMin : age < minAgeMin) || age > maxAgeMin) continue;
    const d = Math.abs(age - idealMin);
    if (!best || d < best.d || (d === best.d && age > best.age)) best = {d, age, bikes: h.bikes};
  }
  return best ? bikesNow - best.bikes : 0;
}

export function features({bikes, slots, profile, defaults, targetName, history, weather, now}) {
  const {hour, isWeekend} = localParts(now);
  const s = slots ?? 0;
  const cap = profile ? profile.cap : Math.max(1, bikes + s);
  const a = 2 * Math.PI * hour / 24;
  return [
    bikes, s, cap, Math.min(1, Math.max(0, bikes / cap)),
    lagDelta(history, now.getTime(), bikes, 5, 20, 10),
    lagDelta(history, now.getTime(), bikes, 20, 45, 30, true),
    Math.sin(a), Math.cos(a), isWeekend ? 1 : 0, (profile ?? defaults)[targetName][Math.floor(hour)],
    weather.temp, weather.precip, weather.wind,
  ];
}

export function stationRisk(input, model) {
  const dock = Boolean(input.profile?.dock);
  if (input.bikes === 0 || (dock && input.slots === 0)) return {state: 'off', pEmpty: null, pFull: null};
  if (!model || (!model.targets.empty && !model.targets.full)) return {state: 'unknown', pEmpty: null, pFull: null};
  const p = (name) => {
    const t = model.targets[name];
    if (!t) return null;
    const weather = input.weather ?? {temp: t.mean[10], precip: t.mean[11], wind: t.mean[12]};
    return predict(t, features({...input, targetName: name, weather}));
  };
  const pEmpty = p('empty'), pFull = dock && input.slots != null ? p('full') : null;
  const hi = Math.max(pEmpty ?? -1, pFull ?? -1);
  const state = hi < input.threshold ? 'ok' : hi === pEmpty ? 'empty' : 'full';
  return {state, pEmpty, pFull};
}
