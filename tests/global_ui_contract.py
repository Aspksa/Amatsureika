from html.parser import HTMLParser
from pathlib import Path
import re
root=Path(__file__).resolve().parents[1]
class IDs(HTMLParser):
    def __init__(self):super().__init__();self.ids=[]
    def handle_starttag(self,tag,attrs):
        self.ids.extend(v for k,v in attrs if k=="id")
p=IDs();p.feed((root/"public/index.html").read_text(encoding="utf-8"))
assert len(p.ids)==len(set(p.ids)),"Duplicate HTML IDs"
for name,method in [("main.ts","byId"),("workspace.ts","id")]:
    text=(root/"src"/name).read_text(encoding="utf-8")
    missing=set(re.findall(r'\b'+method+r'(?:<[^>]+>)?\("([^"]+)"\)',text))-set(p.ids)
    assert not missing,missing
print("Static UI ID contract passed (not browser E2E)")
