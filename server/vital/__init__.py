"""VITAL web application."""
from flask import Flask

import config
from . import db
from .ml import anomaly, quality, state


def create_app():
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.secret_key = config.SECRET_KEY
    app.json.sort_keys = False
    db.init_db()
    anomaly.load_all()
    state._get()                 # train the small support models once at start-up
    quality.score([1.0] * 50)

    from .pages import pages
    from .api import api
    app.register_blueprint(pages)
    app.register_blueprint(api)
    return app
