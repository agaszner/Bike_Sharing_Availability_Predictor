import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {predict, localParts, lagDelta, features, stationRisk} from './predict.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const liveModel = load('./model.json'), liveFixtures = load('./fixtures.json');
const synth = load('./predict.fixture.json');
const model = synth.model;
const FEATURES = model.features;

const sid = Object.keys(synth.profiles.n1).find((k) => k !== '_default');
const base = {bikes: 4, slots: 6, profile: synth.profiles.n1[sid], defaults: synth.profiles.n1._default,
  history: [], weather: {temp: 9, precip: 0, wind: 4}, now: new Date('2026-11-16T07:00:00Z'), threshold: 0.5};

function caseInput(c, targetName) {
  const prof = synth.profiles[c.network];
  return {bikes: c.bikes, slots: c.slots, profile: prof[c.station_id], defaults: prof._default, targetName,
    history: c.history.map((h) => ({t: Date.parse(h.t), bikes: h.bikes})), weather: c.weather, now: new Date(c.now)};
}

test('predict matches Python on every fixture row', () => {
  for (const name of ['empty', 'full']) {
    if (!liveModel.targets[name]) continue;
    for (const row of liveFixtures[name]) assert.ok(Math.abs(predict(liveModel.targets[name], row.x) - row.p) < 1e-6);
  }
});
test('predict returns null for an untrained target', () => assert.equal(predict(null, [1]), null));
test('localParts uses Budapest time across DST', () => {
  assert.equal(localParts(new Date('2026-11-14T07:30:00Z')).hour, 8.5);      // CET, Saturday
  assert.equal(localParts(new Date('2026-11-14T07:30:00Z')).isWeekend, true);
  assert.equal(localParts(new Date('2026-07-01T07:30:00Z')).hour, 9.5);      // CEST
});
test('lagDelta picks the closest snapshot in the window, else 0', () => {
  const now = Date.UTC(2026, 10, 16, 8, 0), m = 60000;
  const h = [{t: now - 31 * m, bikes: 10}, {t: now - 12 * m, bikes: 8}];
  assert.equal(lagDelta(h, now, 5, 5, 20, 10), -3);
  assert.equal(lagDelta(h, now, 5, 20, 45, 30), -5);
  assert.equal(lagDelta([], now, 5, 5, 20, 10), 0);
});
test('lagDelta window bounds and tie rule match Python _lag', () => {
  // Expected values checked against model.features.add_lags on hand-built frames.
  const now = Date.UTC(2026, 10, 16, 8, 0), m = 60000, at = (age, bikes) => ({t: now - age * m, bikes});
  assert.equal(lagDelta([at(12, 1), at(8, 2)], now, 5, 5, 20, 10), 4);             // tie: older wins
  assert.equal(lagDelta([at(35, 1), at(25, 2)], now, 5, 20, 45, 30, true), 4);     // tie: older wins
  assert.equal(lagDelta([at(20, 1)], now, 5, 5, 20, 10), 4);                       // 20 inclusive for d10
  assert.equal(lagDelta([at(20, 1)], now, 5, 20, 45, 30, true), 0);                // 20 exclusive for d30
  assert.equal(lagDelta([at(45, 1), at(5, 2)], now, 5, 5, 20, 10), 3);             // 5 inclusive
  assert.equal(lagDelta([at(45, 1), at(5, 2)], now, 5, 20, 45, 30, true), 4);      // 45 inclusive
  assert.equal(lagDelta([at(46, 1), at(4, 2)], now, 5, 5, 20, 10), 0);
  assert.equal(lagDelta([at(46, 1), at(4, 2)], now, 5, 20, 45, 30, true), 0);
});
test('features: unknown station falls back to defaults and live capacity', () => {
  const x = features({bikes: 3, slots: null, profile: undefined, defaults: {empty: Array(24).fill(0.2), full: Array(24).fill(0)},
    targetName: 'empty', history: [], weather: {temp: 9, precip: 0, wind: 4}, now: new Date('2026-11-16T07:00:00Z')});
  assert.equal(x.length, 13);
  assert.deepEqual([x[0], x[1], x[2], x[3], x[9]], [3, 0, 3, 1, 0.2]);
});
test('stationRisk states', () => {
  assert.equal(stationRisk({...base, bikes: 0}, model).state, 'off');
  assert.equal(stationRisk(base, undefined).state, 'unknown');
  assert.equal(stationRisk({...base, profile: {...base.profile, dock: false}}, model).pFull, null);
});
test('stationRisk: dock with no free slot is off, null slots gives no full prediction, risky states', () => {
  assert.equal(stationRisk({...base, slots: 0}, model).state, 'off');
  assert.equal(stationRisk({...base, slots: null}, model).pFull, null);
  assert.equal(stationRisk(base, {targets: {empty: null, full: null}}).state, 'unknown');
  const r = stationRisk(base, model);
  assert.ok(r.pEmpty > 0 && r.pEmpty < 1 && r.pFull > 0 && r.pFull < 1);
  assert.equal(stationRisk({...base, threshold: 0}, model).state, r.pEmpty >= r.pFull ? 'empty' : 'full');
  assert.equal(stationRisk({...base, threshold: 1.01}, model).state, 'ok');
});
test('stationRisk is unknown when no probability is computed, but off still wins', () => {
  const onlyFull = {...model, targets: {empty: null, full: model.targets.full}};
  const unknown = {state: 'unknown', pEmpty: null, pFull: null};
  assert.deepEqual(stationRisk({...base, profile: {...base.profile, dock: false}}, onlyFull), unknown);
  assert.deepEqual(stationRisk({...base, slots: null}, onlyFull), unknown);
  assert.equal(stationRisk({...base, bikes: 0}, undefined).state, 'off');
});
test('stationRisk without weather uses the scaler means of temp, precip, wind', () => {
  const r = stationRisk({...base, weather: null}, model);
  for (const [name, p] of [['empty', r.pEmpty], ['full', r.pFull]]) {
    const t = model.targets[name];
    const x = features({...base, targetName: name, weather: {temp: t.mean[10], precip: t.mean[11], wind: t.mean[12]}});
    assert.ok(p > 0 && p < 1);
    assert.equal(p, predict(t, x));
  }
});

test('synthetic fixture is non-trivial', () => {
  for (const name of ['empty', 'full']) {
    assert.ok(model.targets[name], `${name} target trained`);
    assert.ok(synth.fixtures[name].length > 0, `${name} fixtures`);
    const xs = synth.cases[name].map((c) => c.x);
    assert.ok(xs.length > 0, `${name} cases`);
    assert.ok(xs.some((x) => x[4] !== 0) && xs.some((x) => x[5] !== 0), `${name} cases with non-zero d10 and d30`);
    assert.ok(xs.some((x) => x[8] === 1) && xs.some((x) => x[8] === 0), `${name} weekend and weekday cases`);
  }
});
test('predict matches Python on every synthetic fixture row', () => {
  for (const name of ['empty', 'full']) {
    for (const row of synth.fixtures[name]) {
      const p = predict(model.targets[name], row.x);
      assert.ok(Math.abs(p - row.p) < 1e-6, `${name}: ${p} vs ${row.p}`);
    }
  }
});
test('features match build_matrix on every synthetic case', () => {
  for (const name of ['empty', 'full']) {
    synth.cases[name].forEach((c, i) => {
      const x = features(caseInput(c, name));
      assert.equal(x.length, 13);
      FEATURES.forEach((f, j) =>
        assert.ok(Math.abs(x[j] - c.x[j]) < 1e-9, `${name} case ${i} (${c.station_id} ${c.now}) ${f}: ${x[j]} vs ${c.x[j]}`));
    });
  }
});
test('predict(features(...)) matches Python on every synthetic case', () => {
  for (const name of ['empty', 'full']) {
    synth.cases[name].forEach((c, i) => {
      const p = predict(model.targets[name], features(caseInput(c, name)));
      assert.ok(Math.abs(p - c.p) < 1e-6, `${name} case ${i}: ${p} vs ${c.p}`);
    });
  }
});
