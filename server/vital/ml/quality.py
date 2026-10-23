"""Signal-quality model: is this a clean pulse, or a moving / badly placed finger?

Features come from the last few seconds of the raw IR waveform:
  perfusion index  - pulse size relative to the steady (DC) light level
  roughness        - jagged noise relative to the pulse size (motion)
  bpm jump         - how much heart rate changed since the last reading
A logistic regression trained on generated clean and noisy waveforms turns
these into a 0-100 quality score.
"""
import numpy as np
from sklearn.linear_model import LogisticRegression

from . import synth

_model = None


def wave_features(wave, bpm_jump=0.0):
    x = np.asarray(wave, dtype=float)
    if len(x) < 20 or np.mean(x) <= 0:
        return [0.0, 5.0, bpm_jump]
    lo, hi = np.percentile(x, 5), np.percentile(x, 95)
    amp = max(hi - lo, 1e-6)
    pi = amp / np.mean(x) * 100.0
    rough = float(np.std(np.diff(x, n=2)) / amp)
    return [float(pi), rough, float(bpm_jump)]


def _train():
    rng = np.random.default_rng(11)
    X, y = [], []
    for _ in range(700):  # clean
        bpm = rng.uniform(50, 140)
        w = synth.ppg_wave(5, bpm, ac_ratio=rng.uniform(0.006, 0.03), noise=rng.uniform(0.0002, 0.0012), rng=rng)
        X.append(wave_features(w, abs(rng.normal(0, 2)))); y.append(1)
    for _ in range(350):  # moving finger
        bpm = rng.uniform(50, 140)
        w = synth.ppg_wave(5, bpm, ac_ratio=rng.uniform(0.006, 0.03), noise=rng.uniform(0.001, 0.004),
                           motion=rng.uniform(0.6, 2.0), rng=rng)
        X.append(wave_features(w, abs(rng.normal(0, 18)))); y.append(0)
    for _ in range(350):  # badly placed: tiny pulse buried in noise
        bpm = rng.uniform(50, 140)
        w = synth.ppg_wave(5, bpm, ac_ratio=rng.uniform(0.0005, 0.002), noise=rng.uniform(0.001, 0.003), rng=rng)
        X.append(wave_features(w, abs(rng.normal(0, 10)))); y.append(0)
    X = np.array(X)
    X[:, 0] = np.log1p(X[:, 0])
    X[:, 1] = np.log1p(X[:, 1])
    model = LogisticRegression(max_iter=1000)
    model.fit(X, np.array(y))
    return model


def score(wave, bpm_jump=0.0, finger=True):
    """Return signal quality 0-100."""
    global _model
    if not finger:
        return 0.0
    if _model is None:
        _model = _train()
    f = np.array([wave_features(wave, bpm_jump)])
    f[:, 0] = np.log1p(f[:, 0])
    f[:, 1] = np.log1p(f[:, 1])
    return float(_model.predict_proba(f)[0, 1] * 100.0)
