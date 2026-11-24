import sys
import tempfile
from pathlib import Path
from uuid import uuid4
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from cloud_client import Cloud, CloudError

with tempfile.TemporaryDirectory() as directory:
    path=Path(directory)/"memory.db"
    s=ChatStore(path)
    assert s.memory_snapshot()=={"clusters":[],"messages":[]}
    for i in range(250):
        s.append({"text":str(i),"request_id":str(uuid4())})
    assert [c["count"] for c in s.memory_snapshot()["clusters"]]==[500]
    req={"text":"next","request_id":str(uuid4())}
    r=s.memory_append(req)
    assert [c["count"] for c in r["clusters"]]==[500,2]
    assert [m["position"] for m in r["messages"]]==[1,2]
    assert len(s.memory_snapshot(1)["messages"])==500
    assert s.memory_append(req)["duplicate"]
    assert ChatStore(path).memory_snapshot(2)["messages"][0]["text"]=="next"
    calls=[]
    def fake(method,endpoint,key,payload=None):
        calls.append((method,endpoint))
        assert key=="test-key"
        if endpoint=="/models": return {"data":[{"id":"mock-chat"}]}
        assert payload["max_completion_tokens"]==512
        return {"choices":[{"message":{"content":"mock answer"}}]}
    c=Cloud(path,fake)
    c.save_key({"key":"test-key","persist":False})
    assert not calls and not c.status()["verified"]
    assert c.load_models()["models"]==["mock-chat"]
    assert c.select({"model":"mock-chat"})["model"]=="mock-chat"
    assert calls==[("GET","/models")]
    assert c.complete("hello")=="mock answer"
    assert "key" not in c.status()
    c.save_key({"key":"test-key","persist":True})
    assert Cloud(path,fake).status()["has_key"]
    c.save_key({"key":"","persist":False})
    assert not c.status()["has_key"]
    assert not c.key_path.exists()
print("500-message projection, old history, local Cloud configuration and mocked API passed")
