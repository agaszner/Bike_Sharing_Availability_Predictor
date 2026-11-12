import math

import numpy as np
import pandas as pd

from model.features import FEATURES, add_labels, add_lags, build_matrix, build_profiles

T0 = pd.Timestamp("2026-11-16 07:00", tz="UTC")


def snap(minutes, bikes, slots=None, station="s", network="n"):
    return pd.DataFrame({
        "ts": [T0 + pd.Timedelta(minutes=m) for m in minutes],
        "network": network,
        "station_id": station,
        "bikes": bikes,
        "slots": np.array([np.nan if v is None else v for v in slots] if slots else [np.nan] * len(minutes), float),
    })


def stations_df(**virtual_by_station):
    return pd.DataFrame({
        "network": "n",
        "station_id": list(virtual_by_station),
        "name": list(virtual_by_station),
        "lat": 47.5,
        "lon": 19.0,
        "virtual": list(virtual_by_station.values()),
    })


def weather_df():
    return pd.DataFrame({
        "ts": pd.Series([], dtype="datetime64[ns, UTC]"),
        "network": pd.Series([], dtype=str),
        "temp": pd.Series([], dtype=float),
        "precip": pd.Series([], dtype=float),
        "wind": pd.Series([], dtype=float),
    })


def test_empty_label_sees_zero_inside_30_min_only():
    df = add_labels(snap([0, 10, 20, 30, 40, 50], [3, 2, 1, 1, 0, 0]))
    assert df.empty_30.tolist()[:3] == [0.0, 1.0, 1.0]      # zero at +40 is outside t=0's window


def test_label_is_nan_when_window_has_fewer_than_two_snapshots():
    df = add_labels(snap([0, 10, 90, 100, 110], [3, 0, 3, 3, 3]))
    assert math.isnan(df.empty_30[0]) and math.isnan(df.empty_30[1])
    assert df.empty_30[2] == 0.0


def test_full_label_nan_when_slots_unknown():
    df = add_labels(snap([0, 10, 20, 30], [3, 3, 3, 3], slots=[None] * 4))
    assert df.full_30.isna().all()


def test_irregular_lags_pick_closest_in_window_else_zero():
    df = add_lags(snap([0, 12, 31, 100], [10, 8, 5, 5]))
    assert df.d10.tolist() == [0, -2, -3, 0]                # 31→12 is 19 min old: inside [5,20]
    assert df.d30.tolist() == [0, 0, -5, 0]


def test_lags_do_not_cross_stations():
    df = add_lags(pd.concat([snap([0, 10], [9, 9], station="a"), snap([0, 10], [1, 1], station="b")]))
    assert df.d10.tolist() == [0, 0, 0, 0]


def test_profile_cap_dock_and_default_fallback():
    train = add_labels(pd.concat([
        snap([0, 10, 20, 30], [0, 0, 1, 1], slots=[5, 5, 4, 4], station="dock"),
        snap([0, 10, 20, 30], [2, 2, 2, 2], slots=[None] * 4, station="free"),
    ]))
    p = build_profiles(train, stations_df(dock=False, free=False))["n"]
    assert p["dock"]["cap"] == 5 and p["dock"]["dock"] is True
    assert p["free"]["dock"] is False
    assert len(p["_default"]["empty"]) == 24
    assert p["dock"]["empty"][3] == p["_default"]["empty"][3]   # hour with no rows falls back


def test_matrix_keeps_only_transition_rows_and_feature_order():
    df = add_lags(add_labels(snap(list(range(0, 80, 10)), [2, 1, 0, 0, 1, 2, 2, 2], slots=[3] * 8)))
    X, y = build_matrix(df, weather_df(), build_profiles(df, stations_df(s=False)), "empty")
    assert list(X.columns) == FEATURES
    assert (X.bikes > 0).all()                  # rows already empty are excluded
    assert not y.isna().any() and not X.isna().any().any()


def test_full_matrix_excludes_non_dock_stations():
    df = add_lags(add_labels(snap(list(range(0, 80, 10)), [2] * 8, slots=[1] * 8)))
    X, _ = build_matrix(df, weather_df(), build_profiles(df, stations_df(s=True)), "full")
    assert len(X) == 0                          # station is virtual


def test_profile_rates_use_only_eligible_rows():
    train = add_labels(pd.concat([
        snap([0, 10, 20, 30, 40, 50], [0, 0, 1, 1, 1, 1], slots=[5, 5, 4, 4, 4, 4], station="d"),
        snap([0, 10, 20, 30, 40, 50], [2] * 6, slots=[1, 1, 0, 0, 0, 0], station="v"),
    ]))
    p = build_profiles(train, stations_df(d=False, v=True))["n"]
    assert p["d"]["empty"][8] == 0.0            # all labelled rows: 0.25; rows with bikes > 0: 0.0
    assert p["_default"]["full"][8] == 0.0      # virtual station's full labels do not count
