# Bike-Sharing Availability Predictor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public static site with a live station map of MOL Bubi (Budapest), Wien, Ljubljana and Bratislava that predicts "station will be empty or full within 30 minutes" and shows daily net bike flow between zones.

**Architecture:** A GitHub Actions cron job logs CityBikes + Open-Meteo snapshots every 10 minutes to a `data` branch. A nightly Actions job trains a logistic regression in Python on those snapshots and commits small JSON artifacts (coefficients, station profiles, flows, metrics) into `web/`. The site is plain HTML + JS on GitHub Pages: it fetches live data in the browser and computes predictions client-side from the exported coefficients, so there is no server to host. A fallback that moves scoring into the cron job ("Option B") is described at the end.

**Tech Stack:** Python 3.12 (stdlib for the collector; pandas, numpy, scikit-learn for training), pytest, vanilla JS (ES modules, no build step), Leaflet 1.9.4 from CDN, `node --test`, GitHub Actions, GitHub Pages.

**Spec:** No separate spec file. The assignment text is reproduced in the "Spec" section below; the Figma file is the UI spec:
https://www.figma.com/design/ER3Fejs1NlqKROBYtXBIzX
- Live map: `?node-id=1-2`
- Flows: `?node-id=1-250`
- Model: `?node-id=1-637`

## Spec

> **23. Bike-sharing availability predictor.** Make a live station map of MOL Bubi (Budapest) and 2–3 other European cities. Predict "station will be empty or full within 30 minutes" and visualize the daily flow patterns between districts. *Data:* CityBikes API (api.citybik.es), GBFS feeds, Open-Meteo for weather features.

Course requirements: public Git repo; deployed URL (GitHub Pages, Vercel or Hugging Face Spaces — this project uses GitHub Pages); README covering usage, experiences and lessons learned (which copilots/agents, key prompts, what was fixed by hand); at least one ML/statistics/evaluation component the student can defend orally; forecasting tasks need 1–2 weeks of self-collected data. Checkpoint **2026-11-20**: data access confirmed. Hand-in **2026-12-07**. Budget 15–20 hours; graded against the minimum, not polish.

## Schedule

| When | What |
|---|---|
| 2026-11-12 (today) | Task 1 merged and the cron running. Every day of delay is a day less data. |
| by 2026-11-20 | Tasks 2–5. Checkpoint evidence = the `data` branch filling up. |
| by 2026-11-30 | Tasks 6–7, and Task 8 steps 1–3 so the site is live early. |
| 2026-12-03 | Task 8, final training run on ~3 weeks of data, README numbers filled in. |
| 2026-12-07 | Hand in on Moodle. |

## Verified facts (checked 2026-11-12)

- `https://api.citybik.es/v2/networks/{id}` returns `network.stations[]` with `id`, `name`, `latitude`, `longitude`, `free_bikes`, `empty_slots`, `extra`. No key. `access-control-allow-origin: *`.
- Network ids and station counts: `mol-bubi` 700, `wienmobil-rad` 262, `bicikelj` 87, `slovnaft-bajk` 98.
- `mol-bubi` stations carry `extra.virtual: true` and `empty_slots` that does not reflect a real dock limit (a station showed 7 bikes, `empty_slots: 0`, `extra.slots: 2`). `wienmobil-rad` has `empty_slots: null` on 60 stations.
- `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,precipitation,wind_speed_10m` works without a key and allows browser calls.
- All four cities share one timezone; `Europe/Budapest` is used for every local-time computation.
- The feed has station counts only, no trip records.

## Decisions (mine, not confirmed by the user — overrule freely)

1. **Cities:** Budapest, Wien, Ljubljana, Bratislava.
2. **"Full" only where docks are real.** A station is `dock` when `extra.virtual` is not true and `empty_slots` is never null in training data. The "full" target, the purple marker and the "Fills up" bar exist only for `dock` stations. Bubi is therefore mostly "empty"-only.
3. **Predict transitions, not persistence.** The "empty" model is trained and evaluated only on rows where the station has bikes now; the "full" model only on rows with free docks now. A station already empty/full is shown grey and not scored. This keeps the headline metric honest.
4. **Deployed model = logistic regression**, because its coefficients run in the browser in a few lines. Gradient boosting (`HistGradientBoostingClassifier`) is trained alongside as an offline comparison and reported, not deployed.
5. **Baseline** = the station's historical rate of the target at that hour of day, computed on the training period.
6. **"Districts" = k-means zones** of station coordinates, named after the station nearest the centroid. Real district polygons are skipped; add a GeoJSON point-in-polygon step if the grader insists on administrative districts.
7. **Flows are net imbalance**, estimated from station count changes. Rebalancing trucks are counted as flow; this is stated in the UI and README.
8. **One CSV per collector run** on an orphan `data` branch, so `main` history and Pages builds are not flooded.
9. **No backend (the user's choice after trying to find a free host).** Hugging Face Docker Spaces are no longer free and Render asks for a card, so the site is static on GitHub Pages with prediction in the browser. Option B at the end is the agreed fallback.

## Global Constraints

- Python 3.12. Collector uses the standard library only. Training deps: `pandas`, `numpy`, `scikit-learn`, `pytest` — nothing else.
- Frontend: no framework, no bundler, no npm dependencies. Leaflet 1.9.4 from `unpkg.com` is the only external script. Charts are hand-written inline SVG.
- No API keys or secrets anywhere.
- Networks, in this order everywhere: `mol-bubi`, `wienmobil-rad`, `bicikelj`, `slovnaft-bajk`. Display names: Budapest, Wien, Ljubljana, Bratislava.
- Timezone for hour-of-day and weekday: `Europe/Budapest`. Timestamps stored in UTC ISO 8601 with `Z`.
- Horizon: 30 minutes. Risk threshold for marker colour: `RISK_THRESHOLD = 0.5` (one named constant in `web/app.js`).
- Feature vector, exact names and order: `bikes, slots, cap, fill, d10, d30, hour_sin, hour_cos, is_weekend, base, temp, precip, wind`.
- UI copy, layout and colours follow the Figma file. Colours: available `#2E9E5B`, likely empty `#E8590C`, likely full `#5F3DC4`, empty/full now `#868E96`, accent `#1F7A4D`, flow leaving `#E8590C`, flow arriving `#0C8599`, ink `#1B1F24`, muted `#6B7480`, line `#E3E7EB`, page `#F5F6F8`. Font: `Inter, system-ui, sans-serif`.
- Every number in the Figma Model screen is a sample. The site shows only numbers read from `web/model.json`.
- Commit after each task, authored as the repository owner only. No `Co-Authored-By` line and no mention of Claude or any AI tool in commit messages.

## Review Focus

1. **One network's API call fails or times out** during a collector run → the other networks are still written; the run exits 0 unless all four fail.
2. **`empty_slots` is null** → stored as an empty CSV field, treated as "no dock information", never as 0 free docks.
3. **Gaps in the log** (GitHub cron skips runs) → a row whose following 30 minutes contain fewer than 2 snapshots gets no label and is dropped; a lag older than its window yields `d10 = 0` / `d30 = 0`; flow deltas across gaps longer than 20 minutes are ignored.
4. **A station the model has never seen** (new station, or missing from `profiles.json`) → the browser uses the network's default base rate and `cap = bikes + slots`, and still renders a marker with a prediction.
5. **`model.json` absent or recent history stale** (first days, or the cron is down) → the map still shows live counts with green/grey markers, and the panel says "Prediction not available yet" instead of showing a number; stale history only zeroes the lag features.

## File Structure

```
collector/collect.py            fetch 4 networks + weather, write one snapshot file, update latest/*.json
collector/test_collect.py
model/load.py                   read the data branch checkout into DataFrames
model/features.py               labels, lag features, profiles, feature matrix
model/train.py                  time split, LR + HGB + baseline, metrics, writes web/*.json
model/flows.py                  zones, hourly net flow, arrows
model/test_features.py  model/test_train.py  model/test_flows.py
requirements.txt
web/index.html  web/style.css
web/predict.js                  pure functions: features() and predict()  (shared maths with Python)
web/predict.test.js             parity test against web/fixtures.json
web/app.js                      data fetching, Leaflet map, station panel, tab switching
web/flows.js                    Flows view
web/model-view.js               Model view
web/model.json  web/profiles.json  web/flows.json  web/fixtures.json     (generated, committed)
.github/workflows/collect.yml   cron */10
.github/workflows/train.yml     nightly + manual
.github/workflows/pages.yml     deploy web/ on push to main
README.md
```

Data branch layout (branch `data`, orphan):

```
snapshots/YYYY-MM-DD/HHMM.csv   header: network,station_id,bikes,slots      (slots empty when null)
weather.csv                     header: ts,network,temp,precip,wind          (appended)
stations/<network>.json         [{"id","name","lat","lon","virtual"}]        (overwritten each run)
latest/<network>.json           {"ts":[...≤18 ISO strings, oldest first],
                                 "stations":{"<id>":[[bikes,slots|null]|null, ... aligned to ts]}}
```

`HHMM` and the folder date are the run's UTC time.

---

### Task 1: Snapshot collector and cron (do this today)

**Files:**
- Create: `collector/collect.py`, `collector/test_collect.py`, `.github/workflows/collect.yml`, `.gitignore`

**Interfaces:**
- Produces: the data branch layout above. Later tasks depend on it exactly.
- Produces: `NETWORKS: dict[str, tuple[str, float, float]]` in `collector/collect.py` — network id → (display name, lat, lon): `mol-bubi` Budapest 47.4979, 19.0402; `wienmobil-rad` Wien 48.2082, 16.3738; `bicikelj` Ljubljana 46.0569, 14.5058; `slovnaft-bajk` Bratislava 48.1486, 17.1077.

- [ ] **Step 1: Write the failing tests** in `collector/test_collect.py`

```python
from collector.collect import station_rows, station_meta, roll_latest

RAW = {"network": {"stations": [
    {"id": "a", "name": "A tér", "latitude": 47.5, "longitude": 19.0,
     "free_bikes": 7, "empty_slots": 0, "extra": {"virtual": True}},
    {"id": "b", "name": "B", "latitude": 48.2, "longitude": 16.3,
     "free_bikes": 0, "empty_slots": None, "extra": {}},
]}}

def test_station_rows_keeps_null_slots_empty():
    assert station_rows("x", RAW) == [("x", "a", 7, 0), ("x", "b", 0, "")]

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

def test_roll_latest_starts_from_nothing():
    assert roll_latest(None, "t1", [("x", "a", 1, 1)]) == {"ts": ["t1"], "stations": {"a": [[1, 1]]}}
```

- [ ] **Step 2: Run** `python -m pytest collector -q` — expect import failure.

- [ ] **Step 3: Implement `collector/collect.py`** (stdlib only: `urllib.request`, `json`, `csv`, `pathlib`, `datetime`, `sys`)
  - `station_rows(network: str, payload: dict) -> list[tuple[str, str, int, int | str]]`
  - `station_meta(payload: dict) -> list[dict]`
  - `roll_latest(latest: dict | None, ts: str, rows: list[tuple]) -> dict` — keeps the last 18 entries; stations absent for all 18 entries are dropped.
  - `main(out_dir: str) -> int` — for each network: GET CityBikes with a 20 s timeout and `User-Agent: bike-availability-predictor`, GET Open-Meteo current weather; write the files listed under "Data branch layout" inside `out_dir`. Each network is wrapped in its own `try/except` that prints the error and continues. Returns 1 only if every network failed. One `ts` per run (start time, UTC, seconds precision).
  - `if __name__ == "__main__": sys.exit(main(sys.argv[1]))`

- [ ] **Step 4: Run** `python -m pytest collector -q` — expect 4 passed. Then `python collector/collect.py /tmp/bike-data && ls -R /tmp/bike-data | head -30` — expect one `snapshots/<date>/<HHMM>.csv` of roughly 1,150 lines, `weather.csv` with 4 rows, four files in `stations/` and `latest/`.

- [ ] **Step 5: Write `.github/workflows/collect.yml`**
  - Triggers: `schedule: cron "*/10 * * * *"` and `workflow_dispatch`.
  - `permissions: contents: write`. `concurrency: group: collect, cancel-in-progress: false`.
  - Steps: checkout `main`; checkout ref `data` into path `data` (first run: if the branch does not exist, `git switch --orphan data` inside an empty `data` dir pointed at the same remote); `python collector/collect.py data`; in `data`: `git add -A && git commit -m "snapshot <ts>" && git push origin HEAD:data`, retrying the push once after `git pull --rebase` if it is rejected.
  - `.gitignore`: `__pycache__/`, `.pytest_cache/`, `.idea/`, `.DS_Store`, `/data/`.

- [ ] **Step 6: Commit, push `main`, trigger the workflow by hand** (`gh workflow run collect.yml`), then `gh run watch` and `git ls-remote origin data` — expect the run green and the `data` branch present. Check again after 30 minutes that at least two more snapshot files exist. *(Pushing makes the repo's first public commit — confirm with the user before pushing.)*

---

### Task 2: Loading, labels and features

**Files:**
- Create: `requirements.txt`, `model/__init__.py`, `model/load.py`, `model/features.py`, `model/test_features.py`

**Interfaces:**
- Consumes: data branch layout from Task 1.
- Produces:
  - `load.snapshots(data_dir: str) -> pd.DataFrame` — columns `ts` (UTC datetime), `network`, `station_id`, `bikes` (int), `slots` (float, NaN when unknown); sorted by `network, station_id, ts`.
  - `load.weather(data_dir: str) -> pd.DataFrame` — `ts, network, temp, precip, wind`.
  - `load.stations(data_dir: str) -> pd.DataFrame` — `network, station_id, name, lat, lon, virtual`.
  - `features.FEATURES: list[str]` — the 13 names from Global Constraints.
  - `features.add_labels(df) -> df` — adds `empty_30`, `full_30` (float 0/1, NaN = no label).
  - `features.add_lags(df) -> df` — adds `d10`, `d30`.
  - `features.build_profiles(train_df, stations_df) -> dict` — the `profiles.json` structure below.
  - `features.build_matrix(df, weather_df, profiles, target: str) -> tuple[pd.DataFrame, pd.Series]` — `target` is `"empty"` or `"full"`; returns only rows eligible under Decision 3 with a non-NaN label; `X` has exactly `FEATURES` columns in order.

`profiles.json` structure:
```json
{"<network>": {"_default": {"empty": [24 floats], "full": [24 floats]},
               "<station_id>": {"cap": 20, "dock": true, "empty": [24 floats], "full": [24 floats]}}}
```

Definitions the tests pin:
- `empty_30` at time t = 1 if any snapshot of that station in (t, t+30 min] has `bikes == 0`, else 0; NaN if that window holds fewer than 2 snapshots. `full_30` likewise with `slots == 0`; NaN also when `slots` is NaN in the window.
- `d10` = `bikes` now minus `bikes` at the snapshot whose age is closest to 10 min within [5, 20] min; 0 if none. `d30`: closest to 30 min within (20, 45] min; 0 if none.
- `cap` = max of `bikes + slots` seen for the station in training (slots NaN counted as 0), minimum 1. `dock` = station not virtual and no NaN `slots` in training. `fill = bikes / cap`, clipped to [0, 1].
- `slots` feature: NaN → 0. `hour_sin/cos` from local hour + minute/60 over 24 h. `is_weekend`: local Saturday or Sunday.
- `base`: the station's profile value for the target at the local hour; hours with no training rows, and unknown stations, use the network `_default`.
- Weather joined by nearest earlier `ts` per network, tolerance 60 min; missing → the training median (`build_matrix` fills, never drops).

- [ ] **Step 1: Write the failing tests** in `model/test_features.py`. Build frames with a small helper `snap(minutes: list[int], bikes: list[int], slots=None, station="s", network="n")` starting at `2026-11-16 07:00Z`.

```python
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
```

- [ ] **Step 2: Run** `python -m pytest model/test_features.py -q` — expect failures.
- [ ] **Step 3: Implement `model/load.py` and `model/features.py`** to the signatures above. `requirements.txt`: `pandas`, `numpy`, `scikit-learn`, `pytest`. Use `pd.merge_asof` for lags and the weather join.
- [ ] **Step 4: Run** `python -m pytest model/test_features.py -q` — expect all passed. Then fetch real data (`git worktree add data data`) and run `python -c "from model import load; d=load.snapshots('data'); print(len(d), d.ts.min(), d.ts.max())"` — expect a non-zero row count.
- [ ] **Step 5: Commit.**

---

### Task 3: Training, evaluation and export

**Files:**
- Create: `model/train.py`, `model/test_train.py`
- Generates: `web/model.json`, `web/profiles.json`, `web/fixtures.json`

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces:
  - `train.time_split(df, test_fraction=0.2) -> tuple[df, df]` — cut at the timestamp below which 80 % of the time span lies; train strictly earlier.
  - `train.run(data_dir: str, out_dir: str) -> dict` — returns and writes the model dict.
  - CLI: `python -m model.train data web`.
  - `web/model.json`:
    ```json
    {"trained_at": "2026-12-03T02:10:00Z", "features": ["bikes", "..."],
     "targets": {"empty": {"mean": [13], "std": [13], "coef": [13], "intercept": 0.0}, "full": {"...": "..."}},
     "metrics": {"all": {"empty": {"n": 0, "pos_rate": 0.0, "pr_auc": 0.0, "pr_auc_baseline": 0.0,
                                   "pr_auc_hgb": 0.0, "brier": 0.0, "brier_baseline": 0.0},
                         "full": {"...": "..."}},
                 "mol-bubi": {"...": "..."}, "wienmobil-rad": {}, "bicikelj": {}, "slovnaft-bajk": {}},
     "curves": {"empty": {"pr": [[recall, precision]], "pr_baseline": [[recall, precision]],
                          "calibration": [[mean_predicted, observed_rate, n]]}, "full": {"...": "..."}},
     "test_window": {"from": "...", "to": "...", "rows": 0, "stations": {"mol-bubi": 700}}}
    ```
    PR curves are downsampled to at most 50 points; calibration uses 10 equal-width bins, empty bins omitted.
  - `web/fixtures.json`: `{"empty": [{"x": [13 raw feature values], "p": 0.123}, ...20 rows], "full": [...]}` — raw (unscaled) feature rows from the test set and the Python LR probability. Task 5's parity test reads this.

Method (pin it; it is what gets defended):
1. Load, `add_labels`, `add_lags`, `time_split`.
2. `build_profiles` on **train only**; `build_matrix` for train and test with those profiles.
3. Per target: `StandardScaler` + `LogisticRegression(max_iter=1000)` (deployed); `HistGradientBoostingClassifier(random_state=0)` on unscaled features (offline comparison); baseline score = the `base` column.
4. Metrics on test: `average_precision_score` for all three, `brier_score_loss` for LR and baseline, overall and per network. A network/target with no positive test rows gets `null` metrics, not a crash.
5. After evaluation, rebuild profiles on **all** data and write them to `profiles.json` (the browser needs the freshest ones). The exported coefficients stay those fitted on train.
6. A target with fewer than 50 positive training rows is skipped: its entry in `targets` is `null`.

- [ ] **Step 1: Write the failing tests** in `model/test_train.py`. A fixture `synthetic_data(tmp_path)` writes a data dir in Task 1's layout: 2 networks × 6 dock stations, 5 days at 10-minute steps, bikes following a daily sine plus seeded noise so that stations regularly hit 0 and capacity.

```python
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
```

- [ ] **Step 2: Run** `python -m pytest model/test_train.py -q` — expect failures.
- [ ] **Step 3: Implement `model/train.py`.** Constant-variance features get `std = 1.0` in the export so the browser never divides by zero.
- [ ] **Step 4: Run** `python -m pytest model -q` — expect all passed. Then `python -m model.train data web` on the real data collected so far and print `metrics.all` — expect it to complete; with only a few days of data the numbers are provisional.
- [ ] **Step 5: Commit** code and the generated `web/*.json`.

---

### Task 4: Zones and daily flows

**Files:**
- Create: `model/flows.py`, `model/test_flows.py`
- Modify: `model/train.py` (call `flows.run` at the end of `run`)
- Generates: `web/flows.json`

**Interfaces:**
- Consumes: `load.snapshots`, `load.stations`.
- Produces:
  - `flows.assign_zones(stations_df, k_max=10) -> tuple[pd.Series, list[dict]]` — per network `KMeans(n_clusters=min(k_max, max(2, n_stations // 8)), random_state=0, n_init=10)` on `lat, lon`; returns station → zone id and zone records `{"id", "name", "lat", "lon"}`, where `name` is the name of the station nearest the centroid.
  - `flows.net_flow(snap_df, zone_of) -> dict` — `{"weekday": [[24 floats] per zone], "weekend": [...]}`: per-station bike deltas between consecutive snapshots at most 20 minutes apart, summed per zone per local hour per day, then averaged over days. Positive = bikes arriving.
  - `flows.arrows(net_row: list[float], zones: list[dict], top=8) -> list[list]` — for one hour: greedy matching of exporting zones (negative) to importing zones (positive), nearest pairs first, each arrow `[from_zone, to_zone, amount]` with `amount = min(remaining export, remaining import)`; arrows below 1.0 dropped; the `top` largest returned.
  - `web/flows.json`: `{"<network>": {"zones": [...], "station_zone": {"<id>": 0}, "net": {"weekday": [...], "weekend": [...]}, "arrows": {"weekday": [[arrows] × 24], "weekend": [...]}}}`.

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run** `python -m pytest model/test_flows.py -q` — expect failures.
- [ ] **Step 3: Implement `model/flows.py`** and call it from `train.run` so one command writes all four JSON files. Leave a comment at the delta computation: `# ponytail: net imbalance from count deltas, includes rebalancing trucks; needs trip data (not in CityBikes) to do better`.
- [ ] **Step 4: Run** `python -m pytest model -q`, then `python -m model.train data web` and check `web/flows.json` has 4 networks with 24 arrow lists each.
- [ ] **Step 5: Commit.**

---

### Task 5: Browser prediction maths and parity test

**Files:**
- Create: `web/predict.js`, `web/predict.test.js`

**Interfaces:**
- Consumes: `web/model.json`, `web/profiles.json`, `web/fixtures.json`, `latest/<network>.json`.
- Produces (ES module exports):
  - `predict(target, x) -> number` — `target` is `model.targets.empty|full`; returns the probability, or `null` when `target` is `null`.
  - `localParts(date) -> {hour: number, isWeekend: boolean}` — fractional local hour in `Europe/Budapest` via `Intl.DateTimeFormat`.
  - `lagDelta(history, nowMs, bikesNow, minAgeMin, maxAgeMin, idealMin) -> number` — `history` is `[{t: ms, bikes}]`; same rule as Python's `d10`/`d30`; 0 when nothing qualifies.
  - `features(input) -> number[]` — `input = {bikes, slots, profile, defaults, targetName, history, weather: {temp, precip, wind}, now: Date}`; returns the 13 values in `FEATURES` order. `profile` may be `undefined` (unknown station): then `cap = max(1, bikes + (slots ?? 0))` and `base` comes from `defaults`.
  - `stationRisk(input, model) -> {state: "ok"|"empty"|"full"|"off"|"unknown", pEmpty: number|null, pFull: number|null}` — `off` when `bikes === 0` or (dock and `slots === 0`); `unknown` when `model` is missing or both targets are null; otherwise `empty`/`full` when that probability is ≥ the threshold passed in `input.threshold` (higher probability wins), else `ok`. `pFull` is `null` for non-dock stations.

- [ ] **Step 1: Write the failing tests** in `web/predict.test.js` (`node:test`, `node:assert/strict`, reads the JSON files with `fs`)

```js
test('predict matches Python on every fixture row', () => {
  for (const name of ['empty', 'full']) {
    if (!model.targets[name]) continue;
    for (const row of fixtures[name]) assert.ok(Math.abs(predict(model.targets[name], row.x) - row.p) < 1e-6);
  }
});
test('predict returns null for an untrained target', () => assert.equal(predict(null, [1]), null));
test('localParts uses Budapest time across DST', () => {
  assert.equal(localParts(new Date('2026-11-14T07:30:00Z')).hour, 8.5);      // CET, Saturday
  assert.equal(localParts(new Date('2026-11-14T07:30:00Z')).isWeekend, true);
  assert.equal(localParts(new Date('2026-07-01T07:30:00Z')).hour, 9.5);      // CEST
});
test('lagDelta picks the closest snapshot in the window, else 0', () => {
  const now = Date.UTC(2026, 10, 16, 8, 0), m = 60000;
  const h = [{t: now - 31 * m, bikes: 10}, {t: now - 12 * m, bikes: 8}];
  assert.equal(lagDelta(h, now, 5, 5, 20, 10), -3);
  assert.equal(lagDelta(h, now, 5, 20, 45, 30), -5);
  assert.equal(lagDelta([], now, 5, 5, 20, 10), 0);
});
test('features: unknown station falls back to defaults and live capacity', () => {
  const x = features({bikes: 3, slots: null, profile: undefined, defaults: {empty: Array(24).fill(0.2), full: Array(24).fill(0)},
    targetName: 'empty', history: [], weather: {temp: 9, precip: 0, wind: 4}, now: new Date('2026-11-16T07:00:00Z')});
  assert.equal(x.length, 13);
  assert.deepEqual([x[0], x[1], x[2], x[3], x[9]], [3, 0, 3, 1, 0.2]);
});
test('stationRisk states', () => {
  assert.equal(stationRisk({...base, bikes: 0}, model).state, 'off');
  assert.equal(stationRisk(base, undefined).state, 'unknown');
  assert.equal(stationRisk({...base, profile: {...base.profile, dock: false}}, model).pFull, null);
});
```

- [ ] **Step 2: Run** `node --test web/` — expect failures.
- [ ] **Step 3: Implement `web/predict.js`.** No DOM, no fetch, no imports.
- [ ] **Step 4: Run** `node --test web/` — expect all passed.
- [ ] **Step 5: Commit.**

---

### Task 6: Live map view

**Files:**
- Create: `web/index.html`, `web/style.css`, `web/app.js`

**Interfaces:**
- Consumes: `stationRisk`, `features` from Task 5; CityBikes and Open-Meteo live endpoints; `https://raw.githubusercontent.com/agaszner/Bike_Sharing_Availability_Predictor/data/latest/<network>.json`; `./model.json`, `./profiles.json`, `./flows.json` (for zone names).
- Produces: `state = {network, view, stations, model, profiles, weather}` and `onViewChange(fn)` exported from `web/app.js` for Task 7; DOM containers `#view-map`, `#view-flows`, `#view-model`; the URL hash `#<network>/<view>` (e.g. `#mol-bubi/flows`).

Design reference: Figma `Live map` (`node-id=1-2`). Build what it shows:
- Header: title "Bike Availability Predictor"; city tabs Budapest / Wien / Ljubljana / Bratislava; nav Live map / Flows / Model; status text "Updated HH:MM · T °C · <rain|dry>" (weather part omitted when unavailable).
- Map: Leaflet with OpenStreetMap tiles and attribution; one `L.circleMarker` per station (canvas renderer — Budapest has 700), coloured by `stationRisk().state` using the four colours; tooltip with name, bike count and status in words; legend bottom-left with the four labels from Figma. `unknown` state uses the green/grey rule on live counts only.
- Station panel (right, 360 px; below the map under 800 px width): name; "<City> · <zone> zone · N docks" (zone and docks omitted when unknown); "Bikes now" / "Free docks" cards ("—" when unknown); "Next 30 minutes" with "Runs out of bikes" and "Fills up" bars and percentages ("Fills up" hidden for non-dock stations; "Prediction not available yet" when state is `unknown`; "Already empty" / "Already full" when `off`); "Bikes, last 3 hours" sparkline from `latest` history; "Most at risk in <City>" — top 4 stations by max probability, clickable, hidden when no model.
- Before any station is clicked the panel shows only the "Most at risk" list.

- [ ] **Step 1: Write `index.html` + `style.css`** — static shell matching the Figma layout with the three view containers, Leaflet CSS/JS tags, `<script type="module" src="app.js">`. Tabs are real `<button>`s with `aria-pressed`; colour never carries meaning alone.
- [ ] **Step 2: Implement `web/app.js` data loading** — on start and on city change fetch, in parallel and each independently caught: CityBikes live, Open-Meteo current, `latest/<network>.json`, and once `model.json` + `profiles.json` + `flows.json`. Any failure except CityBikes degrades (Review Focus 4–5); a CityBikes failure shows "Live data unavailable — retrying" in the status text and keeps the previous markers. Refresh live data every 60 s. History older than 45 minutes is ignored for lags. `RISK_THRESHOLD = 0.5` lives here.
- [ ] **Step 3: Implement rendering** — markers, legend, panel, sparkline (inline SVG), hash routing. Station names go into the DOM via `textContent`, never `innerHTML`.
- [ ] **Step 4: Verify in a browser** — `python -m http.server -d web 8000`, open `http://localhost:8000`. Check: all four cities load and the map recentres; a Bubi station shows no "Fills up" bar; a Ljubljana station shows both; renaming `web/model.json` temporarily gives green/grey markers and "Prediction not available yet"; no console errors; layout holds at 390 px width. Compare side by side with the Figma frame.
- [ ] **Step 5: Commit.**

---

### Task 7: Flows and Model views

**Files:**
- Create: `web/flows.js`, `web/model-view.js`
- Modify: `web/app.js` (import and mount both), `web/style.css`

**Interfaces:**
- Consumes: `state`, `onViewChange` from Task 6; `./flows.json`; `state.model`.
- Produces: `mountFlows(el, state)`, `mountModel(el, state)`.

Flows view — Figma `Flows` (`node-id=1-250`):
- Leaflet map with one circle per zone at its centroid: radius from |net flow| for the selected hour, `#0C8599` when arriving, `#E8590C` when leaving, label with zone name and signed value.
- Arrows from `flows.json` for the selected hour and day type, drawn as curved SVG paths in a Leaflet overlay, width scaled by amount.
- Time control: play/pause button, current hour "HH:00", `<input type="range" min="0" max="23">`, Weekdays / Weekend toggle. Play advances one hour per 800 ms and loops; it does not start on its own and stops when the tab is hidden.
- Right panel: "Daily flow pattern", zone × hour heatmap (inline SVG, diverging orange–teal, selected hour outlined, each cell with a `<title>` giving zone, hour and value), legend "Bikes leaving" / "Bikes arriving", and the "How this is estimated" note with the text from Figma.
- No zones yet → "Flow patterns appear after a few days of data collection."

Model view — Figma `Model` (`node-id=1-637`), every number from `model.json`:
- Heading "How good are the predictions?" and one-line subtitle with the test window dates.
- Four cards: PR-AUC runs empty (with baseline), PR-AUC fills up (with baseline), Brier score (with baseline), test window (days and row count).
- Precision–recall chart (model solid, baseline dashed) and calibration chart (points + diagonal), inline SVG with axis labels "Recall"/"Precision" and "Predicted"/"Observed", 0–1 ticks; a target toggle "Runs empty / Fills up".
- "By city" table: City, Stations, Model, Baseline, Gradient boosting (PR-AUC for the toggled target); `null` metrics render as "—".
- Three notes: "What is predicted", "What the model sees", "How it is tested" — text from Figma.
- When `model.json` is missing: a single message "The model has not been trained yet. Data collection started on 2026-11-12."

- [ ] **Step 1: Implement `web/flows.js`.**
- [ ] **Step 2: Implement `web/model-view.js`.**
- [ ] **Step 3: Verify in a browser** — hour slider changes circles, arrows and the heatmap outline together; weekday/weekend toggle changes values; play loops and pauses; Model numbers equal those in `web/model.json` (spot-check three by hand); toggling target swaps charts and table; no console errors; both views usable at 390 px.
- [ ] **Step 4: Commit.**

---

### Task 8: Deployment, nightly training and README

**Files:**
- Create: `.github/workflows/pages.yml`, `.github/workflows/train.yml`, `README.md`

**Interfaces:**
- Consumes: everything.
- Produces: the deployed URL `https://agaszner.github.io/Bike_Sharing_Availability_Predictor/`.

User action, once: repo Settings → Pages → Source = GitHub Actions.

- [ ] **Step 1: `pages.yml`** — on push to `main` touching `web/**` and on `workflow_dispatch`: `actions/configure-pages`, `actions/upload-pages-artifact` with `path: web`, `actions/deploy-pages`; `permissions: pages: write, id-token: write`.
- [ ] **Step 2: `train.yml`** — `schedule: cron "10 2 * * *"` and `workflow_dispatch`; `permissions: contents: write`; checkout `main` and `data` (path `data`); Python 3.12; `pip install -r requirements.txt`; `python -m pytest collector model -q`; `python -m model.train data web`; `node --test web/`; commit `web/*.json` if changed and push; then `gh workflow run pages.yml` (a push made with the default `GITHUB_TOKEN` does not start other workflows). The parity test runs after training, so a mismatch between Python and browser maths blocks the commit.
- [ ] **Step 3: Run both workflows by hand** — `gh workflow run train.yml`, then confirm `pages.yml` deployed and the public URL shows live markers and the Model view with real numbers.
- [ ] **Step 4: Write `README.md`** with these sections:
  - What it is, the live URL, a screenshot per view, link to the Figma file.
  - Usage: how to read the map; run locally (`python -m http.server -d web`); retrain (`git worktree add data data && python -m model.train data web`); run tests.
  - How it works: pipeline diagram (GitHub cron → `data` branch → nightly training → JSON → browser), label definition, feature list, time-based split, baseline, metrics table copied from the final `model.json`, logistic regression vs gradient boosting.
  - Limitations: Bubi's virtual stations have no dock limit, so "full" is predicted only where docks are real; flows are net imbalance and include rebalancing; zones are k-means clusters, not administrative districts; GitHub cron is irregular; about three weeks of November data only.
  - Experiences and lessons learned: tools used (Claude Code with the superpowers plugin, Figma MCP), the key prompts, what had to be fixed by hand (include the hosting detour: a backend on Hugging Face Spaces or Render was planned, then dropped because neither is free without a card). **The student fills this in from their own notes — keep a running list in `NOTES.md` from Task 1 onward.**
  - Oral-defence crib: one paragraph each on "why a time-based split", "why PR-AUC and not accuracy", "why only transition rows", "what calibration shows".
- [ ] **Step 5: Final check on 2026-12-03** — `data` branch has snapshots for ≥ 14 distinct dates; rerun `train.yml`; update the README metrics table; open the public URL in a private window.
- [ ] **Step 6: Commit and push.** Optional: record the 3-minute demo video (Live map → click an at-risk station → Flows with play → Model).

---

## Fallback: Option B (only if browser-side prediction proves troublesome)

Move scoring into the collector run instead of the browser:
- `collect.yml` also checks out `main`'s `web/model.json` + `web/profiles.json`, scores the fresh snapshot in Python with `model.features`, and writes `predictions/<network>.json` (`{"ts", "stations": {"<id>": {"p_empty", "p_full"}}}`) to the `data` branch.
- `web/app.js` reads that file instead of calling `features()` / `predict()`, shows "predicted at HH:MM", and hides predictions older than 20 minutes.
- `web/predict.js`, its test and `fixtures.json` are deleted; the deployed model may then be gradient boosting.
- Cost: GitHub cron is often 10–30 minutes late, so 30-minute predictions are frequently stale.

Tasks 1–4 and 7 are identical under both options, so the switch touches only Tasks 5, 6 and the two workflows.
