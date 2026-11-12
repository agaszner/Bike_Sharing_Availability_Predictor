import test from 'node:test';
import assert from 'node:assert/strict';
import {hourText, signed, zoneRadius, arrowWidth, heatColor, arrowPath, hasFlowData, polyPoints, fmtMetric, fmtCount,
  isTrained, targetMetrics, testWindowText, testWindowDays} from './view-logic.js';

test('hourText pads to HH:00', () => {
  assert.equal(hourText(8), '08:00');
  assert.equal(hourText(23), '23:00');
});

test('signed uses one decimal, + for positive, true minus for negative, 0 when it rounds to zero', () => {
  assert.equal(signed(4.21), '+4.2');
  assert.equal(signed(-3.96), '−4.0');
  assert.equal(signed(0), '0');
  assert.equal(signed(-0.04), '0');
  assert.equal(signed(0.04), '0');
  // halves round away from zero on both sides, so +x and -x always show the same digits
  assert.equal(signed(0.25), '+0.3');
  assert.equal(signed(-0.25), '−0.3');
  assert.equal(signed(-0.05), '−0.1');
});

test('zoneRadius grows with |value| by area between a minimum and a maximum', () => {
  assert.equal(zoneRadius(0, 10), 12);
  assert.equal(zoneRadius(0, 0), 12);
  assert.equal(zoneRadius(10, 10), 34);
  assert.equal(zoneRadius(-10, 10), 34);
  assert.equal(zoneRadius(2.5, 10), 23); // 12 + 22 * sqrt(0.25)
  assert.equal(zoneRadius(50, 10), 34);
});

test('arrowWidth scales linearly with amount', () => {
  assert.equal(arrowWidth(0, 10), 1.5);
  assert.equal(arrowWidth(10, 10), 6);
  assert.equal(arrowWidth(5, 10), 3.75);
  assert.equal(arrowWidth(5, 0), 1.5);
});

test('heatColor is a diverging scale: white at 0, teal when arriving, orange when leaving', () => {
  assert.equal(heatColor(0, 5), '#ffffff');
  assert.equal(heatColor(3, 0), '#ffffff');
  assert.equal(heatColor(5, 5), '#0c8599');
  assert.equal(heatColor(-5, 5), '#e8590c');
  assert.equal(heatColor(-9, 5), '#e8590c');
  assert.equal(heatColor(2.5, 5), '#86c2cc'); // halfway from white to #0C8599
  assert.equal(heatColor(-2.5, 5), heatColor(-2.5, -5)); // symmetric, sign of max ignored
});

test('arrowPath is a quadratic curve trimmed to the circle edges', () => {
  // horizontal, 100 px apart, radii 10 and 20, bend 0.2 of the trimmed length
  assert.equal(arrowPath({x: 0, y: 0}, {x: 100, y: 0}, 10, 20), 'M10 0 Q45 14 80 0');
  // overlapping circles: nothing to draw
  assert.equal(arrowPath({x: 0, y: 0}, {x: 20, y: 0}, 10, 15), null);
  // vertical works too (perpendicular of (0,1) is (-1,0))
  assert.equal(arrowPath({x: 0, y: 0}, {x: 0, y: 50}, 5, 5), 'M0 5 Q-8 25 0 45');
});

test('hasFlowData is false for missing, all-zero and arrow-less data', () => {
  const zero = {zones: [{id: 0}], net: {weekday: [Array(24).fill(0)], weekend: [Array(24).fill(0)]},
    arrows: {weekday: Array(24).fill([]), weekend: Array(24).fill([])}};
  assert.equal(hasFlowData(undefined), false);
  assert.equal(hasFlowData({}), false);
  assert.equal(hasFlowData(zero), false);
  const net = structuredClone(zero);
  net.net.weekend[0][5] = -0.3;
  assert.equal(hasFlowData(net), true);
  const arrows = structuredClone(zero);
  arrows.arrows.weekday[8] = [[0, 1, 2.1]];
  assert.equal(hasFlowData(arrows), true);
});

test('polyPoints maps 0..1 data into a plot box with y up', () => {
  const box = {x: 40, y: 10, w: 200, h: 100};
  assert.equal(polyPoints([[0, 0], [1, 1], [0.5, 0.25]], box), '40,110 240,10 140,85');
  assert.equal(polyPoints([], box), '');
});

test('fmtMetric gives fixed decimals or a dash', () => {
  assert.equal(fmtMetric(0.887698), '0.89');
  assert.equal(fmtMetric(0.0271193, 3), '0.027');
  assert.equal(fmtMetric(null), '—');
  assert.equal(fmtMetric(undefined, 3), '—');
  assert.equal(fmtMetric(NaN), '—');
});

test('fmtCount groups thousands or gives a dash', () => {
  assert.equal(fmtCount(412000), '412,000');
  assert.equal(fmtCount(87), '87');
  assert.equal(fmtCount(undefined), '—');
});

test('isTrained needs at least one trained target', () => {
  assert.equal(isTrained(null), false);
  assert.equal(isTrained({}), false);
  assert.equal(isTrained({targets: {empty: null, full: null}}), false);
  assert.equal(isTrained({targets: {empty: null, full: {coef: []}}}), true);
});

test('testWindowText formats a Budapest date range', () => {
  const norm = (s) => s.replace(/\s/g, ' ');
  assert.equal(norm(testWindowText({from: '2026-11-28T10:00:00Z', to: '2026-12-02T20:00:00Z'})), '28 Nov – 2 Dec 2026');
  assert.equal(norm(testWindowText({from: '2026-11-20T10:00:00Z', to: '2026-11-20T12:00:00Z'})), '20 Nov 2026');
  // 23:30Z is already the next day in Budapest
  assert.equal(norm(testWindowText({from: '2026-11-20T10:00:00Z', to: '2026-11-20T23:30:00Z'})), '20 – 21 Nov 2026');
  assert.equal(testWindowText(null), null);
  assert.equal(testWindowText({from: 'x', to: 'y'}), null);
});

test('testWindowDays rounds the duration, at least one day', () => {
  assert.equal(testWindowDays({from: '2026-11-20T00:00:00Z', to: '2026-11-20T23:50:00Z'}), 1);
  assert.equal(testWindowDays({from: '2026-11-28T00:00:00Z', to: '2026-12-02T23:50:00Z'}), 5);
  assert.equal(testWindowDays({from: '2026-11-12T14:37:00Z', to: '2026-11-12T14:37:00Z'}), 1);
  assert.equal(testWindowDays(undefined), null);
});

test('targetMetrics returns metrics only for a trained target', () => {
  const metrics = {all: {empty: {pr_auc: 0.8}, full: {pr_auc: 0.7}}, 'mol-bubi': {empty: {pr_auc: 0.6}}};
  const model = {targets: {empty: {coef: []}, full: null}, metrics};
  assert.deepEqual(targetMetrics(model, 'all', 'empty'), {pr_auc: 0.8});
  assert.equal(targetMetrics(model, 'all', 'full'), null);
  assert.deepEqual(targetMetrics(model, 'mol-bubi', 'empty'), {pr_auc: 0.6});
  assert.equal(targetMetrics(model, 'wienmobil-rad', 'empty'), null);
  assert.equal(targetMetrics(null, 'all', 'empty'), null);
});
