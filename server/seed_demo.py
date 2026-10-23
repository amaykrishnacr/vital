"""Fill the database with 7 days of realistic history for member1..member4,
then train each person's anomaly model.  Run once:  python seed_demo.py

Use --reset to delete all existing readings, sessions, windows and alerts first.
"""
import argparse
import random
import time

from vital import db
from vital.ml import anomaly, insights, state

PROFILES = {   # username: resting HR, body temp, SpO2
    "member1": (72, 36.62, 98.0),
    "member2": (66, 36.50, 98.4),
    "member3": (80, 36.80, 97.6),
    "member4": (76, 36.70, 98.1),
}


def session_readings(start, seconds, hr, temp, spo2, elevated=False):
    out, wander, t_hr = [], 0.0, hr + (32 if elevated else 0)
    cur = t_hr + (12 if elevated else 0)
    for i in range(seconds):
        wander += random.gauss(0, 0.3) - wander * 0.08
        if elevated:
            cur += (hr + 18 - cur) * 0.006          # recovering after stairs
        else:
            cur = hr + wander
        out.append({
            "ts": start + i, "bpm": round(cur + random.gauss(0, 1.1), 1),
            "spo2": round(min(100, spo2 + random.gauss(0, 0.4) - (0.6 if elevated else 0)), 1),
            "temp": round(temp + random.gauss(0, 0.05) + (0.15 if elevated else 0), 2),
            "quality": round(random.uniform(78, 97), 1),
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--days", type=int, default=7)
    args = ap.parse_args()

    db.init_db()
    if args.reset:
        for t in ("readings", "sessions", "windows", "alerts"):
            db.execute(f"DELETE FROM {t}")
        print("Old data deleted.")

    random.seed(42)
    now = time.time()
    for username, (hr, temp, spo2) in PROFILES.items():
        user = db.query("SELECT * FROM users WHERE username=?", (username,), one=True)
        if not user:
            print(f"skip {username}: no such user")
            continue
        n_read = n_win = 0
        for day in range(args.days, 0, -1):
            for hour, elevated in ((8.5, False), (13.5, day % 3 == 0), (20.5, False)):
                midnight = time.mktime(time.localtime(now - day * 86400)[:3] + (0, 0, 0, 0, 0, -1))
                start = midnight + hour * 3600 + random.uniform(-1800, 1800)
                secs = random.randint(150, 300)
                sid = db.execute("INSERT INTO sessions(user_id, device_id, start, end) VALUES(?,?,?,?)",
                                 (user["id"], 1, start, start + secs))
                rows = session_readings(start, secs, hr + random.gauss(0, 1.5), temp + random.gauss(0, 0.08),
                                        spo2, elevated)
                skin_off = user["temp_offset"] or 2.4
                db.executemany("INSERT INTO readings(session_id,user_id,ts,bpm,spo2,temp,skin,ambient,ir,red,quality) "
                               "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                               [(sid, user["id"], r["ts"], r["bpm"], r["spo2"], r["temp"], round(r["temp"] - skin_off, 2),
                                 29.0, 112000, 98000, r["quality"]) for r in rows])
                n_read += len(rows)
                wins = []
                for i in range(0, len(rows) - 9, 10):
                    w = insights.window_features(rows[i:i + 10])
                    st, _ = state.classify(w)
                    wins.append((user["id"], sid, rows[i + 9]["ts"], w["hr_mean"], w["hr_std"], w["hr_min"],
                                 w["hr_max"], w["spo2_mean"], w["temp_mean"], w["quality"], 0.0, st))
                db.executemany("INSERT INTO windows(user_id,session_id,ts,hr_mean,hr_std,hr_min,hr_max,spo2_mean,"
                               "temp_mean,quality,anomaly,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", wins)
                n_win += len(wins)
        info = anomaly.train(user["id"])
        # score the history with the freshly trained personal model
        for w in db.query("SELECT * FROM windows WHERE user_id=?", (user["id"],)):
            s, _ = anomaly.score(user["id"], w)
            db.execute("UPDATE windows SET anomaly=? WHERE id=?", (round(s, 3), w["id"]))
        print(f"{user['name']}: {n_read} readings, {n_win} windows, model trained: {info}")

    m3 = db.query("SELECT * FROM users WHERE username='member3'", one=True)
    if m3:
        db.execute("INSERT INTO alerts(user_id, ts, level, kind, reason, sent_to, delivered, acknowledged) "
                   "VALUES(?,?,?,?,?,?,?,1)", (m3["id"], now - 2 * 86400 + 3000, "warning", "predict_temp",
                                               "Temperature is rising and may reach 38 °C in about 11 min",
                                               "(demo history)", 0))
    print("Done. Start the server with: python app.py")


if __name__ == "__main__":
    main()
