"""Personal anomaly detection with an Isolation Forest per user.

Each user gets their own model trained only on their own 10-second windows,
so "unusual" means unusual for that person. Until a user has enough data
(MIN_WINDOWS, about 5 minutes of readings) VITAL falls back to fixed
population limits.
"""
import math
import os
import threading
import time

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from .. import db

MIN_WINDOWS = 30          # 30 windows x 10 s = 5 minutes of readings
RETRAIN_EVERY = 60        # retrain after this many new windows
MODEL_DIR = os.path.join(db.DATA_DIR, "models")

POPULATION = {"hr_mean": 75.0, "hr_std": 2.5, "hr_lo": 60.0, "hr_hi": 100.0,
              "temp_mean": 36.8, "spo2_mean": 97.0, "n": 0}

_models = {}              # user_id -> {"model", "n", "trained_at"}
_baselines = {}           # user_id -> baseline dict
_lock = threading.Lock()
_training = set()


def _vector(w):
    return [w["hr_mean"], w["hr_std"], w["hr_max"] - w["hr_min"], w["spo2_mean"], w["temp_mean"]]


def _path(user_id):
    return os.path.join(MODEL_DIR, f"user_{user_id}.joblib")


def load_all():
    os.makedirs(MODEL_DIR, exist_ok=True)
    for name in os.listdir(MODEL_DIR):
        if name.startswith("user_") and name.endswith(".joblib"):
            uid = int(name[5:-7])
            try:
                _models[uid] = joblib.load(os.path.join(MODEL_DIR, name))
            except Exception:
                continue
            if "stats" not in _models[uid]:     # upgrade models saved by an older version
                threading.Thread(target=train, args=(uid,), daemon=True).start()


def _user_windows(user_id, limit=3000):
    return db.query("SELECT * FROM windows WHERE user_id=? AND quality>=60 ORDER BY ts DESC LIMIT ?",
                    (user_id, limit))


def compute_baseline(user_id):
    rows = _user_windows(user_id)
    if len(rows) < 6:
        return dict(POPULATION)
    resting = [r for r in rows if r["state"] in (None, "Resting")] or rows
    hr = np.array([r["hr_mean"] for r in resting])
    b = {
        "hr_mean": float(np.mean(hr)),
        "hr_std": float(np.std(hr)),
        "hr_lo": float(np.percentile(hr, 15)),
        "hr_hi": float(np.percentile(hr, 85)),
        "temp_mean": float(np.median([r["temp_mean"] for r in resting])),
        "spo2_mean": float(np.median([r["spo2_mean"] for r in resting])),
        "n": len(rows),
    }
    _baselines[user_id] = b
    return b


def baseline(user_id):
    return _baselines.get(user_id) or compute_baseline(user_id)


# Smallest spread allowed for each vital, so a very steady person is not over-sensitive
SD_FLOOR = {"hr_mean": 2.0, "spo2_mean": 0.5, "temp_mean": 0.1}
K_IF = 3.0                # slope of the Isolation Forest score curve (calibrated, see validation/)
Z_MID, K_Z = 4.5, 1.5     # per-vital deviation (in robust standard deviations) mapped to 0..1


def fit_windows(rows):
    """Build one user's personal model from their quality-accepted 10-second windows.

    Two parts:
      - an Isolation Forest over 5 window features, which catches unusual
        combinations (e.g. pulse a little high AND temperature a little high);
      - a robust per-vital baseline (median and MAD), which catches one vital
        drifting far from this person's own normal.
    """
    X = np.array([_vector(r) for r in rows])
    model = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
    model.fit(X)
    raw = -model.score_samples(X)
    stats = {}
    for k in SD_FLOOR:
        v = np.array([r[k] for r in rows], dtype=float)
        med = float(np.median(v))
        sd = float(1.4826 * np.median(np.abs(v - med)))
        stats[k] = {"median": med, "sd": max(sd, SD_FLOOR[k])}
    return {"model": model, "n": len(rows), "trained_at": time.time(),
            "if_p50": float(np.percentile(raw, 50)), "if_p99": float(np.percentile(raw, 99)), "stats": stats}


def train(user_id):
    """Train (or retrain) this user's personal model. Returns info dict."""
    rows = _user_windows(user_id)
    if len(rows) < MIN_WINDOWS:
        return {"ok": False, "reason": f"needs {MIN_WINDOWS} windows, has {len(rows)}"}
    info = fit_windows(rows)
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(info, _path(user_id))
    with _lock:
        _models[user_id] = info
    compute_baseline(user_id)
    return {"ok": True, "n": len(rows)}


def maybe_retrain(user_id, total_windows):
    info = _models.get(user_id)
    due = (info is None and total_windows >= MIN_WINDOWS) or \
          (info is not None and total_windows - info["n"] >= RETRAIN_EVERY)
    if due and user_id not in _training:
        _training.add(user_id)

        def run():
            try:
                train(user_id)
            finally:
                _training.discard(user_id)
        threading.Thread(target=run, daemon=True).start()


def model_info(user_id):
    info = _models.get(user_id)
    if not info:
        return {"personal": False, "n": 0, "trained_at": None}
    return {"personal": True, "n": info["n"], "trained_at": info["trained_at"]}


def _rules_score(w):
    dev = max(abs(w["hr_mean"] - 80) / 40.0,
              max(0.0, 96 - w["spo2_mean"]) / 8.0,
              abs(w["temp_mean"] - 36.8) / 1.6)
    return float(min(1.0, dev))


def _sigmoid(x):
    return 1.0 / (1.0 + math.exp(-max(-50.0, min(50.0, x))))


def personal_parts(info, w):
    """(Isolation Forest score, per-vital deviation score, largest deviation in SDs)."""
    raw = float(-info["model"].score_samples(np.array([_vector(w)]))[0])
    z_if = (raw - info["if_p99"]) / max(info["if_p99"] - info["if_p50"], 1e-6)
    zmax = max(abs(w[k] - st["median"]) / st["sd"] for k, st in info["stats"].items())
    return _sigmoid(K_IF * z_if), _sigmoid(K_Z * (zmax - Z_MID)), zmax


def score(user_id, w):
    """Anomaly score 0 (normal) .. 1 (very unusual) and which method produced it."""
    info = _models.get(user_id)
    if info is None:
        return _rules_score(w), "rules"
    if "stats" not in info:                     # model saved by an older version
        d = float(info["model"].decision_function(np.array([_vector(w)]))[0])
        return max(1.0 / (1.0 + math.exp(12.0 * d)), _rules_score(w) * 0.9), "personal"
    s_if, s_z, _ = personal_parts(info, w)
    # a reading that breaks the population limits is always at least as unusual
    return max(s_if, s_z, _rules_score(w) * 0.9), "personal"
