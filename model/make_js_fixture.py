"""Writes web/predict.fixture.json: a model trained on the synthetic data of test_train.py plus raw browser inputs
and the features/probabilities Python computes for them, so web/predict.test.js can check parity.
Run: python -m model.make_js_fixture"""
import json
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd

from model import features, load, train
from model.test_train import write_data

OUT = Path(__file__).resolve().parent.parent / "web" / "predict.fixture.json"
N_WEEKEND, N_WEEKDAY = 6, 14


def _cases(df, weather, profiles, model, t):
    _, te = train.time_split(df)
    X, _ = features.build_matrix(te[te.network.isin(profiles)], weather, profiles, t)
    w = X.is_weekend == 1
    sample = pd.concat([X[w].sample(N_WEEKEND, random_state=0), X[~w].sample(N_WEEKDAY, random_state=0)])
    m = model["targets"][t]
    z = ((sample.to_numpy(float) - m["mean"]) / m["std"]) @ np.array(m["coef"]) + m["intercept"]
    out = []
    for (i, x), zi in zip(sample.iterrows(), z):
        r = df.loc[i]
        hist = df[(df.network == r.network) & (df.station_id == r.station_id)
                  & (df.ts >= r.ts - pd.Timedelta(minutes=45)) & (df.ts < r.ts)]
        out.append({"network": r.network, "station_id": r.station_id, "bikes": int(r.bikes),
                    "slots": None if pd.isna(r.slots) else int(r.slots), "now": train._iso(r.ts),
                    "history": [{"t": train._iso(ts), "bikes": int(b)} for ts, b in zip(hist.ts, hist.bikes)],
                    "weather": {c: float(x[c]) for c in features.WEATHER},
                    "x": x.to_numpy(float).tolist(), "p": float(1 / (1 + np.exp(-zi)))})
    xs = np.array([c["x"] for c in out])
    assert (xs[:, 4] != 0).any() and (xs[:, 5] != 0).any(), "cases need non-zero d10 and d30"
    return out


def build(out_file=OUT):
    with tempfile.TemporaryDirectory() as tmp:
        data, web = write_data(Path(tmp) / "data", 5 * 144), Path(tmp) / "web"
        train.run(str(data), str(web))
        res = {name: json.loads((web / f"{name}.json").read_text()) for name in ("model", "profiles", "fixtures")}
        df = features.add_lags(features.add_labels(load.snapshots(str(data))))
        weather = load.weather(str(data))
    # Browser-side features use the exported profiles (all data), so the cases do too.
    res["cases"] = {t: _cases(df, weather, res["profiles"], res["model"], t) for t in train.TARGETS}
    Path(out_file).write_text(json.dumps(res, allow_nan=False, ensure_ascii=False), encoding="utf-8")
    return res


if __name__ == "__main__":
    build()
