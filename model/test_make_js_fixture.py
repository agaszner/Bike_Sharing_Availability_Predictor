import json
from pathlib import Path

from model.make_js_fixture import build

COMMITTED = Path(__file__).resolve().parent.parent / "web" / "predict.fixture.json"


def test_regenerated_fixture_has_the_committed_structure(tmp_path):
    new, old = build(tmp_path / "f.json"), json.loads(COMMITTED.read_text())
    assert new.keys() == old.keys() == {"model", "profiles", "fixtures", "cases"}
    for t in ("empty", "full"):
        assert len(new["cases"][t]) == len(old["cases"][t]) > 0
        assert len(new["fixtures"][t]) == len(old["fixtures"][t]) > 0
        assert all(c.keys() == old["cases"][t][0].keys() for c in new["cases"][t])
