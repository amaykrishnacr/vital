"""Login helpers."""
from functools import wraps

from flask import jsonify, redirect, request, session, url_for

from . import db


def current_user():
    uid = session.get("uid")
    return db.query("SELECT * FROM users WHERE id=?", (uid,), one=True) if uid else None


def login_required(role=None):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            user = current_user()
            is_api = request.path.startswith("/api/")
            if not user:
                return (jsonify({"error": "login required"}), 401) if is_api else redirect(url_for("pages.login"))
            if role and user["role"] != role:
                return (jsonify({"error": "not allowed"}), 403) if is_api else redirect(url_for("pages.home"))
            return fn(user, *a, **kw)
        return wrapper
    return deco
