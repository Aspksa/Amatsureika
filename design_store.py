"""Portable appearance settings, stored locally independent of HTTP port."""
import json
import math
import sqlite3
from pathlib import Path

DEFAULTS = dict(speed=1, glow=65, density=50, depth=65, texture=35, motion=75, textMotion=60)

def normalize(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError("Invalid settings keys")
    result = {}
    for key, number in value.items():
        if type(number) not in (int, float) or not math.isfinite(number):
            raise ValueError("Invalid number")
        low, high = (.25, 2) if key == "speed" else (0, 100)
        if not low <= number <= high:
            raise ValueError("Out of range")
        result[key] = number
    return result

class DesignStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    def load(self):
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT value FROM preferences WHERE key = 'design'").fetchone()
        if not row:
            return DEFAULTS.copy()
        try:
            return normalize({**DEFAULTS, **json.loads(row[0])})
        except (ValueError, TypeError):
            return DEFAULTS.copy()
    def save(self, value):
        value = normalize(value)
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO preferences VALUES ('design', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(value),))
        return value

    def load_camera(self):
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT value FROM preferences WHERE key = 'camera'").fetchone()
        if row:
            try:
                return normalize_camera(json.loads(row[0]))
            except (ValueError, TypeError, OverflowError):
                pass
        return CAMERA_DEFAULT.copy()

    def save_camera(self, value):
        value = normalize_camera(value)
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO preferences VALUES ('camera', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (json.dumps(value),))
        return value

CAMERA_DEFAULT = dict(zoom=1, tx=0, ty=0, mode=None)

def normalize_camera(value):
    if not isinstance(value, dict) or set(value) != set(CAMERA_DEFAULT):
        raise ValueError("Invalid camera keys")
    if value["mode"] not in ("compact", "radial", "hex"):
        raise ValueError("Invalid mode")
    for key, low, high in (("zoom", .025, 64), ("tx", -1e6, 1e6), ("ty", -1e6, 1e6)):
        n = value[key]
        if type(n) not in (int, float) or not math.isfinite(n) or not low <= n <= high:
            raise ValueError("Invalid camera coordinate")
    return value
