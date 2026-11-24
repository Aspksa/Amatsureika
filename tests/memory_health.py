import sys
import tempfile
import sqlite3
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore

with tempfile.TemporaryDirectory() as directory:
    path=Path(directory)/"test.db"
    store=ChatStore(path)
    assert store.health()["ok"]
    req={"text":"test","request_id":str(uuid4())}
    store.append(req)
    assert ChatStore(path).append(req)["duplicate"]
    with sqlite3.connect(path) as db:
        try:
            db.execute("INSERT INTO chat_messages(cluster_id,position,role,text,created_at,request_id) VALUES(1,201,'user','x','now','x')")
            raise AssertionError("capacity violation accepted")
        except sqlite3.IntegrityError: pass
        db.execute("DELETE FROM chat_messages WHERE role='assistant'")
    bad=ChatStore(path)
    assert not bad.health()["ok"]
    try:
        bad.append({"text":"x","request_id":str(uuid4())})
        raise AssertionError("unsafe write")
    except RuntimeError: pass

# Large fixture is inserted in one transaction; measures integrity, not HTTP throughput.
with tempfile.TemporaryDirectory() as directory:
    path=Path(directory)/"large.db"
    store=ChatStore(path)
    with sqlite3.connect(path) as db:
        for c in range(1,501):
            db.execute("INSERT INTO chat_clusters(id,previous_id,created_at) VALUES(?,?,?)",(c,c-1 if c>1 else None,"now"))
            db.executemany("INSERT INTO chat_messages(cluster_id,position,role,text,created_at,request_id) VALUES(?,?,?,?,?,?)", ((c,n,"user" if n%2 else "assistant","test","now",f"{c}-{(n+1)//2}") for n in range(1,201)))
        db.execute("INSERT INTO chat_clusters(id,previous_id,created_at) VALUES(501,500,'now')")
    health=ChatStore(path).health()
    assert health["ok"] and health["messages"]==100000 and health["active_cluster"]==501,health
print("Memory health, crash-safe retry, database guard and 100000-message fixture passed")
