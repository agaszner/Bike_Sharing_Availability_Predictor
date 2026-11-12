import json
from pathlib import Path

import numpy as np

from model.make_js_fixture import build

COMMITTED = Path(__file__).resolve().parent.parent / "web" / "predict.fixture.json"
STALE = "web/predict.fixture.json is stale: run `python -m model.make_js_fixture`"
RAW = ("network", "station_id", "bikes", "slots", "now", "history", "weather")


def _close(a, b):
    """Nested JSON equality with floats compared to 1e-9."""
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(_close(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b))
    if isinstance(a, float) or isinstance(b, float):
        return isinstance(a, (int, float)) and isinstance(b, (int, float)) and abs(a - b) < 1e-9
    return a == b


def test_regenerated_fixture_matches_the_committed_one(tmp_path):
    # Model coefficients, `fixtures` and `p` depend on the scikit-learn version, so only inputs, x and profiles count.
    new, old = build(tmp_path / "f.json"), json.loads(COMMITTED.read_text())
    assert new.keys() == old.keys() == {"model", "profiles", "fixtures", "cases"}, STALE
    assert _close(new["profiles"], old["profiles"]), f"profiles differ; {STALE}"
    for t in ("empty", "full"):
        assert len(new["fixtures"][t]) == len(old["fixtures"][t]) > 0, STALE
        assert len(new["cases"][t]) == len(old["cases"][t]) > 0, STALE
        for i, (n, o) in enumerate(zip(new["cases"][t], old["cases"][t])):
            assert n.keys() == o.keys(), STALE
            assert {k: n[k] for k in RAW} == {k: o[k] for k in RAW}, f"{t} case {i} inputs differ; {STALE}"
            assert np.allclose(n["x"], o["x"], rtol=0, atol=1e-9), f"{t} case {i} x differs; {STALE}"
