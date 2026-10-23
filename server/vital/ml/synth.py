"""Synthetic data used to pre-train the support models.

Real labelled data from four people is small, so the state classifier and the
signal-quality model start from generated examples with realistic ranges.
They can be retrained later on real labelled sessions.
"""
import numpy as np

FS = 25  # waveform samples per second sent by the device


def ppg_wave(seconds, bpm, fs=FS, dc=110000.0, ac_ratio=0.012, noise=0.0008,
             motion=0.0, rng=None, phase=0.0):
    """Generate a photoplethysmogram-like IR signal (pulse + dicrotic notch)."""
    rng = rng or np.random.default_rng()
    n = int(seconds * fs)
    t = np.arange(n) / fs
    beat = (t * bpm / 60.0 + phase) % 1.0
    pulse = np.exp(-((beat - 0.18) / 0.07) ** 2) + 0.38 * np.exp(-((beat - 0.42) / 0.09) ** 2)
    x = dc * (1 + ac_ratio * pulse)
    x += dc * noise * rng.standard_normal(n)
    if motion > 0:
        # motion artefacts: slow drift + sudden jumps much larger than the pulse
        drift = np.cumsum(rng.standard_normal(n)) * dc * 0.002 * motion
        jumps = (rng.random(n) < 0.04 * motion) * rng.standard_normal(n) * dc * 0.03 * motion
        x += drift + np.cumsum(jumps) * 0.3 + jumps
    return x


def window_examples(n_per_class=600, rng=None):
    """Feature rows [hr_mean, hr_std, spo2_mean, temp_mean] with state labels."""
    rng = rng or np.random.default_rng(7)
    X, y = [], []
    specs = {
        "Resting":        dict(hr=(55, 95), hrs=(0.8, 3.5), spo2=(95, 100), temp=(36.1, 37.4)),
        "Elevated":       dict(hr=(100, 150), hrs=(2.0, 7.0), spo2=(94, 100), temp=(36.3, 37.6)),
        "Possible fever": dict(hr=(80, 125), hrs=(1.0, 4.0), spo2=(93, 99), temp=(37.8, 39.8)),
        "Low oxygen":     dict(hr=(60, 125), hrs=(1.0, 5.0), spo2=(80, 92), temp=(36.0, 37.6)),
    }
    for label, s in specs.items():
        for _ in range(n_per_class):
            X.append([rng.uniform(*s["hr"]), rng.uniform(*s["hrs"]),
                      rng.uniform(*s["spo2"]), rng.uniform(*s["temp"])])
            y.append(label)
    return np.array(X), np.array(y)
