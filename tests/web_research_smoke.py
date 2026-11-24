import sys,tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from chat_store import ChatStore
from workspace import Workspace
from web_research import WebResearch,public_target,search_results
for ip in ("127.0.0.1","10.0.0.1","169.254.169.254","::1"):
    with patch("socket.getaddrinfo",return_value=[(0,0,0,"",(ip,443))]):
        try:public_target("https://example.com")
        except ValueError:pass
        else:raise AssertionError("SSRF")
with tempfile.TemporaryDirectory() as d:
    p=Path(d)/"db.sqlite";c=ChatStore(p);w=Workspace(p);calls=[]
    def fetch(url,limit):
        calls.append(url)
        if "duckduckgo" in url:body=b'<a href="https://example.com/a">Example result</a>';mime="text/html"
        elif url.endswith(".pdf"):body=b"%PDF-1.4\n";mime="application/pdf"
        else:body=b"<title>Example</title><p>Evidence</p><script>bad()</script>";mime="text/html"
        return {"url":url,"body":body,"mime":mime,"modified":""}
    web=WebResearch(c,w,fetch)
    try:web.dispatch({"action":"search","query":"test"})
    except ValueError:pass
    else:raise AssertionError("consent")
    assert not calls
    r=web.search("test");assert r["items"][0]["url"]=="https://example.com/a"
    assert web.search("test")["cached"] and len(calls)==1
    assert "bad()" not in web.read("https://example.com/a")["text"]
    assert web.research("test")["pages"]
    out=web.download("https://example.com/a.pdf")
    assert w.download(out["id"])[2]==9
    web.watch("https://example.com/a")
    assert web.watches()[0]["enabled"]==1
    web.disable(web.watches()[0]["id"])
    assert not web.watches()[0]["enabled"]
print("Web consent, public address guard, parsing, cache, document and watch passed")
