"""Health-state classifier: Resting, Elevated, Possible fever or Low oxygen.

A small decision tree on four window features. It starts from generated
examples (see synth.py) because four people cannot produce labelled fever or
low-oxygen sessions safely.
"""
import numpy as np
from sklearn.tree import DecisionTreeClassifier

from . import synth

_model = None


def _get():
    global _model
    if _model is None:
        X, y = synth.window_examples()
        _model = DecisionTreeClassifier(max_depth=5, min_samples_leaf=10, random_state=0)
        _model.fit(X, y)
    return _model


def classify(w):
    """w: window dict -> (state, confidence 0-1)."""
    m = _get()
    x = np.array([[w["hr_mean"], w["hr_std"], w["spo2_mean"], w["temp_mean"]]])
    proba = m.predict_proba(x)[0]
    i = int(np.argmax(proba))
    return str(m.classes_[i]), float(proba[i])
