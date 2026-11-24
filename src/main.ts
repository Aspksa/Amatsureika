import {ClusterIndex, curvedPoint, conversationLayout, valid, clamp, polar, TAU, type Mode, type Point} from "./geometry.js";
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
const hiddenPoints=new Set<string>();
const pendingClusters=new Set<number>();
let renderKey="",mapRevision=0;
const key=(i:number,n:number,outer:boolean)=>i+":"+n+":"+outer;
const counts:number[]=[];
type ChatCluster={id:number;previous_id:number|null;count:number};
type ChatMessage={id:number;cluster_id:number;position:number;role:"user"|"assistant";text:string};
type Snapshot={clusters:ChatCluster[];messages:ChatMessage[];duplicate?:boolean};
let clusters:ChatCluster[]=[];
let pulse:{message:ChatMessage;begin:number;dot:SVGCircleElement;trail:SVGCircleElement[];wave:SVGCircleElement;start:Point;fromChat:boolean} | null=null;
const pulseQueue:ChatMessage[]=[];
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
let geometry=conversationLayout(counts,mode),spatial=new ClusterIndex(geometry.centers);
function reindex(){spatial=new ClusterIndex(geometry.centers);mapRevision++;renderKey=""}
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function position(item:Item){return geometry.point(item.cluster,item.index,item.outer)}
function transform(item:Item,p:Point){item.now=valid(p)?p:position(item);if(!valid(item.now))item.now={x:0,y:0}}
function fitZoom(){return Math.min(1,485/geometry.radius)}
function color(i:number){return palette[Math.floor(i/4)%palette.length]}
const glyphs=["M0 -5 4 -2 4 2 0 5 -4 2 -4 -2Z M0 -2v4 M-2 0h4","M-4 -4h8v8h-8Z M-2 -1h4 M-2 2h3","M-4 3 -1 -3 1 1 4 -4 M-4 3h8","M0 -5 5 0 0 5 -5 0Z M0 -2v4","M0 4C-7 0 -4 -5 0 -2 4 -5 7 0 0 4Z","M-4 -3h8 M-4 0h8 M-4 3h5","M-5 -3 0 -5 5 -3 0 0Z M-5 0 0 3 5 0 M-5 3 0 5 5 3","M0 -5 4 3 0 1 -4 3Z","M-5 -2 0 -5 5 -2 0 1Z M-3 0v3l3 2 3-2V0","M-4 0 -1 3 4 -3","M-4 4V0 M0 4v-8 M4 4v-5","M-3 -5h4l3 3v7h-7Z M1 -5v3h3","M-3 -3 3 3 M-3 3 3 -3 M-4 -4h2v2h-2Z M2 2h2v2H2Z","M-4 -1 1 -5 5 -1 0 4 -4 4Z","M-5 0Q0 -6 5 0Q0 6 -5 0Z M0 -2v4","M-5 -4h10v7H0l-3 2V3h-2Z","M-4 4 0 0 4 -4 M0 -4h4v4","M-4 -4h3 M-4 -4v3 M4 4H1 M4 4V1 M0 -2v4","M-5 4 0 -1 M0 -1 2 -4 5 -5 4 -2 1 0Z","M-4 -4h8v8h-8Z M-4 0h8 M0 -4v8","M0 -5 4 -3 4 3 0 5 -4 3 -4 -3Z M-2 0h4"];
function add(i:number,outer:boolean,n:number){let e:SVGElement;if(outer){e=el("g",{class:"satellite",color:color(i)});el("circle",{class:"satellite-shell",r:9},e);el("path",{class:"satellite-glyph",d:glyphs[i%glyphs.length]},e);const title=el("title",{},e);title.textContent=nodeId(i,n,outer)}else{const hot=(n*13+i*7)%23===0;e=el("circle",{r:hot?3.1:1.35,class:"dot"+(hot?" hot":""),color:color(i)});if(hot)e.style.animationDelay=-(n%9)*.38+"s";e.classList.add("depth-"+(n%3))}e.setAttribute("data-node",nodeId(i,n,outer));e.addEventListener("click",()=>select(i));e.addEventListener("dblclick",ev=>{ev.stopPropagation();focusCluster(i)});const item:Item={e,cluster:i,index:n,outer,from:{x:0,y:0},to:{x:0,y:0},now:{x:0,y:0}};item.to=position(item);item.from=item.to;transform(item,item.to);items.push(item);visibleItems.set(key(i,n,outer),item);return item}
function refreshStats(){byId("stats").textContent=counts.reduce((a,b)=>a+b,0)+" СООБЩЕНИЙ · "+names.length+" КЛАСТЕРОВ";Array.from(legend.children).forEach((b,i)=>{const n=b.lastElementChild;if(n)n.textContent=counts[i]+" / 200"})}
refreshStats();
function polygon(c:Point,r:number){return Array.from({length:6},(_,j)=>{const p=polar(r,j*TAU/6);return (c.x+p.x)+","+(c.y+p.y)}).join(" ")}
function decorate(){
 svg.dataset.mode=mode;
 for(const g of [orbits,labels,links,cells])g.replaceChildren();
 for(const r of geometry.orbits)el("circle",{r,class:"orbit"},orbits);
 if(mode==="hex")names.forEach((_,i)=>{const h=el("polygon",{points:polygon(geometry.centers[i],geometry.radii[i]),class:"hex-cell cluster-shape",color:color(i)},cells);h.onclick=()=>select(i)});
 drawEdges();if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations();
}
function select(i:number){
 renderKey="";
 if(busy||!ready)return;
 selected=i===selected?-1:i;Array.from(legend.children).forEach((b,j)=>b.classList.toggle("selected",j===selected));
 for(const item of items){item.e.classList.toggle("chosen",item.cluster===selected);item.e.style.opacity=selected<0||item.cluster===selected?"":"0.22"}
 detail.textContent=selected<0?"Выберите кластер или точку.":names[selected]+" · "+counts[selected]+" / 200 сообщений";
 requestFrame();void openHistory(selected);
}
function requestFrame(){if(!frame)frame=requestAnimationFrame(renderFrame)}
function renderFrame(now:number){
 frame=0;
 if(lastFrame&&(moving||flight)){const dt=now-lastFrame;if(dt>24){slowFrames++;fastFrames=0}else{fastFrames++;slowFrames=0}if(slowFrames>=8){quality=Math.max(.25,quality-.25);slowFrames=0}if(fastFrames>=40){quality=Math.min(1,quality+.25);fastFrames=0}}
 lastFrame=now;
 if(moving){const p=motionOff()?1:Math.min(1,(now-start)/700),e=p*p*(3-2*p);for(const it of items)transform(it,mix(it.from,it.to,e));moving=p<1}
 if(flight){const f=flight,p=motionOff()?1:Math.min(1,(now-f.begin)/650),e=p*p*(3-2*p);zoom=Math.exp(Math.log(f.fromZ)+(Math.log(f.z)-Math.log(f.fromZ))*e);tx=f.fromX+(f.x-f.fromX)*e;ty=f.fromY+(f.y-f.fromY)*e;if(p===1){flight=null;saveCamera()}}
 zoom=clamp(zoom,.025,64,fitZoom());tx=clamp(tx,-1e6,1e6);ty=clamp(ty,-1e6,1e6);
 world.setAttribute("transform",`translate(${tx} ${ty}) scale(${zoom})`);byId("reset").textContent=Math.round(zoom*100)+"%";
 const level=zoom<.45?"overview":zoom<1.6?"normal":zoom<5?"near":"detail";svg.dataset.lod=level;svg.dataset.quality=String(quality);
 const stride=items.length<2500?1:level==="overview"?Math.max(2,Math.ceil(4/quality)):Math.ceil(1/quality);
 const fragment=document.createDocumentFragment();
 const view=svg.viewBox.baseVal, margin=30;
 for(const it of items){
  if(!valid(it.now)){transform(it,position(it))}
  const x=it.now.x*zoom+tx,y=it.now.y*zoom+ty;
  const visible=x>=view.x-margin&&x<=view.x+view.width+margin&&y>=view.y-margin&&y<=view.y+view.height+margin&&(it.outer||it.cluster===selected||it.index%stride===0);
  if(visible){it.e.setAttribute("transform",`translate(${it.now.x.toFixed(2)} ${it.now.y.toFixed(2)})`);if(!it.e.isConnected)fragment.append(it.e);it.e.classList.toggle("fine-dot",!it.outer&&level==="detail")}else if(it.e.parentNode===nodes)it.e.remove();
 }
 nodes.append(fragment);
 updatePulse(now);
 if(moving||flight||pulse||pulseQueue.length){requestFrame()}else lastFrame=0;
}
function renderVisible(level:string){
 const view=svg.viewBox.baseVal, margin=50;
 const signature=[mapRevision,zoom,tx,ty,view.width,view.height,level,quality,selected].join(":");
 if(signature===renderKey)return;renderKey=signature;
 const candidates=spatial.query((view.x-margin-tx)/zoom,(view.y-margin-ty)/zoom,(view.x+view.width+margin-tx)/zoom,(view.y+view.height+margin-ty)/zoom);
 const aggregate=level==="overview"||candidates.length*200>6000;
 const wanted=new Set<string>(),summaryWanted=new Set<number>();
 const fragment=document.createDocumentFragment();
 function want(i:number,n:number,outer:boolean){
  const k=key(i,n,outer);wanted.add(k);
  const it=visibleItems.get(k)||add(i,outer,n),p=position(it);
  it.now=p;it.e.setAttribute("transform",`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
  it.e.classList.toggle("archive",counts[i]===200);it.e.classList.toggle("chosen",selected===i);
  it.e.classList.toggle("pending-memory",outer?pendingClusters.has(i):hiddenPoints.has(k));
  it.e.style.setProperty("--fill-level",String(counts[i]/200));it.e.style.opacity=selected>=0&&selected!==i?".22":"";
  if(!it.e.isConnected)fragment.append(it.e);
 }
 for(const i of candidates){
  want(i,0,true);
  if(pendingClusters.has(i))continue;
  if(aggregate&&selected!==i){
   summaryWanted.add(i);
   let p=summaries.get(i);if(!p){p=el("path",{class:"memory-summary",color:color(i)});p.addEventListener("click",()=>select(i));p.addEventListener("dblclick",()=>focusCluster(i));summaries.set(i,p)}
   const visible=counts[i]-Array.from(hiddenPoints).filter(k=>k.startsWith(i+":")).length;
   const n=Math.min(24,Math.max(0,Math.ceil(visible/9))),d:string[]=[];
   for(let j=0;j<n;j++){const pt=geometry.point(i,Math.floor(j*Math.max(1,visible)/Math.max(1,n)),false);d.push(`M${pt.x.toFixed(1)} ${pt.y.toFixed(1)}h.01`)}
   const path=d.join("");if(p.getAttribute("d")!==path)p.setAttribute("d",path);
   p.classList.toggle("archive",counts[i]===200);p.style.opacity=selected>=0?".22":"";if(!p.isConnected)fragment.append(p);
  }else for(let n=0;n<counts[i];n++)want(i,n,false);
 }
 for(const [k,it] of visibleItems)if(!wanted.has(k)){it.e.remove();visibleItems.delete(k)}
 for(const [i,p] of summaries)if(!summaryWanted.has(i)){p.remove();summaries.delete(i)}
 items.splice(0,items.length,...visibleItems.values());nodes.append(fragment);
 svg.dataset.visibleNodes=String(visibleItems.size);svg.dataset.aggregated=String(summaryWanted.size);
}
function relayout(){geometry=conversationLayout(counts,mode);reindex();decorate();requestFrame()}
function setMode(m:Mode){if(m===mode)return;mode=m;flight=null;document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===m));relayout();animateCamera(fitZoom(),0,0)}
function camera(){requestFrame()}
function zoomAt(factor:number,x=0,y=0){flight=null;const next=clamp(zoom*factor,.025,64,zoom);tx=x-(x-tx)*next/zoom;ty=y-(y-ty)*next/zoom;zoom=next;camera();saveCamera()}
function coords(x:number,y:number):Point{const matrix=svg.getScreenCTM();if(!matrix)return{x:0,y:0};const p=new DOMPoint(x,y).matrixTransform(matrix.inverse());return{x:p.x,y:p.y}}
svg.addEventListener("wheel",e=>{e.preventDefault();const p=coords(e.clientX,e.clientY);zoomAt(Math.exp(-e.deltaY*.0015),p.x,p.y)},{passive:false});
let drag:{id:number;point:Point;tx:number;ty:number;moved:boolean}|null=null;
svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;flight=null;cameraRevision++;drag={id:e.pointerId,point:coords(e.clientX,e.clientY),tx,ty,moved:false}});
svg.addEventListener("pointermove",e=>{if(!drag||drag.id!==e.pointerId)return;const p=coords(e.clientX,e.clientY),dx=p.x-drag.point.x,dy=p.y-drag.point.y;if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;svg.setPointerCapture(e.pointerId);svg.classList.add("dragging");tx=drag.tx+dx;ty=drag.ty+dy;camera()});
function stop(){if(drag?.moved)saveCamera();drag=null;svg.classList.remove("dragging")}svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);
const reset=()=>animateCamera(fitZoom(),0,0);byId("reset").onclick=reset;byId("minus").onclick=()=>zoomAt(.8);byId("plus").onclick=()=>zoomAt(1.25);group("core").addEventListener("click",()=>{reset();if(selected>=0)select(selected)});group("core").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();reset();if(selected>=0)select(selected)}});
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
function applyPause(){document.body.classList.toggle("paused",motionOff());byId("pause").textContent=paused?"Продолжить анимацию":"Пауза анимации";if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations();requestFrame()}
byId("pause").onclick=()=>{paused=!paused;decorate();applyPause()};
const panel=byId("panel"),toggle=byId("panelToggle");panel.hidden=true;toggle.setAttribute("aria-expanded","false");toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute("aria-expanded",String(!panel.hidden))};decorate();applyEffects(false);zoom=fitZoom();camera();void loadDesign();

function animateCamera(z:number,x:number,y:number){cameraRevision++;flight={z:clamp(z,.025,64,fitZoom()),x:clamp(x,-1e6,1e6),y:clamp(y,-1e6,1e6),fromZ:zoom,fromX:tx,fromY:ty,begin:performance.now()};requestFrame()}
function anchor(i:number){return geometry.centers[i]}
function focusCluster(i:number){if(selected!==i)select(i);const p=anchor(i),z=Math.min(3,Math.max(.4,200/geometry.radii[i]));animateCamera(z,-p.x*z,-p.y*z)}
function nodeId(i:number,n:number,outer:boolean){return (outer?"S":"N")+(i+1)+"-"+(n+1)}
function saveCamera(){
 cameraRevision++;if(!cameraLoaded)return;window.clearTimeout(cameraTimer);
 cameraTimer=window.setTimeout(()=>{const value={zoom,tx,ty,mode};cameraChain=cameraChain.then(async()=>{try{const r=await fetch("/api/camera",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value),keepalive:true});if(!r.ok)throw Error("camera")}catch{byId("cameraStatus").textContent="Камера: сохранение недоступно"}})},220);
}
async function loadCamera(){
 const rev=cameraRevision;
 try{const r=await fetch("/api/camera",{cache:"no-store"});if(!r.ok)throw Error("camera");const c=await r.json();if(rev!==cameraRevision)return;if(c.mode==="hex"||c.mode==="radial"||c.mode==="compact"){mode=c.mode;geometry=conversationLayout(counts,mode);reindex();for(const it of items){it.to=position(it);transform(it,it.to)}document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));zoom=clamp(c.zoom,.025,64,fitZoom());tx=clamp(c.tx,-1e6,1e6);ty=clamp(c.ty,-1e6,1e6);decorate();requestFrame()}}
 catch{byId("cameraStatus").textContent="Камера: стандартное положение"}
 finally{cameraLoaded=true;if(rev!==cameraRevision)saveCamera()}
}
function drawEdges(){
 for(let i=1;i<clusters.length;i++){const j=i-1;const a=geometry.point(j,0,true),b=geometry.point(i,0,true);el("path",{d:`M${a.x} ${a.y} L${b.x} ${b.y}`,class:"continuation-link",fill:"none",color:color(j)},links)}
}
const chat=byId("chat"),chatToggle=byId("chatToggle"),messages=byId("messages"),chatPrompt=byId<HTMLInputElement>("prompt"),chatStatus=byId("chatStatus"),historyTitle=byId("historyTitle"),liveButton=byId("liveChat"),form=byId<HTMLFormElement>("chatForm"),sendButton=form.querySelector("button") as HTMLButtonElement;
let busy=false,historyRevision=0,ready=false;
let pending:{text:string;request_id:string}|null=null;
chatToggle.onclick=()=>{chat.hidden=!chat.hidden;chatToggle.setAttribute("aria-expanded",String(!chat.hidden));if(!chat.hidden)chatPrompt.focus();requestFrame()};
function syncMap(next:ChatCluster[]){
 if(next.some((c,i)=>!Number.isSafeInteger(c.id)||!Number.isInteger(c.count)||c.count<0||c.count>200||c.previous_id!==(i?next[i-1].id:null)||i<next.length-1&&c.count!==200))throw Error("Invalid cluster state");
 if(next.length<clusters.length||clusters.some((c,i)=>next[i].id!==c.id||next[i].count<c.count))return;
 const oldFit=fitZoom(),oldLength=clusters.length,changed=next.length!==oldLength||next.some((c,i)=>c.count!==counts[i]);
 if(!changed)return;
 clusters=next;names.splice(0,names.length,...next.map(c=>"C"+c.id));counts.splice(0,counts.length,...next.map(c=>c.count));geometry=conversationLayout(counts,mode);reindex();
 for(let i=0;i<clusters.length;i++){
  const c=clusters[i];let b=legend.children[i] as HTMLButtonElement|undefined;
  if(!b){b=document.createElement("button");b.className="legend-row";b.style.setProperty("--c",color(i));const sw=document.createElement("i"),title=document.createElement("span"),count=document.createElement("span");title.textContent="C"+c.id;b.append(sw,title,count);b.onclick=()=>select(i);b.ondblclick=()=>focusCluster(i);legend.append(b)}
  b.classList.toggle("selected",selected===i);b.lastElementChild!.textContent=c.count+" / 200";
 }
 refreshStats();if(oldLength!==clusters.length)decorate();
 if(oldLength!==clusters.length&&Math.abs(zoom-oldFit)<.03){zoom=fitZoom();tx=ty=0}requestFrame();
}
function appendMessage(m:ChatMessage){
 if(messages.querySelector('[data-message="'+m.id+'"]'))return;
 const p=document.createElement("p");p.className=m.role==="user"?"user-message":"reply";p.dataset.message=String(m.id);p.textContent=m.text;messages.append(p);while(messages.children.length>400)messages.firstElementChild?.remove();messages.scrollTop=messages.scrollHeight;
}
async function snapshot(cluster?:number):Promise<Snapshot>{const r=await fetch("/api/chat"+(cluster===undefined?"":"?cluster="+cluster),{cache:"no-store"});if(!r.ok)throw Error("history");return r.json()}
async function openHistory(i:number){
 const revision=++historyRevision;chat.hidden=false;chatToggle.setAttribute("aria-expanded","true");
 historyTitle.textContent=i<0?"ТЕКУЩИЙ ДИАЛОГ":"АРХИВ · C"+clusters[i].id+" · "+counts[i]+"/200";
 liveButton.hidden=i<0;sendButton.disabled=i>=0||busy||!ready;chatPrompt.disabled=i>=0||!ready;
 try{const s=await snapshot(i<0?undefined:clusters[i].id);if(revision!==historyRevision)return;messages.replaceChildren();s.messages.forEach(appendMessage);syncMap(s.clusters);chatStatus.textContent=i<0?"Локальная память · без облачной модели":"Архив · для отправки вернитесь в диалог"}
 catch{if(revision===historyRevision)chatStatus.textContent="Не удалось загрузить переписку."}
}
liveButton.onclick=()=>{if(selected>=0)select(selected);else void openHistory(-1)};
function screenPoint(p:Point):Point{const m=world.getScreenCTM();if(!m)return{x:0,y:0};const s=new DOMPoint(p.x,p.y).matrixTransform(m);return{x:s.x,y:s.y}}
function clearPulse(){
 pulse?.dot.remove();pulse?.wave.remove();pulse?.trail.forEach(x=>x.remove());pulse=null;pulseQueue.length=0;
 hiddenPoints.clear();pendingClusters.clear();renderKey="";document.body.classList.remove("memory-flow");
}
function updatePulse(now:number){
 if(motionOff()||document.hidden){if(pulse||pulseQueue.length||hiddenPoints.size){clearPulse();requestFrame()}return}
 if(!pulse&&pulseQueue.length){
  const message=pulseQueue.shift()!,rect=chatPrompt.getBoundingClientRect(),fromChat=message.role==="user";
  const layer=byId("traffic"),className="chat-pulse "+(fromChat?"request-pulse":"reply-pulse");
  const trail=Array.from({length:8},(_,i)=>el("circle",{r:Math.max(.7,3-i*.28),class:className+" trail",opacity:Math.max(.05,.48-i*.05)},layer));
  const dot=el("circle",{r:3.8,class:className},layer),wave=el("circle",{r:0,class:"energy-wave"},layer);
  pulse={message,begin:now,dot,trail,wave,start:{x:rect.left+rect.width*.5,y:rect.top+rect.height*.5},fromChat};
  document.body.classList.add("memory-flow");
 }
 if(!pulse){document.body.classList.remove("memory-flow");return}
 const {message,begin,dot,trail,wave,start,fromChat}=pulse,i=clusters.findIndex(c=>c.id===message.cluster_id);
 if(i<0){clearPulse();requestFrame();return}
 const target=screenPoint(geometry.point(i,message.position-1,false)),core=screenPoint({x:0,y:0}),duration=1250/speed,t=Math.min(1,(now-begin)/duration);
 const at=(v:number)=>fromChat?(v<.46?curvedPoint(start,core,v/.46,.16):curvedPoint(core,target,(v-.46)/.54,-.17)):curvedPoint(core,target,v,-.17);
 const p=at(t);dot.setAttribute("cx",String(p.x));dot.setAttribute("cy",String(p.y));
 trail.forEach((d,j)=>{const p=at(Math.max(0,t-(j+1)*.027));d.setAttribute("cx",String(p.x));d.setAttribute("cy",String(p.y));d.style.opacity=String(Math.max(0,1-j/8)*Math.min(1,t*6)*.48)});
 const progress=fromChat?Math.max(0,(t-.46)/.54):t;
 wave.setAttribute("cx",String(core.x));wave.setAttribute("cy",String(core.y));wave.setAttribute("r",String(15+progress*Math.hypot(target.x-core.x,target.y-core.y)));wave.style.opacity=String(progress>0?(1-progress)*.36:0);
 if(t>=1){
  const k=key(i,message.position-1,false);hiddenPoints.delete(k);const it=visibleItems.get(k);
  if(it){it.e.classList.remove("pending-memory");it.e.classList.add("born");window.setTimeout(()=>it.e.classList.remove("born"),1300)}
  if(message.position===200){const next=clusters.findIndex(c=>c.previous_id===message.cluster_id);if(next>=0){pendingClusters.delete(next);const icon=visibleItems.get(key(next,0,true));if(icon){icon.e.classList.remove("pending-memory");icon.e.classList.add("cluster-born");window.setTimeout(()=>icon.e.classList.remove("cluster-born"),900)}}}
  dot.remove();wave.remove();trail.forEach(x=>x.remove());pulse=null;renderKey="";requestFrame();
 }
}
form.onsubmit=async e=>{
 e.preventDefault();const raw=chatPrompt.value.trim();if(!raw||busy||!ready||selected>=0)return;
 busy=true;sendButton.disabled=true;chatPrompt.disabled=true;chatStatus.textContent="Сохранение…";
 if(!pending||pending.text!==raw)pending={text:raw,request_id:crypto.randomUUID()};
 const request=pending;
 try{
  const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(request)});if(!r.ok)throw Error("save");
  const s:Snapshot=await r.json();pending=null;chatPrompt.value="";syncMap(s.clusters);
  if(selected<0)s.messages.forEach(appendMessage);
  if(!s.duplicate&&!motionOff()){
   for(const m of s.messages){const i=clusters.findIndex(c=>c.id===m.cluster_id);hiddenPoints.add(key(i,m.position-1,false));pulseQueue.push(m);if(m.position===200){const next=clusters.findIndex(c=>c.previous_id===m.cluster_id);if(next>=0)pendingClusters.add(next)}}
   // Bound animation backlog without discarding any committed messages.
   if(pulseQueue.length>24)clearPulse();renderKey="";requestFrame();
  }
  chatStatus.textContent="Сохранено · "+counts.reduce((a,b)=>a+b,0)+" сообщений";
 }catch{chatStatus.textContent="Связь прервана. Повторите отправку — дубликата не будет.";try{const recovered=await snapshot();syncMap(recovered.clusters);if(recovered.messages.some(m=>(m as ChatMessage & {request_id?:string}).request_id===request.request_id)){pending=null;chatPrompt.value="";messages.replaceChildren();recovered.messages.forEach(appendMessage);chatStatus.textContent="Сохранение восстановлено из SQLite"}}catch{/* preserve pending request for retry */}}
 finally{busy=false;sendButton.disabled=selected>=0||!ready;chatPrompt.disabled=selected>=0||!ready;if(!chatPrompt.disabled)chatPrompt.focus()}
};
async function initChat(){
 sendButton.disabled=true;chatPrompt.disabled=true;
 try{const s=await snapshot();syncMap(s.clusters);messages.replaceChildren();s.messages.forEach(appendMessage);ready=true;chatStatus.textContent="Локальная память · без облачной модели";await loadCamera()}
 catch{chatStatus.textContent="Не удалось загрузить локальную память. Обновите страницу."}
 finally{sendButton.disabled=!ready;chatPrompt.disabled=!ready}
}
document.addEventListener("visibilitychange",()=>{if(document.hidden)clearPulse();else{renderKey="";requestFrame();if(ready&&!busy)void snapshot().then(s=>{syncMap(s.clusters);if(selected<0)s.messages.forEach(appendMessage)}).catch(()=>{})}});
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
