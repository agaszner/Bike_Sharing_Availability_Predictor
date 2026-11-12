import json

import pandas as pd

from model.flows import arrows, assign_zones, net_flow, run
from model.test_train import write_data


def grid_stations(n):
    return pd.DataFrame([{"network": "net", "station_id": f"s{i}", "name": f"Station {i}",
                          "lat": 47.4 + i // 8 * 0.01, "lon": 19.0 + i % 8 * 0.01, "virtual": False}
                         for i in range(n)])


def two_station_snaps(days=1, second_day_delta=None):
    """A loses `delta` bikes and B gains it 08:00 -> 08:10 local (07:00 UTC in November), then a 3-hour gap
    and a jump that must be ignored. Day 0 is Monday 2026-11-16 with delta 4; day 1 uses second_day_delta."""
    rows = []
    for d in range(days):
        delta = 4 if d == 0 else second_day_delta
        t = pd.Timestamp("2026-11-16 07:00", tz="UTC") + pd.Timedelta(days=d)
        for sid, sign in (("A", -1), ("B", 1)):
            for dt, b in ((0, 10), (10, 10 + sign * delta), (190, 10 + sign * 9)):
                rows.append({"ts": t + pd.Timedelta(minutes=dt), "network": "net", "station_id": sid,
                             "bikes": b, "slots": 20 - b})
    return pd.DataFrame(rows)


def test_zones_cover_every_station_and_k_scales():
    zone_of, zones = assign_zones(grid_stations(n=40))        # one network
    assert zone_of.notna().all() and len(zones) == 5           # 40 // 8
    assert all(z["name"] for z in zones)


def test_net_flow_sign_hour_and_gap():
    # station A loses 4 bikes 08:00→08:10 local, B gains 4; then a 3-hour gap with a jump that must be ignored
    net = net_flow(two_station_snaps(), pd.Series({"A": 0, "B": 1}))
    assert net["weekday"][0][8] == -4 and net["weekday"][1][8] == 4
    assert sum(abs(v) for z in net["weekday"] for h, v in enumerate(z) if h != 8) == 0


def test_net_flow_averages_over_days():
    net = net_flow(two_station_snaps(days=2, second_day_delta=2), pd.Series({"A": 0, "B": 1}))
    assert net["weekday"][0][8] == -3


def test_arrows_match_exporters_to_nearest_importers():
    zones = [{"id": 0, "lat": 0, "lon": 0}, {"id": 1, "lat": 0, "lon": 1}, {"id": 2, "lat": 0, "lon": 5}]
    assert arrows([-6, 4, 2], zones) == [[0, 1, 4], [0, 2, 2]]
    assert arrows([-0.4, 0.4, 0], zones) == []


def test_no_history_writes_zones_and_empty_flows(tmp_path):
    out = run(str(write_data(tmp_path / "data", 1)), str(tmp_path / "web"))
    assert json.loads((tmp_path / "web" / "flows.json").read_text()) == out
    assert list(out) == ["n1", "n2"]
    for f in out.values():
        assert f["zones"] and set(f["station_zone"].values()) <= {z["id"] for z in f["zones"]}
        for k in ("weekday", "weekend"):
            assert all(v == 0 for z in f["net"][k] for v in z) and len(f["net"][k]) == len(f["zones"])
            assert f["arrows"][k] == [[] for _ in range(24)]
