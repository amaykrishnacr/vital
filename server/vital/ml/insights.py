"""Turn numbers into the plain-English cards and status shown in Simple mode."""
import numpy as np


def window_features(readings):
    """Summarise ~10 seconds of readings into one window (or None if too little data)."""
    good = [r for r in readings if r.get("bpm") and r.get("quality", 0) >= 40]
    if len(good) < 5:
        return None
    hr = np.array([r["bpm"] for r in good])
    return {
        "hr_mean": float(np.mean(hr)), "hr_std": float(np.std(hr)),
        "hr_min": float(np.min(hr)), "hr_max": float(np.max(hr)),
        "spo2_mean": float(np.mean([r["spo2"] for r in good])),
        "temp_mean": float(np.mean([r["temp"] for r in good])),
        "quality": float(np.mean([r["quality"] for r in good])),
    }


def status(latest, anomaly, predictions, active_alert, quality=None):
    """Overall status pill: good / watch / check."""
    if active_alert:
        return {"level": "check", "text": "Check this"}
    if latest and not latest.get("finger", True):
        return {"level": "idle", "text": "No finger"}
    if quality is not None and quality < 40:
        return {"level": "watch", "text": "Poor signal"}
    if latest:
        t = latest.get("temp") or 0
        if latest["spo2"] < 92 or latest["bpm"] > 120 or latest["bpm"] < 45 or t >= 38.0:
            return {"level": "check", "text": "Check this"}
    if predictions or (anomaly is not None and anomaly >= 0.6):
        return {"level": "watch", "text": "Keep an eye"}
    if latest and (latest["spo2"] < 95 or latest["bpm"] > 100 or (latest.get("temp") or 0) >= 37.5):
        return {"level": "watch", "text": "Keep an eye"}
    return {"level": "good", "text": "All good"}


def cards(latest, base, state, predictions, quality):
    """List of {tone, title, text} for the 'What VITAL noticed' section."""
    out = []
    if latest is None:
        return out
    if not latest.get("finger", True) or not latest.get("bpm"):
        return [{"tone": "cyan", "title": "Place your finger on the sensor",
                 "text": "Rest your fingertip gently on the sensor and keep it still."}]
    if quality is not None and quality < 50:
        out.append({"tone": "amber", "title": "Hold your finger still",
                    "text": "The signal is noisy, so some readings are being skipped."})
    hr, lo, hi = latest["bpm"], base["hr_lo"], base["hr_hi"]
    rng = f"{lo:.0f}–{hi:.0f}"
    if hr > 120:
        out.append({"tone": "red", "title": "Your pulse is very high",
                    "text": f"{hr:.0f} bpm. If you are resting, sit down and tell someone nearby."})
    elif hr > hi + 6:
        extra = " If you've just been active, that's expected." if state == "Elevated" else ""
        out.append({"tone": "amber", "title": "Your pulse is higher than usual",
                    "text": f"About {hr - base['hr_mean']:.0f} bpm above your usual resting range ({rng}).{extra}"})
    elif hr < max(45, lo - 8):
        out.append({"tone": "amber", "title": "Your pulse is lower than usual",
                    "text": f"{hr:.0f} bpm, below your usual range ({rng})."})
    else:
        out.append({"tone": "green", "title": "Your heart is calm",
                    "text": f"Your pulse is right in your usual resting range ({rng}). Nothing to worry about."})

    s = latest["spo2"]
    if s < 90:
        out.append({"tone": "red", "title": "Oxygen is low",
                    "text": f"{s:.0f}%. Sit upright, breathe slowly, and get help if it stays low."})
    elif s < 95:
        out.append({"tone": "amber", "title": "Oxygen is a little low",
                    "text": f"{s:.0f}%. Healthy is 95% and above. Keep your hand still and re-check."})
    else:
        out.append({"tone": "cyan", "title": "Oxygen looks great",
                    "text": "Your blood oxygen is in the healthy range (95% and above)."})

    t, bt = latest.get("temp"), base["temp_mean"]
    if t is None:
        out.append({"tone": "amber", "title": "Temperature not available",
                    "text": "The temperature sensor isn't responding. Check the GY-906 wiring."})
    elif t >= 38.0:
        out.append({"tone": "red", "title": "You may have a fever",
                    "text": f"{t:.1f} °C. Rest, drink water and check with a thermometer."})
    elif t > bt + 0.4:
        out.append({"tone": "amber", "title": "A little warmer than your usual",
                    "text": f"{t:.1f} °C vs your usual {bt:.1f} °C. Still normal; if you've just come from outside, this is expected."})
    else:
        out.append({"tone": "amber" if t < 35.5 else "green", "title": "Temperature is normal for you",
                    "text": f"{t:.1f} °C, close to your usual {bt:.1f} °C."})

    for p in predictions:
        out.insert(0, {"tone": "red", "title": "Early warning", "text": p["text"] + "."})
    return out
