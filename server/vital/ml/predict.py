"""Trend prediction: fit a straight line to recent readings and look ahead.

For each vital we take the last 10 minutes, average it into 10-second points,
fit value = a + b * minutes with numpy.polyfit, and project 15 minutes ahead.
If the projection crosses a danger limit, we estimate how many minutes are
left and raise an early warning.
"""
import numpy as np

HORIZON_MIN = 15
MIN_POINTS = 12            # at least 2 minutes of data (12 x 10 s)

# vital: (limit, direction, minimum change over the horizon to count as a trend, label, unit)
LIMITS = {
    "temp": (38.0, +1, 0.25, "Temperature", "°C"),
    "bpm":  (120.0, +1, 8.0, "Heart rate", "bpm"),
    "spo2": (92.0, -1, 2.0, "SpO₂", "%"),
}


def _points(readings, key):
    if not readings:
        return np.array([]), np.array([])
    t0 = readings[-1]["ts"]
    buckets = {}
    for r in readings:
        if r.get(key) is None:
            continue
        k = int((r["ts"] - t0) // 10)
        buckets.setdefault(k, []).append(r[key])
    ks = sorted(buckets)
    t = np.array([k * 10 / 60.0 for k in ks])            # minutes, <= 0
    y = np.array([float(np.mean(buckets[k])) for k in ks])
    return t, y


def forecast(readings):
    """readings: list of dicts (ts, bpm, spo2, temp) from the last ~10 minutes."""
    out = []
    for key, (limit, direction, min_change, label, unit) in LIMITS.items():
        t, y = _points(readings, key)
        if len(t) < MIN_POINTS:
            continue
        b, a = np.polyfit(t, y, 1)                       # slope per minute, intercept
        now = a                                          # fitted value at t = 0
        future = a + b * HORIZON_MIN
        # the newest half of the data must still be moving the same way;
        # this ignores one-off jumps (e.g. after standing up) that a single line would extend
        half = len(t) // 2
        b_recent = np.polyfit(t[half:], y[half:], 1)[0]
        trending = direction * b * HORIZON_MIN >= min_change and direction * b_recent >= 0.5 * direction * b
        crosses = direction * (future - limit) >= 0 and direction * (now - limit) < 0
        if trending and crosses:
            eta = (limit - now) / b
            out.append({
                "vital": key, "label": label, "unit": unit, "limit": limit,
                "now": round(float(now), 2), "slope": round(float(b), 3),
                "eta_min": round(float(eta), 1),
                "text": f"{label} is {'rising' if direction > 0 else 'falling'} and may reach "
                        f"{limit:g} {unit} in about {max(1, round(eta))} min",
            })
    return out


def series(readings, key):
    """Points and fitted line for charts (Detailed mode)."""
    t, y = _points(readings, key)
    if len(t) < MIN_POINTS:
        return None
    b, a = np.polyfit(t, y, 1)
    return {"t": t.round(3).tolist(), "y": y.round(2).tolist(), "a": float(a), "b": float(b)}
