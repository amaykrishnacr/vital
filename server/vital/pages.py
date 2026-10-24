"""HTML pages."""
from flask import Blueprint, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

import config
from . import db
from .auth import current_user, login_required

pages = Blueprint("pages", __name__)


@pages.route("/")
def home():
    user = current_user()
    if not user:
        return redirect(url_for("pages.login"))
    return redirect(url_for("pages.admin_station" if user["role"] == "admin" else "pages.live"))


@pages.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        u = db.query("SELECT * FROM users WHERE username=?", (request.form.get("username", "").strip().lower(),), one=True)
        if u and check_password_hash(u["password_hash"], request.form.get("password", "")):
            session["uid"] = u["id"]
            return redirect(url_for("pages.home"))
        error = "Wrong username or password"
    return render_template("login.html", error=error)


@pages.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("pages.login"))


@pages.route("/live")
@login_required("user")
def live(user):
    return render_template("live.html", user=user, page="live")


@pages.route("/history")
@login_required("user")
def history(user):
    return render_template("history.html", user=user, page="history")


@pages.route("/admin")
@login_required("admin")
def admin_station(user):
    return render_template("admin_station.html", user=user, page="station")


@pages.route("/admin/alerts")
@login_required("admin")
def admin_alerts(user):
    return render_template("admin_alerts.html", user=user, page="alerts")


@pages.route("/admin/users")
@login_required("admin")
def admin_users(user):
    return render_template("admin_users.html", user=user, page="users")


@pages.route("/admin/city")
@login_required("admin")
def admin_city(user):
    return render_template("admin_city.html", user=user, page="city", city=config.CITY_NAME)


@pages.route("/admin/demo")
@login_required("admin")
def admin_demo(user):
    return render_template("admin_demo.html", user=user, page="demo")
