import sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from routing import Router
from workspace import Workspace
from chat_store import ChatStore
from cloud_client import Cloud
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";r=Router(ChatStore(p),Workspace(p),Cloud(p));k=r.knowledge
    v={"kind":"fact","subject":"Двигатель","predicate":"цвет","value":"белый","context":"","expires":""}
    i=k.add(v)["id"];k.add(v)
    assert len(k.search("Двигатель")[0]["sources"])==1
    k.review({"id":i,"state":"confirmed","confidence":1,"confirm":True})
    with patch.object(r.cloud,"embed",return_value=[1.0]+[0.0]*1023) as mock:
        k.embed_item(i,k.embedding_preview(i)["text"])
        assert k.semantic("цвет")[0]["id"]==i
        assert k.fusion("цвет")[0]["semantic_score"]==1
        assert k.context("цвет")
        assert mock.call_count==2
    assert k.health()["frequent_context"][0]["id"]==i
    k.review({"id":i,"state":"rejected","confidence":0,"confirm":True})
    assert not k.fusion("цвет")
    assert r.repair_index({"confirm":True})["ok"]
    assert r.chat.health()["ok"]
print("Memory fusion, provenance, confirmed-only context and index rebuild passed")
