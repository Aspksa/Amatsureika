import sys,tempfile
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from workspace import Workspace
from cloud_client import Cloud
from routing import Router
from unittest.mock import patch
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);r=Router(c,w,Cloud(p));k=r.knowledge
    c.memory_append({"text":"Автомобиль тестовый","request_id":str(uuid4())},"Ответ")
    k.consolidate();k.consolidate()
    assert len(k.search("тестовый"))==1 and k.search("тестовый")[0]["state"]=="candidate"
    v={"kind":"fact","subject":"Автомобиль","predicate":"цвет","value":"синий","context":"пользователь","expires":""}
    i=k.add(v)["id"];assert k.add(v)["id"]==i
    assert not k.context("синий")
    k.review({"id":i,"state":"confirmed","confidence":.9,"confirm":True})
    assert "синий" in k.context("синий")[0]
    j=k.add({**v,"value":"красный"})["id"]
    try:k.review({"id":j,"state":"confirmed","confidence":1,"confirm":True})
    except ValueError:pass
    else:raise AssertionError("conflicting confirmed fact")
    k.link({"a":i,"b":j,"kind":"contradicts"})
    assert k.stats()["links"]==1
    assert k.history(i)["items"]
    k.review({"id":i,"state":"rejected","confidence":0,"confirm":True})
    assert not k.context("синий")
    z=k.add({**v,"subject":"Двигатель","value":"белый"})["id"]
    k.review({"id":z,"state":"confirmed","confidence":1,"confirm":True})
    p=k.embedding_preview(z)
    with patch.object(r.cloud,"embed",return_value=[1.0]+[0.0]*1023) as mock:
        assert not k.embed_item(z,p["text"])["cached"]
        assert k.embed_item(z,p["text"])["cached"]
        assert k.semantic("цвет")[0]["id"]==z
        assert mock.call_count==2
    assert c.health()["ok"]
print("Knowledge provenance, deduplication, quarantine, confirmation, conflicts and history passed")
