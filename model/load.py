"""Read a checkout of the `data` branch (layout written by collector/collect.py) into DataFrames."""
import json
from pathlib import Path

import pandas as pd


def snapshots(data_dir: str) -> pd.DataFrame:
    """ts comes from the path: snapshots/YYYY-MM-DD/HHMM.csv, UTC, minute precision."""
    frames = []
    for f in sorted(Path(data_dir, "snapshots").glob("*/*.csv")):
        d = pd.read_csv(f, dtype={"network": str, "station_id": str, "bikes": str, "slots": float})
        d["bikes"] = pd.to_numeric(d.bikes, errors="coerce")  # empty or junk bike count -> row dropped
        d = d.dropna(subset=["bikes"]).astype({"bikes": int})
        d.insert(0, "ts", pd.to_datetime(f"{f.parent.name} {f.stem}", format="%Y-%m-%d %H%M", utc=True))
        frames.append(d)
    df = pd.concat(frames, ignore_index=True)
    df["ts"] = df.ts.dt.as_unit("ns")
    return df.sort_values(["network", "station_id", "ts"], ignore_index=True)


def weather(data_dir: str) -> pd.DataFrame:
    df = pd.read_csv(Path(data_dir, "weather.csv"), dtype={"network": str})
    # Floored to the minute so a run's weather lines up with that run's snapshot (whose ts has no seconds).
    df["ts"] = pd.to_datetime(df.ts, utc=True).dt.floor("min").dt.as_unit("ns")
    return df[["ts", "network", "temp", "precip", "wind"]]


def stations(data_dir: str) -> pd.DataFrame:
    rows = [
        {"network": f.stem, "station_id": str(s["id"]), "name": s["name"], "lat": s["lat"], "lon": s["lon"],
         "virtual": bool(s["virtual"])}
        for f in sorted(Path(data_dir, "stations").glob("*.json"))
        for s in json.loads(f.read_text(encoding="utf-8"))
    ]
    return pd.DataFrame(rows, columns=["network", "station_id", "name", "lat", "lon", "virtual"])
