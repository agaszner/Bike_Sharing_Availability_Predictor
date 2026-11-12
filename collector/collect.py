"""Log one snapshot of every network (station counts + weather) into a data directory.

Usage: python collector/collect.py <out_dir>
Layout written: snapshots/YYYY-MM-DD/HHMM.csv, weather.csv, stations/<network>.json, latest/<network>.json
"""
import csv
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# network id -> (display name, lat, lon)
NETWORKS = {
    "mol-bubi": ("Budapest", 47.4979, 19.0402),
    "wienmobil-rad": ("Wien", 48.2082, 16.3738),
    "bicikelj": ("Ljubljana", 46.0569, 14.5058),
    "slovnaft-bajk": ("Bratislava", 48.1486, 17.1077),
}
LATEST_KEEP = 18  # ~3 hours at one run per 10 minutes


def station_rows(network, payload):
    """Stations without an integer bike count are skipped: the snapshot's bikes column is never empty."""
    return [
        (network, s["id"], s["free_bikes"], "" if s["empty_slots"] is None else s["empty_slots"])
        for s in payload["network"]["stations"]
        if type(s["free_bikes"]) is int
    ]


def station_meta(payload):
    return [
        {"id": s["id"], "name": s["name"], "lat": s["latitude"], "lon": s["longitude"],
         "virtual": bool((s.get("extra") or {}).get("virtual"))}
        for s in payload["network"]["stations"]
    ]


def roll_latest(latest, ts, rows):
    latest = latest or {"ts": [], "stations": {}}
    n = len(latest["ts"])
    now = {sid: [bikes, None if slots == "" else slots] for _, sid, bikes, slots in rows}
    stations = {}
    for sid in latest["stations"].keys() | now.keys():
        series = (latest["stations"].get(sid) or [None] * n) + [now.get(sid)]
        series = series[-LATEST_KEEP:]
        if any(v is not None for v in series):
            stations[sid] = series
    return {"ts": (latest["ts"] + [ts])[-LATEST_KEEP:], "stations": stations}


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "bike-availability-predictor"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main(out_dir):
    out = Path(out_dir)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    ts = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    for d in ("stations", "latest"):
        (out / d).mkdir(parents=True, exist_ok=True)

    all_rows = []
    for network, (_, lat, lon) in NETWORKS.items():
        try:
            payload = get_json(f"https://api.citybik.es/v2/networks/{network}")
            rows = station_rows(network, payload)
            (out / "stations" / f"{network}.json").write_text(
                json.dumps(station_meta(payload), ensure_ascii=False), encoding="utf-8")
            latest_path = out / "latest" / f"{network}.json"
            latest = json.loads(latest_path.read_text(encoding="utf-8")) if latest_path.exists() else None
            latest_path.write_text(json.dumps(roll_latest(latest, ts, rows), separators=(",", ":")), encoding="utf-8")
        except Exception as e:  # one network down must not lose the others
            print(f"{network}: stations failed: {e!r}", file=sys.stderr)
            continue
        all_rows += rows

        try:
            cur = get_json(
                "https://api.open-meteo.com/v1/forecast"
                f"?latitude={lat}&longitude={lon}&current=temperature_2m,precipitation,wind_speed_10m"
            )["current"]
            weather_path = out / "weather.csv"
            new = not weather_path.exists()
            with weather_path.open("a", newline="") as f:
                w = csv.writer(f, lineterminator="\n")
                if new:
                    w.writerow(["ts", "network", "temp", "precip", "wind"])
                w.writerow([ts, network, cur["temperature_2m"], cur["precipitation"], cur["wind_speed_10m"]])
        except Exception as e:
            print(f"{network}: weather failed: {e!r}", file=sys.stderr)

    if not all_rows:
        return 1
    snap = out / "snapshots" / now.strftime("%Y-%m-%d") / (now.strftime("%H%M") + ".csv")
    snap.parent.mkdir(parents=True, exist_ok=True)
    with snap.open("w", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["network", "station_id", "bikes", "slots"])
        w.writerows(all_rows)
    print(f"{ts}: {len(all_rows)} stations -> {snap}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
