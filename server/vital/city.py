"""City view: what VITAL would publish to a smart city platform.

Real readings from this server are combined with simulated VITAL hubs in
other wards, so the page shows a whole city. Only anonymised, ward-level
counts are produced, which is exactly what would be sent over MQTT.
"""
import math
import random
import time

import config
from . import db

WARDS = ["Ward 1", "Ward 2", "Ward 3", "Ward 4", "Ward 5", "Ward 6", "Ward 7", "Ward 8"]
MIN_GROUP = 10            # groups smaller than this are merged (k-anonymity)
FEVER_C = 37.8


def _simulated(ward, hour_key, minute):
    rnd = random.Random(f"{ward}-{hour_key}")
    people = rnd.randint(14, 70) if ward != "Ward 8" else rnd.randint(4, 8)   # Ward 8: tiny group
    readings = int(people * rnd.uniform(40, 90) * (0.9 + 0.1 * math.sin(minute / 6)))
    fever_rate = 0.02 + rnd.uniform(0, 0.03)
    if ward == "Ward 5":
        fever_rate = 0.16 + 0.02 * math.sin(minute / 9)          # simulated fever cluster
    fevers = int(round(people * fever_rate))
    alerts = rnd.randint(0, 2) + (2 if ward == "Ward 5" else 0)
    hr = rnd.uniform(72, 80) + (6 if ward == "Ward 5" else 0)
    return {"hubs": max(1, people // 4), "people": people, "readings": readings,
            "fevers": fevers, "alerts": alerts, "avg_hr": hr,
            "avg_spo2": rnd.uniform(96.5, 98.2), "avg_temp": rnd.uniform(36.6, 36.9) + (0.5 if ward == "Ward 5" else 0)}


def snapshot():
    now = time.time()
    lt = time.localtime(now)
    hour_key = time.strftime("%Y%m%d%H", lt)
    since = now - 3600
    wards = []
    for w in WARDS:
        s = _simulated(w, hour_key, lt.tm_min)
        real_users = db.query("SELECT id FROM users WHERE role='user' AND ward=?", (w,))
        ids = [u["id"] for u in real_users]
        real = {"people": len(ids), "readings": 0, "fevers": 0, "alerts": 0}
        if ids:
            marks = ",".join("?" * len(ids))
            real["readings"] = db.query(f"SELECT COUNT(*) n FROM readings WHERE ts>? AND user_id IN ({marks})",
                                        (since, *ids), one=True)["n"]
            real["fevers"] = db.query(f"SELECT COUNT(DISTINCT user_id) n FROM windows WHERE ts>? AND temp_mean>=? "
                                      f"AND user_id IN ({marks})", (since, FEVER_C, *ids), one=True)["n"]
            real["alerts"] = db.query(f"SELECT COUNT(*) n FROM alerts WHERE ts>? AND level='critical' "
                                      f"AND user_id IN ({marks})", (since, *ids), one=True)["n"]
        people = s["people"] + real["people"]
        fevers = s["fevers"] + real["fevers"]
        row = {
            "ward": w, "hubs": s["hubs"] + (1 if ids else 0), "people": people,
            "readings": s["readings"] + real["readings"], "fevers": fevers,
            "alerts": s["alerts"] + real["alerts"],
            "fever_rate": fevers / people if people else 0,
            "avg_hr": round(s["avg_hr"], 1), "avg_spo2": round(s["avg_spo2"], 1),
            "avg_temp": round(s["avg_temp"], 2),
            "has_vital_hub": bool(ids), "merged": people < MIN_GROUP,
        }
        row["cluster"] = row["fever_rate"] >= 0.10 and not row["merged"]
        wards.append(row)
    totals = {k: sum(w[k] for w in wards) for k in ("hubs", "people", "readings", "fevers", "alerts")}
    return {"city": config.CITY_NAME, "ts": now, "wards": wards, "totals": totals,
            "min_group": MIN_GROUP, "fever_c": FEVER_C}


def mqtt_message(ward_row, city):
    """The anonymised summary one ward hub would publish every hour."""
    topic = f"city/{city.lower()}/health/{ward_row['ward'].lower().replace(' ', '-')}/summary"
    if ward_row["merged"]:
        payload = {"ward": ward_row["ward"], "merged": True,
                   "note": f"fewer than {MIN_GROUP} people; counts merged into the city total"}
    else:
        payload = {"ward": ward_row["ward"], "period": "1h", "people": ward_row["people"],
                   "readings": ward_row["readings"], "fever_count": ward_row["fevers"],
                   "critical_alerts": ward_row["alerts"], "avg_hr": ward_row["avg_hr"],
                   "avg_spo2": ward_row["avg_spo2"], "avg_temp": ward_row["avg_temp"]}
    return {"topic": topic, "qos": 1, "payload": payload}
