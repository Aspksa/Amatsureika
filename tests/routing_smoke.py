import io
import tempfile
import sys
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from workspace import Workspace
from cloud_client import Cloud
from routing import Router

with tempfile.TemporaryDirectory() as d:
    path=Path(d)/"memory.db"
    chat=ChatStore(path); ws=Workspace(path); calls=[]
    def fake(method,endpoint,key,payload=None):
        calls.append((method,endpoint,payload))
        if endpoint=="/models":return {"data":[{"id":"mock"}]}
        return {"choices":[{"message":{"content":"mock response"}}]}
    cloud=Cloud(path,fake); cloud.save_key({"key":"test-key","persist":False});cloud.load_models();cloud.select({"model":"mock"})
    chat.append({"text":"Секретное слово альбатрос","request_id":str(uuid4())})
    router=Router(chat,ws,cloud)
    assert router.fts
    def plan(text):
        req={"text":text,"request_id":str(uuid4())}
        return req,router.plan(req)
    def execute(req,p,paid=False):
        return router.execute({**req,"token":p["token"],"cloud":paid})
    req,p=plan("Найди альбатрос")
    assert p["sufficient"] and p["hits"][0]["source"]=="memory" and p["hits"][0]["id"]==1
    assert execute(req,p,True)["route"]=="local" and len(calls)==1
    assert execute(req,p)["duplicate"]
    chat.append({"text":"Новый термин горностай","request_id":str(uuid4())})
    assert plan("Найди горностай")[1]["hits"]
    staff=ws.save_work({"kind":"staff","fields":{"name":"Петров","job":"Водитель","number":"7"}})["id"]
    file=ws.upload(None,"отчёт.txt",io.BytesIO("Турбина работает".encode()),len("Турбина работает".encode()))["id"]
    assert any(h["source"]=="work" and h["id"]==staff for h in plan("Найди Петров")[1]["hits"])
    assert any(h["source"]=="file" and h["id"]==file for h in plan("Найди турбина")[1]["hits"])
    req,p=plan("Объясни турбина")
    assert not p["sufficient"] and "Турбина работает" in p["context"]
    assert execute(req,p,True)["route"]=="cloud"
    assert len(calls)==2 and p["context"] in calls[-1][2]["messages"][1]["content"]
    ws.disk_action({"action":"trash","id":file})
    assert not any(h["source"]=="file" for h in plan("Найди турбина")[1]["hits"])
    ws.save_work({"kind":"staff","id":staff,"archived":True})
    assert not any(h["source"]=="work" for h in plan("Найди Петров")[1]["hits"])
    req,p=plan("Найди неизвестныймаркер")
    assert not p["sufficient"] and not p["hits"]
    assert execute(req,p)["route"]=="local" and len(calls)==2
    req,p=plan("Найди орёл")
    try: execute({**req,"text":"другой текст"},p,True)
    except ValueError: pass
    else: raise AssertionError("changed plan accepted")
    assert chat.health()["ok"]
print("FTS backfill/increment, work and file retrieval, local sufficiency, consent-bound cloud, trash/archive, duplicate and integrity passed")
