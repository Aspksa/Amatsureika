import io,sys,tempfile,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
from workspace import Workspace
from chat_store import ChatStore
from cloud_client import Cloud
from cognitive_tools import series_analysis,cached_series
assert series_analysis([1,2,3,4],2)["seasonality"] is None
assert series_analysis([10,20,12,22,14,24],2)["seasonality"]["cycles"]==3
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);r=Router(c,w,Cloud(p));t=r.cognitive
    def upload(name,raw):return w.upload(None,name,io.BytesIO(raw),len(raw))["id"]
    a=upload("a.csv",b"id;value\n1;10\n2;20\n")
    assert t.dispatch({"action":"profile","file":a})["rows"]==2
    result=t.dispatch({"action":"stats","values":[1,2,3]});result["values"][0]=0
    assert t.dispatch({"action":"stats","values":[1,2,3]})["values"][0]==1
    try:t.dispatch({"action":"convert","file":a,"format":"json","confirm":False})
    except ValueError:pass
    else:raise AssertionError("no consent")
    out=t.dispatch({"action":"convert","file":a,"format":"json","confirm":True})
    assert json.loads(w.download(out["id"])[0].read_text())[0]["value"]=="10"
    b=upload("b.txt",b"Engine: turbo\ncommonword")
    c2=upload("c.txt",b"Engine: petrol\ncommonword")
    result=t.dispatch({"action":"research_docs","files":[b,c2]})
    assert result["links"][0]["possible_conflicts"]
    assert c.health()["ok"]
print("Bounded statistics cache, seasonal series, table profile, conversion and document links passed")
