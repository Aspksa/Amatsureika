const NS="http://www.w3.org/2000/svg";
const byId=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const svg=document.getElementById("brain") as unknown as SVGSVGElement;
const group=(id:string)=>document.getElementById(id) as unknown as SVGGElement;
const world=group("world"), nodes=group("nodes"), links=group("links"), cells=group("cells"), labels=group("labels"), orbits=group("orbits");
function el<K extends keyof SVGElementTagNameMap>(tag:K, attrs:Record<string,string|number>={}, parent?:Element):SVGElementTagNameMap[K]{const e=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));parent?.append(e);return e}
const names=["ЯДРО ЛИЧНОСТИ","ДОЛГОВРЕМЕННАЯ ПАМЯТЬ","МЫШЛЕНИЕ","САМОСТЬ","ЭМОЦИИ","БИОГРАФИЯ","ЗНАНИЯ","ЦЕЛИ","ОБУЧЕНИЕ","РЕШЕНИЯ","ОПЫТ","ДОКУМЕНТЫ","СВЯЗИ","НАВЫКИ","РЕФЛЕКСИЯ","ДИАЛОГ","САМОРАЗВИТИЕ","ВНИМАНИЕ","ИНСТРУМЕНТЫ","КОНТЕКСТ","СИСТЕМА"];
const palette=["#4ebfb0","#79a9de","#6c86cf","#a58ad6","#65c4a8","#dda775","#8faebe"];
type Mode="compact"|"radial"|"hex";
type Point={x:number;y:number};
type Item={e:SVGElement;cluster:number;row:number;col:number;outer:boolean;from:Point;to:Point;now:Point};
const items:Item[]=[];
const counts=names.map((_,i)=>i===16?176: i===0?88: 24+(i*17)%67);
let mode:Mode="radial", selected=-1, zoom=1, tx=0,ty=0, speed=1, density=.5, paused=matchMedia("(prefers-reduced-motion: reduce)").matches;
let raf=0, start=0, cameraRaf=0;
const edges:{a:number;b:number;combined:boolean}[]=[];
let previous=-1;
const reduced=matchMedia("(prefers-reduced-motion: reduce)");
const defaults={speed:1,glow:65,density:50,depth:65,texture:35,motion:75,textMotion:60};
type Effects=typeof defaults;
let effects:Effects={...defaults};
let saveTimer:number|undefined, saveChain=Promise.resolve(), revision=0;
function motionOff(){return paused||reduced.matches||effects.motion===0}
const legend=byId("legend"), detail=byId("detail");
const TAU=Math.PI*2;
const angle=(i:number)=>-Math.PI/2+i*TAU/names.length;
const polar=(r:number,a:number):Point=>({x:r*Math.cos(a),y:r*Math.sin(a)});
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const hexCenter=(i:number):Point=>i<6?polar(205,-Math.PI/2+i*TAU/6):polar(455,-Math.PI/2+(i-6)*TAU/15);
function position(item:Item,m:Mode):Point{const {cluster:i,row,col,outer}=item;const a=angle(i);const width=clusterWidth(i), rows=Math.max(1,Math.ceil(counts[i]/width));const fraction=row/Math.max(1,rows-1);const step=Math.min(9,125/Math.max(1,rows-1));if(m==="hex"){const c=hexCenter(i);return outer?polarAround(c,72,(row*5+col)*TAU/(7+i%4)): {x:c.x+(col-4)*9+(row%2)*4.5,y:c.y+(row-(rows-1)/2)*step}}if(m==="compact"){return outer?polar(180+row*15,a+(col-2)*.045):polar(55+fraction*95,a+(col-4)*.027)}if(outer)return polar(474+row*22,a+(col-2)*.042);return polar(156+fraction*Math.min(142,Math.max(38,rows*8.6)),a+(col-4)*.025)}
function clusterWidth(i:number){return Math.min(9,Math.max(i===16?9:5,Math.ceil(Math.sqrt(counts[i]/3))))}
function polarAround(c:Point,r:number,a:number):Point{const p=polar(r,a);return {x:c.x+p.x,y:c.y+p.y}}
function transform(item:Item,p:Point){item.now=p;item.e.setAttribute("transform","translate("+p.x.toFixed(2)+" "+p.y.toFixed(2)+")")}
function color(i:number){return palette[i%palette.length]}
const glyphs=["M0 -5 4 -2 4 2 0 5 -4 2 -4 -2Z M0 -2v4 M-2 0h4","M-4 -4h8v8h-8Z M-2 -1h4 M-2 2h3","M-4 3 -1 -3 1 1 4 -4 M-4 3h8","M0 -5 5 0 0 5 -5 0Z M0 -2v4","M0 4C-7 0 -4 -5 0 -2 4 -5 7 0 0 4Z","M-4 -3h8 M-4 0h8 M-4 3h5","M-5 -3 0 -5 5 -3 0 0Z M-5 0 0 3 5 0 M-5 3 0 5 5 3","M0 -5 4 3 0 1 -4 3Z","M-5 -2 0 -5 5 -2 0 1Z M-3 0v3l3 2 3-2V0","M-4 0 -1 3 4 -3","M-4 4V0 M0 4v-8 M4 4v-5","M-3 -5h4l3 3v7h-7Z M1 -5v3h3","M-3 -3 3 3 M-3 3 3 -3 M-4 -4h2v2h-2Z M2 2h2v2H2Z","M-4 -1 1 -5 5 -1 0 4 -4 4Z","M-5 0Q0 -6 5 0Q0 6 -5 0Z M0 -2v4","M-5 -4h10v7H0l-3 2V3h-2Z","M-4 4 0 0 4 -4 M0 -4h4v4","M-4 -4h3 M-4 -4v3 M4 4H1 M4 4V1 M0 -2v4","M-5 4 0 -1 M0 -1 2 -4 5 -5 4 -2 1 0Z","M-4 -4h8v8h-8Z M-4 0h8 M0 -4v8","M0 -5 4 -3 4 3 0 5 -4 3 -4 -3Z M-2 0h4"];
function add(i:number,row:number,col:number,outer:boolean,n:number){let e:SVGElement;if(outer){e=el("g",{class:"satellite",color:color(i)},nodes);el("path",{class:"satellite-shell",d:"M0 -10 8.7 -5 8.7 5 0 10 -8.7 5 -8.7 -5Z"},e);el("path",{class:"satellite-glyph",d:glyphs[i]},e);const title=el("title",{},e);title.textContent=names[i]}else{const hot=(n*13+i*7)%23===0;e=el("circle",{r:hot?3.5:1.8,class:"dot"+(hot?" hot":""),color:color(i)},nodes);if(hot)e.style.animationDelay=-(n%9)*.38+"s";e.classList.add("depth-"+(n%3))}e.addEventListener("click",()=>select(i));e.addEventListener("dblclick",ev=>{ev.stopPropagation();focusCluster(i)});const item:Item={e,cluster:i,row,col,outer,from:{x:0,y:0},to:{x:0,y:0},now:{x:0,y:0}};item.to=position(item,mode);item.from=item.to;transform(item,item.to);items.push(item)}
names.forEach((name,i)=>{for(let n=0;n<counts[i];n++){const width=clusterWidth(i);const col=n%width+Math.floor((9-width)/2);add(i,Math.floor(n/width),col,false,n)}for(let n=0;n<7+(i%4);n++)add(i,Math.floor(n/5),n%5,true,n);const b=document.createElement("button");b.className="legend-row";b.style.setProperty("--c",color(i));const sw=document.createElement("i"),title=document.createElement("span"),count=document.createElement("span");title.textContent=name;count.textContent=String(counts[i]);b.append(sw,title,count);b.onclick=()=>select(i);b.ondblclick=()=>focusCluster(i);legend.append(b)});
function refreshStats(){byId("stats").textContent=items.length+" УЗЛОВ · "+names.length+" КЛАСТЕРОВ";Array.from(legend.children).forEach((b,i)=>{const n=b.lastElementChild;if(n)n.textContent=String(counts[i])})}
refreshStats();
function polygon(c:Point,r:number){return Array.from({length:6},(_,j)=>{const p=polar(r,j*TAU/6);return (c.x+p.x)+","+(c.y+p.y)}).join(" ")}
function decorate(){orbits.replaceChildren();labels.replaceChildren();links.replaceChildren();cells.replaceChildren();if(mode!=="hex"){for(const r of mode==="compact"?[180,198,225]:[450,500,530])el("circle",{r,class:"orbit"},orbits)}names.forEach((name,i)=>{const a=angle(i),c=mode==="hex"?hexCenter(i):polar(mode==="compact"?145:310,a);if(mode==="hex"){const h=el("polygon",{points:polygon(c,90),class:"hex-cell",color:color(i)},cells);h.onclick=()=>select(i)}const p=mode==="hex"?c:polar(mode==="compact"?190:485,a);const from=mode==="hex"?{x:0,y:0}:polar(mode==="compact"?100:160,a);const end=mode==="hex"?c:polar(mode==="compact"?180:475,a);for(let j=0;j<3;j++){const dst=mode==="hex"?{x:end.x+j*5,y:end.y+j*3}:polar(mode==="compact"?180:475,a+(j-1)*.04);el("path",{d:"M"+from.x+" "+from.y+" L"+dst.x+" "+dst.y,class:"spoke",opacity:density,style:"opacity:"+density*.55},links)}const t=el("text",{x:c.x,y:c.y+(mode==="hex"?-52:0),class:"cluster-label",color:color(i),"text-anchor":mode==="hex"||Math.abs(Math.cos(a))<.18?"middle":Math.cos(a)>0?"start":"end"},labels);t.textContent=name;t.onclick=()=>select(i);t.ondblclick=()=>focusCluster(i);if(i%2===0&&!paused&&effects.motion>0){const dot=el("circle",{r:1.8,class:"particle"},links);el("animateMotion",{path:"M"+from.x+" "+from.y+" L"+p.x+" "+p.y,dur:(4+i%5)/speed+"s",begin:-(i%7)+"s",repeatCount:"indefinite"},dot)}});if(selected>=0){const a=angle(selected), target=mode==="hex"?hexCenter(selected):polar(mode==="compact"?125:235,a);for(let i=0;i<names.length;i++){if(i===selected)continue;const p=mode==="hex"?hexCenter(i):polar(mode==="compact"?160:470,angle(i));el("path",{d:"M"+target.x+" "+target.y+" Q0 0 "+p.x+" "+p.y,fill:"none",color:color(selected),class:"selected-link"},links)}}drawEdges();if(motionOff())svg.pauseAnimations();else svg.unpauseAnimations()}
function select(i:number){if(selected>=0&&selected!==i)previous=selected;selected=i===selected?-1:i;Array.from(legend.children).forEach((b,j)=>b.classList.toggle("selected",j===selected));for(const item of items){item.e.classList.toggle("chosen",item.cluster===selected);item.e.style.opacity=selected<0||item.cluster===selected?"":"0.22"}detail.textContent=selected<0?"Выберите кластер или точку на карте.":names[selected]+" · "+counts[selected]+" демонстрационных точек. Подсвечены связи к другим кластерам.";decorate()}
function relayout(){cancelAnimationFrame(raf);for(const it of items){it.from=it.now;it.to=position(it,mode)}start=performance.now();function tick(t:number){const p=motionOff()?1:Math.min(1,(t-start)/850), eased=p*p*(3-2*p);for(const it of items)transform(it,mix(it.from,it.to,eased));if(p<1)raf=requestAnimationFrame(tick)}raf=requestAnimationFrame(tick)}
function setMode(m:Mode){if(m===mode)return;const old=el("g",{class:"map-ghost"},world);old.style.pointerEvents="none";for(const g of [orbits,links,cells,labels]){const clone=g.cloneNode(true) as SVGGElement;clone.removeAttribute("id");old.append(clone)}world.insertBefore(old,nodes);mode=m;document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===m));decorate();for(const g of [orbits,links,cells,labels]){g.animate([{opacity:0},{opacity:1}],{duration:motionOff()?0:650})}if(motionOff())old.remove();else{const a=old.animate([{opacity:1},{opacity:0}],{duration:650});a.onfinish=()=>old.remove()}relayout();updateLOD()}
function camera(){world.setAttribute("transform","translate("+tx+" "+ty+") scale("+zoom+")");byId("reset").textContent=Math.round(zoom*100)+"%";updateLOD()}
function zoomAt(factor:number,x=0,y=0){cancelAnimationFrame(cameraRaf);const next=Math.max(.08,Math.min(64,zoom*factor));tx=x-(x-tx)*next/zoom;ty=y-(y-ty)*next/zoom;zoom=next;camera()}
function coords(x:number,y:number):Point{const matrix=svg.getScreenCTM();if(!matrix)return{x:0,y:0};const p=new DOMPoint(x,y).matrixTransform(matrix.inverse());return{x:p.x,y:p.y}}
svg.addEventListener("wheel",e=>{e.preventDefault();const p=coords(e.clientX,e.clientY);zoomAt(Math.exp(-e.deltaY*.0015),p.x,p.y)},{passive:false});
let drag:{id:number;point:Point;tx:number;ty:number;moved:boolean}|null=null;
svg.addEventListener("pointerdown",e=>{if(e.button!==0)return;cancelAnimationFrame(cameraRaf);drag={id:e.pointerId,point:coords(e.clientX,e.clientY),tx,ty,moved:false}});
svg.addEventListener("pointermove",e=>{if(!drag||drag.id!==e.pointerId)return;const p=coords(e.clientX,e.clientY),dx=p.x-drag.point.x,dy=p.y-drag.point.y;if(!drag.moved&&Math.hypot(dx,dy)<4)return;drag.moved=true;svg.setPointerCapture(e.pointerId);svg.classList.add("dragging");tx=drag.tx+dx;ty=drag.ty+dy;camera()});
function stop(){drag=null;svg.classList.remove("dragging")}svg.addEventListener("pointerup",stop);svg.addEventListener("pointercancel",stop);
const reset=()=>animateCamera(1,0,0);byId("reset").onclick=reset;byId("minus").onclick=()=>zoomAt(.8);byId("plus").onclick=()=>zoomAt(1.25);group("core").addEventListener("click",()=>{reset();if(selected>=0)select(selected)});group("core").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();reset();if(selected>=0)select(selected)}});
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
function applyPause(){document.body.classList.toggle("paused",motionOff());byId("pause").textContent=paused?"Продолжить анимацию":"Пауза анимации";if(paused)svg.pauseAnimations();else svg.unpauseAnimations()}
byId("pause").onclick=()=>{paused=!paused;decorate();applyPause()};
const panel=byId("panel"),toggle=byId("panelToggle");panel.hidden=true;toggle.setAttribute("aria-expanded","false");toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute("aria-expanded",String(!panel.hidden))};decorate();applyEffects(false);camera();void loadDesign();

function updateLOD(){
 const level=zoom<.45?"overview":zoom<1.6?"normal":zoom<5?"near":"detail";
 svg.dataset.lod=level;
 for(const it of items){const sparse=(it.row*9+it.col)%4!==0;const far=level==="overview"&&!it.outer&&sparse;it.e.classList.toggle("lod-hidden",far);if(!it.outer)it.e.classList.toggle("fine-dot",level==="detail")}
}
function animateCamera(z:number,x:number,y:number){
 cancelAnimationFrame(cameraRaf);const origin={z:zoom,x:tx,y:ty},begin=performance.now();
 const tick=(now:number)=>{const p=motionOff()?1:Math.min(1,(now-begin)/650),e=p*p*(3-2*p);zoom=Math.exp(Math.log(origin.z)+(Math.log(z)-Math.log(origin.z))*e);tx=origin.x+(x-origin.x)*e;ty=origin.y+(y-origin.y)*e;camera();if(p<1)cameraRaf=requestAnimationFrame(tick)};
 cameraRaf=requestAnimationFrame(tick);
}
function anchor(i:number){return mode==="hex"?hexCenter(i):polar(mode==="compact"?115:225,angle(i))}
function focusCluster(i:number){if(selected!==i)select(i);const p=anchor(i),z=mode==="compact"?4:2.8;animateCamera(z,-p.x*z,-p.y*z)}
function grow(i:number){
 if(items.length>=5000||counts[i]>=360){detail.textContent="Достигнут предел демонстрационной карты.";return false}
 counts[i]++;const width=clusterWidth(i);let n=0;
 for(const it of items.filter(x=>x.cluster===i&&!x.outer)){it.row=Math.floor(n/width);it.col=n%width+Math.floor((9-width)/2);n++}
 add(i,Math.floor(n/width),n%width+Math.floor((9-width)/2),false,n);
 const it=items[items.length-1];transform(it,anchor(i));it.e.classList.add("born");it.e.addEventListener("animationend",()=>it.e.classList.remove("born"),{once:true});refreshStats();relayout();updateLOD();return true
}
function drawEdges(){
 for(const edge of edges){const a=anchor(edge.a),b=anchor(edge.b);const path="M"+a.x+" "+a.y+" Q0 0 "+b.x+" "+b.y;el("path",{d:path,class:"memory-edge"+(edge.combined?" combined":""),fill:"none",color:color(edge.a)},links);
 if(edge.combined&&!paused&&!reduced.matches&&effects.motion>0){const p=el("circle",{r:3,class:"particle"},links);el("animateMotion",{path,dur:"2.4s",repeatCount:"indefinite"},p)}
 }
}
function pair(combined:boolean){
 const a=previous,b=selected;if(a<0||b<0||a===b){detail.textContent="Выберите последовательно два разных кластера.";return false}
 const existing=edges.find(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a));
 if(existing&&(!combined||existing.combined)){detail.textContent="Эта связь уже существует.";return false}
 if(combined&&!grow(b))return false;
 if(existing)existing.combined=true;else edges.push({a,b,combined});
 decorate();detail.textContent=combined?"Создан производный демонстрационный узел; исходные узлы сохранены.":"Добавлена демонстрационная связь.";return true
}
byId("grow").onclick=()=>{if(selected<0){detail.textContent="Сначала выберите кластер.";return}if(grow(selected))detail.textContent=names[selected]+": добавлен демонстрационный узел."};
byId("connect").onclick=()=>pair(false);
byId("combine").onclick=()=>pair(true);
const chat=byId("chat"),chatToggle=byId("chatToggle"),messages=byId("messages"),chatPrompt=byId<HTMLInputElement>("prompt");
if(matchMedia("(max-width:720px)").matches){chat.hidden=true;chatToggle.setAttribute("aria-expanded","false")}
chatToggle.onclick=()=>{chat.hidden=!chat.hidden;chatToggle.setAttribute("aria-expanded",String(!chat.hidden));if(!chat.hidden)chatPrompt.focus()};
function message(text:string,kind:string){const p=document.createElement("p");p.className=kind;p.textContent=text;messages.append(p);while(messages.children.length>100)messages.firstElementChild?.remove();messages.scrollTop=messages.scrollHeight}
byId<HTMLFormElement>("chatForm").onsubmit=e=>{e.preventDefault();const raw=chatPrompt.value.trim();if(!raw)return;chatPrompt.value="";message(raw,"user-message");const cmd=raw.toLocaleLowerCase("ru").replace(/[.!?]+$/,"");let reply="Я пока работаю в локальном демонстрационном режиме. Доступны команды: кольца, соты, ядро, рост, связи, объединить.";
 if(cmd==="кольца"||cmd==="соты"||cmd==="ядро"){setMode(cmd==="кольца"?"radial":cmd==="соты"?"hex":"compact");reply="Режим карты изменён."}
 else if(cmd==="рост"){reply=selected>=0&&grow(selected)?"Добавлен демонстрационный узел.":"Выберите кластер или проверьте предел карты."}
 else if(cmd==="связи"||cmd==="объединить"){reply=pair(cmd==="объединить")?"Демонстрационная операция выполнена.":"Выберите два разных кластера без повторной операции."}
 message(reply,"reply");};
