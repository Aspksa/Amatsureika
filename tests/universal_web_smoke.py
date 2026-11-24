import sys,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
from workspace import Workspace
from chat_store import ChatStore
from cloud_client import Cloud
from unittest.mock import patch
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";r=Router(ChatStore(p),Workspace(p),Cloud(p))
    urls=["https://example.com/a","https://example.org/b"]
    def read(url):return {"url":url,"title":"Test","text":"SSD 512 GB\nЦена 2500 руб.","fetched":"2026-01-01"}
    with patch.object(r.web,"read",side_effect=read) as mock:
        v={"action":"compare","urls":urls,"query":"SSD","confirm":False}
        try:r.web.dispatch(v)
        except ValueError:pass
        else:raise AssertionError("consent")
        assert not mock.called
        out=r.web.dispatch({**v,"confirm":True})
        assert mock.call_count==2 and len(out["comparison"])==2
        assert out["comparison"][0]["prices"] and out["comparison"][0]["excerpts"]
print("Explicit URLs, literal prices and source comparison passed")
