"""Labels, lag features, per-station profiles and the feature matrix. web/predict.js mirrors these rules."""
import numpy as np
import pandas as pd

FEATURES = ["bikes", "slots", "cap", "fill", "d10", "d30", "hour_sin", "hour_cos", "is_weekend", "base",
            "temp", "precip", "wind"]
TZ = "Europe/Budapest"
LABELS = {"empty": "empty_30", "full": "full_30"}
WEATHER = ["temp", "precip", "wind"]
HORIZON = pd.Timedelta(minutes=30)


def _cum(x):
    return np.concatenate([[0], np.cumsum(x)])


def add_labels(df):
    """empty_30/full_30 at t: any bikes==0 / slots==0 in (t, t+30 min]; NaN if < 2 snapshots there (full: or any NaN slots)."""
    ts = df.ts.dt.as_unit("ns").astype("int64").to_numpy()
    bikes, slots = df.bikes.to_numpy(), df.slots.to_numpy(float)
    empty, full = np.full(len(df), np.nan), np.full(len(df), np.nan)
    for idx in df.groupby(["network", "station_id"], sort=False).indices.values():
        idx = idx[np.argsort(ts[idx], kind="stable")]
        t = ts[idx]
        lo, hi = np.searchsorted(t, t, "right"), np.searchsorted(t, t + HORIZON.value, "right")
        few = hi - lo < 2
        z, sz, sn = _cum(bikes[idx] == 0), _cum(slots[idx] == 0), _cum(np.isnan(slots[idx]))
        empty[idx] = np.where(few, np.nan, (z[hi] - z[lo] > 0).astype(float))
        full[idx] = np.where(few | (sn[hi] - sn[lo] > 0), np.nan, (sz[hi] - sz[lo] > 0).astype(float))
    return df.assign(empty_30=empty, full_30=full)


def _lag(df, ideal, lo, hi, lo_open):
    """bikes now minus bikes at the same station's snapshot whose age is closest to `ideal` minutes within the
    age window (lo, hi] or [lo, hi]; ties go to the older snapshot; 0 if none qualifies."""
    left = pd.DataFrame({"network": df.network.to_numpy(), "station_id": df.station_id.to_numpy(),
                         "ts": df.ts.dt.as_unit("ns").array, "bikes": df.bikes.to_numpy(),
                         "_pos": np.arange(len(df))})
    left["key"] = left.ts - pd.Timedelta(minutes=ideal)
    left = left.sort_values("key")
    right = left[["network", "station_id", "ts", "bikes"]].rename(columns={"ts": "lag_ts", "bikes": "lag_bikes"})
    right = right.sort_values("lag_ts")
    cand = []
    for direction in ("backward", "forward"):
        m = pd.merge_asof(left, right, left_on="key", right_on="lag_ts", by=["network", "station_id"],
                          direction=direction).sort_values("_pos")
        age = ((m.ts - m.lag_ts) / pd.Timedelta(minutes=1)).to_numpy(float)
        ok = ((age > lo) if lo_open else (age >= lo)) & (age <= hi)
        cand.append((np.where(ok, np.abs(age - ideal), np.inf), (m.bikes - m.lag_bikes).to_numpy(float)))
    (bd, bv), (fd, fv) = cand
    return np.where(np.isfinite(bd) & (bd <= fd), bv, np.where(np.isfinite(fd), fv, 0.0))


def add_lags(df):
    """d10: closest to 10 min old within [5, 20] min; d30: closest to 30 min old within (20, 45] min."""
    return df.assign(d10=_lag(df, 10, 5, 20, lo_open=False), d30=_lag(df, 30, 20, 45, lo_open=True))


def build_profiles(train_df, stations_df):
    """Per network: `_default` hourly target rates, and per station cap, dock and hourly rates (gaps → default).
    Rates are the mean label over all labelled training rows at that local hour."""
    t = train_df.assign(hour=train_df.ts.dt.tz_convert(TZ).dt.hour,
                        cap=train_df.bikes + train_df.slots.fillna(0), nan_slots=train_df.slots.isna())
    cols = list(LABELS.values())
    rate = t.groupby(["network", "station_id", "hour"])[cols].mean()
    net_hour = t.groupby(["network", "hour"])[cols].mean()
    net_all = t.groupby("network")[cols].mean()
    virtual = stations_df.set_index(["network", "station_id"]).virtual
    out = {}
    for net in net_all.index:
        out[net] = {"_default": {
            name: net_hour.loc[net][col].reindex(range(24)).fillna(net_all.loc[net, col]).fillna(0.0).tolist()
            for name, col in LABELS.items()}}
    for (net, sid), row in t.groupby(["network", "station_id"]).agg(cap=("cap", "max"),
                                                                    nan_slots=("nan_slots", "any")).iterrows():
        r = rate.loc[(net, sid)]
        default = out[net]["_default"]
        out[net][sid] = {
            "cap": int(max(1, row.cap)),
            "dock": not bool(virtual.get((net, sid), False)) and not bool(row.nan_slots),
            **{name: r[col].reindex(range(24)).fillna(pd.Series(default[name])).tolist()
               for name, col in LABELS.items()},
        }
    return out


def build_matrix(df, weather_df, profiles, target):
    """Rows eligible for `target` ("empty": bikes > 0; "full": dock station with slots > 0) with a label.
    Unknown stations: cap = max(1, bikes + slots), base from `_default`, not dock.
    Missing weather (no reading within 60 min before) → median of `weather_df`, or 0 if it has none."""
    label = LABELS[target]
    prof = [profiles[n].get(s) for n, s in zip(df.network, df.station_id)]
    eligible = df.bikes > 0 if target == "empty" else np.array([bool(p and p["dock"]) for p in prof]) & (df.slots > 0)
    keep = (eligible & df[label].notna()).to_numpy()
    d, prof = df[keep], [p for p, k in zip(prof, keep) if k]

    local = d.ts.dt.tz_convert(TZ)
    hour = (local.dt.hour + local.dt.minute / 60).to_numpy(float)
    bikes, slots = d.bikes.to_numpy(float), d.slots.fillna(0).to_numpy(float)
    cap = np.array([p["cap"] if p else max(1.0, b + s) for p, b, s in zip(prof, bikes, slots)], float)
    base = np.array([(p or profiles[n]["_default"])[target][int(h)] for p, n, h in zip(prof, d.network, hour)],
                    float)

    left = pd.DataFrame({"ts": d.ts.dt.as_unit("ns").array, "network": d.network.astype(str).array,
                         "_pos": np.arange(len(d))}).sort_values("ts")
    w = weather_df.assign(ts=weather_df.ts.dt.as_unit("ns"), network=weather_df.network.astype(str)).sort_values("ts")
    m = pd.merge_asof(left, w, on="ts", by="network", direction="backward",
                      tolerance=pd.Timedelta(minutes=60)).sort_values("_pos")
    med = weather_df[WEATHER].median().fillna(0.0)

    X = pd.DataFrame({
        "bikes": bikes, "slots": slots, "cap": cap, "fill": np.clip(bikes / cap, 0, 1),
        "d10": d.d10.to_numpy(float), "d30": d.d30.to_numpy(float),
        "hour_sin": np.sin(2 * np.pi * hour / 24), "hour_cos": np.cos(2 * np.pi * hour / 24),
        "is_weekend": (local.dt.day_of_week >= 5).to_numpy(float), "base": base,
        **{c: m[c].fillna(med[c]).to_numpy(float) for c in WEATHER},
    }, index=d.index)[FEATURES]
    return X, d[label]
