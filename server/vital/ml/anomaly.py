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
                pass


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


def train(user_id):
    """Train (or retrain) this user's Isolation Forest. Returns info dict."""
    rows = _user_windows(user_id)
    if len(rows) < MIN_WINDOWS:
        return {"ok": False, "reason": f"needs {MIN_WINDOWS} windows, has {len(rows)}"}
    X = np.array([_vector(r) for r in rows])
    model = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
    model.fit(X)
    info = {"model": model, "n": len(rows), "trained_at": time.time()}
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


def score(user_id, w):
    """Anomaly score 0 (normal) .. 1 (very unusual) and which method produced it."""
    info = _models.get(user_id)
    if info is None:
        return _rules_score(w), "rules"
    d = float(info["model"].decision_function(np.array([_vector(w)]))[0])
    s = 1.0 / (1.0 + math.exp(12.0 * d))
    # a reading that breaks the population limits is always at least as unusual
    return max(s, _rules_score(w) * 0.9), "personal"
