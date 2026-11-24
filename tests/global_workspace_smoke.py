import io,sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
from chat_store import ChatStore
from workspace import Workspace
from cloud_client import Cloud
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";w=Workspace(p);r=Router(ChatStore(p),w,Cloud(p));x=r.workspace_intelligence
    a=w.disk_action({"action":"folder","parent":None,"name":"A"})["id"]
    b=w.disk_action({"action":"folder","parent":a,"name":"B"})["id"]
    try:w.disk_action({"action":"move","id":a,"parent":b})
    except ValueError:pass
    else:raise AssertionError("cycle")
    f=w.upload(a,"one.txt",io.BytesIO(b"contract"),8)["id"]
    g=w.upload(b,"two.txt",io.BytesIO(b"contract"),8)["id"]
    assert len(x.duplicates()["groups"])==1
    assert x.preview(f)["text"]=="contract"
    assert x.classify()["items"][0]["tags"]
    w.disk_action({"action":"move","id":g,"parent":None})
    assert next(i for i in x.tree()["items"] if i["id"]==g)["parent"] is None
    data={"kind":"staff","fields":{"name":"Иван","job":"Водитель","number":"1"}}
    i=w.save_work(data)["id"]
    w.save_work({**data,"id":i,"fields":{**data["fields"],"job":"Механик"}})
    w.save_work({"kind":"timesheet","fields":{"employee":i,"date":"2026-11-24","hours":8,"note":""}})
    record=x.record(i)
    assert len(record["versions"])==2 and record["related_total"]==1
    assert x.garage("2026-11")["hours"]=="8"
    assert r.chat.health()["ok"]
print("Disk tree/move, exact duplicates, classification, previews, garage totals and actual record revisions passed")
