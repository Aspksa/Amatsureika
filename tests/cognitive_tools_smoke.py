import sys,tempfile,io
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from workspace import Workspace
from cloud_client import Cloud
from routing import Router
from cognitive_tools import analyze,deduce,decisions
assert analyze([1,2,3])["next_linear_estimate"]==4
f=[["A","type","vehicle"]];r=[{"if":f,"then":["A","needs","inspection"]},{"if":[["A","needs","inspection"]],"then":["A","status","pending"]}]
assert len(deduce(f,r)["conclusions"])==2
assert not deduce(f+[["A","type","other"]],r)["valid"]
d=decisions([{"name":"A","outcomes":[{"probability":.5,"value":-2},{"probability":.5,"value":8}]},{"name":"B","outcomes":[{"probability":1,"value":2}]}])
assert d["options"][0]["name"]=="A" and d["options"][0]["loss_probability"]==.5
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";w=Workspace(p);c=ChatStore(p);router=Router(c,w,Cloud(p));t=router.cognitive
    def upload(name,raw):return w.upload(None,name,io.BytesIO(raw),len(raw))["id"]
    a=upload("a.csv",b"id;cost\n1;10\n2;20\n")
    b=upload("b.csv",b"id;cost\n1;15\n3;30\n")
    out=t.dispatch({"action":"compare","a":a,"b":b,"key":"id"})
    assert out["added"]==["3"] and out["removed"]==["2"] and out["changed_count"]==1
    assert t.dispatch({"action":"column","file":a,"column":"cost"})["sum"]==30
    file=upload("test.txt",b"# Heading\nName: Test\n")
    assert t.dispatch({"action":"document","file":file})["candidate_facts"][0]["state"]=="candidate"
    try:t.dispatch({"action":"draft","title":"Test","body":"Text","confirm":False})
    except ValueError:pass
    else:raise AssertionError("Draft without approval")
    result=t.dispatch({"action":"draft","title":"Test","body":"Text","confirm":True})
    assert w.download(result["id"])[1].endswith(".docx")
    assert t.dispatch({"action":"performance"})["metrics"]
print("Statistics, deduction, decision risk, table comparison, candidates, draft approval and journal passed")
