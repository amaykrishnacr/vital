"""VITAL software validation (offline, uses the real VITAL ML code).

Run from the repository root:   python validation/validate_ml.py
Writes validation/results_ml.json and prints a summary.

Experiments
  A  Personal anomaly detection vs fixed population thresholds
  B  Trend prediction: early-warning lead time and false-warning rate
  C  Signal-quality model on held-out waveforms
  D  Health-state classifier on held-out windows
All data is simulated with fixed random seeds, so results are repeatable.
"""
import json
import math
import os
import sys
import time

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))

from vital.ml import anomaly, insights, predict, quality, state, synth  # noqa: E402

OUT = {}


# --------------------------------------------------------------- helpers
def person(rng):
    return {
        "hr": rng.uniform(55, 95),           # resting heart rate
        "hr_sd": rng.uniform(0.8, 2.0),      # beat-to-beat wander
        "temp": rng.uniform(36.3, 36.9),
        "spo2": rng.uniform(96.5, 99.0),
    }


def window(rng, p, d_hr=0.0, d_temp=0.0, d_spo2=0.0, hr_abs=None, spo2_abs=None, temp_abs=None):
    """10 one-second readings -> one VITAL window (same feature code as the server)."""
    base_hr = hr_abs if hr_abs is not None else p["hr"] + d_hr + rng.normal(0, 1.5)
    base_t = temp_abs if temp_abs is not None else p["temp"] + d_temp + rng.normal(0, 0.06)
    base_s = spo2_abs if spo2_abs is not None else p["spo2"] + d_spo2 + rng.normal(0, 0.3)
    rows = [{"bpm": base_hr + rng.normal(0, p["hr_sd"]), "spo2": min(100, base_s + rng.normal(0, 0.35)),
             "temp": base_t + rng.normal(0, 0.04), "quality": 90.0} for _ in range(10)]
    return insights.window_features(rows)


def fixed_threshold_flag(w):
    """Typical fixed population limits used by simple monitors."""
    return w["hr_mean"] > 100 or w["hr_mean"] < 50 or w["spo2_mean"] < 95 or w["temp_mean"] >= 37.5


# --------------------------------------------------------------- A
def experiment_a(n_people=40, n_train=180, n_test_normal=150, n_test_abn=40, flag_at=0.7):
    rng = np.random.default_rng(2026)
    classes = {
        "Personal deviation (population-normal): HR +20 bpm": dict(d_hr=20),
        "Subtle combined: HR +12 bpm and temp +0.5 °C": dict(d_hr=12, d_temp=0.5),
        "Tachycardia at rest: HR 125 bpm": dict(hr_abs=125),
        "Hypoxia: SpO2 87 %": dict(spo2_abs=87),
        "Fever: 38.6 °C": dict(temp_abs=38.6),
    }
    keys = ("fixed", "if_only", "base_only", "vital")
    res = {"normal": {"n": 0, "n_high_base": 0, **{k: 0 for k in keys}, **{k + "_hb": 0 for k in keys}}}
    for c in classes:
        res[c] = {"n": 0, **{k: 0 for k in keys}}

    def flags(uid, info, w):
        s_if, s_z, _ = anomaly.personal_parts(info, w)
        s, _ = anomaly.score(uid, w)
        return {"fixed": fixed_threshold_flag(w), "if_only": s_if >= flag_at, "base_only": s_z >= flag_at,
                "vital": s >= flag_at}
    t0 = time.time()
    for i in range(n_people):
        p = person(rng)
        uid = 10_000 + i
        info = anomaly.fit_windows([window(rng, p) for _ in range(n_train)])   # same code as the server
        anomaly._models[uid] = info
        for _ in range(n_test_normal):
            f = flags(uid, info, window(rng, p))
            r = res["normal"]; r["n"] += 1
            for k in keys:
                r[k] += f[k]
            if p["hr"] >= 85:
                r["n_high_base"] += 1
                for k in keys:
                    r[k + "_hb"] += f[k]
        for c, kw in classes.items():
            if c.startswith("Personal") and p["hr"] > 75:
                continue                      # keep this class inside the population-normal range (< 100 bpm)
            for _ in range(n_test_abn):
                f = flags(uid, info, window(rng, p, **kw))
                r = res[c]; r["n"] += 1
                for k in keys:
                    r[k] += f[k]
        anomaly._models.pop(uid, None)
    rows = []
    n = res["normal"]
    rows.append({"case": "Healthy held-out windows (false alarms)", "n": n["n"], **{k: n[k] / n["n"] for k in keys}})
    rows.append({"case": "Healthy, resting HR ≥ 85 bpm (false alarms)", "n": n["n_high_base"],
                 **{k: n[k + "_hb"] / max(1, n["n_high_base"]) for k in keys}})
    for c in classes:
        r = res[c]
        rows.append({"case": c + " (detected)", "n": r["n"], **{k: r[k] / r["n"] for k in keys}})
    OUT["A"] = {"people": n_people, "train_windows_per_person": n_train, "flag_threshold": flag_at,
                "rows": rows, "seconds": round(time.time() - t0, 1)}


# --------------------------------------------------------------- B
def trajectory(rng, kind, minutes=20, start=None):
    """1 Hz readings. kind: rise (temp), stable, step (one-off jump), spo2drop."""
    n = minutes * 60
    t = np.arange(n) / 60.0
    hr = 75 + rng.normal(0, 1.2, n)
    spo2 = 98 + rng.normal(0, 0.35, n)
    if kind == "rise":
        t0, slope = rng.uniform(36.8, 37.3), rng.uniform(0.05, 0.20)
        temp = t0 + slope * t
    elif kind == "stable":
        temp = np.full(n, rng.uniform(36.4, 37.2))
    elif kind == "step":
        base = rng.uniform(36.4, 36.9)
        temp = np.where(t > rng.uniform(4, 10), base + rng.uniform(0.3, 0.6), base)
    elif kind == "spo2drop":
        temp = np.full(n, 36.7)
        s0, slope = rng.uniform(96.5, 98.0), rng.uniform(0.3, 1.0)
        spo2 = s0 - slope * t + rng.normal(0, 0.35, n)
    temp = temp + rng.normal(0, 0.05, n)
    return [{"ts": 1_000_000 + k, "bpm": float(hr[k]), "spo2": float(spo2[k]), "temp": float(temp[k])} for k in range(n)], t


def first_warning(readings, vital):
    for k in range(120, len(readings), 5):            # the server re-forecasts every 5 s
        window_ = [r for r in readings[:k + 1] if readings[k]["ts"] - r["ts"] <= 600]
        for p in predict.forecast(window_):
            if p["vital"] == vital:
                return k / 60.0, p["eta_min"]
    return None, None


def experiment_b(n=120):
    rng = np.random.default_rng(7)
    out = {}
    for kind, vital, limit, sign in (("rise", "temp", 38.0, +1), ("spo2drop", "spo2", 92.0, -1)):
        leads, eta_err, missed = [], [], 0
        for _ in range(n):
            rd, t = trajectory(rng, kind)
            # true crossing time of the underlying (noise-free) trend, via the clean signal
            vals = np.array([r[vital] for r in rd])
            smooth = np.convolve(vals, np.ones(30) / 30, mode="same")
            idx = np.where(sign * (smooth - limit) >= 0)[0]
            idx = idx[idx > 30]
            if len(idx) == 0:
                continue
            cross = idx[0] / 60.0
            w_at, eta = first_warning(rd, vital)
            if w_at is None or w_at > cross:
                missed += 1
                continue
            leads.append(cross - w_at)
            eta_err.append(abs((w_at + eta) - cross))
        out[vital] = {"trajectories": len(leads) + missed, "warned_before_crossing": len(leads),
                      "missed": missed, "lead_median_min": float(np.median(leads)) if leads else None,
                      "lead_p10_min": float(np.percentile(leads, 10)) if leads else None,
                      "eta_abs_error_median_min": float(np.median(eta_err)) if eta_err else None}
    fp = {}
    for kind in ("stable", "step"):
        false = 0
        for _ in range(n):
            rd, _ = trajectory(rng, kind)
            w_at, _ = first_warning(rd, "temp")
            false += w_at is not None
        fp[kind] = {"trajectories": n, "false_warnings": false}
    out["no_rise"] = fp
    OUT["B"] = out


# --------------------------------------------------------------- C
def experiment_c(n=300):
    rng = np.random.default_rng(99)
    quality._model = None
    res = {}
    for label, kw, jump in (("clean", dict(noise=None, motion=0), 2), ("motion", dict(noise=None, motion=1), 18),
                            ("poor placement", dict(noise=None, motion=0, weak=True), 10)):
        accepted = 0
        for _ in range(n):
            bpm = rng.uniform(50, 140)
            ac = rng.uniform(0.0005, 0.002) if kw.get("weak") else rng.uniform(0.006, 0.03)
            noise = rng.uniform(0.001, 0.004) if (kw.get("motion") or kw.get("weak")) else rng.uniform(0.0002, 0.0012)
            motion = rng.uniform(0.6, 2.0) if kw.get("motion") else 0.0
            w = synth.ppg_wave(5, bpm, ac_ratio=ac, noise=noise, motion=motion, rng=rng)
            q = quality.score(w, abs(rng.normal(0, jump)))
            accepted += q >= 40
        res[label] = {"n": n, "accepted": accepted}
    OUT["C"] = res


# --------------------------------------------------------------- D
def experiment_d():
    X, y = synth.window_examples(n_per_class=300, rng=np.random.default_rng(31))
    m = state._get()
    pred = m.predict(X)
    labels = list(m.classes_)
    cm = {a: {b: int(((y == a) & (pred == b)).sum()) for b in labels} for a in labels}
    OUT["D"] = {"n": int(len(y)), "accuracy": float((pred == y).mean()), "confusion": cm}


if __name__ == "__main__":
    t = time.time()
    experiment_a(); print("A done")
    experiment_b(); print("B done")
    experiment_c(); print("C done")
    experiment_d(); print("D done")
    OUT["seconds_total"] = round(time.time() - t, 1)
    path = os.path.join(ROOT, "validation", "results_ml.json")
    with open(path, "w") as f:
        json.dump(OUT, f, indent=2, ensure_ascii=False)
    print(json.dumps(OUT, indent=2, ensure_ascii=False))
