"""Minimal OOXML report exports, generated from allowlisted local reports."""
import io
import re
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape

XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
PKG="http://schemas.openxmlformats.org/package/2006/relationships"
REL="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CT="http://schemas.openxmlformats.org/package/2006/content-types"
SS="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
W="http://schemas.openxmlformats.org/wordprocessingml/2006/main"

def safe(s):
    return escape(re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]","",str(s)))

def pack(parts):
    stream=io.BytesIO()
    with ZipFile(stream,"w",ZIP_DEFLATED) as z:
        for name,body in parts.items():z.writestr(name,XML+body)
    return stream.getvalue()

def content_types(overrides):
    return f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'+''.join(f'<Override PartName="/{p}" ContentType="{t}"/>' for p,t in overrides)+'</Types>'

def relationship(target,kind):
    return f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{REL}/{kind}" Target="{target}"/></Relationships>'

def xlsx(report):
    workbook=f'<workbook xmlns="{SS}" xmlns:r="{REL}"><sheets><sheet name="Отчёт" sheetId="1" r:id="rId1"/></sheets></workbook>'
    rows=[[report["title"],report["month"]],*[ [s] for s in report["summary"]],[],report["columns"],*report["rows"],[f"Показано {len(report['rows'])} из {report['total_rows']}"],[report["generated"]]]
    def cell(value,c,r):
        # Every cell is inline text, never a formula. Excel column names beyond Z.
        col="";n=c+1
        while n:n,rem=divmod(n-1,26);col=chr(65+rem)+col
        return f'<c r="{col}{r}" t="inlineStr"><is><t xml:space="preserve">{safe(value)}</t></is></c>'
    sheet=f'<worksheet xmlns="{SS}"><cols><col min="1" max="8" width="25" customWidth="1"/></cols><sheetData>'+''.join(f'<row r="{r}">'+''.join(cell(v,c,r) for c,v in enumerate(row))+'</row>' for r,row in enumerate(rows,1))+'</sheetData></worksheet>'
    return pack({"[Content_Types].xml":content_types([("xl/workbook.xml","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),("xl/worksheets/sheet1.xml","application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")]),"_rels/.rels":relationship("xl/workbook.xml","officeDocument"),"xl/workbook.xml":workbook,"xl/_rels/workbook.xml.rels":relationship("worksheets/sheet1.xml","worksheet"),"xl/worksheets/sheet1.xml":sheet})

def docx(report):
    def p(s,bold=False):return '<w:p><w:r>'+('<w:rPr><w:b/></w:rPr>' if bold else '')+'<w:t xml:space="preserve">'+safe(s)+'</w:t></w:r></w:p>'
    rows=[report["columns"],*report["rows"]]
    table='<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>'+''.join(f'<w:{x} w:val="single" w:sz="4" w:color="B0B0B0"/>' for x in ("top","left","bottom","right","insideH","insideV"))+'</w:tblBorders></w:tblPr>'+''.join('<w:tr>'+''.join('<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'+p(v,i==0)+'</w:tc>' for v in row)+'</w:tr>' for i,row in enumerate(rows))+'</w:tbl>'
    body=p(report["title"]+" "+report["month"],True)+''.join(p(x) for x in report["summary"])+table+p(f"Показано {len(report['rows'])} из {report['total_rows']}")+p(report["generated"])
    document=f'<w:document xmlns:w="{W}"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr></w:body></w:document>'
    return pack({"[Content_Types].xml":content_types([("word/document.xml","application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")]),"_rels/.rels":relationship("word/document.xml","officeDocument"),"word/document.xml":document})

def export_report(engine,value):
    if not isinstance(value,dict) or set(value)!={"tool","month","format"} or value["format"] not in ("xlsx","docx"):raise ValueError("Неверный формат")
    r=engine.run({"tool":value["tool"],"month":value["month"]})
    ext=value["format"]
    return (xlsx(r) if ext=="xlsx" else docx(r)),r["tool"]+("-"+r["month"] if r["month"] else "")+"."+ext,("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if ext=="xlsx" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
