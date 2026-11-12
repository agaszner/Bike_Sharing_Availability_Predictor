// Model view: test-window metrics, precision-recall and calibration charts, per-city table. Every number is from state.model.
import {NETWORKS} from './app-logic.js';
import {fmtMetric, fmtCount, isTrained, polyPoints, testWindowText, testWindowDays} from './view-logic.js';
import {el, svg} from './dom.js';

const CHART_W = 400;
const CHART_H = 250;
const PLOT = {x: 48, y: 12, w: 336, h: 182};
const TICKS = [0, 0.5, 1];
const DOT_R = 3.5;
const BRIER_DIGITS = 3;
const TARGETS = {empty: 'runs empty', full: 'fills up'};
const NOT_TRAINED = 'The model has not been trained yet. Data collection started on 2026-11-12.';
const NO_CHARTS = 'Charts appear once this target has been trained.';
const NOTES = [
  ['What is predicted', 'For every station and snapshot: does it hit 0 bikes (empty) or 0 free docks (full) at any '
    + 'snapshot in the following 30 minutes?'],
  ['What the model sees', 'Fill level now, change over the last 10 and 30 minutes, capacity, hour and weekday, the '
    + 'station’s usual rate at this hour, temperature, rain and wind.'],
  ['How it is tested', 'Trained on the earlier days, tested on the latest days. No shuffling, so the model never peeks '
    + 'at the future. Logistic regression runs in the browser; gradient boosting is the offline comparison.'],
];

let target = 'empty';

const card = (label, value, sub) => el('div', {class: 'mcard'},
  el('span', {class: 'label'}, label), el('span', {class: 'num'}, value), el('span', {class: 'muted'}, sub));

const legend = (items) => el('ul', {class: 'mlegend'},
  ...items.map(([kind, text]) => el('li', {}, el('span', {class: `key ${kind}`, 'aria-hidden': 'true'}), text)));

// Axes, grid and 0/0.5/1 ticks shared by both charts; marks are drawn on top.
function chart(label, xTitle, yTitle, ...marks) {
  const sx = (v) => PLOT.x + v * PLOT.w, sy = (v) => PLOT.y + PLOT.h - v * PLOT.h;
  const bottom = PLOT.y + PLOT.h;
  return svg('svg', {class: 'mchart', viewBox: `0 0 ${CHART_W} ${CHART_H}`, role: 'img', 'aria-label': label},
    ...TICKS.flatMap((t) => [
      svg('line', {class: 'grid', x1: PLOT.x, x2: PLOT.x + PLOT.w, y1: sy(t), y2: sy(t)}),
      svg('text', {class: 'tick', x: PLOT.x - 8, y: sy(t), 'text-anchor': 'end', 'dominant-baseline': 'middle'}, String(t)),
      svg('text', {class: 'tick', x: sx(t), y: bottom + 16, 'text-anchor': 'middle'}, String(t)),
    ]),
    svg('line', {class: 'axis', x1: PLOT.x, x2: PLOT.x, y1: PLOT.y, y2: bottom}),
    svg('text', {class: 'axis-title', x: PLOT.x + PLOT.w / 2, y: CHART_H - 8, 'text-anchor': 'middle'}, xTitle),
    svg('text', {class: 'axis-title', transform: `translate(14 ${PLOT.y + PLOT.h / 2}) rotate(-90)`, 'text-anchor': 'middle'},
      yTitle),
    ...marks);
}

function charts(model, m) {
  const curves = model.curves?.[target];
  const name = TARGETS[target];
  const prBox = el('section', {class: 'mbox'}, el('h3', {}, `Precision vs recall · ${name}`));
  const calBox = el('section', {class: 'mbox'}, el('h3', {}, 'Calibration · predicted vs observed'));
  if (!model.targets?.[target] || !curves) {
    prBox.append(el('p', {class: 'muted'}, NO_CHARTS));
    calBox.append(el('p', {class: 'muted'}, NO_CHARTS));
    return [prBox, calBox];
  }
  const line = (points, cls) => svg('polyline', {class: cls, points: polyPoints(points, PLOT)});
  prBox.append(
    chart(`Precision–recall curve: model average precision ${fmtMetric(m?.pr_auc)}, `
      + `baseline ${fmtMetric(m?.pr_auc_baseline)}`, 'Recall', 'Precision',
    line(curves.pr_baseline ?? [], 'base'), line(curves.pr ?? [], 'model')),
    legend([['model', 'Model'], ['base', 'Baseline: station’s usual rate at this hour']]));
  const cal = curves.calibration ?? []; // [predicted, observed, n]; polyPoints reads the first two
  calBox.append(
    chart(`Calibration: ${cal.length} groups of predictions, predicted probability against observed rate; `
      + `Brier score ${fmtMetric(m?.brier, BRIER_DIGITS)}, baseline ${fmtMetric(m?.brier_baseline, BRIER_DIGITS)}`,
    'Predicted', 'Observed',
    line([[0, 0], [1, 1]], 'base'), line(cal, 'model'),
    ...cal.map((pt) => {
      const [cx, cy] = polyPoints([pt], PLOT).split(',');
      return svg('circle', {class: 'dot', cx, cy, r: DOT_R});
    })),
    legend([['model', 'Model'], ['base', 'Perfect']]));
  return [prBox, calBox];
}

function table(model) {
  const cols = ['City', 'Stations', 'Model', 'Baseline', 'Gradient boosting'];
  const rows = NETWORKS.map((n) => {
    const m = model.metrics?.[n.id]?.[target];
    return el('tr', {}, el('th', {scope: 'row'}, n.name),
      ...[fmtCount(model.test_window?.stations?.[n.id]), fmtMetric(m?.pr_auc), fmtMetric(m?.pr_auc_baseline),
        fmtMetric(m?.pr_auc_hgb)].map((v) => el('td', {}, v)));
  });
  return el('section', {class: 'mbox'}, el('h3', {}, 'By city'),
    el('div', {class: 'table-wrap'}, el('table', {class: 'mtable'},
      el('caption', {}, `PR-AUC, ${TARGETS[target]}`),
      el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', {scope: 'col'}, c)))),
      el('tbody', {}, ...rows))));
}

function render(root, model) {
  const all = model.metrics?.all ?? {};
  const m = all[target];
  const win = model.test_window;
  const days = testWindowDays(win);
  const toggle = el('div', {class: 'seg', role: 'group', 'aria-label': 'Prediction target'},
    ...Object.entries(TARGETS).map(([t, name]) => {
      const b = el('button', {type: 'button', 'data-target': t, 'aria-pressed': String(t === target)},
        name[0].toUpperCase() + name.slice(1));
      b.addEventListener('click', () => {
        target = t;
        render(root, model);
        root.querySelector(`[data-target="${t}"]`).focus();
      });
      return b;
    }));
  const prCard = (t) => card(`PR-AUC · ${TARGETS[t]}`, fmtMetric(all[t]?.pr_auc),
    `baseline ${fmtMetric(all[t]?.pr_auc_baseline)}`);

  root.replaceChildren(el('div', {class: 'model-page'},
    el('div', {class: 'model-head'},
      el('div', {}, el('h2', {}, 'How good are the predictions?'),
        el('p', {class: 'muted'}, `Will a station be empty or full within 30 minutes? Tested on ${testWindowText(win) ?? '—'}, `
          + 'days the model never saw.')),
      toggle),
    el('div', {class: 'mcards'},
      prCard('empty'), prCard('full'),
      card(`Brier score · ${TARGETS[target]} (lower is better)`, fmtMetric(m?.brier, BRIER_DIGITS),
        `baseline ${fmtMetric(m?.brier_baseline, BRIER_DIGITS)}`),
      card('Test window', days ? `${days} ${days === 1 ? 'day' : 'days'}` : '—',
        `${fmtCount(win?.rows)} station snapshots`)),
    el('div', {class: 'mgrid'}, ...charts(model, m), table(model)),
    el('div', {class: 'mgrid'}, ...NOTES.map(([h, p]) => el('section', {class: 'mbox'}, el('h3', {}, h),
      el('p', {class: 'muted'}, p))))));
}

// Called on every view or network change and after static data loads; renders only while visible.
export function mountModel(root, state) {
  if (state.view !== 'model') return;
  if (!state.loaded || !isTrained(state.model)) {
    root.replaceChildren(el('p', {class: 'coming'}, state.loaded ? NOT_TRAINED : 'Loading…'));
    return;
  }
  render(root, state.model);
}
