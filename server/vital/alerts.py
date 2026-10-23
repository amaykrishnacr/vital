"""Emergency alert rules and Telegram delivery."""
import threading
import time
from datetime import datetime

import requests

import config
from . import db

TELEGRAM_API = "https://api.telegram.org/bot"
_last_sent = {}           # (user_id, kind) -> timestamp
_lock = threading.Lock()


# ---------------------------------------------------------------- Telegram
def telegram_enabled():
    return bool(config.TELEGRAM_BOT_TOKEN.strip())


def send_telegram(chat_id, text):
    """Send one message. Returns (ok, error_text)."""
    if not telegram_enabled():
        return False, "Telegram bot token not set in config.py"
    if not chat_id:
        return False, "No emergency contact chat ID for this user"
    try:
        r = requests.post(f"{TELEGRAM_API}{config.TELEGRAM_BOT_TOKEN}/sendMessage",
                          data={"chat_id": chat_id, "text": text}, timeout=8)
        if r.ok and r.json().get("ok"):
            return True, ""
        return False, r.json().get("description", f"HTTP {r.status_code}")
    except Exception as e:  # no internet, wrong token, ...
        return False, str(e)


def recent_chats():
    """People who recently messaged the bot, so the admin can copy their chat ID."""
    if not telegram_enabled():
        return {"ok": False, "error": "Telegram bot token not set in config.py", "chats": []}
    try:
        r = requests.get(f"{TELEGRAM_API}{config.TELEGRAM_BOT_TOKEN}/getUpdates", timeout=8).json()
    except Exception as e:
        return {"ok": False, "error": str(e), "chats": []}
    chats = {}
    for u in r.get("result", []):
        msg = u.get("message") or u.get("edited_message") or {}
        c = msg.get("chat")
        if c:
            name = " ".join(x for x in [c.get("first_name"), c.get("last_name")] if x) or c.get("title", "")
            chats[c["id"]] = {"chat_id": c["id"], "name": name, "username": c.get("username", "")}
    return {"ok": r.get("ok", False), "error": r.get("description", ""), "chats": list(chats.values())}


# ---------------------------------------------------------------- alerts
def raise_alert(user, level, kind, reason, force=False):
    """Store an alert and send it, unless the same kind was sent recently."""
    key = (user["id"], kind)
    now = time.time()
    with _lock:
        if not force and now - _last_sent.get(key, 0) < config.ALERT_COOLDOWN_MIN * 60:
            return None
        _last_sent[key] = now
    alert_id = db.execute(
        "INSERT INTO alerts(user_id, ts, level, kind, reason, sent_to) VALUES(?,?,?,?,?,?)",
        (user["id"], now, level, kind, reason, user.get("emergency_name") or user.get("emergency_chat") or ""))

    icon = "🚨" if level == "critical" else "⚠️"
    text = (f"{icon} VITAL {'ALERT' if level == 'critical' else 'EARLY WARNING'}: {user['name']}\n"
            f"{reason}\n"
            f"Time: {datetime.fromtimestamp(now).strftime('%d %b %H:%M:%S')}\n"
            f"Location: {user.get('ward') or 'unknown'}")

    def deliver():
        ok, err = send_telegram(user.get("emergency_chat"), text)
        db.execute("UPDATE alerts SET delivered=? , sent_to=? WHERE id=?",
                   (1 if ok else 0, (user.get("emergency_name") or user.get("emergency_chat") or "") +
                    ("" if ok else f" (not sent: {err})"), alert_id))
    threading.Thread(target=deliver, daemon=True).start()
    return {"id": alert_id, "level": level, "kind": kind, "reason": reason, "ts": now}


def _sustained(readings, key, test, seconds=10):
    """True if the last `seconds` readings all pass `test`."""
    if len(readings) < seconds:
        return False
    last = readings[-seconds:]
    if last[-1]["ts"] - last[0]["ts"] > seconds + 5:      # gap in data
        return False
    return all(test(r[key]) for r in last)


def check(user, readings, windows, predictions):
    """Apply the alert rules. Returns the list of alerts raised now."""
    raised = []
    r = readings[-1] if readings else None

    def fire(level, kind, reason):
        a = raise_alert(user, level, kind, reason)
        if a:
            raised.append(a)

    if r:
        if _sustained(readings, "spo2", lambda v: v < 90):
            fire("critical", "low_spo2", f"SpO₂ is {r['spo2']:.0f}% (below 90% for 10 s)")
        if _sustained(readings, "bpm", lambda v: v > 120):
            fire("critical", "high_hr", f"Heart rate is {r['bpm']:.0f} bpm (above 120 for 10 s)")
        if _sustained(readings, "bpm", lambda v: v < 45):
            fire("critical", "low_hr", f"Heart rate is {r['bpm']:.0f} bpm (below 45 for 10 s)")
        if _sustained(readings, "temp", lambda v: v >= 38.5):
            fire("critical", "fever", f"Temperature is {r['temp']:.1f} °C (38.5 °C or higher)")
    last3 = list(windows)[-3:]
    # "Elevated" (exercise-like) windows are expected to look unusual; the
    # heart-rate rules above still catch a dangerous pulse.
    if len(last3) == 3 and all(w["anomaly"] >= 0.7 and w["state"] != "Elevated" for w in last3):
        fire("critical", "anomaly", "Readings have been very unusual for this person for 30 s "
                                    f"(anomaly score {windows[-1]['anomaly']:.2f})")
    for p in predictions:
        fire("warning", "predict_" + p["vital"], p["text"])
    return raised
