"""Live processing: every reading from the device passes through here.

reading -> signal quality -> body temperature -> store
every 10 s: window features -> anomaly score + health state -> store
every 5 s:  trend prediction
always:     alert rules
"""
import threading
import time
from collections import deque

import numpy as np

from . import alerts, db
from .ml import anomaly, insights, predict, quality, state

WAVE_KEEP = 400            # waveform samples kept per user (16 s at 25 Hz)
DEVICE_ONLINE_S = 6        # a device is "online" if it sent something this recently


class UserLive:
    def __init__(self, user_id):
        self.user_id = user_id
        self.readings = deque(maxlen=900)       # good readings, last 15 minutes
        self.wave = deque(maxlen=WAVE_KEEP)     # (index, ir, red)
        self.wave_idx = 0
        self.pending = []
        self.windows = deque(maxlen=120)
        self.latest = None
        self.last_quality = None
        self.predictions = []
        self.last_predict = 0
        self.prev_bpm = None
        self.alert_until = 0
        self.alert_text = ""
        self.total_windows = None


_users = {}
_devices = {}              # device_key -> live info
_lock = threading.Lock()


def user_live(user_id):
    with _lock:
        if user_id not in _users:
            _users[user_id] = UserLive(user_id)
        return _users[user_id]


def device_live(key):
    return _devices.get(key)


def devices_snapshot():
    now = time.time()
    out = []
    for key, d in _devices.items():
        out.append(dict(d, key=key, online=now - d["last_seen"] < DEVICE_ONLINE_S,
                        last_packet_s=round(now - d["last_seen"], 1)))
    return out


def online_device():
    """Most recently seen online device row, or the newest device if none online."""
    now = time.time()
    online = [k for k, d in _devices.items() if now - d["last_seen"] < DEVICE_ONLINE_S]
    if online:
        key = max(online, key=lambda k: _devices[k]["last_seen"])
        return db.query("SELECT * FROM devices WHERE device_key=?", (key,), one=True)
    return db.query("SELECT * FROM devices ORDER BY last_seen DESC LIMIT 1", one=True)


def active_session_for_device(device_id):
    return db.query("SELECT s.*, u.name AS user_name FROM sessions s JOIN users u ON u.id=s.user_id "
                    "WHERE s.device_id=? AND s.end IS NULL ORDER BY s.start DESC LIMIT 1", (device_id,), one=True)


def active_session_for_user(user_id):
    return db.query("SELECT * FROM sessions WHERE user_id=? AND end IS NULL ORDER BY start DESC LIMIT 1",
                    (user_id,), one=True)


def process(payload, ip):
    """Handle one POST /api/reading from a device. Returns the reply sent back to it."""
    now = time.time()
    key = str(payload.get("device") or "vital-01")[:40]
    dev = db.query("SELECT * FROM devices WHERE device_key=?", (key,), one=True)
    if not dev:
        db.execute("INSERT INTO devices(device_key) VALUES(?)", (key,))
        dev = db.query("SELECT * FROM devices WHERE device_key=?", (key,), one=True)
    db.execute("UPDATE devices SET last_seen=?, rssi=?, ip=?, fw=? WHERE id=?",
               (now, payload.get("rssi"), ip, payload.get("fw"), dev["id"]))
    prev = _devices.get(key, {})
    _devices[key] = {"id": dev["id"], "last_seen": now, "rssi": payload.get("rssi"), "ip": ip,
                     "fw": payload.get("fw", "?"), "sample_rate": payload.get("rate", 100),
                     "finger": bool(payload.get("finger")), "packets": prev.get("packets", 0) + 1}

    sess = active_session_for_device(dev["id"])
    if not sess:
        return {"ok": True, "user": None, "alert": False, "msg": "Log in + Start"}

    user = db.query("SELECT * FROM users WHERE id=?", (sess["user_id"],), one=True)
    ul = user_live(user["id"])
    if ul.total_windows is None:
        ul.total_windows = db.query("SELECT COUNT(*) AS n FROM windows WHERE user_id=?", (user["id"],), one=True)["n"]

    finger = bool(payload.get("finger", True))
    ir_wave = list(payload.get("wave") or [])
    red_wave = list(payload.get("red_wave") or [])
    for i, v in enumerate(ir_wave):
        ul.wave.append((ul.wave_idx, v, red_wave[i] if i < len(red_wave) else None))
        ul.wave_idx += 1

    bpm = float(payload.get("bpm") or 0)
    jump = abs(bpm - ul.prev_bpm) if (ul.prev_bpm and bpm) else 0.0
    recent_wave = [w[1] for w in list(ul.wave)[-125:]]
    q = quality.score(recent_wave, jump, finger and bpm > 0)
    ul.last_quality = q
    ul.prev_bpm = bpm or ul.prev_bpm

    skin = payload.get("temp")
    r = {
        "ts": now, "bpm": bpm, "spo2": float(payload.get("spo2") or 0),
        "skin": float(skin) if skin is not None else None,
        "temp": round(float(skin) + float(user["temp_offset"] or 0), 2) if skin is not None else None,
        "ambient": payload.get("ambient"), "ir": payload.get("ir"), "red": payload.get("red"),
        "quality": round(q, 1), "finger": finger,
    }
    ul.latest = r
    good = finger and bpm > 0 and r["temp"] is not None and q >= 40
    if good:
        ul.readings.append(r)
        db.execute("INSERT INTO readings(session_id,user_id,ts,bpm,spo2,temp,skin,ambient,ir,red,quality) "
                   "VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                   (sess["id"], user["id"], now, r["bpm"], r["spo2"], r["temp"], r["skin"], r["ambient"],
                    r["ir"], r["red"], r["quality"]))
        ul.pending.append(r)

    if len(ul.pending) >= 10:
        w = insights.window_features(ul.pending)
        ul.pending = []
        if w:
            w["anomaly"], w["source"] = anomaly.score(user["id"], w)
            w["state"], w["state_conf"] = state.classify(w)
            w["ts"] = now
            ul.windows.append(w)
            db.execute("INSERT INTO windows(user_id,session_id,ts,hr_mean,hr_std,hr_min,hr_max,spo2_mean,"
                       "temp_mean,quality,anomaly,state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                       (user["id"], sess["id"], now, w["hr_mean"], w["hr_std"], w["hr_min"], w["hr_max"],
                        w["spo2_mean"], w["temp_mean"], w["quality"], w["anomaly"], w["state"]))
            ul.total_windows += 1
            anomaly.maybe_retrain(user["id"], ul.total_windows)

    if now - ul.last_predict >= 5:
        recent = [x for x in ul.readings if now - x["ts"] <= 600]
        ul.predictions = predict.forecast(recent)
        ul.last_predict = now

    raised = alerts.check(user, list(ul.readings), ul.windows, ul.predictions) if good else []
    for a in raised:
        if a["level"] == "critical":
            ul.alert_until = now + 60
            ul.alert_text = a["kind"].replace("_", " ").upper()

    alert_on = now < ul.alert_until
    return {"ok": True, "user": user["name"], "alert": alert_on, "temp": r["temp"] if finger else None,
            "msg": ("ALERT " + ul.alert_text) if alert_on else ("Place finger" if not finger else "OK"),
            "quality": round(q)}


def build_live(user, since=None):
    """Everything the user page and admin tiles need, in one JSON-friendly dict."""
    now = time.time()
    ul = user_live(user["id"])
    sess = active_session_for_user(user["id"])
    dev = None
    if sess and sess.get("device_id"):
        drow = db.query("SELECT * FROM devices WHERE id=?", (sess["device_id"],), one=True)
        dev = _devices.get(drow["device_key"]) if drow else None
    online = bool(dev and now - dev["last_seen"] < DEVICE_ONLINE_S)
    measuring = bool(sess) and online and ul.latest is not None and now - ul.latest["ts"] < DEVICE_ONLINE_S

    base = anomaly.baseline(user["id"])
    last_w = ul.windows[-1] if ul.windows else None
    # average the last 3 windows (30 s) so the status doesn't flicker
    recent_w = [w for w in list(ul.windows)[-3:] if now - w["ts"] < 60]
    an = sum(w["anomaly"] for w in recent_w) / len(recent_w) if recent_w else None
    latest = ul.latest if measuring else None
    alert_on = now < ul.alert_until
    preds = ul.predictions if measuring else []

    wave = list(ul.wave)
    if since is not None:
        wave = [w for w in wave if w[0] >= since]
    else:
        wave = wave[-100:]

    last_seen = db.query("SELECT ts, bpm, spo2, temp FROM readings WHERE user_id=? ORDER BY ts DESC LIMIT 1",
                         (user["id"],), one=True)
    recent_alerts = db.query("SELECT * FROM alerts WHERE user_id=? ORDER BY ts DESC LIMIT 5", (user["id"],))
    recent = [x for x in ul.readings if now - x["ts"] <= 600]

    return {
        "user": {"id": user["id"], "name": user["name"], "ward": user["ward"]},
        "session": sess, "measuring": measuring, "device_online": online,
        "latest": latest, "last_seen": last_seen,
        "status": insights.status(latest, an, preds, alert_on, ul.last_quality) if measuring else
                  {"level": "idle", "text": "Not measuring"},
        "insights": insights.cards(latest, base, last_w["state"] if last_w else None, preds,
                                   ul.last_quality) if measuring else [],
        "wave": {"next": ul.wave_idx, "ir": [[w[0], w[1]] for w in wave],
                 "red": [[w[0], w[2]] for w in wave if w[2] is not None]},
        "ml": {
            "anomaly": an, "source": last_w["source"] if last_w else None,
            "state": last_w["state"] if last_w else None,
            "state_conf": last_w["state_conf"] if last_w else None,
            "quality": ul.last_quality if measuring else None,
            "baseline": base, "model": anomaly.model_info(user["id"]),
            "windows_live": len(ul.windows),
            "trend_temp": predict.series(recent, "temp") if measuring else None,
        },
        "predictions": preds,
        "alert": {"on": alert_on, "text": ul.alert_text},
        "device": ({"rssi": dev["rssi"], "rate": dev["sample_rate"], "fw": dev["fw"],
                    "last_packet_s": round(now - dev["last_seen"], 1), "online": online} if dev else None),
        "recent_alerts": recent_alerts,
    }


def reset_user(user_id):
    with _lock:
        _users.pop(user_id, None)
