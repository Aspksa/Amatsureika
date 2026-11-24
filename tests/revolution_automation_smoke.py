import io,sys,tempfile,time,json
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
from workspace import Workspace
from chat_store import ChatStore
from cloud_client import Cloud
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);r=Router(c,w,Cloud(p));a=r.agent
    steps=[{"id":"s1","tool":"staff","month":"","depends":[]}]
    sc=a.save_scenario({"name":"Staff","steps":steps})["id"]
    v={"action":"add","scenario":sc,"mode":"interval","minutes":60,"file":None,"current_month":False,"draft":True,"confirm":True}
    try:a.rule_action({**v,"confirm":False})
    except ValueError:pass
    else:raise AssertionError("no consent")
    rule=a.rule_action(v)["id"]
    now=time.time()+3601
    assert a.tick_rules(now) and not a.tick_rules(now)
    assert a.tick()
    state=a.state();job=state["jobs"][0];assert job["status"]=="done" and "ЧЕРНОВИК" in job["result"]["draft"]
    a.rule_action({"action":"disable","id":rule,"confirm":True})
    raw=b"indexmarker";f=w.upload(None,"a.txt",io.BytesIO(raw),len(raw))["id"]
    a.rule_action({**v,"mode":"file","file":f})
    assert a.tick_rules(now) and not a.tick()
    path,_,_=w.download(f);path.write_bytes(b"indexchange")
    assert a.tick_rules(now+3601) and a.tick()
    r.background_index()
    assert any(h["id"]==f for h in r.search("indexchange","file"))
    assert c.health()["ok"]
print("Recurring rules, consent, file changes, durable drafts, and background index passed")
