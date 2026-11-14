"""Station zones (KMeans) and average hourly net bike flow per zone; writes web/flows.json."""
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans

from model import load

# Same order as train.NETWORKS; not imported from there because train imports this module.
NETWORKS = ["mol-bubi", "wienmobil-rad", "bicikelj", "slovnaft-bajk"]
TZ = "Europe/Budapest"
MAX_GAP = pd.Timedelta(minutes=20)
DAY_TYPES = ("weekday", "weekend")
ZONE_SHARE = 0.05  # one zone per 20 stations


def assign_zones(stations_df):
    """One network's stations -> (station_id -> zone id, zone records named after the station nearest the centroid)."""
    s = stations_df.reset_index(drop=True)
    xy = s[["lat", "lon"]].to_numpy(float)
    # Capped at the distinct locations so KMeans never asks for more clusters than points.
    k = min(max(2, round(len(s) * ZONE_SHARE)), len(np.unique(xy, axis=0)))
    km = KMeans(n_clusters=k, random_state=0, n_init=10).fit(xy)
    zones = []
    for i, c in enumerate(km.cluster_centers_):
        members = np.flatnonzero(km.labels_ == i)
        nearest = members[np.argmin(((xy[members] - c) ** 2).sum(axis=1))]
        zones.append({"id": i, "name": str(s.name[nearest]), "lat": round(float(c[0]), 5), "lon": round(float(c[1]), 5)})
    return pd.Series(km.labels_, index=s.station_id), zones


def net_flow(snap_df, zone_of):
    """One network's snapshots -> {"weekday"|"weekend": [[24 floats] per zone]}, mean net bikes per local hour."""
    n = int(zone_of.max()) + 1 if len(zone_of) else 0
    d = snap_df.sort_values(["station_id", "ts"])
    g = d.groupby("station_id", sort=False)
    # ponytail: net imbalance from count deltas, includes rebalancing trucks; needs trip data (not in CityBikes) to do better
    ok = g.ts.diff() <= MAX_GAP                              # first row of a station has NaT -> False
    delta = g.bikes.diff()[ok]
    local = d.ts[ok].dt.tz_convert(TZ)                       # the later snapshot's local time
    v = pd.DataFrame({"weekend": local.dt.day_of_week >= 5, "zone": d.station_id[ok].map(zone_of),
                      "day": local.dt.normalize(), "hour": local.dt.hour, "delta": delta}).dropna(subset=["zone"])
    # Sum per day, then average over the days on which that zone-hour had a valid delta.
    mean = v.groupby(["weekend", "zone", "day", "hour"]).delta.sum().groupby(level=["weekend", "zone", "hour"]).mean()
    out = {}
    for name, we in zip(DAY_TYPES, (False, True)):
        grid = np.zeros((n, 24))
        m = mean[mean.index.get_level_values("weekend") == we].reset_index()
        grid[m.zone.astype(int), m.hour.astype(int)] = m.delta
        out[name] = (grid.round(2) + 0.0).tolist()          # + 0.0 turns -0.0 into 0.0
    return out


def arrows(net_row, zones, top=8):
    """Greedy: exporting zones (negative) to importing zones (positive), nearest pairs first."""
    exp = {i: -v for i, v in enumerate(net_row) if v < 0}
    imp = {i: v for i, v in enumerate(net_row) if v > 0}
    pairs = sorted((math.dist((zones[e]["lat"], zones[e]["lon"]), (zones[i]["lat"], zones[i]["lon"])), e, i)
                   for e in exp for i in imp)
    out = []
    for _, e, i in pairs:
        a = min(exp[e], imp[i])
        exp[e] -= a
        imp[i] -= a
        if a >= 1.0:
            out.append([e, i, round(float(a), 2)])
    return sorted(out, key=lambda r: -r[2])[:top]           # stable: ties keep creation order


def run(data_dir, out_dir):
    snaps, stations = load.snapshots(data_dir), load.stations(data_dir)
    present = set(stations.network)
    result = {}
    for net in [n for n in NETWORKS if n in present] + sorted(present - set(NETWORKS)):
        zone_of, zones = assign_zones(stations[stations.network == net])
        flow = net_flow(snaps[snaps.network == net], zone_of)
        result[net] = {
            "zones": zones,
            "station_zone": {str(k): int(v) for k, v in zone_of.items()},
            "net": flow,
            "arrows": {t: [arrows([z[h] for z in flow[t]], zones) for h in range(24)] for t in DAY_TYPES},
        }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "flows.json").write_text(json.dumps(result, allow_nan=False, ensure_ascii=False), encoding="utf-8")
    return result
