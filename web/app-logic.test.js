import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stationRisk} from './predict.js';
import {NETWORKS, parseHash, weatherFrom, stationsFrom, historyFromLatest, riskInput, markerState, stateWords,
  topRisk, statusText, dockInfo, subtitle, sparkPaths, stationOptions} from './app-logic.js';

const synth = JSON.parse(fs.readFileSync(new URL('./predict.fixture.json', import.meta.url), 'utf8'));
const MIN = 60000;
const now = new Date('2026-11-16T07:00:00Z');

test('NETWORKS is the fixed ordered list', () => {
  assert.deepEqual(NETWORKS.map((n) => n.id), ['mol-bubi', 'wienmobil-rad', 'bicikelj', 'slovnaft-bajk']);
  assert.deepEqual(NETWORKS.map((n) => n.name), ['Budapest', 'Wien', 'Ljubljana', 'Bratislava']);
  assert.deepEqual([NETWORKS[0].lat, NETWORKS[0].lon], [47.4979, 19.0402]);
});

test('parseHash validates network and view, defaulting to mol-bubi/map', () => {
  assert.deepEqual(parseHash('#bicikelj/flows'), {network: 'bicikelj', view: 'flows'});
  assert.deepEqual(parseHash(''), {network: 'mol-bubi', view: 'map'});
  assert.deepEqual(parseHash('#nope/model'), {network: 'mol-bubi', view: 'model'});
  assert.deepEqual(parseHash('#wienmobil-rad/bogus'), {network: 'wienmobil-rad', view: 'map'});
  assert.deepEqual(parseHash('#wienmobil-rad'), {network: 'wienmobil-rad', view: 'map'});
});

test('weatherFrom reads Open-Meteo current, null when incomplete', () => {
  assert.deepEqual(weatherFrom({current: {temperature_2m: 9.4, precipitation: 0.2, wind_speed_10m: 12}}),
    {temp: 9.4, precip: 0.2, wind: 12});
  assert.equal(weatherFrom({current: {temperature_2m: 9.4, precipitation: null, wind_speed_10m: 12}}), null);
  assert.equal(weatherFrom({}), null);
  assert.equal(weatherFrom(null), null);
});

test('stationsFrom maps CityBikes stations', () => {
  const s = stationsFrom({network: {stations: [
    {id: 'a', name: 'A', latitude: 1, longitude: 2, free_bikes: 3, empty_slots: null, extra: {virtual: true}},
    {id: 'b', name: 'B', latitude: 1, longitude: 2, free_bikes: 0, empty_slots: 5}]}});
  assert.deepEqual(s, [
    {id: 'a', name: 'A', lat: 1, lon: 2, bikes: 3, slots: null, virtual: true},
    {id: 'b', name: 'B', lat: 1, lon: 2, bikes: 0, slots: 5, virtual: false}]);
});

test('stationsFrom drops stations whose free_bikes is not a finite number', () => {
  const st = (id, free_bikes) => ({id, name: id, latitude: 1, longitude: 2, free_bikes, empty_slots: 1});
  const s = stationsFrom({network: {stations: [st('null', null), st('str', '3'), st('nan', NaN), st('ok', 2)]}});
  assert.deepEqual(s.map((x) => x.id), ['ok']);
});

test('stationOptions lists every station by name, locale-aware', () => {
  const s = [{id: '3', name: 'Zrínyi utca'}, {id: '1', name: 'Állatkert'}, {id: '2', name: 'Bem tér'},
    {id: '4', name: 'árpád híd'}];
  assert.deepEqual(stationOptions(s), [
    {value: '1', label: 'Állatkert'}, {value: '4', label: 'árpád híd'},
    {value: '2', label: 'Bem tér'}, {value: '3', label: 'Zrínyi utca'}]);
  assert.deepEqual(stationOptions([]), []);
});

test('historyFromLatest skips nulls; recent keeps only the last 45 minutes', () => {
  const t = (m) => new Date(now.getTime() - m * MIN).toISOString();
  const latest = {ts: [t(170), t(50), t(45), t(30), t(10)], stations: {a: [[1, 9], null, [3, 7], [4, null], [5, 5]]}};
  const h = historyFromLatest(latest, 'a', now.getTime());
  assert.deepEqual(h.all.map((x) => x.bikes), [1, 3, 4, 5]);
  assert.equal(h.all[0].t, now.getTime() - 170 * MIN);
  assert.deepEqual(h.recent.map((x) => x.bikes), [3, 4, 5]);
  assert.deepEqual(historyFromLatest(latest, 'missing', now.getTime()), {all: [], recent: []});
  assert.deepEqual(historyFromLatest(null, 'a', now.getTime()), {all: [], recent: []});
});

test('riskInput builds the stationRisk input, null when the network has no profiles', () => {
  const prof = synth.profiles.n1, sid = 'n1-s0';
  const st = {id: sid, bikes: 4, slots: 6};
  const hist = [{t: now.getTime() - 10 * MIN, bikes: 6}];
  const w = {temp: 9, precip: 0, wind: 4};
  const input = riskInput(st, prof, hist, w, now, 0.5);
  assert.deepEqual(input, {bikes: 4, slots: 6, profile: prof[sid], defaults: prof._default, history: hist,
    weather: w, now, threshold: 0.5});
  assert.equal(riskInput({...st, id: 'unseen'}, prof, [], null, now, 0.5).profile, undefined);
  assert.equal(riskInput(st, undefined, [], null, now, 0.5), null);
  // the built input is accepted by stationRisk with a trained model and with the null model
  assert.ok(['ok', 'empty', 'full'].includes(stationRisk(input, synth.model).state));
  assert.equal(stationRisk(input, {targets: {empty: null, full: null}}).state, 'unknown');
});

test('markerState: unknown is coloured from live counts only', () => {
  for (const s of ['ok', 'empty', 'full', 'off']) assert.equal(markerState({state: s}, 3), s);
  assert.equal(markerState({state: 'unknown'}, 3), 'ok');
  assert.equal(markerState({state: 'unknown'}, 0), 'off');
});

test('stateWords says the status in words', () => {
  assert.equal(stateWords({state: 'ok'}, 3), 'Available');
  assert.equal(stateWords({state: 'empty'}, 3), 'Likely empty within 30 min');
  assert.equal(stateWords({state: 'full'}, 3), 'Likely full within 30 min');
  assert.equal(stateWords({state: 'off'}, 0), 'Empty now');
  assert.equal(stateWords({state: 'off'}, 5), 'Full now');
  assert.equal(stateWords({state: 'unknown'}, 2), 'Available');
  assert.equal(stateWords({state: 'unknown'}, 0), 'Empty now');
});

test('topRisk ranks by max probability, ties go to empty, skips stations without one', () => {
  const e = (id, pEmpty, pFull, state = 'ok') => ({station: {id}, risk: {state, pEmpty, pFull}});
  const out = topRisk([e('a', 0.2, null), e('b', 0.9, 0.1), e('c', null, null, 'off'), e('d', 0.3, 0.7),
    e('f', 0.5, 0.5), e('g', 0.1, 0.05), e('h', null, null, 'unknown')]);
  assert.deepEqual(out.map((r) => [r.station.id, r.kind, r.p]),
    [['b', 'empty', 0.9], ['d', 'full', 0.7], ['f', 'empty', 0.5], ['a', 'empty', 0.2]]);
  assert.deepEqual(topRisk([e('c', null, null, 'unknown')]), []);
});

test('statusText: Budapest time, rounded temperature, rain or dry, failure text', () => {
  const updated = new Date('2026-11-12T11:41:30Z'); // 12:41 CET
  assert.equal(statusText({updated, weather: {temp: 8.6, precip: 0.3, wind: 3}}), 'Updated 12:41 · 9 °C · rain');
  assert.equal(statusText({updated, weather: {temp: -0.4, precip: 0, wind: 3}}), 'Updated 12:41 · 0 °C · dry');
  assert.equal(statusText({updated: new Date('2026-07-01T07:05:00Z'), weather: null}), 'Updated 09:05');
  assert.equal(statusText({updated, weather: null, failed: true}), 'Live data unavailable — retrying');
  assert.equal(statusText({updated: null, weather: null}), 'Loading live data…');
});

test('dockInfo: docks and free docks only for dock stations', () => {
  assert.deepEqual(dockInfo({bikes: 2, slots: 18}, {cap: 20, dock: true}), {docks: 20, free: 18});
  assert.deepEqual(dockInfo({bikes: 6, slots: 0}, {cap: 2, dock: false}), {docks: null, free: null});
  assert.deepEqual(dockInfo({bikes: 6, slots: null}, {cap: 20, dock: true}), {docks: 20, free: null});
  assert.deepEqual(dockInfo({bikes: 3, slots: 5, virtual: false}, undefined), {docks: 8, free: 5});
  assert.deepEqual(dockInfo({bikes: 3, slots: 0, virtual: true}, undefined), {docks: null, free: null});
  assert.deepEqual(dockInfo({bikes: 3, slots: null, virtual: false}, undefined), {docks: null, free: null});
});

test('subtitle omits unknown zone and docks', () => {
  assert.equal(subtitle('Budapest', 'Belváros', 20), 'Budapest · Belváros zone · 20 docks');
  assert.equal(subtitle('Budapest', null, 20), 'Budapest · 20 docks');
  assert.equal(subtitle('Wien', 'Ring', null), 'Wien · Ring zone');
  assert.equal(subtitle('Wien', undefined, null), 'Wien');
});

test('sparkPaths scales the last 3 hours into the box, null with fewer than 2 points', () => {
  const n = now.getTime();
  const p = sparkPaths([{t: n - 180 * MIN, bikes: 0}, {t: n - 90 * MIN, bikes: 5}, {t: n, bikes: 10}], n, 300, 60);
  assert.equal(p.line, 'M0,60 L150,30 L300,0');
  assert.equal(p.area, 'M0,60 L150,30 L300,0 L300,60 L0,60 Z');
  assert.equal(sparkPaths([{t: n, bikes: 3}], n, 300, 60), null);
  const flat = sparkPaths([{t: n - 60 * MIN, bikes: 0}, {t: n, bikes: 0}], n, 300, 60);
  assert.equal(flat.line, 'M200,60 L300,60');
});
