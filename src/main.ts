import {visibleRange} from "./chat_virtual.js";
import {setupWorkspace} from "./workspace.js";
import {runQuietFlow, particleAt, PARTICLES, type Leg} from "./flow.js";
import {ClusterIndex, directedBlockLayout, workspaceSectors, dataOrbit, type WorkKind, valid, clamp, polar, TAU, type Mode, type Point} from "./geometry.js";
const NS="http://www.w3.org/2000/svg";
const byId=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const svg=document.getElementById("brain") as unknown as SVGSVGElement;
const group=(id:string)=>document.getElementById(id) as unknown as SVGGElement;
const world=group("world"), nodes=group("nodes"), links=group("links"), cells=group("cells"), labels=group("labels"), orbits=group("orbits");
function el<K extends keyof SVGElementTagNameMap>(tag:K, attrs:Record<string,string|number>={}, parent?:Element):SVGElementTagNameMap[K]{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent?.append(e);return e}
const names:string[]=[];
const palette=["#77d9c7","#93b8ee","#9aa7f0","#c3a6e9","#8cdbb2","#e0ba88","#a8c8d9"];
type Item={e:SVGElement;cluster:number;index:number;outer:boolean;from:Point;to:Point;now:Point};
const items:Item[]=[];
const visibleItems=new Map<string,Item>();
const summaries=new Map<number,SVGPathElement>();
const pendingClusters=new Set<number>();
let renderKey="",mapRevision=0;
const key=(i:number,n:number,outer:boolean)=>i+":"+n+":"+outer;
const counts:number[]=[];
type ChatCluster={id:number;previous_id:number|null;count:number};
type ResultSource={source:"memory"|"work"|"file";id:number;title:string};
type ResultMeta={search_passes?:number;evidence_status?:string;source_groups?:Record<string,number>;links?:{from:string;to:string;terms:string[]}[];missing?:string[];conflicts?:string[];style?:string;tools?:string[];warnings?:string[];sources?:ResultSource[];web_sources?:{title:string;url:string;date:string;excerpt:string}[];series?:number[];steps?:{tool:string;status:string}[];table?:{columns:string[];rows:string[][];total_rows:number}};
type ChatMessage={id:number;cluster_id:number;position:number;role:"user"|"assistant";text:string;metadata?:ResultMeta};
type Snapshot={clusters:ChatCluster[];messages:ChatMessage[];duplicate?:boolean};
let clusters:ChatCluster[]=[];
type Endpoint=()=>Point;
type FlowLeg={from:Endpoint;to:Endpoint;begin:number;speed:number;dots:SVGCircleElement[];line:SVGLineElement;resolve:()=>void};
const flowLegs=new Set<FlowLeg>();
const arrivalTimers=new Map<SVGElement,number>();
let mode:Mode="radial", selected=-1, zoom=1, tx=0,ty=0, speed=1, density=.5, paused=matchMedia("(prefers-reduced-motion: reduce)").matches;
let frame=0, start=0, moving=false, quality=1, slowFrames=0, fastFrames=0, lastFrame=0;
let flight:{z:number;x:number;y:number;fromZ:number;fromX:number;fromY:number;begin:number}|null=null;
let cameraTimer:number|undefined,cameraRevision=0,cameraLoaded=false;
let cameraChain=Promise.resolve();


const reduced=matchMedia("(prefers-reduced-motion: reduce)");
const defaults={speed:1,glow:65,density:50,depth:65,texture:35,motion:75,textMotion:60};
type Effects=typeof defaults;
let effects:Effects={...defaults};
let saveTimer:number|undefined, saveChain=Promise.resolve(), revision=0;
function motionOff(){return paused||reduced.matches||effects.motion===0}
const legend=byId("legend"), detail=byId("detail");
let geometry=directedBlockLayout(counts.length,mode),spatial=new ClusterIndex(geometry.centers);
function reindex(){spatial=new ClusterIndex(geometry.centers);mapRevision++;renderKey=""}
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function position(item:Item){return geometry.point(item.cluster,item.index,item.outer)}
function transform(item:Item,p:Point){item.now=valid(p)?p:position(item);if(!valid(item.now))item.now={x:0,y:0}}
type MapFile={id:number;name:string;size:number};
type MapWork={id:number;kind:WorkKind};
type WorkspaceMap={files:MapFile[];work:Record<string,number>;records:MapWork[]};
const workTitles:Record<WorkKind,string>={staff:"Сотрудники",timesheet:"Табель",cards:"Топливные карты",vehicles:"Автомобили",fuel:"ГСМ"};
const workColors:Record<WorkKind,string>={staff:"#d9b07b",timesheet:"#ceb38e",cards:"#e2c18d",vehicles:"#c99867",fuel:"#e4a66e"};
let workspaceMap:WorkspaceMap={files:[],work:{},records:[]},filePoints:Point[]=[],fileSpatial=new ClusterIndex([]),fileNodes=new Map<number,SVGCircleElement>();
let workPoints:Point[]=[],oldWorkPoints:Point[]|null=null,workSpatial=new ClusterIndex([]),workNodes=new Map<number,SVGCircleElement>();
let mapOuter=geometry.outer,orbitPoints:Point[]=[],oldCenters:Point[]|null=null,oldOrbit:Point[]|null=null,oldSpatial:ClusterIndex|null=null,oldFilePoints:Point[]|null=null;
let transition=1,workspaceRevision=0,hoverTarget:{kind:"memory"|"file"|"work"|"module";index:number;id?:string}|null=null;
const moduleList=()=>Array.from(group("functional-orbit").querySelectorAll<SVGGElement>(".functional-icon"));
function prepareLayout(animate=false){
 if(animate&&!motionOff()){
  oldCenters=geometry.centers.map((p,i)=>oldCenters?.[i]?mix(oldCenters[i],p,transition):p);
  oldSpatial=new ClusterIndex(oldCenters);
  oldOrbit=orbitPoints.map((p,i)=>oldOrbit?.[i]?mix(oldOrbit[i],p,transition):p);
  oldFilePoints=filePoints.map((p,i)=>oldFilePoints?.[i]?mix(oldFilePoints[i],p,transition):p);
  oldWorkPoints=workPoints.map((p,i)=>oldWorkPoints?.[i]?mix(oldWorkPoints[i],p,transition):p);
  transition=0;moving=true;start=performance.now();
 }else{oldCenters=null;oldOrbit=null;oldSpatial=null;oldFilePoints=null;oldWorkPoints=null;transition=1;moving=false}
 geometry=directedBlockLayout(counts.length,mode);reindex();
 const sectors=workspaceSectors(mode,geometry.edge??180,workspaceMap.files.length,workspaceMap.records);
 filePoints=sectors.files;workPoints=sectors.work;
 fileSpatial=new ClusterIndex(filePoints);workSpatial=new ClusterIndex(workPoints);
 mapOuter=Math.max(geometry.outer,sectors.edge+72);orbitPoints=dataOrbit(mapOuter);
}
function fitZoom(){
 const radius=orbitPoints.reduce((r,p)=>Math.max(r,Math.hypot(p.x,p.y)+45),mapOuter+58);
 return Math.max(.025,Math.min(1,490/radius))
}
function fitOffset(){return 0}
function memoryPoint(i:number):Point{const p=geometry.centers[i];return oldCenters?.[i]?mix(oldCenters[i],p,transition):p}
function filePoint(i:number):Point{const p=filePoints[i];return oldFilePoints?.[i]?mix(oldFilePoints[i],p,transition):p}
function workPoint(i:number):Point{const p=workPoints[i];return oldWorkPoints?.[i]?mix(oldWorkPoints[i],p,transition):p}
function updateOrbit(){
 moduleList().forEach((icon,i)=>{const dest=orbitPoints[i];if(!dest)return;const p=oldOrbit?.[i]?mix(oldOrbit[i],dest,transition):dest;icon.setAttribute("transform",`translate(${p.x} ${p.y})`)});
}
function hover(kind:"memory"|"file"|"work"|"module",index:number,id?:string){hoverTarget={kind,index,id};requestFrame()}
function unhover(){hoverTarget=null;requestFrame()}
function highlightFrame(){
 links.replaceChildren();labels.replaceChildren();
 if(zoom>=1.6){for(const item of items){const p=item.now;const label=el("text",{x:p.x+9,y:p.y+3,class:"detail-label","font-size":Math.max(2,10/zoom)},labels);label.textContent=String(counts[item.cluster])+"/500"}}
 const h=hoverTarget;if(!h)return;
 let p:Point|undefined;
 if(h.kind==="memory"&&geometry.centers[h.index])p=memoryPoint(h.index);
 if(h.kind==="file"&&filePoints[h.index])p=filePoint(h.index);
 if(h.kind==="work"&&workPoints[h.index])p=workPoint(h.index);
 if(h.kind==="module"){const icon=moduleList().find(x=>x.id===h.id);if(icon){const m=icon.transform.baseVal.consolidate()?.matrix;if(m)p={x:m.e,y:m.f}}}
 if(!p)return;
 const color=h.kind==="memory"?"#77d9c7":h.kind==="file"?"#b8a5e6":h.kind==="work"?"#d9b07b":"#8db8d8";
 el("line",{x1:0,y1:0,x2:p.x,y2:p.y,class:"hover-link",stroke:color},links);
 if(h.kind==="memory"&&h.index>0){const prev=memoryPoint(h.index-1);el("line",{x1:prev.x,y1:prev.y,x2:p.x,y2:p.y,class:"hover-link",stroke:color},links)}
 if(h.kind==="file"||h.kind==="work"){const icon=moduleList().find(x=>x.id===(h.kind==="file"?"docsIcon":"workIcon")),m=icon?.transform.baseVal.consolidate()?.matrix;if(m)el("line",{x1:m.e,y1:m.f,x2:p.x,y2:p.y,class:"hover-link",stroke:color},links)}
 if(h.kind==="module"&&h.id==="chatIcon"){const stride=Math.max(1,Math.ceil(geometry.centers.length/36));for(let i=0;i<geometry.centers.length;i+=stride){const q=memoryPoint(i);el("line",{x1:p.x,y1:p.y,x2:q.x,y2:q.y,class:"sector-link",stroke:"#77d9c7"},links)}}
 if(h.kind==="module"&&(h.id==="workIcon"||h.id==="docsIcon")){const isWork=h.id==="workIcon",points=isWork?workPoints:filePoints;const stride=Math.max(1,Math.ceil(points.length/36));for(let i=0;i<points.length;i+=stride){const q=isWork?workPoint(i):filePoint(i);el("line",{x1:p.x,y1:p.y,x2:q.x,y2:q.y,class:"sector-link",stroke:isWork?"#d9b07b":"#b6a3e1"},links)}}
}
async function refreshWorkspaceMap(animate=false){
 const rev=++workspaceRevision;
 try{
  const response=await fetch("/api/workspace/map",{cache:"no-store"});if(!response.ok)throw Error("map");
  const data:WorkspaceMap=await response.json();if(rev!==workspaceRevision)return;
  const priorFit=fitZoom(),changed=JSON.stringify(workspaceMap)!==JSON.stringify(data);
  const prevFiles=new Set(workspaceMap.files.map(f=>f.id)),prevWork=new Set(workspaceMap.records.map(r=>r.id));
  workspaceMap=data;byId("documentCount").textContent=data.files.length+" файлов";byId("workCount").textContent=Object.values(data.work).reduce((a,b)=>a+b,0)+" записей";
  if(changed){hoverTarget=null;prepareLayout();decorate();if(Math.abs(zoom-priorFit)<.03){zoom=fitZoom();tx=0;ty=0}}
  requestFrame();
  if(animate&&changed&&!motionOff()&&!document.hidden){
   const newFiles=data.files.filter(f=>!prevFiles.has(f.id)).slice(-3),newWork=data.records.filter(r=>!prevWork.has(r.id)).slice(-3);
   for(const f of newFiles)void dataArrival("docsIcon",f.id);
   for(const r of newWork)void dataArrival("workIcon",r.id);
  }
 }catch{if(rev===workspaceRevision){byId("documentCount").textContent="Данные недоступны";byId("workCount").textContent="Данные недоступны"}}
}
function color(i:number){return palette[Math.floor(i/4)%palette.length]}
const glyphs=["M0 -5 4 -2 4 2 0 5 -4 2 -4 -2Z M0 -2v4 M-2 0h4","M-4 -4h8v8h-8Z M-2 -1h4 M-2 2h3","M-4 3 -1 -3 1 1 4 -4 M-4 3h8","M0 -5 5 0 0 5 -5 0Z M0 -2v4","M0 4C-7 0 -4 -5 0 -2 4 -5 7 0 0 4Z","M-4 -3h8 M-4 0h8 M-4 3h5","M-5 -3 0 -5 5 -3 0 0Z M-5 0 0 3 5 0 M-5 3 0 5 5 3","M0 -5 4 3 0 1 -4 3Z","M-5 -2 0 -5 5 -2 0 1Z M-3 0v3l3 2 3-2V0","M-4 0 -1 3 4 -3","M-4 4V0 M0 4v-8 M4 4v-5","M-3 -5h4l3 3v7h-7Z M1 -5v3h3","M-3 -3 3 3 M-3 3 3 -3 M-4 -4h2v2h-2Z M2 2h2v2H2Z","M-4 -1 1 -5 5 -1 0 4 -4 4Z","M-5 0Q0 -6 5 0Q0 6 -5 0Z M0 -2v4","M-5 -4h10v7H0l-3 2V3h-2Z","M-4 4 0 0 4 -4 M0 -4h4v4","M-4 -4h3 M-4 -4v3 M4 4H1 M4 4V1 M0 -2v4","M-5 4 0 -1 M0 -1 2 -4 5 -5 4 -2 1 0Z","M-4 -4h8v8h-8Z M-4 0h8 M0 -4v8","M0 -5 4 -3 4 3 0 5 -4 3 -4 -3Z M-2 0h4"];
function add(i:number,outer:boolean,n:number){
 const e=el("circle",{r:5,class:"memory-block",color:color(i),tabindex:0,role:"button","aria-label":"Блок памяти "+(i+1)});
 e.setAttribute("data-node",nodeId(i,n,outer));e.addEventListener("pointerenter",()=>hover("memory",i));e.addEventListener("pointerleave",unhover);e.addEventListener("focus",()=>hover("memory",i));e.addEventListener("blur",unhover);e.addEventListener("click",()=>select(i));e.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();select(i)}});e.addEventListener("dblclick",ev=>{ev.stopPropagation();focusCluster(i)});
 const item:Item={e,cluster:i,index:n,outer,from:{x:0,y:0},to:{x:0,y:0},now:{x:0,y:0}};item.to=position(item);item.from=item.to;transform(item,item.to);items.push(item);visibleItems.set(key(i,n,outer),item);return item
}
function refreshStats(){byId("stats").textContent=counts.reduce((a,b)=>a+b,0)+" СООБЩЕНИЙ · "+names.length+" БЛОКОВ";Array.from(legend.children).forEach((b,i)=>{const n=b.lastElementChild;if(n)n.textContent=counts[i]+" / 500"})}
refreshStats();
function polygon(c:Point,r:number){return Array.from({length:6},(_,j)=>{const p=polar(r,j*TAU/6);return (c.x+p.x)+","+(c.y+p.y)}).join(" ")}
function decorate(){
 svg.dataset.mode=mode;
 for(const g of [orbits,labels,links,cells])g.replaceChildren();
 for(const r of [116,148,mapOuter-28,mapOuter])el("circle",{r,class:"orbit"},orbits);
 updateOrbit();
 if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations();
}
function select(i:number){
 renderKey="";
 if(busy||!ready)return;
 selected=i===selected?-1:i;Array.from(legend.children).forEach((b,j)=>b.classList.toggle("selected",j===selected));
 for(const item of items){item.e.classList.toggle("chosen",item.cluster===selected);item.e.style.opacity=selected<0||item.cluster===selected?"":"0.22"}
 detail.textContent=selected<0?"Выберите кластер или точку.":names[selected]+" · "+counts[selected]+" / 500 сообщений";
 requestFrame();void openHistory(selected);
}
function requestFrame(){if(!frame)frame=requestAnimationFrame(renderFrame)}
function renderFrame(now:number){
 frame=0;
 if(lastFrame&&(moving||flight)){const dt=now-lastFrame;if(dt>24){slowFrames++;fastFrames=0}else{fastFrames++;slowFrames=0}if(slowFrames>=8){quality=Math.max(.25,quality-.25);slowFrames=0}if(fastFrames>=40){quality=Math.min(1,quality+.25);fastFrames=0}}
 lastFrame=now;
 if(moving){const p=motionOff()?1:Math.min(1,(now-start)/700);transition=p*p*(3-2*p);moving=p<1;if(!moving){oldCenters=null;oldOrbit=null;oldSpatial=null;oldFilePoints=null;oldWorkPoints=null}}
 if(flight){const f=flight,p=motionOff()?1:Math.min(1,(now-f.begin)/650),e=p*p*(3-2*p);zoom=Math.exp(Math.log(f.fromZ)+(Math.log(f.z)-Math.log(f.fromZ))*e);tx=f.fromX+(f.x-f.fromX)*e;ty=f.fromY+(f.y-f.fromY)*e;if(p===1){flight=null;saveCamera()}}
 zoom=clamp(zoom,.025,64,fitZoom());tx=clamp(tx,-1e6,1e6);ty=clamp(ty,-1e6,1e6);
 world.setAttribute("transform",`translate(${tx} ${ty}) scale(${zoom})`);byId("reset").textContent=Math.round(zoom*100)+"%";
 const level=zoom<.45?"overview":zoom<1.6?"normal":zoom<5?"near":"detail";svg.dataset.lod=level;svg.dataset.quality=String(quality);
 renderVisible(level);renderFiles(level);renderWorkNodes(level);updateOrbit();highlightFrame();
 updateFlow(now);
 if(moving||flight||flowLegs.size){requestFrame()}else lastFrame=0;
}
function renderVisible(level:string){
 const view=svg.viewBox.baseVal, margin=50;
 const signature=[mapRevision,zoom,tx,ty,view.width,view.height,level,quality,selected,transition].join(":");
 if(signature===renderKey)return;renderKey=signature;
 const bounds:[number,number,number,number]=[(view.x-margin-tx)/zoom,(view.y-margin-ty)/zoom,(view.x+view.width+margin-tx)/zoom,(view.y+view.height+margin-ty)/zoom];
 const candidates=Array.from(new Set([...spatial.query(...bounds),...(oldSpatial?.query(...bounds)??[])]));
 const wanted=new Set<string>(),fragment=document.createDocumentFragment();
 for(const i of candidates){
  const k=key(i,0,false);wanted.add(k);const it=visibleItems.get(k)||add(i,false,0),p=memoryPoint(i);
  it.now=p;it.e.setAttribute("transform",`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
  it.e.setAttribute("r",String(Math.min(12,Math.max(3.5,2.4/zoom))));
  it.e.classList.toggle("near-detail",level==="near"||level==="detail");
  it.e.setAttribute("aria-label","Блок "+(i+1)+": "+counts[i]+" из 500 сообщений");
  it.e.classList.toggle("archive",counts[i]===500);it.e.classList.toggle("chosen",selected===i);
  it.e.classList.toggle("pending-memory",pendingClusters.has(i));it.e.classList.toggle("active-block",i===counts.length-1&&counts[i]<500);
  it.e.style.setProperty("--fill-level",String(counts[i]/500));it.e.style.opacity=selected>=0&&selected!==i?".26":"";
  it.e.setAttribute("aria-label","Блок "+(i+1)+": "+counts[i]+" из 500 сообщений");
  if(!it.e.firstElementChild)el("title",{},it.e);it.e.firstElementChild!.textContent="Блок "+(i+1)+" · "+counts[i]+"/500";
  if(!it.e.isConnected)fragment.append(it.e);
 }
 for(const [k,it] of visibleItems)if(!wanted.has(k)){it.e.remove();visibleItems.delete(k)}
 items.splice(0,items.length,...visibleItems.values());nodes.append(fragment);
 svg.dataset.visibleNodes=String(visibleItems.size);
}
let fileRenderKey="";
function renderFiles(level:string){
 const view=svg.viewBox.baseVal,sig=[mapRevision,zoom,tx,ty,view.width,view.height,transition,level].join(":");
 if(sig===fileRenderKey)return;fileRenderKey=sig;
 const candidates=fileSpatial.query((view.x-70-tx)/zoom,(view.y-70-ty)/zoom,(view.x+view.width+70-tx)/zoom,(view.y+view.height+70-ty)/zoom);
 const wanted=new Set<number>(),layer=group("fileNodes"),fragment=document.createDocumentFragment();
 for(const i of candidates){
  const file=workspaceMap.files[i],p=filePoint(i);wanted.add(file.id);let dot=fileNodes.get(file.id);
  if(!dot){
   dot=el("circle",{class:"document-dot",r:5,tabindex:0,role:"button"});fileNodes.set(file.id,dot);
   const focus=()=>{const at=workspaceMap.files.findIndex(f=>f.id===file.id);if(at>=0)hover("file",at)};
   const open=()=>{const f=workspaceMap.files.find(x=>x.id===file.id);if(f)byId<HTMLAnchorElement>("fileDownload").href="/api/disk/download?id="+f.id;if(f){byId("fileDetailName").textContent=f.name;byId("fileDetailSize").textContent=(f.size/1024).toLocaleString("ru",{maximumFractionDigits:1})+" КБ";byId<HTMLDialogElement>("fileDetail").showModal()}};
   dot.addEventListener("pointerenter",focus);dot.addEventListener("pointerleave",unhover);dot.addEventListener("focus",focus);dot.addEventListener("blur",unhover);
   dot.addEventListener("click",open);dot.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
   el("title",{},dot);fragment.append(dot);
  }
  dot.setAttribute("transform",`translate(${p.x} ${p.y})`);dot.setAttribute("r",String(Math.min(10,Math.max(3.5,2.1/zoom))));
  dot.setAttribute("aria-label",file.name);dot.firstElementChild!.textContent=file.name;
 }
 for(const [id,dot] of fileNodes)if(!wanted.has(id)){dot.remove();fileNodes.delete(id)}
 layer.append(fragment);
}
let workRenderKey="";
function renderWorkNodes(level:string){
 const view=svg.viewBox.baseVal,sig=[mapRevision,zoom,tx,ty,view.width,view.height,transition,level].join(":");
 if(sig===workRenderKey)return;workRenderKey=sig;
 const candidates=workSpatial.query((view.x-70-tx)/zoom,(view.y-70-ty)/zoom,(view.x+view.width+70-tx)/zoom,(view.y+view.height+70-ty)/zoom);
 const wanted=new Set<number>(),layer=group("workNodes"),fragment=document.createDocumentFragment();
 for(const i of candidates){
  const record=workspaceMap.records[i],p=workPoint(i);wanted.add(record.id);let dot=workNodes.get(record.id);
  if(!dot){
   dot=el("circle",{class:"work-dot",r:5,tabindex:0,role:"button"});workNodes.set(record.id,dot);
   const focus=()=>{const at=workspaceMap.records.findIndex(r=>r.id===record.id);if(at>=0)hover("work",at)};
   const open=()=>{const r=workspaceMap.records.find(x=>x.id===record.id);if(r)void workspaceUI.openRecord(r.kind,r.id)};
   dot.addEventListener("pointerenter",focus);dot.addEventListener("pointerleave",unhover);dot.addEventListener("focus",focus);dot.addEventListener("blur",unhover);
   dot.addEventListener("click",open);dot.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
   el("title",{},dot);fragment.append(dot);
  }
  dot.setAttribute("transform",`translate(${p.x} ${p.y})`);dot.setAttribute("r",String(Math.min(10,Math.max(3.5,2.1/zoom))));
  dot.setAttribute("fill",workColors[record.kind]);dot.setAttribute("aria-label",workTitles[record.kind]+" · "+record.id);dot.firstElementChild!.textContent=workTitles[record.kind]+" · "+record.id;
 }
 for(const [id,dot] of workNodes)if(!wanted.has(id)){dot.remove();workNodes.delete(id)}
 layer.append(fragment);
}
async function dataArrival(id:"workIcon"|"docsIcon",recordId:number){
 const isWork=id==="workIcon",find=()=>isWork?workspaceMap.records.findIndex(r=>r.id===recordId):workspaceMap.files.findIndex(r=>r.id===recordId);
 const target=()=>{const i=find();return i<0?modulePoint(id):screenPoint(isWork?workPoint(i):filePoint(i))};
 await playLeg(()=>modulePoint(id),target,isWork?"work":"docs");
 arrival((isWork?workNodes:fileNodes).get(recordId),"memory");
}
function relayout(){prepareLayout(true);decorate();requestFrame()}
function setMode(m:Mode){if(m===mode)return;mode=m;flight=null;document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===m));relayout();animateCamera(fitZoom(),0,fitOffset())}
function camera(){requestFrame()}
function zoomAt(factor:number,x=0,y=0){flight=null;const next=clamp(zoom*factor,.025,64,zoom);tx=x-(x-tx)*next/zoom;ty=y-(y-ty)*next/zoom;zoom=next;camera();saveCamera()}
function coords(x:number,y:number):Point{const matrix=svg.getScreenCTM();if(!matrix)return{x:0,y:0};const p=new DOMPoint(x,y).matrixTransform(matrix.inverse());return{x:p.x,y:p.y}}
svg.addEventListener("wheel",e=>{e.preventDefault();const p=coords(e.clientX,e.clientY);zoomAt(Math.exp(-e.deltaY*.0015),p.x,p.y)},{passive:false});
let drag:{id:number;point:Point;tx:number;ty:number;moved:boolean}|null=null;
svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;flight=null;cameraRevision++;drag={id:e.pointerId,point:coords(e.clientX,e.clientY),tx,ty,moved:false}});
svg.addEventListener("pointermove",e=>{if(!drag||drag.id!==e.pointerId)return;const p=coords(e.clientX,e.clientY),dx=p.x-drag.point.x,dy=p.y-drag.point.y;if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;svg.setPointerCapture(e.pointerId);svg.classList.add("dragging");tx=drag.tx+dx;ty=drag.ty+dy;camera()});
function stop(){if(drag?.moved)saveCamera();drag=null;svg.classList.remove("dragging")}svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);
const reset=()=>animateCamera(fitZoom(),0,fitOffset());byId("reset").onclick=reset;byId("minus").onclick=()=>zoomAt(.8);byId("plus").onclick=()=>zoomAt(1.25);group("core").addEventListener("click",()=>{reset();if(selected>=0)select(selected)});group("core").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();reset();if(selected>=0)select(selected)}});
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.onclick=()=>setMode(b.dataset.mode as Mode));
function applyEffects(redraw=true){
 const root=document.documentElement.style;speed=effects.speed;density=effects.density/100;
 root.setProperty("--duration",4/speed+"s");
 for(const key of ["glow","depth","texture","motion"] as const)root.setProperty("--"+key,String(effects[key]/100));
 root.setProperty("--text-duration",Math.round(effects.textMotion*6)+"ms");
 for(const key of Object.keys(defaults) as (keyof Effects)[]){byId<HTMLInputElement>(key).value=String(effects[key]);const out=document.getElementById(key+"Out");if(out)out.textContent=key==="speed"?effects.speed.toFixed(2)+"×":effects[key]+"%";}
 if(redraw)decorate();applyPause();
}
function scheduleSave(){
 revision++;const current=revision;
 byId("saveState").textContent="Сохранение…";window.clearTimeout(saveTimer);
 saveTimer=window.setTimeout(()=>{const snapshot={...effects};saveChain=saveChain.then(async()=>{
 try{const response=await fetch("/api/design",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(snapshot),keepalive:true});if(!response.ok)throw Error("save failed");if(current===revision)byId("saveState").textContent="Сохранено на диске";}
 catch{if(current===revision)byId("saveState").textContent="Не удалось сохранить. Проверьте локальный сервер.";}
 });},180);
}
for(const key of Object.keys(defaults) as (keyof Effects)[]){byId<HTMLInputElement>(key).oninput=e=>{effects[key]=Number((e.target as HTMLInputElement).value);applyEffects(key==="speed"||key==="density"||key==="motion");scheduleSave();};}
byId("restoreDesign").onclick=()=>{effects={...defaults};applyEffects();scheduleSave();};
async function loadDesign(){
 const initial=revision;
 try{const r=await fetch("/api/design",{cache:"no-store"});if(!r.ok)throw Error("load failed");const data=await r.json();if(revision!==initial)return;
 for(const key of Object.keys(defaults) as (keyof Effects)[]){const n=data[key];if(typeof n==="number"&&Number.isFinite(n))effects[key]=key==="speed"?Math.max(.25,Math.min(2,n)):Math.max(0,Math.min(100,n));}
 applyEffects();byId("saveState").textContent="Настройки восстановлены";}
 catch{if(revision===initial)byId("saveState").textContent="Настройки недоступны; используются стандартные.";}
}
reduced.addEventListener("change",()=>{decorate();applyPause()});
function applyPause(){if(motionOff())clearFlow();document.body.classList.toggle("paused",motionOff());byId("pause").textContent=paused?"Продолжить анимацию":"Пауза анимации";if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations();requestFrame()}
byId("pause").onclick=()=>{paused=!paused;decorate();applyPause()};
const panel=byId("panel"),toggle=byId("panelToggle");panel.hidden=true;toggle.setAttribute("aria-expanded","false");toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute("aria-expanded",String(!panel.hidden))};decorate();applyEffects(false);zoom=fitZoom();camera();void loadDesign();

function animateCamera(z:number,x:number,y:number){cameraRevision++;flight={z:clamp(z,.025,64,fitZoom()),x:clamp(x,-1e6,1e6),y:clamp(y,-1e6,1e6),fromZ:zoom,fromX:tx,fromY:ty,begin:performance.now()};requestFrame()}
function anchor(i:number){return geometry.centers[i]}
function focusCluster(i:number){if(selected!==i)select(i);const p=anchor(i),z=Math.min(3,Math.max(.4,200/geometry.radii[i]));animateCamera(z,-p.x*z,-p.y*z)}
function nodeId(i:number,n:number,outer:boolean){return "B"+(i+1)}
function saveCamera(){
 cameraRevision++;if(!cameraLoaded)return;window.clearTimeout(cameraTimer);
 cameraTimer=window.setTimeout(()=>{const value={zoom,tx,ty,mode};cameraChain=cameraChain.then(async()=>{try{const r=await fetch("/api/camera",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),keepalive:true});if(!r.ok)throw Error("camera")}catch{byId("cameraStatus").textContent="Камера: сохранение недоступно"}})},220);
}
async function loadCamera(){
 const rev=cameraRevision;
 try{const r=await fetch("/api/camera",{cache:"no-store"});if(!r.ok)throw Error("camera");const c=await r.json();if(rev!==cameraRevision)return;if(c.mode==="hex"||c.mode==="radial"||c.mode==="compact"){mode=c.mode;prepareLayout();for(const it of items){it.to=position(it);transform(it,it.to)}document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));zoom=clamp(c.zoom,.025,64,fitZoom());tx=clamp(c.tx,-1e6,1e6);ty=clamp(c.ty,-1e6,1e6);decorate();requestFrame()}}
 catch{byId("cameraStatus").textContent="Камера: стандартное положение"}
 finally{cameraLoaded=true;if(rev!==cameraRevision)saveCamera()}
}
function drawEdges(){
 for(let i=1;i<clusters.length;i++){const j=i-1;const a=geometry.point(j,0,true),b=geometry.point(i,0,true);el("path",{d:`M${a.x} ${a.y} L${b.x} ${b.y}`,class:"continuation-link",fill:"none",color:color(j)},links)}
}
const chat=byId("chat"),chatToggle=byId("chatToggle"),messages=byId("messages"),chatPrompt=byId<HTMLTextAreaElement>("prompt"),chatStatus=byId("chatStatus"),historyTitle=byId("historyTitle"),liveButton=byId("liveChat"),form=byId<HTMLFormElement>("chatForm"),sendButton=byId<HTMLButtonElement>("sendMessage");
let busy=false,historyRevision=0,ready=false;
let pending:{text:string;request_id:string}|null=null;
let cloudAvailable=false,localOnly=false,preparing=false,cancelPreparation=false;
function syncChatIcons(){
 const open=!chat.hidden&&!document.body.classList.contains("full-map");
 chatToggle.setAttribute("aria-expanded",String(open));group("chatIcon").setAttribute("aria-expanded",String(open));group("chatIcon").classList.toggle("chat-open",open);
}
function toggleChat(){
 if(document.body.classList.contains("full-chat")){setChatFull(false);return}
 if(document.body.classList.contains("full-map")){
  setFull(false);if(document.fullscreenElement)void document.exitFullscreen().catch(()=>{});
  chat.hidden=false;
 }else chat.hidden=!chat.hidden;
 syncChatIcons();if(!chat.hidden)chatPrompt.focus();requestFrame();
}
chatToggle.onclick=toggleChat;
function syncMap(next:ChatCluster[]){
 if(next.some((c,i)=>!Number.isSafeInteger(c.id)||!Number.isInteger(c.count)||c.count<1||c.count>500||c.previous_id!==(i?next[i-1].id:null)||i<next.length-1&&c.count!==500))throw Error("Invalid cluster state");
 if(next.length<clusters.length||clusters.some((c,i)=>next[i].id!==c.id||next[i].count<c.count))return;
 const oldFit=fitZoom(),oldLength=clusters.length,changed=next.length!==oldLength||next.some((c,i)=>c.count!==counts[i]);
 if(!changed)return;
 clusters=next;names.splice(0,names.length,...next.map(c=>"B"+c.id));counts.splice(0,counts.length,...next.map(c=>c.count));prepareLayout();
 for(let i=0;i<clusters.length;i++){
  const c=clusters[i];let b=legend.children[i] as HTMLButtonElement|undefined;
  if(!b){b=document.createElement("button");b.className="legend-row";b.style.setProperty("--c",color(i));const sw=document.createElement("i"),title=document.createElement("span"),count=document.createElement("span");title.textContent="Блок "+c.id;b.append(sw,title,count);b.onclick=()=>select(i);b.ondblclick=()=>focusCluster(i);legend.append(b)}
  b.classList.toggle("selected",selected===i);b.lastElementChild!.textContent=c.count+" / 500";
 }
 refreshStats();if(oldLength!==clusters.length)decorate();
 if(oldLength!==clusters.length&&Math.abs(zoom-oldFit)<.03){zoom=fitZoom();tx=0;ty=fitOffset()}requestFrame();
}
function renderMarkdown(root:HTMLElement,text:string){
 const lines=text.split("\n");let language="",code:string[]|null=null,list:HTMLUListElement|HTMLOListElement|null=null;
 function inline(parent:HTMLElement,value:string){
  for(const token of value.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g)){
   if(token.startsWith("**")&&token.endsWith("**")&&token.length>4){const e=document.createElement("strong");e.textContent=token.slice(2,-2);parent.append(e)}
   else if(token.startsWith("`")&&token.endsWith("`")&&token.length>2){const e=document.createElement("code");e.textContent=token.slice(1,-1);parent.append(e)}
   else parent.append(document.createTextNode(token))
  }
 }
 function flushCode(){if(code!==null){const block=document.createElement("div"),bar=document.createElement("div"),pre=document.createElement("pre"),el=document.createElement("code"),copy=document.createElement("button"),label=document.createElement("span");const value=code.join("\n");block.className="code-block";bar.className="code-bar";label.textContent=language||"Код";copy.type="button";copy.textContent="Копировать";copy.onclick=()=>void copyText(value);bar.append(label,copy);el.textContent=value;pre.append(el);block.append(bar,pre);root.append(block);code=null;language=""}}
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(/^\s*```/.test(line)){if(code!==null)flushCode();else{code=[];language=line.trim().slice(3).trim().slice(0,30)}list=null;continue}
  if(code!==null){code.push(line);continue}
  if(!line.trim()){list=null;continue}
  if(i+1<lines.length&&line.includes("|")&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])&&lines[i+1].includes("|")){
   const cells=(v:string)=>v.trim().replace(/^\||\|$/g,"").split("|").map(x=>x.trim());
   const headers=cells(line),wrap=document.createElement("div"),table=document.createElement("table"),head=document.createElement("thead"),tr=document.createElement("tr"),body=document.createElement("tbody");wrap.className="chat-table-scroll";
   for(const h of headers){const th=document.createElement("th");inline(th,h);tr.append(th)}head.append(tr);table.append(head);i++;
   while(i+1<lines.length&&lines[i+1].includes("|")&&cells(lines[i+1]).length===headers.length){i++;const row=document.createElement("tr");for(const cell of cells(lines[i])){const td=document.createElement("td");inline(td,cell);row.append(td)}body.append(row)}
   table.append(body);wrap.append(table);root.append(wrap);list=null;continue
  }
  const heading=line.match(/^(#{1,6})\s+(.+)$/),bullet=line.match(/^\s*([-*]|\d+\.)\s+(.+)$/);
  if(heading){list=null;const h=document.createElement(heading[1].length<=2?"h3":"h4");inline(h,heading[2]);root.append(h)}
  else if(bullet){const tag=/\d/.test(bullet[1])?"ol":"ul";if(!list||list.tagName.toLowerCase()!==tag){list=document.createElement(tag);root.append(list)}const li=document.createElement("li");inline(li,bullet[2]);list.append(li)}
  else{list=null;const p=document.createElement("p");inline(p,line);root.append(p)}
 }flushCode()
}
function sourceAction(h:ResultSource){
 if(busy)return;
 if(h.source==="memory"){const i=clusters.findIndex(c=>c.id===h.id);if(i>=0)focusCluster(i);else chatStatus.textContent="Источник недоступен"}
 else if(h.source==="work"){const r=workspaceMap.records.find(x=>x.id===h.id);if(r)void workspaceUI.openRecord(r.kind,r.id);else chatStatus.textContent="Запись недоступна или архивирована"}
 else{const f=workspaceMap.files.find(x=>x.id===h.id);if(f){byId<HTMLAnchorElement>("fileDownload").href="/api/disk/download?id="+f.id;byId("fileDetailName").textContent=f.name;byId("fileDetailSize").textContent=(f.size/1024).toLocaleString("ru",{maximumFractionDigits:1})+" КБ";byId<HTMLDialogElement>("fileDetail").showModal()}else chatStatus.textContent="Файл недоступен"}
}
function evidenceGraph(meta:ResultMeta){
 const root=document.createElement("div");root.className="evidence-graph";
 const sources=Array.from(new Map((meta.sources??[]).map(s=>[s.source+" #"+s.id,s])).entries());
 const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 320 170");svg.setAttribute("role","group");svg.setAttribute("aria-label","Граф общих терминов источников");
 const points=new Map(sources.map(([k],i)=>[k,{x:160+125*Math.cos(2*Math.PI*i/Math.max(1,sources.length)-Math.PI/2),y:85+58*Math.sin(2*Math.PI*i/Math.max(1,sources.length)-Math.PI/2)}]));
 for(const link of meta.links??[]){const a=points.get(link.from),b=points.get(link.to);if(!a||!b)continue;const line=document.createElementNS(ns,"line");line.setAttribute("x1",String(a.x));line.setAttribute("y1",String(a.y));line.setAttribute("x2",String(b.x));line.setAttribute("y2",String(b.y));line.setAttribute("class","evidence-edge");const title=document.createElementNS(ns,"title");title.textContent=link.terms.join(", ");line.append(title);svg.append(line)}
 for(const [k,s] of sources){const p=points.get(k)!;const g=document.createElementNS(ns,"g");g.setAttribute("transform","translate("+p.x+" "+p.y+")");g.setAttribute("role","button");g.setAttribute("tabindex","0");g.setAttribute("aria-label",s.title+" #"+s.id);const dot=document.createElementNS(ns,"circle");dot.setAttribute("r","8");dot.setAttribute("class","evidence-node "+s.source);const label=document.createElementNS(ns,"text");label.setAttribute("y","19");label.setAttribute("text-anchor","middle");label.textContent=(s.source==="memory"?"П":s.source==="work"?"Р":"Д")+"#"+s.id;g.append(dot,label);g.addEventListener("click",()=>sourceAction(s));g.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();sourceAction(s)}});svg.append(g)}
 root.append(svg);return root
}
function resultCard(meta:ResultMeta,messageId:number){
 const root=document.createElement("details");root.className="chat-result";const summary=document.createElement("summary");summary.textContent="Источники и инструменты"+(meta.tools?.length?" · "+meta.tools.join(", "):"");root.append(summary);
 if(meta.evidence_status){const p=document.createElement("p");p.textContent=({local_result:"Локальный результат",retrieval_only:"Найдены выдержки, требуется проверка",insufficient:"Недостаточно данных",external_excerpts:"Интернет-выдержки, не проверенные факты"} as Record<string,string>)[meta.evidence_status]??meta.evidence_status;p.textContent+=" · проходов поиска: "+(meta.search_passes??0);root.append(p)}
 if(meta.steps?.length){const p=document.createElement("p");p.textContent=meta.steps.map(s=>s.tool+" · "+s.status).join(" / ");root.append(p)}
 for(const h of meta.sources??[]){const b=document.createElement("button");b.type="button";b.textContent=h.title+" · #"+h.id;b.onclick=()=>sourceAction(h);root.append(b)}
 for(const h of meta.web_sources??[]){const div=document.createElement("div"),a=document.createElement("a");div.className="web-evidence";try{if(new URL(h.url).protocol!=="https:")continue}catch{continue}a.href=h.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=h.title;div.append(a);const p=document.createElement("p");p.textContent=(h.date||"Дата не указана")+" · непроверенная выдержка: "+h.excerpt;div.append(p);root.append(div)}
 if(meta.warnings?.length){const p=document.createElement("p");p.textContent=meta.warnings.join(" ");p.className="result-warning";root.append(p)}
 if(meta.links?.length){const p=document.createElement("p");p.textContent="Связи по общим словам (не причинность): "+meta.links.map(l=>l.from+" ↔ "+l.to+" · "+l.terms.join(", ")).join("; ");root.append(p);root.append(evidenceGraph(meta))}
 if(meta.table){const t=meta.table,wrap=document.createElement("div"),table=document.createElement("table"),head=document.createElement("tr"),body=document.createElement("tbody");wrap.className="chat-table-scroll";for(let i=0;i<t.columns.length;i++){const th=document.createElement("th"),b=document.createElement("button");b.type="button";b.textContent=t.columns[i];let asc=true;b.onclick=()=>{const rows=Array.from(body.rows);rows.sort((x,y)=>(x.cells[i].textContent??"").localeCompare(y.cells[i].textContent??"","ru",{numeric:true})*(asc?1:-1));asc=!asc;body.append(...rows)};th.append(b);head.append(th)}table.append(head);for(const row of t.rows){const tr=document.createElement("tr");for(const v of row){const td=document.createElement("td");td.textContent=v;tr.append(td)}body.append(tr)}table.append(body);wrap.append(table);root.append(wrap);const p=document.createElement("p");p.textContent="Показано "+t.rows.length+" из "+t.total_rows;root.append(p);for(const format of ["xlsx","docx"]){const b=document.createElement("button");b.type="button";b.textContent="Сохранить "+format.toUpperCase();b.onclick=async()=>{if(busy||!confirm("Сохранить именно эту таблицу на Диск?"))return;b.disabled=true;try{const out=await routingPost<{name:string}>("export-result",{message:messageId,format,confirm:true});chatStatus.textContent="Сохранено: "+out.name;await refreshWorkspaceMap(true)}catch(e){chatStatus.textContent=e instanceof Error?e.message:"Ошибка"}finally{b.disabled=false}};root.append(b)}}
 if(meta.series?.length){const chart=document.createElement("div");chart.className="chat-series";root.append(chart);drawSeries(meta.series,chart);root.open=true}
 return root;
}
function renderMessage(m:ChatMessage){

 const article=document.createElement("article");article.className="chat-message "+(m.role==="user"?"user-message":"reply");article.dataset.message=String(m.id);article.dataset.role=m.role;
 article.dataset.raw=m.text;const content=document.createElement("div");content.className="message-content";if(m.role==="assistant")renderMarkdown(content,m.text);else{const p=document.createElement("p");p.textContent=m.text.replace(/^\[Документ #\d+\]$/gm,"").trim();content.append(p);for(const match of m.text.matchAll(/^\[Документ #(\d+)\]$/gm)){const id=Number(match[1]),file=workspaceMap.files.find(f=>f.id===id),button=document.createElement("button");button.className="attachment-chip";button.type="button";button.textContent=file?.name??"Документ #"+id;button.onclick=()=>sourceAction({source:"file",id,title:button.textContent??""});content.append(button)}}if(m.role==="assistant"&&m.text.length>2200){const folded=document.createElement("details");folded.className="long-answer";const summary=document.createElement("summary");summary.textContent="Развернуть полный ответ · "+m.text.length.toLocaleString("ru")+" символов";const preview=document.createElement("p");preview.className="answer-preview";preview.textContent=m.text.slice(0,420)+"…";folded.append(summary,content);folded.ontoggle=()=>{preview.hidden=folded.open};article.append(preview,folded)}else article.append(content);
 if(m.role==="assistant"&&m.metadata&&(m.metadata.tools?.length||m.metadata.sources?.length||m.metadata.web_sources?.length||m.metadata.warnings?.length))article.append(resultCard(m.metadata,m.id));
 const actions=document.createElement("div");actions.className="message-actions";
 const copy=document.createElement("button");copy.type="button";copy.textContent="Копировать";copy.onclick=()=>void copyText(m.text);actions.append(copy);
 if(m.role==="user"){const reuse=document.createElement("button");reuse.type="button";reuse.textContent="Повторить";reuse.onclick=()=>{if(busy)return;if(selected>=0)select(selected);chatPrompt.value=m.text.slice(0,1000);resizePrompt();chatPrompt.focus()};actions.append(reuse)}
 if(m.role==="assistant"){
  const draft=document.createElement("button");draft.type="button";draft.textContent="Черновик Word";draft.onclick=async()=>{if(busy)return;if(m.text.length>4000){chatStatus.textContent="Для черновика выберите текст до 4000 символов";return}if(!confirm("Сохранить этот ответ как локальный DOCX-черновик?"))return;draft.disabled=true;try{const r=await agentApi<{name:string}>("cognitive",{action:"draft",title:"Ответ #"+m.id,body:m.text,confirm:true});chatStatus.textContent="Черновик: "+r.name;await refreshWorkspaceMap(true)}catch(e){chatStatus.textContent=e instanceof Error?e.message:"Ошибка"}finally{draft.disabled=false}};actions.append(draft);
  const correct=document.createElement("button");correct.type="button";correct.textContent="Исправить";correct.onclick=()=>{if(busy)return;const d=byId<HTMLDialogElement>("correctionDialog");byId<HTMLInputElement>("correctionId").value=String(m.id);byId<HTMLTextAreaElement>("correctionText").value="";d.showModal()};actions.append(correct);
 }
 const locate=document.createElement("button");locate.type="button";locate.textContent="На карте";locate.onclick=()=>{if(busy)return;const i=clusters.findIndex(c=>c.id===m.cluster_id);if(i>=0)focusCluster(i)};actions.append(locate);
 article.append(actions);return article;
}
const chatRecords=new Map<number,ChatMessage>(),rowHeights=new Map<number,number>(),mountedRows=new Map<number,HTMLElement>();
let virtualFrame=0,virtualBottom=false,virtualSignature="",virtualWidth=0;
function estimate(m:ChatMessage){return m.role==="assistant"&&m.text.length>2200?230:Math.min(1000,85+Math.ceil(m.text.length/55)*23)}
function scheduleVirtual(bottom=false){virtualBottom=virtualBottom||bottom;if(!virtualFrame)virtualFrame=requestAnimationFrame(()=>{virtualFrame=0;const b=virtualBottom;virtualBottom=false;redrawChat(b)})}
const rowObserver=new ResizeObserver(entries=>{
 let delta=0,changed=false;const all=Array.from(chatRecords.values()).sort((a,b)=>a.id-b.id),first=messages.scrollTop;
 let top=0;const before=new Set<number>();for(const m of all){const h=rowHeights.get(m.id)??estimate(m);if(top+h<=first)before.add(m.id);top+=h}
 for(const e of entries){const node=e.target as HTMLElement,id=Number(node.dataset.row),m=chatRecords.get(id);if(!m||mountedRows.get(id)!==node)continue;const old=rowHeights.get(id)??estimate(m),h=Math.max(1,Math.ceil(node.getBoundingClientRect().height));if(h!==old){rowHeights.set(id,h);changed=true;if(before.has(id))delta+=h-old}}
 if(changed){const atBottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<45;virtualSignature="";if(delta&&!atBottom)messages.scrollTop+=delta;scheduleVirtual(atBottom)}
});
function redrawChat(scrollBottom=false){
 const all=Array.from(chatRecords.values()).sort((a,b)=>a.id-b.id),width=messages.clientWidth;
 if(width&&Math.abs(width-virtualWidth)>25){rowHeights.clear();virtualWidth=width;virtualSignature=""}
 const heights=all.map(m=>rowHeights.get(m.id)??estimate(m)),total=heights.reduce((a,b)=>a+b,0),viewport=Math.max(100,messages.clientHeight);
 const offset=scrollBottom?Math.max(0,total-viewport):messages.scrollTop;
 const range=visibleRange(heights,offset,viewport);
 const ids=all.slice(range.start,range.end).map(m=>m.id),signature=ids.join(",")+":"+range.top+":"+range.bottom;
 if(signature!==virtualSignature){
  virtualSignature=signature;
  const keep=new Set(ids);for(const [id,node] of mountedRows)if(!keep.has(id)){rowObserver.unobserve(node);mountedRows.delete(id)}
  const top=document.createElement("div"),bottom=document.createElement("div");top.className=bottom.className="virtual-space";top.style.height=range.top+"px";bottom.style.height=range.bottom+"px";top.setAttribute("aria-hidden","true");bottom.setAttribute("aria-hidden","true");
  const nodes:HTMLElement[]=[top];for(const m of all.slice(range.start,range.end)){let node=mountedRows.get(m.id);if(!node){node=document.createElement("div");node.className="virtual-message-row";node.dataset.row=String(m.id);node.append(renderMessage(m));mountedRows.set(m.id,node);rowObserver.observe(node)}nodes.push(node)}nodes.push(bottom);
  if(streamingPreview)nodes.push(streamingPreview);messages.replaceChildren(...nodes);
 }
 if(scrollBottom)messages.scrollTop=messages.scrollHeight;
}
function resetChat(records:ChatMessage[]){rowObserver.disconnect();mountedRows.clear();rowHeights.clear();chatRecords.clear();virtualSignature="";for(const m of records)chatRecords.set(m.id,m);redrawChat(true)}
function appendMessage(m:ChatMessage){if(chatRecords.has(m.id))return;chatRecords.set(m.id,m);while(chatRecords.size>500){const first=chatRecords.keys().next().value;if(first===undefined)break;chatRecords.delete(first);rowHeights.delete(first)}redrawChat(true)}
function latestChat(){redrawChat(true)}
messages.addEventListener("scroll",()=>scheduleVirtual(),{passive:true});
new ResizeObserver(()=>scheduleVirtual()).observe(messages);
async function snapshot(cluster?:number):Promise<Snapshot>{const r=await fetch("/api/memory"+(cluster===undefined?"":"?cluster="+cluster),{cache:"no-store"});if(!r.ok)throw Error("history");return r.json()}
async function openHistory(i:number){
 const revision=++historyRevision;chat.hidden=false;syncChatIcons();
 historyTitle.textContent=i<0?"ТЕКУЩИЙ ДИАЛОГ":"АРХИВ · БЛОК "+clusters[i].id+" · "+counts[i]+"/500";
 liveButton.hidden=i<0;sendButton.disabled=i>=0||busy||!ready;chatPrompt.disabled=i>=0||!ready;
 try{const s=await snapshot(i<0?undefined:clusters[i].id);if(revision!==historyRevision)return;resetChat(s.messages);syncMap(s.clusters);chatStatus.textContent=i<0?"Локальная память · Cloud.ru по запросу":"Архив · для отправки вернитесь в диалог"}
 catch{if(revision===historyRevision)chatStatus.textContent="Не удалось загрузить переписку."}
}
liveButton.onclick=()=>{if(selected>=0)select(selected);else void openHistory(-1)};
function screenPoint(p:Point):Point{const m=world.getScreenCTM();if(!m)return{x:0,y:0};const s=new DOMPoint(p.x,p.y).matrixTransform(m);return{x:s.x,y:s.y}}
function corePoint(){return screenPoint({x:0,y:0})}
function modulePoint(id:string):Point{
 const m=group(id).getScreenCTM();if(!m)return corePoint();
 const p=new DOMPoint(0,0).matrixTransform(m);return{x:p.x,y:p.y};
}
function cloudPoint(){return modulePoint("cloudIcon")}
function chatPoint():Point{const r=chatPrompt.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width*.5,y:r.top+r.height*.5}:corePoint()}
function replyPoint():Point{
 const r=messages.getBoundingClientRect();return r.width&&r.height?{x:r.left+r.width*.5,y:r.bottom-18}:chatPoint();
}
function arrival(target:SVGElement|undefined,kind:"request"|"reply"|"memory"|"error"){
 if(!target||motionOff()||document.hidden)return;
 const old=arrivalTimers.get(target);if(old!==undefined)window.clearTimeout(old);
 target.classList.remove("arrived-request","arrived-reply","arrived-memory","arrived-error");
 target.classList.add("arrived-"+kind);
 arrivalTimers.set(target,window.setTimeout(()=>{target.classList.remove("arrived-"+kind);arrivalTimers.delete(target)},550));
}
function finishLeg(leg:FlowLeg){
 if(!flowLegs.delete(leg))return;
 leg.line.remove();leg.dots.forEach(d=>d.remove());leg.resolve();
}
function clearFlow(){
 for(const leg of Array.from(flowLegs))finishLeg(leg);
 for(const [target,timer] of arrivalTimers){window.clearTimeout(timer);target.classList.remove("arrived-request","arrived-reply","arrived-memory","arrived-error")}
 arrivalTimers.clear();pendingClusters.clear();renderKey="";
}
function playLeg(from:Endpoint,to:Endpoint,kind:"request"|"reply"|"memory"|"work"|"docs"|"web"):Promise<void>{
 if(motionOff()||document.hidden||flowLegs.size>=Math.max(3,Math.floor(12*quality)))return Promise.resolve();
 return new Promise(resolve=>{
  const layer=byId("traffic"),cls="quiet-"+kind;
  const line=el("line",{class:"quiet-route "+cls},layer);
  const dots=Array.from({length:Math.max(1,Math.round(PARTICLES*quality))},(_,i)=>el("circle",{r:particleAt(0,i,speed).radius,class:"quiet-particle "+cls,opacity:0},layer));
  flowLegs.add({from,to,begin:performance.now(),speed,dots,line,resolve});requestFrame();
 });
}
function updateFlow(now:number){
 if(motionOff()||document.hidden){if(flowLegs.size||pendingClusters.size){clearFlow();requestFrame()}return}
 for(const leg of flowLegs){
  const a=leg.from(),b=leg.to();
  if(![a.x,a.y,b.x,b.y].every(Number.isFinite)){finishLeg(leg);continue}
  leg.line.setAttribute("x1",String(a.x));leg.line.setAttribute("y1",String(a.y));leg.line.setAttribute("x2",String(b.x));leg.line.setAttribute("y2",String(b.y));
  let done=true;
  leg.dots.forEach((dot,i)=>{
   const sample=particleAt(now-leg.begin,i,leg.speed),p=mix(a,b,sample.progress);
   dot.setAttribute("cx",String(p.x));dot.setAttribute("cy",String(p.y));dot.setAttribute("opacity",String(sample.opacity));if(!sample.done)done=false;
  });
  if(done)finishLeg(leg);
 }
}
async function routeLeg(leg:Leg){
 switch(leg){
  case "chat-core":await playLeg(chatPoint,()=>modulePoint("chatIcon"),"request");arrival(group("chatIcon"),"request");await playLeg(()=>modulePoint("chatIcon"),corePoint,"request");arrival(group("core"),"request");break;
  case "core-cloud":await playLeg(corePoint,cloudPoint,"request");arrival(group("cloudIcon"),"request");break;
  case "cloud-core":await playLeg(cloudPoint,corePoint,"reply");arrival(group("core"),"reply");break;
  case "core-chat":await playLeg(corePoint,()=>modulePoint("chatIcon"),"reply");arrival(group("chatIcon"),"reply");await playLeg(()=>modulePoint("chatIcon"),replyPoint,"reply");break;
 }
}
async function remember(s:Snapshot){
 const ids=Array.from(new Set(s.messages.map(m=>m.cluster_id)));
 await Promise.all(ids.map(async id=>{
  const i=clusters.findIndex(c=>c.id===id);if(i<0)return;
  await playLeg(corePoint,()=>screenPoint(geometry.centers[i]),"memory");
  pendingClusters.delete(i);const item=visibleItems.get(key(i,0,false));
  item?.e.classList.remove("pending-memory");arrival(item?.e,"memory");renderKey="";requestFrame();
 }));
}
type SearchHit={source:"memory"|"work"|"file";id:number;title:string;text:string;updated:string;age_days:number;coverage:number};
type EditPreview={id:number;kind:string;field:string;label:string;before:string|number;after:string|number;version:string};
type RoutePlan={web_offer?:{query:string;action:string}|null;metadata?:ResultMeta;missing?:string[];mutation?:EditPreview|null;token:string;hits:SearchHit[];intent:string;sufficient:boolean;conflicts:string[];context:string;local:string;fts:boolean};
async function routingPost<T>(path:string,body:object):Promise<T>{
 const r=await fetch("/api/routing/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok)throw Error(data.error||"Ошибка поиска");return data as T;
}
let streamingPreview:HTMLDivElement|null=null,streamFrame=0;
function clearStreamPreview(){if(streamFrame)cancelAnimationFrame(streamFrame);streamFrame=0;streamingPreview?.remove();streamingPreview=null}
async function streamRequest(body:object):Promise<Snapshot>{
 const r=await fetch("/api/routing/stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 if(!r.ok||!r.body)throw Error("Поток недоступен");
 const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="",answer="",done:Snapshot|undefined;
 try{
  while(true){
   const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});
   const lines=buffer.split("\n");buffer=lines.pop()??"";
   if(buffer.length>4*1024*1024)throw Error("Слишком большая строка потока");
   for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);
    if(event.type==="error")throw Error(event.error);
    if(event.type==="delta"&&typeof event.text==="string"){
     answer+=event.text;if(answer.length>100000)throw Error("Слишком большой ответ");
     if(selected<0){if(!streamingPreview){streamingPreview=document.createElement("div");streamingPreview.className="stream-preview";messages.append(streamingPreview)}
      if(!streamFrame)streamFrame=requestAnimationFrame(()=>{streamFrame=0;if(streamingPreview){streamingPreview.textContent=answer;messages.scrollTop=messages.scrollHeight}});}
    }else if(event.type==="done")done=event.result as Snapshot;
   }
   if(chunk.done)break;
  }
  if(!done)throw Error("Поток оборвался до сохранения");
  return done;
 }finally{await reader.cancel().catch(()=>{});clearStreamPreview()}
}
async function retrieveAnimation(hits:SearchHit[]){
 const distinct=Array.from(new Map(hits.map(h=>[h.source+":"+h.id,h])).values());
 await Promise.all(distinct.map(async h=>{
  const locate=()=>h.source==="memory"?clusters.findIndex(c=>c.id===h.id):h.source==="work"?workspaceMap.records.findIndex(r=>r.id===h.id):workspaceMap.files.findIndex(f=>f.id===h.id);
  if(locate()<0)return;
  const target=()=>{const i=locate();return i<0?corePoint():screenPoint(h.source==="memory"?memoryPoint(i):h.source==="work"?workPoint(i):filePoint(i))};
  const kind=h.source==="memory"?"memory":h.source==="work"?"work":"docs";
  const i0=locate();const node0=h.source==="memory"?visibleItems.get(key(i0,0,false))?.e:h.source==="work"?workNodes.get(h.id):fileNodes.get(h.id);arrival(node0,"memory");
  await playLeg(corePoint,target,kind);
  const i=locate();if(i<0)return;
  const node=h.source==="memory"?visibleItems.get(key(i,0,false))?.e:h.source==="work"?workNodes.get(h.id):fileNodes.get(h.id);
  arrival(node,"memory");
  await playLeg(target,corePoint,kind);arrival(group("core"),"reply");
 }));
}
function sourceEndpoint(ref:string):Endpoint|undefined{
 const m=ref.match(/^(memory|work|file) #(\d+)$/);if(!m)return;const id=Number(m[2]);
 if(m[1]==="memory"&&!clusters.some(c=>c.id===id)||m[1]==="work"&&!workspaceMap.records.some(r=>r.id===id)||m[1]==="file"&&!workspaceMap.files.some(f=>f.id===id))return;
 return ()=>{const i=m[1]==="memory"?clusters.findIndex(c=>c.id===id):m[1]==="work"?workspaceMap.records.findIndex(r=>r.id===id):workspaceMap.files.findIndex(f=>f.id===id);return i<0?corePoint():screenPoint(m[1]==="memory"?memoryPoint(i):m[1]==="work"?workPoint(i):filePoint(i))}
}
async function animateEvidence(meta?:ResultMeta){if(!meta)return;await Promise.all((meta.links??[]).slice(0,4).map(async l=>{const a=sourceEndpoint(l.from),b=sourceEndpoint(l.to);if(a&&b)await playLeg(a,b,"memory")}))}
function chatPhase(phase:string){document.body.dataset.chatPhase=phase;group("chatIcon").dataset.phase=phase;chat.dataset.phase=phase;if(phase==="search")arrival(group("chatIcon"),"request")}
type PreviewStep={id:string;tool:string;month:string;depends:string[]};
async function previewChatPlan(request:{text:string;request_id:string}){
 const preview=await routingPost<{steps:PreviewStep[];note:string}>("preview",request);
 if(!preview.steps.length)return preview.steps;
 const dialog=byId<HTMLDialogElement>("chatPlanDialog"),output=byId("chatPlanSteps");
 output.textContent=preview.steps.map((s,i)=>(i+1)+". "+s.tool+(s.month?" · "+s.month:"")+(s.depends.length?" · после "+s.depends.join(", "):" · независимый шаг")).join("\n");
 const ok=await new Promise<boolean>(resolve=>{dialog.returnValue="cancel";dialog.addEventListener("close",()=>resolve(dialog.returnValue==="run"),{once:true});dialog.showModal()});
 if(!ok){cancelPreparation=true;throw Error("План отменён")}return preview.steps
}
async function runChatPlan(request:{text:string;request_id:string},steps:PreviewStep[]):Promise<RoutePlan>{
 if(!steps.length)return routingPost<RoutePlan>("plan",request);
 const response=await fetch("/api/routing/plan-stream",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...request,steps})});
 if(!response.ok||!response.body)throw Error("Нет потока плана");
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="",result:RoutePlan|undefined;
 const statuses=new Map<string,string>();
 try{while(true){const chunk=await reader.read();buffer+=decoder.decode(chunk.value,{stream:!chunk.done});const lines=buffer.split("\n");buffer=lines.pop()??"";if(buffer.length>4*1024*1024)throw Error("Слишком большой результат");
 for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);
 if(event.type==="error")throw Error(event.error);
 if(event.type==="done")result=event.result as RoutePlan;
 if(event.type==="progress"){const p=event.step;statuses.set(p.id,p.tool+" · "+p.status);byId("chatProgress").textContent=[...statuses.values()].join(" | ");chatPhase("tool");const id=p.tool==="files"?"docsIcon":p.tool==="health"||p.tool==="summary"?null:"workIcon";if(id){if(p.status==="scheduled"){arrival(group(id),"request");void playLeg(corePoint,()=>modulePoint(id),id==="docsIcon"?"docs":"work")}else{arrival(group(id),p.status==="ok"?"reply":"error");void playLeg(()=>modulePoint(id),corePoint,id==="docsIcon"?"docs":"work")}}else arrival(group("core"),p.status==="scheduled"?"request":p.status==="ok"?"reply":"error")}
 }if(chunk.done)break}if(!result)throw Error("План прерван");return result}finally{await reader.cancel().catch(()=>{})}
}
function approveCloud(text:string,plan:RoutePlan):Promise<boolean>{
 const dialog=byId<HTMLDialogElement>("routingConsent");
 byId("routingQuestion").textContent=text;
 byId("routingContext").textContent=plan.context||"Нет найденных выдержек — будет отправлен только вопрос.";
 byId("routingWarnings").textContent=[...plan.conflicts,...(plan.missing?.length?["Не подтверждено точными совпадениями: "+plan.missing.join(", ")]:[])].join("; ");
 return new Promise(resolve=>{
  dialog.returnValue="local";
  dialog.addEventListener("close",()=>resolve(dialog.returnValue==="cloud"),{once:true});
  dialog.showModal();
 });
}
function approveEdit(m:EditPreview):Promise<boolean>{
 const dialog=byId<HTMLDialogElement>("editConsent");
 byId("editRecord").textContent="Запись #"+m.id+" · "+m.label;
 byId("editBefore").textContent=String(m.before);byId("editAfter").textContent=String(m.after);
 return new Promise(resolve=>{dialog.returnValue="cancel";dialog.addEventListener("close",()=>resolve(dialog.returnValue==="apply"),{once:true});dialog.showModal()});
}
form.onsubmit=async e=>{
 e.preventDefault();const raw=chatPrompt.value.trim();if(!raw||busy||attaching||!ready||selected>=0)return;
 const paid=cloudAvailable&&!localOnly;
 busy=true;preparing=true;cancelPreparation=false;chatPhase("search");updateToolState();sendButton.disabled=true;chatPrompt.disabled=true;chatStatus.textContent="Поиск в локальной памяти…";
 if(!pending||pending.text!==raw)pending={text:raw,request_id:crypto.randomUUID()};
 const request=pending;let plan:RoutePlan|undefined,approved=false,editApproved=false;
 try{
  await runQuietFlow<Snapshot>(paid,{
   leg:routeLeg,
   prepare:async requested=>{
    checkPreparation();chatStatus.textContent="Поиск: переписка, работа, документы…";
    const steps=await previewChatPlan(request);checkPreparation();plan=await runChatPlan(request,steps);
    await refreshWorkspaceMap();
    chatStatus.textContent="Найдено источников: "+plan.hits.length+(plan.fts?" · FTS5":" · ограниченный поиск");
    checkPreparation();await retrieveAnimation(plan.hits);checkPreparation();await animateEvidence(plan.metadata);checkPreparation();
    if(plan.web_offer&&!localOnly&&confirm("Разрешить интернет-поиск? Внешнему поисковику будет отправлено только:\n"+plan.web_offer.query+"\nРежим: "+plan.web_offer.action)){
     checkPreparation();chatPhase("web");chatStatus.textContent="Интернет: получение источников…";
     const icon=group("webIcon");icon.classList.add("module-working");
     try{await playLeg(corePoint,()=>modulePoint("webIcon"),"web");checkPreparation();plan=await routingPost<RoutePlan>("web",{token:plan.token,...plan.web_offer,confirm:true});await playLeg(()=>modulePoint("webIcon"),corePoint,"web");arrival(group("core"),"reply")}
     catch(e){chatStatus.textContent="Интернет недоступен: "+(e instanceof Error?e.message:"ошибка");if(cancelPreparation)throw e}
     finally{icon.classList.remove("module-working")}
    }
    checkPreparation();chatPhase("tool");
    if(plan.mutation)editApproved=await approveEdit(plan.mutation);
    else approved=!!(requested&&cloudAvailable&&!localOnly&&!plan.sufficient&&await approveCloud(request.text,plan));
    checkPreparation();preparing=false;updateToolState();
    chatStatus.textContent=approved?"Cloud.ru: отправка подтверждена…":plan.sufficient?"Локальный ответ…":"Локальные результаты · без Cloud.ru";
    return approved;
   },
   waiting:active=>{chatPhase(active?"cloud":"reply");group("cloudIcon").classList.toggle("cloud-waiting",active);if(active)chatStatus.textContent="Cloud.ru: ожидание ответа…"},
   send:async()=>{
    if(!plan)throw Error("Нет плана поиска");
    const body={text:request.text,request_id:request.request_id,token:plan.token,cloud:approved,approve_edit:editApproved};
    return approved?streamRequest(body):routingPost<Snapshot>("execute",body);
   },
   committed:s=>{
    const previousCount=clusters.length;syncMap(s.clusters);pending=null;chatPrompt.value="";resizePrompt();
    if(selected<0)s.messages.filter(m=>m.role==="user").forEach(appendMessage);
    if(!s.duplicate&&!motionOff()&&!document.hidden)for(let i=previousCount;i<clusters.length;i++)pendingClusters.add(i);
    renderKey="";requestFrame();
   },
   duplicate:s=>!!s.duplicate,
   deliver:s=>{if(selected<0)s.messages.filter(m=>m.role==="assistant").forEach(appendMessage)},
   remember
  });
  if(editApproved)void refreshWorkspaceMap();
  chatStatus.textContent=(approved?"Cloud.ru":"Локальный ответ")+" · сохранено · "+counts.reduce((a,b)=>a+b,0)+" сообщений";
 }catch(error){clearFlow();if(cancelPreparation){chatStatus.textContent="Подготовка отменена. Запрос не отправлен.";return}arrival(group(approved?"cloudIcon":"core"),"error");requestFrame();chatStatus.textContent=approved?"Cloud.ru: "+(error instanceof Error?error.message:"ошибка")+". Автоповтора нет; проверьте расход перед повтором.":(error instanceof Error?error.message:"Операция не завершена")+". Проверьте результат перед повтором.";try{const recovered=await snapshot();syncMap(recovered.clusters);if(recovered.messages.some(m=>(m as ChatMessage & {request_id?:string}).request_id===request.request_id)){pending=null;chatPrompt.value="";resizePrompt();resetChat(recovered.messages);chatStatus.textContent="Сохранение восстановлено из SQLite"}}catch{/* preserve pending request for retry */}}
 finally{byId("chatProgress").textContent="";chatPhase("idle");busy=false;preparing=false;cancelPreparation=false;updateToolState();sendButton.disabled=selected>=0||!ready;chatPrompt.disabled=selected>=0||!ready;if(!chatPrompt.disabled)chatPrompt.focus()}
};
async function initChat(){
 sendButton.disabled=true;chatPrompt.disabled=true;
 try{const s=await snapshot();syncMap(s.clusters);resetChat(s.messages);ready=true;chatStatus.textContent="Локальная память · Cloud.ru по запросу";await loadCamera()}
 catch{chatStatus.textContent="Не удалось загрузить локальную память. Обновите страницу."}
 finally{sendButton.disabled=!ready;chatPrompt.disabled=!ready}
}
document.addEventListener("visibilitychange",()=>{if(document.hidden)clearFlow();else{renderKey="";requestFrame();void refreshWorkspaceMap();if(ready&&!busy)void snapshot().then(s=>{syncMap(s.clusters);if(selected<0)s.messages.forEach(appendMessage)}).catch(()=>{})}});
void initChat();
async function checkHealth(){try{const r=await fetch("/api/chat/health",{cache:"no-store"});if(!r.ok)throw Error("health");const h=await r.json();byId("memoryHealth").textContent=h.ok?"SQLite: целостность подтверждена · "+h.messages+" сообщений":"SQLite: обнаружена аномалия · "+h.issues.join(", ")}catch{byId("memoryHealth").textContent="Диагностика памяти недоступна"}}
byId("checkMemory").onclick=()=>void checkHealth();void checkHealth();
const searchInput=byId<HTMLInputElement>("mapSearch"),results=byId("searchResults");
function searchMap(){
 const q=searchInput.value.trim().toLocaleLowerCase("ru");results.replaceChildren();if(!q)return;
 const hits:{title:string;cluster:number;item?:Item}[]=names.map((title,cluster)=>({title,cluster})).filter(x=>x.title.toLocaleLowerCase("ru").includes(q));
 for(const item of items){const id=nodeId(item.cluster,item.index,item.outer);if(id.toLowerCase()===q)hits.unshift({title:id+" · "+names[item.cluster],cluster:item.cluster,item});if(hits.length>=12)break}
 for(const hit of hits.slice(0,12)){const b=document.createElement("button");b.textContent=hit.title;b.onclick=()=>{if(hit.item){if(selected!==hit.cluster)select(hit.cluster);const p=position(hit.item);animateCamera(5,-p.x*5,-p.y*5)}else focusCluster(hit.cluster);results.replaceChildren();searchInput.value=hit.title};results.append(b)}
 if(!hits.length)results.textContent="Ничего не найдено";
}
searchInput.addEventListener("input",searchMap);
searchInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();results.querySelector("button")?.click()}if(e.key==="Escape")results.replaceChildren()});
new ResizeObserver(()=>requestFrame()).observe(svg);

type CloudState={has_key:boolean;saved_key:boolean;model:string;verified:boolean;models:string[]};
const cloudDialog=byId<HTMLDialogElement>("cloudDialog"),cloudIcon=group("cloudIcon"),cloudKey=byId<HTMLInputElement>("cloudKey"),cloudModels=byId<HTMLSelectElement>("cloudModels"),cloudStatus=byId("cloudStatus");
let cloudBusy=false,cloudState:CloudState|null=null;
function showCloud(s:CloudState){
 cloudState=s;cloudModels.replaceChildren();
 for(const model of s.models){const opt=document.createElement("option");opt.value=model;opt.textContent=model;cloudModels.append(opt)}
 if(s.models.includes(s.model))cloudModels.value=s.model;
 const connected=s.verified&&s.models.includes(s.model);
 cloudIcon.classList.toggle("cloud-connected",connected);cloudAvailable=connected;updateToolState();
 byId("cloudSelected").textContent=s.model||"Модель не выбрана";
 cloudStatus.textContent=connected?"Каталог проверен · модель выбрана":s.has_key?"Ключ сохранён локально · загрузите каталог":"Введите API-ключ";
 byId<HTMLButtonElement>("cloudConnect").disabled=!s.verified||!s.models.length||cloudBusy;
 byId<HTMLInputElement>("cloudPersist").checked=s.saved_key;
}
async function cloudAction(path:string,body?:object){
 if(cloudBusy)return;cloudBusy=true;
 for(const id of ["cloudSave","cloudLoad","cloudConnect","cloudRemove"])byId<HTMLButtonElement>(id).disabled=true;
 cloudStatus.textContent="Выполняется…";
 try{const r=await fetch("/api/cloud/"+path,body===undefined?{cache:"no-store"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const s=await r.json();if(!r.ok)throw Error(s.error||"Ошибка Cloud.ru");showCloud(s);if(path==="key")cloudKey.value=""}
 catch(e){cloudStatus.textContent=e instanceof Error?e.message:"Cloud.ru недоступен";if(path==="models"||path==="key"){cloudAvailable=false;updateToolState();cloudIcon.classList.remove("cloud-connected")}}
 finally{cloudBusy=false;for(const id of ["cloudSave","cloudLoad","cloudRemove"])byId<HTMLButtonElement>(id).disabled=false;byId<HTMLButtonElement>("cloudConnect").disabled=!cloudState?.verified||!cloudState.models.length}
}
function openCloud(){if(!cloudDialog.open)cloudDialog.showModal();void cloudAction("status")}
cloudIcon.addEventListener("click",openCloud);cloudIcon.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openCloud()}});
byId("cloudClose").onclick=()=>cloudDialog.close();
byId("cloudSave").onclick=()=>{if(!cloudKey.value.trim()){cloudStatus.textContent="Введите ключ или используйте кнопку удаления";return}void cloudAction("key",{key:cloudKey.value.trim(),persist:byId<HTMLInputElement>("cloudPersist").checked})};
byId("cloudRemove").onclick=()=>void cloudAction("key",{key:"",persist:false});
byId("cloudLoad").onclick=()=>void cloudAction("models",{});
byId("cloudConnect").onclick=()=>void cloudAction("connect",{model:cloudModels.value});
void cloudAction("status");

function bindOrbit(id:string,open:()=>void){
 const icon=group(id);icon.addEventListener("click",open);icon.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open()}});
}
const activityCounts=new Map<string,number>();
async function moduleRequest<T>(id:"workIcon"|"docsIcon",operation:()=>Promise<T>):Promise<T>{
 const icon=group(id),kind=id==="workIcon"?"work":"docs";
 activityCounts.set(id,(activityCounts.get(id)??0)+1);icon.classList.add("module-working");
 try{
  await playLeg(corePoint,()=>modulePoint(id),kind);arrival(icon,"request");
  const result=await operation();
  await playLeg(()=>modulePoint(id),corePoint,kind);arrival(group("core"),"reply");
  void refreshWorkspaceMap(true);return result;
 }catch(e){arrival(icon,"error");throw e}
 finally{const n=(activityCounts.get(id)??1)-1;activityCounts.set(id,n);if(n===0)icon.classList.remove("module-working")}
}
const workspaceUI=setupWorkspace(bindOrbit,moduleRequest);
bindOrbit("chatIcon",toggleChat);syncChatIcons();
for(const icon of moduleList()){
 const show=()=>hover("module",0,icon.id);
 icon.addEventListener("pointerenter",show);icon.addEventListener("pointerleave",unhover);icon.addEventListener("focus",show);icon.addEventListener("blur",unhover);
}
byId("fileDetailClose").onclick=()=>byId<HTMLDialogElement>("fileDetail").close();
const toolMenu=byId("chatTools"),toolToggle=byId<HTMLButtonElement>("chatToolsToggle"),searchDialog=byId<HTMLDialogElement>("chatSearchDialog");
function closeTools(){toolMenu.hidden=true;toolToggle.setAttribute("aria-expanded","false")}
toolToggle.onclick=()=>{toolMenu.hidden=!toolMenu.hidden;toolToggle.setAttribute("aria-expanded",String(!toolMenu.hidden))};
document.addEventListener("pointerdown",e=>{if(e.target instanceof Node&&!toolMenu.contains(e.target)&&!toolToggle.contains(e.target))closeTools()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeTools()});
function updateToolState(){
 const local=byId<HTMLButtonElement>("toolLocal");local.setAttribute("aria-pressed",String(localOnly));local.textContent=localOnly?"Только локально ✓":"Только локально";
 byId("toolCloudState").textContent=cloudAvailable?"Модель подключена":"Модель не подключена";
 byId<HTMLButtonElement>("stopPreparation").hidden=!preparing;
 for(const id of ["toolLocal","toolSearch","toolWork","toolDocs","toolCloud","toolCalculator","toolReports","toolWorkflow","toolAgent","toolAttach","toolImport","toolWeb","toolKnowledge","toolCognitive"])byId<HTMLButtonElement>(id).disabled=busy;
}
function checkPreparation(){if(cancelPreparation)throw Error("Подготовка отменена")}
byId("stopPreparation").onclick=()=>{if(!preparing)return;cancelPreparation=true;clearFlow();for(const name of ["routingConsent","editConsent","chatPlanDialog"]){const d=byId<HTMLDialogElement>(name);if(d.open)d.close("cancel")}chatStatus.textContent="Отмена подготовки…"};
const chatResize=byId("chatResize"),chatFull=byId<HTMLButtonElement>("chatFull");
let chatWidth=0,chatDrag=false;
function setChatWidth(width:number){chatWidth=Math.round(Math.max(260,Math.min(innerWidth*.65,width)));chat.style.setProperty("--chat-width",chatWidth+"px");chatResize.setAttribute("aria-valuenow",String(chatWidth));requestFrame()}
chatResize.addEventListener("pointerdown",e=>{if(innerWidth<=720||document.body.classList.contains("full-chat"))return;chatDrag=true;chatResize.setPointerCapture(e.pointerId);e.preventDefault()});
chatResize.addEventListener("pointermove",e=>{if(chatDrag)setChatWidth(innerWidth-e.clientX)});
for(const event of ["pointerup","pointercancel","lostpointercapture"])chatResize.addEventListener(event,()=>{chatDrag=false});
chatResize.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();setChatWidth((chatWidth||chat.clientWidth)+(e.key==="ArrowLeft"?24:-24))}});
function setChatFull(on:boolean){document.body.classList.toggle("full-chat",on);chatFull.setAttribute("aria-pressed",String(on));chatFull.title=on?"Вернуть карту":"Развернуть чат";chatFull.setAttribute("aria-label",chatFull.title);requestFrame()}
chatFull.onclick=()=>setChatFull(!document.body.classList.contains("full-chat"));
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.body.classList.contains("full-chat")&&!document.querySelector("dialog[open]"))setChatFull(false)});
function resizePrompt(){chatPrompt.style.height="auto";chatPrompt.style.height=Math.min(chatPrompt.scrollHeight,120)+"px";const q=chatPrompt.value.toLowerCase(),h=byId("chatSuggestion");h.textContent=/сравн|excel|xlsx/.test(q)?"Таблицы: прикрепите файлы и укажите ключ: столбец":/новост|интернет|свеж/.test(q)?"Интернет: отдельное подтверждение":/статистик|график/.test(q)?"Статистика: 10 15 20":/отч[её]т|гсм|табел/.test(q)?"Отчёт: укажите месяц ГГГГ-ММ":""}
chatPrompt.addEventListener("input",resizePrompt);
chatPrompt.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();if(!busy)form.requestSubmit(sendButton)}});
async function copyText(text:string){
 try{await navigator.clipboard.writeText(text);chatStatus.textContent="Скопировано"}catch{chatStatus.textContent="Копирование недоступно. Выделите текст вручную."}
}
function displayedText(){return Array.from(chatRecords.values()).sort((a,b)=>a.id-b.id).map(m=>(m.role==="user"?"Вы":"Amatsureika")+": "+m.text).join("\n\n")}
byId("toolCopy").onclick=()=>{closeTools();void copyText(displayedText())};
byId("toolExport").onclick=()=>{closeTools();const blob=new Blob([displayedText()],{type:"text/plain;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="Amatsureika-"+(selected>=0?"block-"+clusters[selected].id:"dialog")+".txt";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)};
byId("toolLatest").onclick=()=>{closeTools();if(!busy){if(selected>=0)select(selected);else latestChat()}};
byId("toolLocal").onclick=()=>{if(busy)return;localOnly=!localOnly;updateToolState();closeTools();chatStatus.textContent=localOnly?"Локальный режим":"Автоматический выбор маршрута"};
function openModule(id:string){closeTools();group(id).dispatchEvent(new MouseEvent("click"))}
byId("toolWork").onclick=()=>openModule("workIcon");byId("toolDocs").onclick=()=>openModule("docsIcon");byId("toolCloud").onclick=()=>openModule("cloudIcon");
byId("toolSearch").onclick=()=>{closeTools();searchDialog.showModal();byId<HTMLInputElement>("chatSearchQuery").focus()};
byId("chatSearchClose").onclick=()=>searchDialog.close();
let searchRun=0;
searchDialog.addEventListener("close",()=>{searchRun++});
byId<HTMLFormElement>("chatSearchForm").onsubmit=async e=>{
 e.preventDefault();const q=byId<HTMLInputElement>("chatSearchQuery").value.trim();if(!q)return;
 const run=++searchRun,results=byId("chatSearchHits");results.textContent="Поиск…";
 try{
  const data=await routingPost<{hits:SearchHit[];fts:boolean}>("search",{text:q,scope:byId<HTMLSelectElement>("chatSearchScope").value});
  if(run!==searchRun)return;results.replaceChildren();
  if(!data.hits.length){results.textContent="Совпадений не найдено";return}
  for(const hit of data.hits){
   const card=document.createElement("div");card.className="chat-search-hit";
   const title=document.createElement("strong");title.textContent=({memory:"Память",work:"Работа",file:"Документы"}[hit.source])+" #"+hit.id+" · "+hit.title;
   const body=document.createElement("p");body.textContent=hit.text;
   const button=document.createElement("button");button.type="button";button.textContent="Открыть источник";
   button.onclick=()=>{
    searchDialog.close();
    if(hit.source==="memory"){const i=clusters.findIndex(c=>c.id===hit.id);if(i>=0)focusCluster(i)}
    else if(hit.source==="work"){const r=workspaceMap.records.find(x=>x.id===hit.id);if(r)void workspaceUI.openRecord(r.kind,r.id)}
    else{const f=workspaceMap.files.find(x=>x.id===hit.id);if(f){byId<HTMLAnchorElement>("fileDownload").href="/api/disk/download?id="+f.id;byId("fileDetailName").textContent=f.name;byId("fileDetailSize").textContent=(f.size/1024).toLocaleString("ru",{maximumFractionDigits:1})+" КБ";byId<HTMLDialogElement>("fileDetail").showModal()}}
   };
   card.append(title,body,button);results.append(card);
  }
 }catch(e){if(run===searchRun)results.textContent=e instanceof Error?e.message:"Ошибка поиска"}
};
type AgentStep={id:string;tool:string;month:string;depends:string[]};
type AgentRegistry={id:string;title:string;permission:string;month:boolean};
type AgentResult={draft?:string;steps:{id:string;tool:string;text:string;status:string}[];ok:boolean;snapshot:string};
type AutomationRule={id:string;scenario:string;mode:string;interval_seconds:number;file_id:number|null;enabled:number;status:string;next_check:number;last_job:string};
type AgentState={rules?:AutomationRule[];registry:AgentRegistry[];scenarios:{id:string;name:string;created:string}[];jobs:{id:string;status:string;due:string;result:AgentResult|null}[];runs:{tool:string;status:string;duration_ms:number;detail:string;created:string}[]};
const agentDialog=byId<HTMLDialogElement>("agentDialog"),agentOutput=byId("agentOutput"),agentTools=byId<HTMLSelectElement>("agentTools"),agentMonth=byId<HTMLInputElement>("agentMonth"),agentScenarios=byId<HTMLSelectElement>("agentScenarios");
let agentState:AgentState|null=null,agentBusy=false,agentSteps:AgentStep[]=[];
async function agentApi<T>(path:string,value:object):Promise<T>{const r=await fetch("/api/agent/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});const data=await r.json();if(!r.ok)throw Error(data.error||"Ошибка инструмента");return data as T}
function showAgentResult(r:AgentResult){agentOutput.textContent=r.steps.map(s=>s.tool+" · "+s.status+"\n"+s.text).join("\n\n")+"\n"+r.snapshot+(r.draft?"\n\n"+r.draft:"")}
async function refreshAgent(){
 const state=await agentApi<AgentState>("state",{});agentState=state;
 const selectedTools=new Set(Array.from(agentTools.selectedOptions).map(o=>o.value)),selectedScenario=agentScenarios.value;agentTools.replaceChildren();agentScenarios.replaceChildren();
 for(const t of state.registry.filter(t=>t.permission==="read_local"&&t.id!=="summary")){const o=document.createElement("option");o.value=t.id;o.textContent=t.title;o.selected=selectedTools.has(t.id);agentTools.append(o)}
 for(const s of state.scenarios){const o=document.createElement("option");o.value=s.id;o.textContent=s.name;agentScenarios.append(o)}
 if(state.scenarios.some(s=>s.id===selectedScenario))agentScenarios.value=selectedScenario;
 const rules=byId("agentRulesList");rules.replaceChildren();
 for(const rule of state.rules??[]){const row=document.createElement("div"),p=document.createElement("p");p.textContent=(state.scenarios.find(s=>s.id===rule.scenario)?.name??rule.scenario)+" · "+rule.mode+" · "+rule.status+" · "+(rule.enabled?new Date(rule.next_check*1000).toLocaleString("ru"):"выключено");row.append(p);if(rule.enabled){const b=document.createElement("button");b.type="button";b.textContent="Отключить";b.onclick=()=>void agentAction(async()=>{await agentApi("rules",{action:"disable",id:rule.id,confirm:true});await refreshAgent()});row.append(b)}rules.append(row)}
 const jobs=byId("agentJobs");jobs.replaceChildren();
 for(const j of state.jobs){const item=document.createElement("button");item.type="button";item.textContent=j.status+" · "+new Date(j.due).toLocaleString("ru");item.onclick=()=>{if(j.result?.steps)showAgentResult(j.result);else agentOutput.textContent=j.status};jobs.append(item);if(j.status==="queued"){const cancel=document.createElement("button");cancel.type="button";cancel.textContent="Отменить";cancel.onclick=()=>void agentAction(async()=>{await agentApi("rules",{action:"cancel",id:j.id,confirm:true});await refreshAgent()});jobs.append(cancel)}}
 byId("agentRuns").textContent=state.runs.map(r=>r.tool+" · "+r.status+" · "+r.duration_ms+" мс · "+r.created.slice(0,19)).join("\n")||"Нет запусков";
 byId("agentPermissions").textContent=state.registry.map(r=>r.title+" — "+(r.permission==="read_local"?"чтение локально":"отдельное подтверждение")).join("\n");
}
function makeAgentSteps(){
 if(!agentState)throw Error("Реестр не загружен");const selected=Array.from(agentTools.selectedOptions);if(!selected.length)throw Error("Выберите инструменты");
 const steps=selected.map((o,i)=>({id:"s"+(i+1),tool:o.value,month:agentState!.registry.find(t=>t.id===o.value)?.month?agentMonth.value:"",depends:[] as string[]}));
 if(steps.length>1)steps.push({id:"summary",tool:"summary",month:"",depends:steps.map(s=>s.id)});return steps
}
async function agentAction(action:()=>Promise<void>){if(agentBusy)return;agentBusy=true;try{await action()}catch(e){agentOutput.textContent=e instanceof Error?e.message:"Ошибка"}finally{agentBusy=false}}
byId("toolAgent").onclick=()=>{closeTools();if(busy)return;const d=new Date();agentMonth.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");agentDialog.showModal();void agentAction(refreshAgent)};
byId("agentClose").onclick=()=>agentDialog.close();
byId("agentRefresh").onclick=()=>void agentAction(refreshAgent);
byId("agentRun").onclick=()=>void agentAction(async()=>{agentSteps=[];const steps=makeAgentSteps();if(!confirm("Выполнить цепочку:\n"+steps.map(s=>s.tool+(s.depends.length?" ← "+s.depends.join(", "):"")).join("\n")))return;agentOutput.textContent="Выполнение…";const r=await agentApi<AgentResult>("run",{steps});showAgentResult(r);if(r.ok)agentSteps=steps;await refreshAgent()});
byId("agentSave").onclick=()=>void agentAction(async()=>{const name=byId<HTMLInputElement>("agentName").value.trim();if(!name)throw Error("Введите название");if(!agentSteps.length)throw Error("Сначала успешно выполните сценарий");await agentApi("save",{name,steps:agentSteps});await refreshAgent();agentOutput.textContent="Сценарий сохранён"});
byId("agentReplay").onclick=()=>void agentAction(async()=>{if(!agentScenarios.value)throw Error("Выберите сценарий");showAgentResult(await agentApi<AgentResult>("replay",{id:agentScenarios.value}));await refreshAgent()});
byId("agentQueue").onclick=()=>void agentAction(async()=>{const value=byId<HTMLInputElement>("agentDue").value;if(!value||!agentScenarios.value)throw Error("Выберите сценарий и время");const due=new Date(value);if(!Number.isFinite(due.getTime()))throw Error("Некорректное время");await agentApi("queue",{scenario:agentScenarios.value,due:due.toISOString()});await refreshAgent();agentOutput.textContent="Задача добавлена в локальную очередь"});
byId("agentRuleAdd").onclick=()=>void agentAction(async()=>{if(!agentScenarios.value)throw Error("Выберите сохранённый сценарий");const mode=byId<HTMLSelectElement>("agentRuleMode").value,minutes=Number(byId<HTMLInputElement>("agentRuleMinutes").value),file=mode==="file"?Number(byId<HTMLInputElement>("agentRuleFile").value):null;if(!confirm("Разрешить повторяющийся локальный сценарий? Только чтение, без Cloud.ru. Для остановки отключите правило."))return;await agentApi("rules",{action:"add",scenario:agentScenarios.value,mode,minutes,file,current_month:byId<HTMLInputElement>("agentRuleMonth").checked,draft:byId<HTMLInputElement>("agentRuleDraft").checked,confirm:true});await refreshAgent();agentOutput.textContent="Правило сохранено в SQLite"});
byId("agentMileageSave").onclick=()=>void agentAction(async()=>{const v=Number(byId<HTMLInputElement>("agentVehicle").value),km=Number(byId<HTMLInputElement>("agentKm").value);if(!confirm("Сохранить месячный пробег автомобиля #"+v+"?"))return;await agentApi("mileage",{vehicle:v,month:agentMonth.value,km});agentOutput.textContent="Пробег сохранён"});
type WebPage={url:string;title:string;text:string;published:string;modified:string;fetched:string;cached?:boolean};
type WebItem={url:string;title:string;published:string;publisher:string};
type WebWatch={id:string;url:string;status:string;enabled:number;checked:string};
type WebResult={items?:WebItem[]|WebWatch[];pages?:WebPage[];overlaps?:{a:string;b:string;terms:string[]}[];errors?:{url:string;error:string}[];queries?:string[];note?:string;provider?:string;fetched?:string;cached?:boolean;title?:string;text?:string;url?:string;published?:string;modified?:string;name?:string;status?:string};
const webDialog=byId<HTMLDialogElement>("webDialog"),webActionSelect=byId<HTMLSelectElement>("webAction"),webInput=byId<HTMLInputElement>("webInput"),webOutput=byId("webOutput");
let webBusy=false;
function webFields(){const action=webActionSelect.value;webInput.required=action!=="watches";byId("webInputLabel").hidden=action==="watches";webInput.placeholder=["read","download","watch"].includes(action)?"https://…":"Поисковый запрос (публичный)"}
webActionSelect.onchange=webFields;
function webText(s:string){const p=document.createElement("p");p.textContent=s;webOutput.append(p)}
function webLink(url:string,title:string){
 const a=document.createElement("a");try{if(new URL(url).protocol!=="https:")return}catch{return}
 a.href=url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=title;webOutput.append(a)
}
function pageCard(page:WebPage){webLink(page.url,page.title);webText("Публикация: "+(page.published||"не указана")+" · получено: "+page.fetched+(page.cached?" · кеш":""));if(page.modified)webText("Last-Modified: "+page.modified);webText(page.text)}
async function webRun(action:string,input?:string){
 if(webBusy)return;if(localOnly&&action!=="watches"&&action!=="disable"){webOutput.textContent="Отключите локальный режим для доступа в интернет.";return}
 webBusy=true;webOutput.textContent="Выполнение…";
 const body:Record<string,string|boolean>={action,confirm:true};
 if(["search","news","research"].includes(action))body.query=input??"";
 else if(action==="disable")body.id=input??"";
 else if(action!=="watches")body.url=input??"";
 try{
  const r=await agentApi<WebResult>("web",body);webOutput.replaceChildren();
  if(r.provider)webText(r.provider+" · "+(r.fetched??"")+(r.cached?" · кеш":""));
  if(r.queries)webText("Запросы: "+r.queries.join(" / "));
  if(r.pages)for(const page of r.pages)pageCard(page);
  if(r.overlaps?.length)for(const overlap of r.overlaps)webText("Общие термины: "+overlap.terms.join(", ")+" · "+overlap.a+" ↔ "+overlap.b);
  if(r.errors)for(const error of r.errors)webText(error.url+": "+error.error);
  if(r.note)webText(r.note);
  if(r.items)for(const item of r.items){
   if("id" in item){webLink(item.url,item.url);webText(item.status+" · "+item.checked+(item.enabled?" · включено":" · выключено"));if(item.enabled){const b=document.createElement("button");b.type="button";b.textContent="Остановить наблюдение";b.onclick=()=>void webRun("disable",item.id);webOutput.append(b)}}
   else{webLink(item.url,item.title);webText((item.publisher||"")+(item.published?" · "+item.published:""))}
  }
  if(r.title&&r.url&&r.text!==undefined)pageCard(r as WebPage);
  if(r.name){webText("Сохранено в Документы: "+r.name);await refreshWorkspaceMap(true)}
  if(r.status)webText(r.status+" · "+(r.url??""));
  if(action==="disable")webText("Наблюдение выключено. Обновите список.");
  if(!webOutput.children.length)webText("Нет результатов");
 }catch(e){webOutput.textContent=e instanceof Error?e.message:"Ошибка интернет-инструмента"}finally{webBusy=false}
}
byId("toolWeb").onclick=()=>{closeTools();webFields();webDialog.showModal()};
byId("webClose").onclick=()=>webDialog.close();
bindOrbit("webIcon",()=>{if(!busy){webFields();webDialog.showModal()}});
byId("correctionClose").onclick=()=>byId<HTMLDialogElement>("correctionDialog").close();
byId<HTMLFormElement>("correctionForm").onsubmit=async e=>{e.preventDefault();const d=byId<HTMLDialogElement>("correctionDialog"),text=byId<HTMLTextAreaElement>("correctionText").value.trim();if(!text)return;const btn=byId<HTMLButtonElement>("correctionSave");btn.disabled=true;try{await routingPost("correction",{message:Number(byId<HTMLInputElement>("correctionId").value),text,confirm:true});d.close();chatStatus.textContent="Исправление сохранено как кандидат, не подтверждённый факт";if(!busy&&selected<0){chatPrompt.value=("Исправление: "+text).slice(0,1000);resizePrompt();chatPrompt.focus()}}catch(e){byId("correctionStatus").textContent=e instanceof Error?e.message:"Ошибка"}finally{btn.disabled=false}};
byId<HTMLFormElement>("webForm").onsubmit=e=>{e.preventDefault();const action=webActionSelect.value,input=webInput.value.trim();if(action==="watch"&&!confirm("Разрешить автоматическую проверку этого публичного сайта раз в час при работающем сервере?"))return;void webRun(action,input)};
byId("webCopy").onclick=()=>void copyText(webOutput.innerText);
byId("webToChat").onclick=()=>{if(busy||selected>=0)return;const excerpt=webOutput.innerText.trim();if(!excerpt)return;chatPrompt.value=("Проанализируй эти интернет-выдержки (не проверенные факты):\n"+excerpt).slice(0,1000);resizePrompt();webDialog.close();chatPrompt.focus()};
type KnowledgeItem={id:string;kind:string;subject:string;predicate:string;value:string;context:string;state:string;confidence:number;expires:string;updated:string;stale?:boolean;semantic_score?:number;sources?:{source_type:string;source_id:string}[];links?:{a:string;b:string;kind:string;strength:number}[];versions?:number};
const knowledgeDialog=byId<HTMLDialogElement>("knowledgeDialog"),knowledgeOutput=byId("knowledgeOutput"),knowledgeQuery=byId<HTMLInputElement>("knowledgeQuery");
let knowledgeBusy=false;
async function knowledgeApi<T>(action:string,value:object={}):Promise<T>{return agentApi<T>("knowledge",{action,...value})}
async function knowledgeAction(action:()=>Promise<void>){if(knowledgeBusy)return;knowledgeBusy=true;try{await action()}catch(e){knowledgeOutput.textContent=e instanceof Error?e.message:"Ошибка памяти"}finally{knowledgeBusy=false}}
function knowledgeText(root:HTMLElement,value:string){const p=document.createElement("p");p.textContent=value;root.append(p)}
function showKnowledge(items:KnowledgeItem[]){
 knowledgeOutput.replaceChildren();if(!items.length)knowledgeText(knowledgeOutput,"Нет совпадений");
 for(const item of items){
  const card=document.createElement("article");card.className="knowledge-entry";
  knowledgeText(card,item.subject+" · "+item.predicate+": "+item.value);
  knowledgeText(card,item.kind+" · "+item.state+" · уверенность "+Math.round(item.confidence*100)+"%"+(item.stale?" · устарело":"")+" · "+item.updated.slice(0,10));
  if(item.semantic_score!==undefined)knowledgeText(card,"Векторное сходство: "+item.semantic_score.toFixed(3));
  if(item.sources)knowledgeText(card,"Источники: "+item.sources.map(s=>s.source_type+" #"+s.source_id).join(", "));
  if(item.links?.length)knowledgeText(card,"Связи: "+item.links.map(x=>x.kind+" "+(x.a===item.id?x.b:x.a)+" ×"+x.strength).join("; "));
  knowledgeText(card,"ID: "+item.id);
  const actions=document.createElement("div");actions.className="workspace-actions";
  function button(label:string,fn:()=>void){const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=fn;actions.append(b)}
  button("Подтвердить",()=>void knowledgeAction(async()=>{if(!confirm("Подтвердить это знание как проверенное вами?"))return;await knowledgeApi("review",{id:item.id,state:"confirmed",confidence:1,confirm:true});await knowledgeSearch()}));
  button("Отклонить",()=>void knowledgeAction(async()=>{if(!confirm("Исключить это знание из поиска?"))return;await knowledgeApi("review",{id:item.id,state:"rejected",confidence:0,confirm:true});await knowledgeSearch()}));
  button("История",()=>void knowledgeAction(async()=>{const h=await knowledgeApi<{items:{created:string;snapshot:KnowledgeItem}[]}>("history",{id:item.id});knowledgeOutput.replaceChildren();for(const v of h.items)knowledgeText(knowledgeOutput,v.created+" · "+v.snapshot.state+" · "+v.snapshot.confidence);if(!h.items.length)knowledgeText(knowledgeOutput,"Нет изменений")}));
  if(item.state==="confirmed")button("Embeddings",()=>void knowledgeAction(async()=>{
   if(localOnly)throw Error("Отключите локальный режим");const p=await knowledgeApi<{id:string;text:string;model:string;cached:boolean}>("embedding_preview",{id:item.id});
   if(p.cached){knowledgeText(card,"Вектор уже сохранён");return}
   if(!confirm("Платный запрос Cloud.ru · "+p.model+"\nБудет отправлено точно:\n"+p.text))return;
   await knowledgeApi("embed",{id:item.id,text:p.text,confirm:true});knowledgeText(card,"Вектор сохранён в SQLite")
  }));
  card.append(actions);knowledgeOutput.append(card);
 }
}
async function knowledgeSearch(){const r=await knowledgeApi<{items:KnowledgeItem[]}>("search",{query:knowledgeQuery.value});showKnowledge(r.items)}
byId("toolKnowledge").onclick=()=>{closeTools();knowledgeDialog.showModal();void knowledgeAction(knowledgeSearch)};
byId("knowledgeClose").onclick=()=>knowledgeDialog.close();
byId<HTMLFormElement>("knowledgeSearchForm").onsubmit=e=>{e.preventDefault();void knowledgeAction(knowledgeSearch)};
byId("knowledgeSemantic").onclick=()=>void knowledgeAction(async()=>{const q=knowledgeQuery.value.trim();if(!q)throw Error("Введите запрос");if(localOnly)throw Error("Отключите локальный режим");if(!confirm("Платный запрос Qwen embeddings. Будет отправлено:\n"+q))return;showKnowledge((await knowledgeApi<{items:KnowledgeItem[]}>("semantic",{query:q,confirm:true})).items)});
byId<HTMLFormElement>("knowledgeAddForm").onsubmit=e=>{e.preventDefault();void knowledgeAction(async()=>{const value=(id:string)=>byId<HTMLInputElement>(id).value;await knowledgeApi("add",{kind:value("knowledgeKind"),subject:value("knowledgeSubject"),predicate:value("knowledgePredicate"),value:value("knowledgeValue"),context:value("knowledgeContext"),expires:value("knowledgeExpires")});knowledgeQuery.value=value("knowledgeSubject");await knowledgeSearch()})};
byId("knowledgeConsolidate").onclick=()=>void knowledgeAction(async()=>{await knowledgeApi("consolidate");await knowledgeSearch()});
byId("knowledgeStats").onclick=()=>void knowledgeAction(async()=>{const r=await knowledgeApi<{counts:{kind:string;state:string;n:number}[];stale:number;links:number;versions:number}>("stats");knowledgeOutput.replaceChildren();for(const row of r.counts)knowledgeText(knowledgeOutput,row.kind+" · "+row.state+" · "+row.n);knowledgeText(knowledgeOutput,"Устарело: "+r.stale+" · связи: "+r.links+" · ревизии: "+r.versions)});
byId<HTMLFormElement>("knowledgeLinkForm").onsubmit=e=>{e.preventDefault();void knowledgeAction(async()=>{const val=(id:string)=>byId<HTMLInputElement>(id).value;await knowledgeApi("link",{a:val("knowledgeA"),b:val("knowledgeB"),kind:val("knowledgeRelation")});await knowledgeSearch()})};
type CognitiveAction="stats"|"column"|"compare"|"document"|"deduce"|"decisions"|"hypothesis"|"transfer"|"performance"|"draft"|"seasonality"|"profile"|"research_docs"|"convert"|"anomalies";
const cognitiveDialog=byId<HTMLDialogElement>("cognitiveDialog"),cognitiveSelect=byId<HTMLSelectElement>("cognitiveAction"),cognitiveInput=byId<HTMLTextAreaElement>("cognitiveInput"),cognitiveOutput=byId("cognitiveOutput");
let cognitiveBusy=false;
const cognitiveExamples:Record<CognitiveAction,object>={
 stats:{values:[10,12,15,14,18,21]},
 seasonality:{values:[10,20,12,22,14,24],period:2},profile:{file:1},research_docs:{files:[1,2]},convert:{file:1,format:"json"},anomalies:{},
 column:{file:1,column:"cost"},
 compare:{a:1,b:2,key:"id"},
 document:{file:1},
 deduce:{facts:[["Автомобиль","статус","не осмотрен"]],rules:[{if:[["Автомобиль","статус","не осмотрен"]],then:["Автомобиль","действие","осмотр"]}]},
 decisions:{options:[{name:"Вариант А",outcomes:[{probability:.6,value:100},{probability:.4,value:-20}]},{name:"Вариант Б",outcomes:[{probability:1,value:40}]}]},
 hypothesis:{id:"ID знания"},
 transfer:{query:"ГСМ"},
 performance:{},
 draft:{title:"Служебная записка",body:"Текст черновика для проверки"}
};
const cognitiveHelp:Record<CognitiveAction,string>={
 stats:"Введите массив чисел по порядку наблюдений. График отражает только введённые значения.",
 seasonality:"Равномерный временной ряд; для сезонности минимум три заданных цикла.",profile:"Профиль первого листа CSV/XLSX: пропуски, уникальные и числовые значения.",research_docs:"ID 2–6 текстовых документов; общие слова и возможные расхождения полей.",convert:"Преобразование таблицы в CSV/JSON на локальном Диске.",anomalies:"Проверка существующих рабочих реестров без изменений.",
 column:"ID CSV/XLSX на локальном диске и точное название числового столбца.",
 compare:"ID двух таблиц и уникальный столбец-ключ. Сравнение значений без изменения файлов.",
 document:"ID текстового файла или DOCX. Извлечённые поля — кандидаты, а не доказанные факты.",
 deduce:"Факты — тройки субъект/свойство/значение. Правила с if и then. Вывод условен.",
 decisions:"Задайте варианты, возможные исходы и вероятности (сумма 1 для каждого варианта).",
 hypothesis:"ID знания из раздела «Память и знания». Поддержка и противоречия — явно заданные связи.",
 transfer:"Поиск сохранённых сценариев по теме, без самостоятельного запуска.",
 performance:"Диагностика по фактическому журналу инструментов.",
 draft:"Введите заголовок и текст. Подтверждение создаёт локальный DOCX с отметкой «Черновик»."
};
function cognitiveFields(){
 const a=cognitiveSelect.value as CognitiveAction;
 cognitiveInput.value=JSON.stringify(cognitiveExamples[a],null,2);byId("cognitiveHelp").textContent=cognitiveHelp[a];cognitiveOutput.replaceChildren();byId("cognitiveChart").replaceChildren()
}
cognitiveSelect.onchange=cognitiveFields;
byId("toolCognitive").onclick=()=>{closeTools();cognitiveFields();cognitiveDialog.showModal()};
byId("cognitiveClose").onclick=()=>cognitiveDialog.close();
function drawSeries(values:number[],container:HTMLElement=byId("cognitiveChart")){
 container.replaceChildren();if(values.length<2||values.some(v=>!Number.isFinite(v)))return;
 const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
 svg.setAttribute("viewBox","0 0 600 220");svg.setAttribute("role","img");svg.setAttribute("aria-label","Линейный график фактических наблюдений");
 function node(name:string,attrs:Record<string,string>,text?:string){const n=document.createElementNS(ns,name);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;svg.append(n);return n}
 const low=Math.min(...values),high=Math.max(...values),span=high-low||1;
 for(let i=0;i<=4;i++){const y=20+170*i/4,v=high-(high-low)*i/4;node("line",{x1:"65",x2:"585",y1:String(y),y2:String(y),stroke:"#29434f","stroke-width":".8"});node("text",{x:"60",y:String(y+4),fill:"#a7c8c9","font-size":"11","text-anchor":"end"},Number(v.toPrecision(5)).toString())}
 const pts=values.map((v,i)=>[65+520*i/(values.length-1),high===low?105:20+170*(high-v)/span]);
 node("polyline",{points:pts.map(p=>p.join(",")).join(" "),fill:"none",stroke:"#77d9c7","stroke-width":"2","stroke-linejoin":"round"});
 if(values.length<=80)pts.forEach(([x,y],i)=>{const point=node("circle",{cx:String(x),cy:String(y),r:"3",fill:"#77d9c7",tabindex:"0"});const title=document.createElementNS(ns,"title");title.textContent="№"+(i+1)+": "+values[i];point.append(title);point.setAttribute("aria-label",title.textContent)});
 node("text",{x:"65",y:"210",fill:"#a7c8c9","font-size":"11"},"1");node("text",{x:"585",y:"210",fill:"#a7c8c9","font-size":"11","text-anchor":"end"},String(values.length));container.append(svg)
}
function displayCognitive(result:Record<string,unknown>){
 cognitiveOutput.replaceChildren();byId("cognitiveChart").replaceChildren();
 const values=result.values;if(Array.isArray(values)&&values.every(v=>typeof v==="number"))drawSeries(values as number[]);
 const pre=document.createElement("pre");const output={...result};delete output.values;
 pre.textContent=JSON.stringify(output,null,2);cognitiveOutput.append(pre)
}
byId<HTMLFormElement>("cognitiveForm").onsubmit=async e=>{
 e.preventDefault();if(cognitiveBusy)return;const action=cognitiveSelect.value as CognitiveAction;
 try{
  const args=JSON.parse(cognitiveInput.value);if(!args||Array.isArray(args)||typeof args!=="object")throw Error("Введите объект параметров");
  if((action==="draft"||action==="convert")&&!confirm("Создать новый локальный файл на Диске?"))return;
  cognitiveBusy=true;cognitiveOutput.textContent="Выполняется…";
  const result=await agentApi<Record<string,unknown>>("cognitive",{...args,action,...((action==="draft"||action==="convert")?{confirm:true}:{})});
  displayCognitive(result);if(action==="draft"||action==="convert")await refreshWorkspaceMap(true)
 }catch(e){cognitiveOutput.textContent=e instanceof Error?e.message:"Ошибка"}finally{cognitiveBusy=false}
};
byId("cognitiveCopy").onclick=()=>void copyText(cognitiveOutput.innerText);
type ImportPlan={token:string;kind:string;title:string;count:number;rows:Record<string,string|number|null>[]};
const importDialog=byId<HTMLDialogElement>("importDialog"),importFile=byId<HTMLSelectElement>("importFile"),importKind=byId<HTMLSelectElement>("importKind"),importOutput=byId("importOutput"),importCommit=byId<HTMLButtonElement>("importCommit");
let importPlan:ImportPlan|null=null,importBusy=false;
function invalidateImport(){importPlan=null;importCommit.disabled=true;importOutput.replaceChildren()}
byId("toolImport").onclick=async()=>{closeTools();if(busy||importBusy)return;invalidateImport();importDialog.showModal();await refreshWorkspaceMap();if(!importDialog.open)return;importFile.replaceChildren();for(const f of workspaceMap.files.filter(f=>/\.(csv|xlsx)$/i.test(f.name))){const o=document.createElement("option");o.value=String(f.id);o.textContent=f.name;importFile.append(o)}};
byId("importClose").onclick=()=>{if(!importBusy)importDialog.close()};
importDialog.addEventListener("cancel",e=>{if(importBusy)e.preventDefault()});
function showImport(p:ImportPlan){importPlan=p;importOutput.replaceChildren();const title=document.createElement("p");title.textContent=p.title+" · "+p.count+" новых записей. Существующие записи не перезаписываются.";importOutput.append(title);
 const scroll=document.createElement("div");scroll.className="workspace-table";const table=document.createElement("table"),head=document.createElement("tr");const columns=Object.keys(p.rows[0]??{});for(const c of columns){const th=document.createElement("th");th.textContent=c;head.append(th)}table.append(head);for(const row of p.rows){const tr=document.createElement("tr");for(const c of columns){const td=document.createElement("td");td.textContent=String(row[c]??"—");tr.append(td)}table.append(tr)}scroll.append(table);importOutput.append(scroll);importCommit.disabled=false}
async function previewImport(path:string,value:object){if(importBusy)return;invalidateImport();importBusy=true;try{showImport(await agentApi<ImportPlan>(path,value))}catch(e){importOutput.textContent=e instanceof Error?e.message:"Ошибка"}finally{importBusy=false}}
byId<HTMLFormElement>("importForm").onsubmit=e=>{e.preventDefault();void previewImport("import-preview",{kind:importKind.value,file:Number(importFile.value)})};
byId<HTMLFormElement>("fillForm").onsubmit=e=>{e.preventDefault();void previewImport("timesheet-preview",{employee:Number(byId<HTMLInputElement>("fillEmployee").value),start:byId<HTMLInputElement>("fillStart").value,end:byId<HTMLInputElement>("fillEnd").value,hours:Number(byId<HTMLInputElement>("fillHours").value),weekdays:byId<HTMLInputElement>("fillWeekdays").checked})};
for(const id of ["importForm","fillForm"])byId(id).addEventListener("input",()=>{if(!importBusy)invalidateImport()});
importCommit.onclick=async()=>{if(importBusy||!importPlan||!confirm("Добавить "+importPlan.count+" записей в SQLite?"))return;importBusy=true;const p=importPlan;try{const r=await agentApi<{count:number}>("import-commit",{token:p.token,confirm:true});invalidateImport();importOutput.textContent="Сохранено записей: "+r.count;await refreshWorkspaceMap(true)}catch(e){importOutput.textContent=e instanceof Error?e.message:"Ошибка";importCommit.disabled=false}finally{importBusy=false}};
const attachDialog=byId<HTMLDialogElement>("attachDialog"),attachList=byId<HTMLSelectElement>("attachList");
function attachIds(ids:number[]){
 if(busy||selected>=0)return;const old=Array.from(chatPrompt.value.matchAll(/\[Документ #(\d+)\]/g),m=>Number(m[1]));
 const add=Array.from(new Set(ids)).filter(i=>!old.includes(i)).slice(0,Math.max(0,3-old.length));
 const text=chatPrompt.value.trim()+add.map(i=>"\n[Документ #"+i+"]").join("");
 if(text.length>1000){chatStatus.textContent="Недостаточно места в сообщении";return}
 chatPrompt.value=text.trim();resizePrompt();chatPrompt.focus();
}
byId("toolAttach").onclick=async()=>{closeTools();if(busy||selected>=0)return;attachDialog.showModal();await refreshWorkspaceMap();if(!attachDialog.open)return;attachList.replaceChildren();for(const f of workspaceMap.files){const o=document.createElement("option");o.value=String(f.id);o.textContent="#"+f.id+" · "+f.name;attachList.append(o)}};
byId("attachClose").onclick=()=>attachDialog.close();
byId("attachInsert").onclick=()=>{attachDialog.close();attachIds(Array.from(attachList.selectedOptions).map(o=>Number(o.value)))};
let attaching=false;
async function uploadAttachments(files:File[]){
 if(busy||selected>=0||attaching)return;attaching=true;chatPhase("upload");chatStatus.textContent="Загрузка в локальные документы…";sendButton.disabled=true;
 try{const ids:number[]=[];for(const file of files.slice(0,3)){
  const data=await moduleRequest("docsIcon",async()=>{const r=await fetch("/api/disk/upload?name="+encodeURIComponent(file.name),{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});const data=await r.json();if(!r.ok)throw Error(data.error||"Ошибка загрузки");return data as {id:number}});ids.push(data.id);
 }attachIds(ids);await refreshWorkspaceMap(true);chatStatus.textContent="Документы сохранены локально"}
 catch(e){chatStatus.textContent=e instanceof Error?e.message:"Ошибка загрузки"}finally{chatPhase("idle");attaching=false;sendButton.disabled=busy||selected>=0||!ready}
}
chat.addEventListener("dragover",e=>{if(e.dataTransfer?.types.includes("Files"))e.preventDefault()});
chat.addEventListener("drop",e=>{if(!e.dataTransfer?.files.length)return;e.preventDefault();void uploadAttachments(Array.from(e.dataTransfer.files))});
byId<HTMLInputElement>("attachUpload").onchange=e=>{const input=e.target as HTMLInputElement;const files=Array.from(input.files??[]);input.value="";attachDialog.close();void uploadAttachments(files)};
const workflowDialog=byId<HTMLDialogElement>("workflowDialog"),workflowKind=byId<HTMLSelectElement>("workflowKind"),workflowMonth=byId<HTMLInputElement>("workflowMonth"),workflowA=byId<HTMLSelectElement>("workflowA"),workflowB=byId<HTMLSelectElement>("workflowB");
function workflowFields(){
 const compare=workflowKind.value==="compare",edit=workflowKind.value==="edit",bundle=workflowKind.value==="bundle";
 byId("workflowMonthLabel").hidden=!bundle;workflowMonth.required=bundle;
 byId("workflowCompareFields").hidden=!compare;workflowA.required=compare;workflowB.required=compare;
 byId("workflowEditFields").hidden=!edit;
 for(const id of ["workflowRecord","workflowField","workflowValue"])byId<HTMLInputElement>(id).required=edit;
}
workflowKind.onchange=workflowFields;
byId("toolWorkflow").onclick=async()=>{
 closeTools();if(busy)return;
 const d=new Date();workflowMonth.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
 workflowFields();byId("workflowStatus").textContent="";workflowDialog.showModal();
 await refreshWorkspaceMap();if(!workflowDialog.open)return;
 for(const select of [workflowA,workflowB]){select.replaceChildren();const empty=document.createElement("option");empty.value="";empty.textContent="Выберите файл";select.append(empty);for(const f of workspaceMap.files){const o=document.createElement("option");o.value=String(f.id);o.textContent="#"+f.id+" · "+f.name;select.append(o)}}
};
byId("workflowClose").onclick=()=>workflowDialog.close();
byId<HTMLFormElement>("workflowForm").onsubmit=e=>{
 e.preventDefault();if(busy)return;let command="";
 if(workflowKind.value==="bundle")command="Комплексный отчёт за "+workflowMonth.value;
 else if(workflowKind.value==="anomalies")command="Проверь аномалии";
 else if(workflowKind.value==="compare"){
  if(!workflowA.value||!workflowB.value||workflowA.value===workflowB.value){byId("workflowStatus").textContent="Выберите два разных документа";return}
  command="Сравни документы #"+workflowA.value+" и #"+workflowB.value;
 }else{
  const id=byId<HTMLInputElement>("workflowRecord").value,field=byId<HTMLSelectElement>("workflowField").value,value=byId<HTMLInputElement>("workflowValue").value.trim();
  if(!/^[1-9][0-9]{0,11}$/.test(id)||!value){byId("workflowStatus").textContent="Укажите ID записи и значение";return}
  command="Измени запись #"+id+" поле "+field+": "+value;
 }
 if(selected>=0)select(selected);
 chatPrompt.value=command;resizePrompt();workflowDialog.close();chatPrompt.focus();
};
type ReportTool={id:string;title:string;monthly:boolean};
type LocalReport={tool:string;title:string;month:string;columns:string[];rows:string[][];total_rows:number;summary:string[];sources:{source:string;id:number;title:string}[];generated:string};
const reportsDialog=byId<HTMLDialogElement>("reportsDialog"),reportSelect=byId<HTMLSelectElement>("reportSelect"),reportMonth=byId<HTMLInputElement>("reportMonth"),reportOutput=byId("reportOutput");
let reportTools:ReportTool[]=[],lastReport:LocalReport|null=null,reportRevision=0;
function syncReportMonth(){const monthly=!!reportTools.find(t=>t.id===reportSelect.value)?.monthly;reportMonth.disabled=!monthly;reportMonth.required=monthly;byId("reportMonthLabel").hidden=!monthly}
function resetReport(){lastReport=null;reportOutput.replaceChildren();byId<HTMLButtonElement>("reportDownload").disabled=true;byId<HTMLButtonElement>("reportCopy").disabled=true;byId<HTMLButtonElement>("reportXlsx").disabled=true;byId<HTMLButtonElement>("reportDocx").disabled=true}
reportSelect.onchange=()=>{reportRevision++;resetReport();syncReportMonth()};
reportMonth.onchange=()=>{reportRevision++;resetReport()};
byId("toolReports").onclick=async()=>{
 closeTools();reportsDialog.showModal();const rev=++reportRevision;resetReport();reportOutput.textContent="Загрузка инструментов…";
 try{const data=await routingPost<{tools:ReportTool[]}>("tools",{});if(rev!==reportRevision)return;
  reportTools=data.tools;reportSelect.replaceChildren();for(const tool of reportTools){const opt=document.createElement("option");opt.value=tool.id;opt.textContent=tool.title;reportSelect.append(opt)}
  const d=new Date();reportMonth.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");syncReportMonth();reportOutput.textContent="Выберите инструмент и сформируйте отчёт.";
 }catch(e){if(rev===reportRevision)reportOutput.textContent=e instanceof Error?e.message:"Инструменты недоступны"}
};
byId("reportsClose").onclick=()=>reportsDialog.close();reportsDialog.addEventListener("close",()=>{reportRevision++});
byId<HTMLFormElement>("reportsForm").onsubmit=async e=>{
 e.preventDefault();const rev=++reportRevision;resetReport();reportOutput.textContent="Выполняется локальный расчёт…";
 try{const result=await routingPost<LocalReport>("report",{tool:reportSelect.value,month:reportMonth.disabled?"":reportMonth.value});
  if(rev!==reportRevision)return;lastReport=result;reportOutput.replaceChildren();
  const title=document.createElement("h3");title.textContent=result.title+(result.month?" · "+result.month:"");reportOutput.append(title);
  for(const line of result.summary){const p=document.createElement("p");p.textContent=line;reportOutput.append(p)}
  const scroll=document.createElement("div");scroll.className="workspace-table";const table=document.createElement("table"),head=document.createElement("thead"),header=document.createElement("tr");
  for(const name of result.columns){const th=document.createElement("th");th.textContent=name;header.append(th)}head.append(header);table.append(head);
  const body=document.createElement("tbody");for(const values of result.rows){const row=document.createElement("tr");for(const value of values){const cell=document.createElement("td");cell.textContent=value;row.append(cell)}body.append(row)}
  table.append(body);scroll.append(table);reportOutput.append(scroll);
  let ascending=true;Array.from(header.children).forEach((th,i)=>{const b=document.createElement("button");b.type="button";b.textContent=th.textContent??"";th.replaceChildren(b);b.onclick=()=>{const rows=Array.from(body.rows);rows.sort((a,b)=>{const x=a.cells[i].textContent??"",y=b.cells[i].textContent??"",nx=Number(x),ny=Number(y);return (x.trim()&&y.trim()&&Number.isFinite(nx)&&Number.isFinite(ny)?nx-ny:x.localeCompare(y,"ru",{numeric:true}))*(ascending?1:-1)});ascending=!ascending;body.append(...rows)}});
  const filter=document.createElement("input");filter.placeholder="Фильтр строк таблицы";filter.setAttribute("aria-label","Фильтр строк отчёта");filter.oninput=()=>{for(const row of Array.from(body.rows))row.hidden=!(row.textContent??"").toLocaleLowerCase("ru").includes(filter.value.toLocaleLowerCase("ru"))};reportOutput.insertBefore(filter,scroll);
  const note=document.createElement("small");note.textContent=result.total_rows===0?"Нет записей":("Строк: "+result.rows.length+" из "+result.total_rows+" · "+new Date(result.generated).toLocaleString("ru"));reportOutput.append(note);
  byId<HTMLButtonElement>("reportDownload").disabled=false;byId<HTMLButtonElement>("reportCopy").disabled=false;byId<HTMLButtonElement>("reportXlsx").disabled=false;byId<HTMLButtonElement>("reportDocx").disabled=false;
 }catch(e){if(rev===reportRevision)reportOutput.textContent=e instanceof Error?e.message:"Ошибка отчёта"}
};
byId("reportCopy").onclick=()=>{if(lastReport)void copyText([lastReport.title,...lastReport.summary,lastReport.columns.join(" | "),...lastReport.rows.map(r=>r.join(" | ")),"Строк: "+lastReport.rows.length+" из "+lastReport.total_rows].join("\n"))};
function csvCell(s:string){const safe=/^[\s]*[=+\-@]/.test(s)&&!/^[-+]?[0-9]+(?:\.[0-9]+)?$/.test(s)?"'"+s:s;return '"'+safe.replace(/"/g,'""')+'"'}
async function downloadOffice(format:"xlsx"|"docx"){
 if(!lastReport)return;const report=lastReport;
 try{
  const response=await fetch("/api/agent/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tool:report.tool,month:report.month,format})});
  if(!response.ok){const error=await response.json();throw Error(error.error||"Ошибка экспорта")}
  const url=URL.createObjectURL(await response.blob()),a=document.createElement("a");a.href=url;a.download=report.tool+(report.month?"-"+report.month:"")+"."+format;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch(e){chatStatus.textContent=e instanceof Error?e.message:"Ошибка экспорта"}
}
byId("reportXlsx").onclick=()=>void downloadOffice("xlsx");byId("reportDocx").onclick=()=>void downloadOffice("docx");
byId("reportDownload").onclick=()=>{
 if(!lastReport)return;const csv=[lastReport.columns,...lastReport.rows].map(r=>r.map(csvCell).join(";")).join("\r\n");const url=URL.createObjectURL(new Blob(["\uFEFF",csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=lastReport.tool+(lastReport.month?"-"+lastReport.month:"")+".csv";a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000)
};
byId("toolCalculator").onclick=()=>{closeTools();byId<HTMLDialogElement>("calculatorDialog").showModal()};
byId("calculatorClose").onclick=()=>byId<HTMLDialogElement>("calculatorDialog").close();
byId<HTMLFormElement>("calculatorForm").onsubmit=async e=>{
 e.preventDefault();const output=byId("calculatorResult");
 try{const data=await routingPost<{result:string}>("calculate",{expression:byId<HTMLInputElement>("calculatorExpression").value});output.textContent=data.result}
 catch(e){output.textContent=e instanceof Error?e.message:"Ошибка вычисления"}
};
byId("calculatorInsert").onclick=()=>{if(busy||selected>=0)return;const value=byId("calculatorResult").textContent??"";if(!/^-?[0-9]+(?:\.[0-9]+)?(?:e[+-]?[0-9]+)?$/i.test(value))return;chatPrompt.value=(chatPrompt.value+value).slice(0,1000);resizePrompt();byId<HTMLDialogElement>("calculatorDialog").close();chatPrompt.focus()};
updateToolState();
const full=byId("fullMap");
function setFull(on:boolean){if(on&&document.body.classList.contains("full-chat"))setChatFull(false);document.body.classList.toggle("full-map",on);full.textContent=on?"Выйти из полноэкранного режима":"На весь экран";full.setAttribute("aria-pressed",String(on));syncChatIcons();requestFrame()}
full.onclick=async()=>{
 const on=!document.body.classList.contains("full-map");setFull(on);
 if(on&&!document.fullscreenElement&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen()}catch{/* map-only fallback */}}
 else if(!on&&document.fullscreenElement){try{await document.exitFullscreen()}catch{/* map-only fallback */}}
};
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement)setFull(false)});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&document.body.classList.contains("full-map")&&!document.fullscreenElement)setFull(false)});
prepareLayout();decorate();zoom=fitZoom();requestFrame();void refreshWorkspaceMap();
bindOrbit("settingsIcon",()=>{if(panel.hidden)toggle.click();byId("settingsClose").focus()});
byId("settingsClose").onclick=()=>{if(!panel.hidden)toggle.click()};
