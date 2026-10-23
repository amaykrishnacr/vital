"""SQLite database: schema and small helper functions."""
import os
import sqlite3
import time
from werkzeug.security import generate_password_hash

import config

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "vital.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',          -- 'user' or 'admin'
    ward TEXT DEFAULT 'Ward 3',
    emergency_chat TEXT DEFAULT '',             -- Telegram chat id
    emergency_name TEXT DEFAULT '',
    temp_offset REAL DEFAULT 2.4,
    created REAL
);
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_key TEXT UNIQUE NOT NULL,            -- e.g. 'vital-01'
    last_seen REAL,
    rssi INTEGER,
    ip TEXT,
    fw TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_id INTEGER,
    start REAL NOT NULL,
    end REAL
);
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER, user_id INTEGER, ts REAL,
    bpm REAL, spo2 REAL, temp REAL, skin REAL, ambient REAL,
    ir INTEGER, red INTEGER, quality REAL
);
CREATE INDEX IF NOT EXISTS idx_readings_user_ts ON readings(user_id, ts);
CREATE TABLE IF NOT EXISTS windows (            -- one row per 10-second window
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, session_id INTEGER, ts REAL,
    hr_mean REAL, hr_std REAL, hr_min REAL, hr_max REAL,
    spo2_mean REAL, temp_mean REAL, quality REAL,
    anomaly REAL, state TEXT
);
CREATE INDEX IF NOT EXISTS idx_windows_user_ts ON windows(user_id, ts);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER, ts REAL,
    level TEXT,                                 -- 'critical' or 'warning'
    kind TEXT, reason TEXT,
    sent_to TEXT, delivered INTEGER DEFAULT 0,
    acknowledged INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT
);
"""


def connect():
    os.makedirs(DATA_DIR, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=15, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def query(sql, args=(), one=False):
    con = connect()
    try:
        rows = [dict(r) for r in con.execute(sql, args).fetchall()]
    finally:
        con.close()
    return (rows[0] if rows else None) if one else rows


def execute(sql, args=()):
    con = connect()
    try:
        cur = con.execute(sql, args)
        con.commit()
        return cur.lastrowid
    finally:
        con.close()


def executemany(sql, rows):
    con = connect()
    try:
        con.executemany(sql, rows)
        con.commit()
    finally:
        con.close()


def get_setting(key, default=None):
    row = query("SELECT value FROM settings WHERE key=?", (key,), one=True)
    return row["value"] if row else default


def set_setting(key, value):
    execute("INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, str(value)))


def init_db():
    """Create tables, and the default accounts on first run."""
    con = connect()
    con.executescript(SCHEMA)
    con.commit()
    count = con.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count == 0:
        now = time.time()
        accounts = [
            ("admin", "Admin", "admin123", "admin", "Ward 3"),
            ("member1", "Member 1", "vital123", "user", "Ward 3"),
            ("member2", "Member 2", "vital123", "user", "Ward 1"),
            ("member3", "Member 3", "vital123", "user", "Ward 5"),
            ("member4", "Member 4", "vital123", "user", "Ward 6"),
        ]
        for username, name, pw, role, ward in accounts:
            con.execute(
                "INSERT INTO users(username, name, password_hash, role, ward, temp_offset, created) "
                "VALUES(?,?,?,?,?,?,?)",
                (username, name, generate_password_hash(pw), role, ward, config.DEFAULT_TEMP_OFFSET, now))
        con.commit()
        print("Created default accounts: admin/admin123 and member1..member4/vital123")
    con.close()
