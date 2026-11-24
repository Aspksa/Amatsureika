"""Chronological chat clusters, 200 committed messages each, one local SQLite DB."""
import sqlite3
import logging
from contextlib import closing
from datetime import datetime, timezone
from uuid import UUID

CAPACITY = 200
LOCAL_REPLY = "Сообщение сохранено в локальной памяти. Облачная модель пока не подключена."

class ChatStore:
    def __init__(self, path):
        self.path = path
        with closing(self.connect()) as db, db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS chat_clusters (
                    id INTEGER PRIMARY KEY, previous_id INTEGER UNIQUE REFERENCES chat_clusters(id),
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY, cluster_id INTEGER NOT NULL REFERENCES chat_clusters(id),
                    position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 200),
                    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
                    text TEXT NOT NULL, created_at TEXT NOT NULL, request_id TEXT NOT NULL,
                    UNIQUE(cluster_id, position), UNIQUE(request_id, role)
                );
                CREATE TRIGGER IF NOT EXISTS chat_capacity_insert BEFORE INSERT ON chat_messages
                WHEN NEW.position < 1 OR NEW.position > 200 OR
                     (SELECT COUNT(*) FROM chat_messages WHERE cluster_id=NEW.cluster_id) >= 200
                BEGIN SELECT RAISE(ABORT,'Cluster capacity exceeded'); END;
                CREATE TRIGGER IF NOT EXISTS chat_capacity_update BEFORE UPDATE OF cluster_id,position ON chat_messages
                WHEN NEW.position < 1 OR NEW.position > 200 OR
                     (NEW.cluster_id != OLD.cluster_id AND (SELECT COUNT(*) FROM chat_messages WHERE cluster_id=NEW.cluster_id) >= 200)
                BEGIN SELECT RAISE(ABORT,'Cluster capacity exceeded'); END;
            """)
        self.startup_health = self.health()
        if not self.startup_health["ok"]:
            logging.error("Chat integrity failure: %s", self.startup_health["issues"])

    def health(self):
        issues = []
        with closing(self.connect()) as db, db:
            db.execute("BEGIN")
            if [row[0] for row in db.execute("PRAGMA quick_check")] != ["ok"]:
                issues.append("sqlite_integrity")
            if db.execute("PRAGMA foreign_key_check").fetchone():
                issues.append("foreign_keys")
            clusters = self.clusters(db)
            total = 0
            previous = None
            for i, c in enumerate(clusters):
                total += c["count"]
                if c["previous_id"] != previous or not 0 <= c["count"] <= CAPACITY or (i < len(clusters)-1 and c["count"] != CAPACITY):
                    issues.append("cluster_chain")
                    break
                previous = c["id"]
            if clusters and clusters[-1]["count"] == CAPACITY:
                issues.append("missing_successor")
            if db.execute("""SELECT 1 FROM chat_messages GROUP BY cluster_id
                         HAVING MIN(position) != 1 OR MAX(position) != COUNT(*) LIMIT 1""").fetchone():
                issues.append("message_positions")
            if db.execute("""SELECT 1 FROM chat_messages GROUP BY request_id
                         HAVING COUNT(*) != 2 OR SUM(role='user') != 1 OR SUM(role='assistant') != 1 LIMIT 1""").fetchone():
                issues.append("message_pairs")
            if total != db.execute("SELECT COUNT(*) FROM chat_messages").fetchone()[0]:
                issues.append("message_count")
            return {"ok": not issues, "issues": sorted(set(issues)), "clusters": len(clusters), "messages": total,
                    "active_cluster": clusters[-1]["id"] if clusters else None}

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def clusters(self, db):
        return [dict(row) for row in db.execute("""
            SELECT c.id, c.previous_id, COUNT(m.id) AS count
            FROM chat_clusters c LEFT JOIN chat_messages m ON m.cluster_id=c.id
            GROUP BY c.id ORDER BY c.id
        """)]

    def snapshot(self, cluster=None):
        with closing(self.connect()) as db, db:
            db.execute("BEGIN")
            clusters = self.clusters(db)
            if cluster is None:
                rows = db.execute("SELECT * FROM chat_messages ORDER BY id DESC LIMIT 400").fetchall()[::-1]
            else:
                if not any(c["id"] == cluster for c in clusters):
                    raise ValueError("Unknown cluster")
                rows = db.execute("SELECT * FROM chat_messages WHERE cluster_id=? ORDER BY position", (cluster,)).fetchall()
            return {"clusters": clusters, "messages": [dict(row) for row in rows]}

    def append(self, value):
        if not self.startup_health["ok"]:
            raise RuntimeError("Chat integrity check failed; writes disabled")
        if not isinstance(value, dict) or set(value) != {"text", "request_id"}:
            raise ValueError("Invalid message")
        text, rid = value["text"], value["request_id"]
        if not isinstance(text, str) or not text.strip() or len(text) > 1000:
            raise ValueError("Invalid text")
        if not isinstance(rid, str) or str(UUID(rid)) != rid:
            raise ValueError("Invalid request")
        text = text.strip()
        text.encode("utf-8")
        now = datetime.now(timezone.utc).isoformat()
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM chat_messages WHERE request_id=? ORDER BY id", (rid,)).fetchall()
            if existing:
                if existing[0]["text"] != text:
                    raise ValueError("Request already used")
                return {"clusters": self.clusters(db), "messages": [dict(row) for row in existing], "duplicate": True}
            last = db.execute("SELECT id FROM chat_clusters ORDER BY id DESC LIMIT 1").fetchone()
            cid = last["id"] if last else db.execute("INSERT INTO chat_clusters(previous_id,created_at) VALUES(NULL,?)", (now,)).lastrowid
            n = db.execute("SELECT COUNT(*) FROM chat_messages WHERE cluster_id=?", (cid,)).fetchone()[0]
            saved = []
            for role, body in (("user", text), ("assistant", LOCAL_REPLY)):
                if n >= CAPACITY:
                    cid = db.execute("INSERT INTO chat_clusters(previous_id,created_at) VALUES(?,?)", (cid, now)).lastrowid
                    n = 0
                n += 1
                row = db.execute("INSERT INTO chat_messages(cluster_id,position,role,text,created_at,request_id) VALUES(?,?,?,?,?,?)",
                                 (cid,n,role,body,now,rid))
                saved.append(dict(db.execute("SELECT * FROM chat_messages WHERE id=?", (row.lastrowid,)).fetchone()))
            if n == CAPACITY:
                db.execute("INSERT INTO chat_clusters(previous_id,created_at) VALUES(?,?)", (cid,now))
            return {"clusters": self.clusters(db), "messages": saved, "duplicate": False}
