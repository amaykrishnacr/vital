"""End-to-end system validation: real VITAL server + fake ESP32, real time.

Start the server (python app.py) and the simulator (python fake_esp32.py) first,
then run:  python validation/validate_system.py [reps]
Writes validation/results_system.json.

For each scenario the script logs a member in, starts a measurement, switches
the simulator scenario from the admin account, watches the live API once per
second, and records whether / when an early warning and a critical alert occur,
and how many readings were accepted by the signal-quality gate.
"""
import json
import os
import sys
import time

import requests

B = os.environ.get("VITAL_URL", "http://localhost:5000")
REPS = int(sys.argv[1]) if len(sys.argv) > 1 else 3
PLAN = [  # scenario, seconds to watch, expected outcome
    ("normal", 150, "no alert"),
    ("exercise", 150, "no critical alert"),
    ("low_oxygen", 150, "critical alert"),
    ("high_hr", 120, "critical alert"),
    ("fever", 300, "early warning"),
    ("noisy", 120, "readings rejected, no alert"),
    ("no_finger", 60, "nothing stored"),
]
USERS = ["member1", "member2", "member3", "member4"]


def login(u, p):
    s = requests.Session()
    s.post(B + "/login", data={"username": u, "password": p})
    return s


def main():
    admin = login("admin", "admin123")
    results, k = [], 0
    for rep in range(REPS):
        for scen, secs, expect in PLAN:
            user = USERS[k % len(USERS)]; k += 1
            u = login(user, "vital123")
            admin.post(B + "/api/demo/scenario", json={"scenario": "normal"})
            time.sleep(45)                                  # let the simulated body settle
            r = u.post(B + "/api/session/start", json={}).json()
            t0 = time.time()
            admin.post(B + "/api/demo/scenario", json={"scenario": scen})
            first_warn = first_crit = None
            statuses, live_readings = {}, 0
            while time.time() - t0 < secs:
                d = u.get(B + "/api/live/me").json()
                el = time.time() - t0
                statuses[d["status"]["text"]] = statuses.get(d["status"]["text"], 0) + 1
                if d["predictions"] and first_warn is None:
                    first_warn = round(el, 1)
                time.sleep(1)
            alerts = [a for a in admin.get(B + "/api/admin/alerts").json()["alerts"]
                      if a["ts"] >= t0 and a["user_name"].lower().replace(" ", "") == user]
            crit = sorted(a["ts"] for a in alerts if a["level"] == "critical")
            first_crit = round(crit[0] - t0, 1) if crit else None
            hist = u.get(B + "/api/history/me?days=1").json()
            sess = [x for x in hist["sessions"] if x["id"] == r.get("session_id")]
            stored = sess[0]["n"] if sess else 0
            u.post(B + "/api/session/stop", json={})
            row = {"rep": rep + 1, "scenario": scen, "user": user, "seconds": secs, "expected": expect,
                   "first_warning_s": first_warn, "first_critical_s": first_crit,
                   "critical_alerts": len(crit), "warnings": sum(a["level"] == "warning" for a in alerts),
                   "readings_stored": stored, "statuses": statuses}
            results.append(row)
            print(json.dumps(row), flush=True)
    admin.post(B + "/api/demo/scenario", json={"scenario": "normal"})
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results_system.json")
    with open(out, "w") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    main()
