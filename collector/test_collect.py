from collector import collect
from collector.collect import station_rows, station_meta, roll_latest

RAW = {"network": {"stations": [
    {"id": "a", "name": "A tér", "latitude": 47.5, "longitude": 19.0,
     "free_bikes": 7, "empty_slots": 0, "extra": {"virtual": True}},
    {"id": "b", "name": "B", "latitude": 48.2, "longitude": 16.3,
     "free_bikes": 0, "empty_slots": None, "extra": {}},
]}}


def test_station_rows_keeps_null_slots_empty():
    assert station_rows("x", RAW) == [("x", "a", 7, 0), ("x", "b", 0, "")]


def test_station_rows_skips_stations_without_a_bike_count():
    raw = {"network": {"stations": [{"id": "a", "free_bikes": None, "empty_slots": 3},
                                    {"id": "b", "free_bikes": True, "empty_slots": 3},
                                    {"id": "c", "free_bikes": 2, "empty_slots": 3}]}}
    assert station_rows("x", raw) == [("x", "c", 2, 3)]


def test_station_meta_flags_virtual():
    assert station_meta(RAW) == [
        {"id": "a", "name": "A tér", "lat": 47.5, "lon": 19.0, "virtual": True},
        {"id": "b", "name": "B", "lat": 48.2, "lon": 16.3, "virtual": False},
    ]


def test_roll_latest_appends_aligns_and_caps_at_18():
    latest = {"ts": ["t1"], "stations": {"a": [[5, 1]], "gone": [[2, 2]]}}
    out = roll_latest(latest, "t2", [("x", "a", 7, 0), ("x", "b", 0, "")])
    assert out["ts"] == ["t1", "t2"]
    assert out["stations"]["a"] == [[5, 1], [7, 0]]
    assert out["stations"]["b"] == [None, [0, None]]      # new station: padded
    assert out["stations"]["gone"] == [[2, 2], None]      # missing this run
    for i in range(30):
        out = roll_latest(out, f"t{i+3}", [("x", "a", 1, 1)])
    assert len(out["ts"]) == 18 and len(out["stations"]["a"]) == 18
    assert "gone" not in out["stations"]                  # absent for all 18 entries


def test_roll_latest_starts_from_nothing():
    assert roll_latest(None, "t1", [("x", "a", 1, 1)]) == {"ts": ["t1"], "stations": {"a": [[1, 1]]}}


def fake_get_json(url):
    if "citybik.es" in url:
        return RAW
    return {"current": {"temperature_2m": 1.5, "precipitation": 0.0, "wind_speed_10m": 2.0}}


def test_main_one_network_failing_keeps_the_others(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "get_json", fake_get_json)
    (tmp_path / "stations" / "bicikelj.json").mkdir(parents=True)  # writing it will raise
    assert collect.main(str(tmp_path)) == 0
    [snap] = tmp_path.glob("snapshots/*/*.csv")
    lines = snap.read_text().splitlines()
    assert lines[0] == "network,station_id,bikes,slots"
    assert sorted({l.split(",")[0] for l in lines[1:]}) == ["mol-bubi", "slovnaft-bajk", "wienmobil-rad"]
    assert "mol-bubi,b,0," in lines                                   # null slots: empty, not 0
    assert len((tmp_path / "weather.csv").read_text().splitlines()) == 1 + 3
    assert b"\r" not in snap.read_bytes() + (tmp_path / "weather.csv").read_bytes()  # plain \n endings


def test_main_all_networks_failing_returns_1(tmp_path, monkeypatch):
    def down(url):
        raise OSError("down")
    monkeypatch.setattr(collect, "get_json", down)
    assert collect.main(str(tmp_path)) == 1
