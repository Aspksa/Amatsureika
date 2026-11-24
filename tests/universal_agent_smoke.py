import sys,tempfile,io,time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
from workspace import Workspace
from chat_store import ChatStore
from cloud_client import Cloud
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);r=Router(c,w,Cloud(p));a=r.agent
    steps=[{"id":"first","tool":"staff","month":"","depends":[]},{"id":"fallback","tool":"vehicles","month":"","depends":["first"],"condition":"any_error"}]
    with patch.object(a,"one",wraps=a.one) as mock:
        assert a.preview(steps)["layers"]==[["first"],["fallback"]] and not mock.called
        out=a.run(steps);assert out["ok"] and out["steps"][1]["status"]=="skipped"
    with patch.object(a,"one",side_effect=[{"status":"error","text":"x","sources":[]},{"status":"ok","text":"y","sources":[]}]):
        out=a.run(steps);assert not out["ok"] and out["steps"][1]["status"]=="ok"
    sc=a.save_scenario({"name":"New files","steps":steps[:1]})["id"]
    rule=a.rule_action({"action":"add","scenario":sc,"mode":"new_files","minutes":60,"file":None,"current_month":False,"draft":True,"confirm":True})["id"]
    now=time.time()+3601
    assert a.tick_rules(now) and not a.tick()
    w.upload(None,"new.txt",io.BytesIO(b"hello"),5)
    assert a.tick_rules(now+3601) and a.tick()
    assert a.state()["jobs"][0]["result"]["draft"]
    a.rule_action({"action":"disable","id":rule,"confirm":True})
    assert c.health()["ok"]
print("Conditional workflows, dry preview and new-file trigger passed")
