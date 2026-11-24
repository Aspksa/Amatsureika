import sys,io,tempfile
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from workspace import Workspace
from chat_store import ChatStore
from tool_engine import ToolEngine
from report_export import export_report
with tempfile.TemporaryDirectory() as d:
    path=Path(d)/"memory.db";w=Workspace(path);c=ChatStore(path)
    w.save_work({"kind":"staff","fields":{"name":"=1+2 & Иванов","job":"Водитель","number":"1"}})
    engine=ToolEngine(w,c)
    for ext,entry in (("xlsx","xl/worksheets/sheet1.xml"),("docx","word/document.xml")):
        data,name,mime=export_report(engine,{"tool":"staff","month":"","format":ext})
        assert name=="staff."+ext and len(data)>100
        with ZipFile(io.BytesIO(data)) as z:
            for part in z.namelist():ET.fromstring(z.read(part))
            text=z.read(entry).decode()
            assert "=1+2 &amp; Иванов" in text
            if ext=="xlsx":assert "<f>" not in text and 't="inlineStr"' in text
print("OOXML report exports, XML structure and formula safety passed")
