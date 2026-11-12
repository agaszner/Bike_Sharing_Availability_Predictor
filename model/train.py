"""Chronological split, logistic regression (deployed) + gradient boosting (offline) + baseline; writes web/*.json."""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, precision_recall_curve
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from model import features, load

NETWORKS = ["mol-bubi", "wienmobil-rad", "bicikelj", "slovnaft-bajk"]
TARGETS = ("empty", "full")
MIN_POSITIVES = 50
N_FIXTURES = 20


def _cut(df, test_fraction=0.2):
    return df.ts.min() + (df.ts.max() - df.ts.min()) * (1 - test_fraction)


def time_split(df, test_fraction=0.2):
    """Cut at tmin + (1 - test_fraction) * span; train strictly earlier, test from the cut on."""
    cut = _cut(df, test_fraction)
    return df[df.ts < cut], df[df.ts >= cut]


def _r(x):
    return None if x is None else float(f"{x:.6g}")


def _iso(ts):
    return ts.strftime("%Y-%m-%dT%H:%M:%SZ")


def _metrics(y, p_lr, p_hgb, base):
    n, pos = len(y), int(y.sum())
    m = {"n": n, "pos_rate": _r(pos / n) if n else None, "pr_auc": None, "pr_auc_baseline": None,
         "pr_auc_hgb": None, "brier": None, "brier_baseline": None}
    if pos == 0:
        return m
    m["pr_auc_baseline"] = _r(average_precision_score(y, base))
    m["brier_baseline"] = _r(brier_score_loss(y, base))
    if p_lr is not None:
        m["pr_auc"] = _r(average_precision_score(y, p_lr))
        m["pr_auc_hgb"] = _r(average_precision_score(y, p_hgb))
        m["brier"] = _r(brier_score_loss(y, p_lr))
    return m


def _pr(y, p):
    precision, recall, _ = precision_recall_curve(y, p)
    idx = np.unique(np.linspace(0, len(recall) - 1, min(50, len(recall))).round().astype(int))
    return [[_r(recall[i]), _r(precision[i])] for i in idx]


def _calibration(y, p):
    b = np.minimum((p * 10).astype(int), 9)
    return [[_r(p[b == i].mean()), _r(y[b == i].mean()), int((b == i).sum())] for i in range(10) if (b == i).any()]


def run(data_dir, out_dir):
    snaps, weather, stations = load.snapshots(data_dir), load.weather(data_dir), load.stations(data_dir)
    df = features.add_lags(features.add_labels(snaps))
    tr, te = time_split(df)
    # Purge: a train row's label window (t, t + 30 min] must not reach a snapshot at or after the cut.
    tr = tr[tr.ts < _cut(df) - features.HORIZON]
    nets = NETWORKS + sorted(set(df.network) - set(NETWORKS))

    targets, curves, fixtures = {}, {}, {}
    metrics = {k: {} for k in ["all"] + nets}
    # Profiles from the train period only (no test leakage); an empty train frame trains nothing.
    # Weather is the full frame: a reading at or before t is known at prediction time, as in the browser.
    profiles = features.build_profiles(tr, stations) if not tr.empty else None
    for t in TARGETS:
        targets[t], curves[t], fixtures[t] = None, None, []
        if profiles is None:
            for k in metrics:
                metrics[k][t] = _metrics(np.array([]), None, None, None)
            continue
        X_tr, y_tr = features.build_matrix(tr, weather, profiles, t)
        X_te, y_te = features.build_matrix(te[te.network.isin(profiles)], weather, profiles, t)
        y_tr, y_te = y_tr.to_numpy(int), y_te.to_numpy(int)
        p_lr = p_hgb = None
        if y_tr.sum() >= MIN_POSITIVES and (y_tr == 0).any():
            lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)).fit(X_tr, y_tr)
            hgb = HistGradientBoostingClassifier(random_state=0).fit(X_tr, y_tr)
            sc, cl = lr[0], lr[-1]
            targets[t] = {"mean": sc.mean_.tolist(), "std": sc.scale_.tolist(),   # scale_ is 1.0 for constant features
                          "coef": cl.coef_[0].tolist(), "intercept": float(cl.intercept_[0])}
            if len(X_te):
                p_lr, p_hgb = lr.predict_proba(X_te)[:, 1], hgb.predict_proba(X_te)[:, 1]
                sample = X_te.sample(min(N_FIXTURES, len(X_te)), random_state=0)
                fixtures[t] = [{"x": x.tolist(), "p": float(p)}
                               for x, p in zip(sample.to_numpy(float), lr.predict_proba(sample)[:, 1])]
        base = X_te.base.to_numpy(float)
        net = te.network.loc[X_te.index].to_numpy()
        metrics["all"][t] = _metrics(y_te, p_lr, p_hgb, base)
        for k in nets:
            s = net == k
            metrics[k][t] = _metrics(y_te[s], None if p_lr is None else p_lr[s], None if p_hgb is None else p_hgb[s],
                                     base[s])
        if p_lr is not None and y_te.sum() > 0:
            curves[t] = {"pr": _pr(y_te, p_lr), "pr_baseline": _pr(y_te, base), "calibration": _calibration(y_te, p_lr)}

    model = {
        "trained_at": _iso(datetime.now(timezone.utc)),
        "features": features.FEATURES,
        "targets": targets,
        "metrics": metrics,
        "curves": curves,
        "test_window": {
            "from": _iso(te.ts.min()) if len(te) else None,
            "to": _iso(te.ts.max()) if len(te) else None,
            "rows": len(te),
            "stations": {k: int(te.station_id[te.network == k].nunique()) for k in nets if (te.network == k).any()},
        },
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # Profiles for the browser come from all data; the exported coefficients stay those fitted on train.
    for name, obj in (("model", model), ("profiles", features.build_profiles(df, stations)), ("fixtures", fixtures)):
        (out / f"{name}.json").write_text(json.dumps(obj, allow_nan=False, ensure_ascii=False), encoding="utf-8")
    return model


if __name__ == "__main__":
    m = run(sys.argv[1], sys.argv[2])
    print(json.dumps(m["metrics"]["all"], indent=2))
