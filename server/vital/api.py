"""JSON API used by the device, the simulator and the website."""
import time
from datetime import datetime

from flask import Blueprint, jsonify, request
from werkzeug.security import generate_password_hash

import config
from . import alerts, city, db, live
from .auth import login_required
from .ml import anomaly

api = Blueprint("api", __name__, url_prefix="/api")
SCENARIOS = ["normal", "exercise", "fever", "low_oxygen", "high_hr", "noisy", "no_finger"]


def _device_ok():
    key = request.headers.get("X-Device-Key") or (request.get_json(silent=True) or {}).get("key") \
        or request.args.get("key")
    return key == config.DEVICE_KEY


# ------------------------------------------------------------------ device
@api.post("/reading")
def reading():
    if not _device_ok():
        return jsonify({"ok": False, "error": "bad device key"}), 403
    payload = request.get_json(silent=True) or {}
    return jsonify(live.process(payload, request.remote_addr))


DEFAULT_MANUAL = {"enabled": False, "bpm": 74, "spo2": 98, "temp": 36.7, "finger": True}


def _manual():
    import json
    try:
        return dict(DEFAULT_MANUAL, **json.loads(db.get_setting("sim_manual", "{}")))
    except Exception:
        return dict(DEFAULT_MANUAL)


@api.get("/demo/scenario")
def get_scenario():
    if not _device_ok():
        return jsonify({"ok": False, "error": "bad device key"}), 403
    return jsonify({"scenario": db.get_setting("sim_scenario", "normal"), "manual": _manual()})


@api.get("/demo/state")
@login_required("admin")
def demo_state(admin):
    return jsonify({"scenario": db.get_setting("sim_scenario", "normal"), "manual": _manual(),
                    "scenarios": SCENARIOS, "devices": live.devices_snapshot()})


@api.post("/demo/manual")
@login_required("admin")
def demo_manual(admin):
    import json
    f = request.get_json(silent=True) or {}
    m = _manual()
    for k in ("bpm", "spo2", "temp"):
        if k in f:
            m[k] = float(f[k])
    for k in ("enabled", "finger"):
        if k in f:
            m[k] = bool(f[k])
    db.set_setting("sim_manual", json.dumps(m))
    return jsonify({"ok": True, "manual": m})


# ------------------------------------------------------------------ user
@api.get("/live/me")
@login_required("user")
def live_me(user):
    since = request.args.get("since", type=int)
    return jsonify(live.build_live(user, since))


@api.post("/session/start")
@login_required("user")
def session_start(user):
    dev = live.online_device()
    if not dev:
        return jsonify({"ok": False, "error": "No VITAL device has connected yet. Switch on the device (or the simulator)."}), 409
    other = live.active_session_for_device(dev["id"])
    if other and other["user_id"] != user["id"]:
        return jsonify({"ok": False, "error": f"The device is in use by {other['user_name']}."}), 409
    db.execute("UPDATE sessions SET end=? WHERE user_id=? AND end IS NULL", (time.time(), user["id"]))
    live.reset_user(user["id"])
    sid = db.execute("INSERT INTO sessions(user_id, device_id, start) VALUES(?,?,?)",
                     (user["id"], dev["id"], time.time()))
    return jsonify({"ok": True, "session_id": sid})


@api.post("/session/stop")
@login_required("user")
def session_stop(user):
    db.execute("UPDATE sessions SET end=? WHERE user_id=? AND end IS NULL", (time.time(), user["id"]))
    return jsonify({"ok": True})


def _history(user, days):
    since = time.time() - days * 86400
    daily = db.query(
        "SELECT date(ts,'unixepoch','localtime') d, AVG(bpm) bpm, AVG(spo2) spo2, AVG(temp) temp, "
        "MIN(spo2) spo2_min, MAX(temp) temp_max, COUNT(*) n FROM readings WHERE user_id=? AND ts>? "
        "GROUP BY d ORDER BY d", (user["id"], since))
    resting = {r["d"]: r["hr"] for r in db.query(
        "SELECT date(ts,'unixepoch','localtime') d, AVG(hr_mean) hr FROM windows WHERE user_id=? AND ts>? "
        "AND state='Resting' GROUP BY d", (user["id"], since))}
    for r in daily:
        r["resting_hr"] = resting.get(r["d"])
    sessions = db.query(
        "SELECT s.id, s.start, s.end, COUNT(r.id) n, AVG(r.bpm) bpm, AVG(r.spo2) spo2, AVG(r.temp) temp, "
        "MAX(r.ts) last_ts FROM sessions s LEFT JOIN readings r ON r.session_id=s.id WHERE s.user_id=? "
        "GROUP BY s.id HAVING n>0 ORDER BY s.start DESC LIMIT 12", (user["id"],))
    last = sessions[0] if sessions else None
    series = []
    if last:
        series = db.query(
            "SELECT CAST((ts-?)/10 AS INT) k, MIN(ts) ts, AVG(bpm) bpm, AVG(spo2) spo2, AVG(temp) temp "
            "FROM readings WHERE session_id=? GROUP BY k ORDER BY k", (last["start"], last["id"]))
    states = db.query("SELECT state, COUNT(*) n FROM windows WHERE user_id=? AND ts>? GROUP BY state",
                      (user["id"], since))
    user_alerts = db.query("SELECT * FROM alerts WHERE user_id=? ORDER BY ts DESC LIMIT 20", (user["id"],))
    return {"daily": daily, "sessions": sessions, "last_series": series, "states": states,
            "alerts": user_alerts, "baseline": anomaly.baseline(user["id"]),
            "model": anomaly.model_info(user["id"])}


@api.get("/history/me")
@login_required("user")
def history_me(user):
    return jsonify(_history(user, request.args.get("days", 7, type=int)))


# ------------------------------------------------------------------ admin
def _user_or_404(uid):
    return db.query("SELECT * FROM users WHERE id=?", (uid,), one=True)


@api.get("/live/<int:uid>")
@login_required("admin")
def live_user(admin, uid):
    u = _user_or_404(uid)
    if not u:
        return jsonify({"error": "no such user"}), 404
    return jsonify(live.build_live(u, request.args.get("since", type=int)))


@api.get("/admin/overview")
@login_required("admin")
def overview(admin):
    users = db.query("SELECT * FROM users WHERE role='user' ORDER BY name")
    tiles = []
    for u in users:
        d = live.build_live(u)
        d["wave"]["ir"] = d["wave"]["ir"][-125:]
        d["wave"]["red"] = []
        d["insights"] = d["insights"][:1]
        open_alert = db.query("SELECT * FROM alerts WHERE user_id=? AND acknowledged=0 AND level='critical' "
                              "AND ts>? ORDER BY ts DESC LIMIT 1", (u["id"], time.time() - 3600), one=True)
        d["open_alert"] = open_alert
        tiles.append(d)
    unack = db.query("SELECT COUNT(*) n FROM alerts WHERE acknowledged=0", one=True)["n"]
    return jsonify({"tiles": tiles, "devices": live.devices_snapshot(), "unacknowledged": unack,
                    "scenario": db.get_setting("sim_scenario", "normal"), "scenarios": SCENARIOS,
                    "telegram": alerts.telegram_enabled()})


@api.get("/admin/alerts")
@login_required("admin")
def admin_alerts(admin):
    rows = db.query("SELECT a.*, u.name user_name, u.ward FROM alerts a JOIN users u ON u.id=a.user_id "
                    "ORDER BY a.ts DESC LIMIT 200")
    return jsonify({"alerts": rows})


@api.post("/admin/alerts/<int:aid>/ack")
@login_required("admin")
def ack(admin, aid):
    db.execute("UPDATE alerts SET acknowledged=1 WHERE id=?", (aid,))
    return jsonify({"ok": True})


@api.post("/admin/alerts/ack_all")
@login_required("admin")
def ack_all(admin):
    db.execute("UPDATE alerts SET acknowledged=1 WHERE acknowledged=0")
    return jsonify({"ok": True})


@api.get("/admin/users")
@login_required("admin")
def users_list(admin):
    rows = db.query("SELECT id, username, name, role, ward, emergency_chat, emergency_name, temp_offset, created "
                    "FROM users ORDER BY role, name")
    for r in rows:
        r["model"] = anomaly.model_info(r["id"])
        r["windows"] = db.query("SELECT COUNT(*) n FROM windows WHERE user_id=?", (r["id"],), one=True)["n"]
        r["measuring"] = live.active_session_for_user(r["id"]) is not None
    return jsonify({"users": rows, "wards": city.WARDS, "telegram": alerts.telegram_enabled(),
                    "min_windows": anomaly.MIN_WINDOWS})


@api.post("/admin/users")
@login_required("admin")
def users_create(admin):
    f = request.get_json(silent=True) or {}
    username = (f.get("username") or "").strip().lower()
    if not username or not f.get("password") or not f.get("name"):
        return jsonify({"ok": False, "error": "Name, username and password are required"}), 400
    if db.query("SELECT id FROM users WHERE username=?", (username,), one=True):
        return jsonify({"ok": False, "error": "That username is taken"}), 400
    db.execute("INSERT INTO users(username,name,password_hash,role,ward,emergency_chat,emergency_name,temp_offset,created) "
               "VALUES(?,?,?,?,?,?,?,?,?)",
               (username, f["name"].strip(), generate_password_hash(f["password"]),
                "admin" if f.get("role") == "admin" else "user", f.get("ward") or "Ward 3",
                (f.get("emergency_chat") or "").strip(), (f.get("emergency_name") or "").strip(),
                config.DEFAULT_TEMP_OFFSET, time.time()))
    return jsonify({"ok": True})


@api.post("/admin/users/<int:uid>")
@login_required("admin")
def users_update(admin, uid):
    f = request.get_json(silent=True) or {}
    u = _user_or_404(uid)
    if not u:
        return jsonify({"ok": False, "error": "no such user"}), 404
    for field in ("name", "ward", "emergency_chat", "emergency_name"):
        if field in f:
            db.execute(f"UPDATE users SET {field}=? WHERE id=?", (str(f[field]).strip(), uid))
    if "temp_offset" in f:
        db.execute("UPDATE users SET temp_offset=? WHERE id=?", (float(f["temp_offset"]), uid))
    if f.get("password"):
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(f["password"]), uid))
    return jsonify({"ok": True})


@api.post("/admin/users/<int:uid>/delete")
@login_required("admin")
def users_delete(admin, uid):
    if uid == admin["id"]:
        return jsonify({"ok": False, "error": "You can't delete your own account"}), 400
    for t in ("users WHERE id", "sessions WHERE user_id", "readings WHERE user_id", "windows WHERE user_id",
              "alerts WHERE user_id"):
        db.execute(f"DELETE FROM {t}=?", (uid,))
    return jsonify({"ok": True})


@api.post("/admin/users/<int:uid>/retrain")
@login_required("admin")
def users_retrain(admin, uid):
    return jsonify(anomaly.train(uid))


@api.post("/admin/users/<int:uid>/test_alert")
@login_required("admin")
def users_test_alert(admin, uid):
    u = _user_or_404(uid)
    a = alerts.raise_alert(u, "warning", "test", "Test alert from the VITAL admin page. No action needed.", force=True)
    return jsonify({"ok": True, "alert": a})


@api.post("/admin/users/<int:uid>/calibrate")
@login_required("admin")
def users_calibrate(admin, uid):
    """Set temp offset = thermometer reading - average skin reading of the last 30 s."""
    f = request.get_json(silent=True) or {}
    try:
        thermo = float(f.get("thermometer"))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Enter the thermometer reading in °C"}), 400
    rows = db.query("SELECT skin FROM readings WHERE user_id=? AND ts>? AND skin IS NOT NULL",
                    (uid, time.time() - 30))
    if len(rows) < 5:
        return jsonify({"ok": False, "error": "This user must be measuring right now (finger on the sensor)"}), 400
    skin = sum(r["skin"] for r in rows) / len(rows)
    offset = round(thermo - skin, 2)
    db.execute("UPDATE users SET temp_offset=? WHERE id=?", (offset, uid))
    return jsonify({"ok": True, "offset": offset, "skin": round(skin, 2)})


@api.post("/admin/session/<int:uid>/stop")
@login_required("admin")
def admin_stop(admin, uid):
    db.execute("UPDATE sessions SET end=? WHERE user_id=? AND end IS NULL", (time.time(), uid))
    return jsonify({"ok": True})


@api.get("/admin/telegram/chats")
@login_required("admin")
def telegram_chats(admin):
    return jsonify(alerts.recent_chats())


@api.get("/admin/city")
@login_required("admin")
def admin_city(admin):
    snap = city.snapshot()
    snap["messages"] = [city.mqtt_message(w, snap["city"]) for w in snap["wards"]]
    return jsonify(snap)


@api.post("/demo/scenario")
@login_required("admin")
def set_scenario(admin):
    s = (request.get_json(silent=True) or {}).get("scenario", "normal")
    if s not in SCENARIOS:
        return jsonify({"ok": False, "error": "unknown scenario"}), 400
    db.set_setting("sim_scenario", s)
    import json
    m = _manual(); m["enabled"] = False                     # a scenario takes over from the sliders
    db.set_setting("sim_manual", json.dumps(m))
    return jsonify({"ok": True, "scenario": s})


@api.get("/time")
def server_time():
    return jsonify({"ts": time.time(), "local": datetime.now().strftime("%H:%M:%S")})
