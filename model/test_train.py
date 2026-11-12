import json
import math

import numpy as np
import pandas as pd
import pytest

from model import features
from model.features import FEATURES, HORIZON
from model.load import snapshots
from model.train import run, time_split

T0 = pd.Timestamp("2026-11-16 00:00", tz="UTC")


def write_data(root, steps, never_full=False):
    """2 networks x 6 dock stations at 10-minute steps; bikes follow a daily sine plus seeded noise."""
    rng = np.random.default_rng(0)
    cap = 10
    times = [T0 + pd.Timedelta(minutes=10 * i) for i in range(steps)]
    stations = [(net, f"{net}-s{i}") for net in ("n1", "n2") for i in range(6)]
    phase = {s: rng.uniform(0, 2 * np.pi) for s in stations}
    for ts in times:
        day = (ts - T0) / pd.Timedelta(days=1)
        rows = []
        for net, sid in stations:
            b = int(np.clip(round(cap / 2 + 7 * math.sin(2 * math.pi * day + phase[net, sid]) + rng.normal(0, 1)),
                            0, cap - 1 if never_full else cap))
            rows.append({"network": net, "station_id": sid, "bikes": b, "slots": cap - b})
        f = root / "snapshots" / ts.strftime("%Y-%m-%d") / f"{ts.strftime('%H%M')}.csv"
        f.parent.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(rows).to_csv(f, index=False)
    hours = pd.date_range(T0, times[-1], freq="h")
    pd.DataFrame([{"ts": h.strftime("%Y-%m-%dT%H:%M:%SZ"), "network": net, "temp": 5.0 + (h.hour % 7),
                   "precip": 0.0, "wind": float(h.hour % 5)} for h in hours for net in ("n1", "n2")]
                 ).to_csv(root / "weather.csv", index=False)
    (root / "stations").mkdir()
    for net in ("n1", "n2"):
        (root / "stations" / f"{net}.json").write_text(json.dumps(
            [{"id": sid, "name": sid, "lat": 47.5, "lon": 19.0, "virtual": False} for n, sid in stations if n == net]))
    return root


@pytest.fixture
def synthetic_data(tmp_path):
    return write_data(tmp_path / "data", 5 * 144)


@pytest.fixture
def synthetic_data_never_full(tmp_path):
    return write_data(tmp_path / "data", 5 * 144, never_full=True)


@pytest.fixture
def df(synthetic_data):
    return snapshots(str(synthetic_data))


def test_snapshots_drop_rows_without_a_bike_count(tmp_path):
    f = tmp_path / "snapshots" / "2026-11-16" / "0700.csv"
    f.parent.mkdir(parents=True)
    f.write_text("network,station_id,bikes,slots\nn,a,3,1\nn,b,,2\nn,c,x,2\n")
    df = snapshots(str(tmp_path))
    assert df.station_id.tolist() == ["a"] and df.bikes.tolist() == [3]
    assert pd.api.types.is_integer_dtype(df.bikes)


def test_time_split_is_chronological(df):
    tr, te = time_split(df)
    assert tr.ts.max() < te.ts.min()
    assert 0.15 < len(te) / len(df) < 0.25


def test_run_writes_schema_and_beats_chance(synthetic_data, tmp_path):
    m = run(str(synthetic_data), str(tmp_path))
    assert m["features"] == FEATURES
    for t in ("empty", "full"):
        assert len(m["targets"][t]["coef"]) == 13 and all(s > 0 for s in m["targets"][t]["std"])
        a = m["metrics"]["all"][t]
        assert 0 <= a["pr_auc"] <= 1 and a["pr_auc"] > a["pos_rate"]
        assert len(m["curves"][t]["pr"]) <= 50
    assert json.loads((tmp_path / "model.json").read_text()) == m
    assert set(json.loads((tmp_path / "profiles.json").read_text())) == {"n1", "n2"}


def test_constant_feature_exports_unit_std(synthetic_data, tmp_path):
    m = run(str(synthetic_data), str(tmp_path))
    assert m["targets"]["empty"]["std"][FEATURES.index("precip")] == 1.0     # precip is always 0.0


def test_fixtures_reproduce_from_exported_coefficients(synthetic_data, tmp_path):
    m = run(str(synthetic_data), str(tmp_path))
    fx = json.loads((tmp_path / "fixtures.json").read_text())
    t = m["targets"]["empty"]
    for row in fx["empty"]:
        z = sum(c * (x - mu) / sd for c, x, mu, sd in zip(t["coef"], row["x"], t["mean"], t["std"])) + t["intercept"]
        assert abs(1 / (1 + math.exp(-z)) - row["p"]) < 1e-9


def test_target_with_too_few_positives_is_null(synthetic_data_never_full, tmp_path):
    m = run(str(synthetic_data_never_full), str(tmp_path))
    assert m["targets"]["full"] is None and m["targets"]["empty"] is not None


@pytest.fixture
def spy(monkeypatch):
    """Records (input df, X) of every build_matrix call and the df of every build_profiles call."""
    calls = {"matrix": [], "profiles": []}
    real_matrix, real_profiles = features.build_matrix, features.build_profiles

    def build_matrix(df, *a):
        X, y = real_matrix(df, *a)
        calls["matrix"].append((df, X))
        return X, y

    def build_profiles(df, *a):
        calls["profiles"].append(df)
        return real_profiles(df, *a)

    monkeypatch.setattr(features, "build_matrix", build_matrix)
    monkeypatch.setattr(features, "build_profiles", build_profiles)
    return calls


def test_matrices_use_the_weather_reading_of_their_own_hour(synthetic_data, tmp_path, spy):
    run(str(synthetic_data), str(tmp_path))
    for df, X in spy["matrix"]:                             # train and test matrices alike
        assert (X.temp == 5.0 + df.ts.loc[X.index].dt.hour % 7).all()


def test_train_rows_are_purged_one_horizon_before_the_cut(synthetic_data, tmp_path, spy):
    df = snapshots(str(synthetic_data))
    cut = df.ts.min() + (df.ts.max() - df.ts.min()) * 0.8
    run(str(synthetic_data), str(tmp_path))
    train_frames = [spy["profiles"][0]] + [d for d, _ in spy["matrix"] if d.ts.max() < cut]
    assert len(train_frames) == 3                           # train profiles + one train matrix per target
    assert all(d.ts.max() <= cut - HORIZON for d in train_frames)


@pytest.mark.parametrize("steps", [1, 2])
def test_no_labelled_rows_still_writes_valid_files(tmp_path, steps):
    out = tmp_path / "web"                                  # does not exist yet
    m = run(str(write_data(tmp_path / "data", steps)), str(out))
    assert m["targets"] == {"empty": None, "full": None}
    assert m["metrics"]["all"]["empty"]["pr_auc"] is None
    assert json.loads((out / "model.json").read_text()) == m
    assert set(json.loads((out / "profiles.json").read_text())) == {"n1", "n2"}
    assert json.loads((out / "fixtures.json").read_text()) == {"empty": [], "full": []}
