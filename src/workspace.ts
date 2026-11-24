type WorkKind="staff"|"timesheet"|"cards"|"vehicles"|"fuel";
type Field={key:string;label:string;type:"text"|"number"|"date"|"ref";optional?:boolean;ref?:WorkKind;max?:number};
type Value=string|number|null;
type RecordRow={id:number;kind:WorkKind;fields:Record<string,Value>;archived:boolean};
type Entry={id:number;parent:number|null;name:string;kind:"folder"|"file";size:number;updated:string};
type DiskState={entries:Entry[];crumbs:{id:number;name:string}[]};
type TreeItem={id:number;parent:number|null;name:string;kind:"folder"|"file";size:number;depth:number};
const sections:Record<WorkKind,{title:string;fields:Field[]}>={
 staff:{title:"Сотрудники",fields:[{key:"name",label:"ФИО",type:"text"},{key:"job",label:"Должность",type:"text"},{key:"number",label:"Табельный номер",type:"text"}]},
 timesheet:{title:"Табель",fields:[{key:"employee",label:"Сотрудник",type:"ref",ref:"staff"},{key:"date",label:"Дата",type:"date"},{key:"hours",label:"Часы",type:"number",max:24},{key:"note",label:"Примечание",type:"text",optional:true}]},
 cards:{title:"Топливные карты",fields:[{key:"number",label:"Номер карты",type:"text"},{key:"provider",label:"Поставщик",type:"text"},{key:"vehicle",label:"Автомобиль",type:"ref",ref:"vehicles",optional:true}]},
 vehicles:{title:"Автомобили",fields:[{key:"plate",label:"Госномер",type:"text"},{key:"model",label:"Марка / модель",type:"text"},{key:"driver",label:"Водитель",type:"ref",ref:"staff",optional:true}]},
 fuel:{title:"ГСМ",fields:[{key:"date",label:"Дата",type:"date"},{key:"vehicle",label:"Автомобиль",type:"ref",ref:"vehicles"},{key:"card",label:"Топливная карта",type:"ref",ref:"cards",optional:true},{key:"kind",label:"Вид топлива",type:"text"},{key:"liters",label:"Литры",type:"number"},{key:"cost",label:"Сумма, ₽",type:"number"},{key:"note",label:"Примечание",type:"text",optional:true}]}
};
const id=<T extends HTMLElement>(s:string)=>document.getElementById(s) as T;
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text="",cls=""){const e=document.createElement(tag);e.textContent=text;if(cls)e.className=cls;return e}
function button(text:string,action:()=>void){const e=node("button",text);e.type="button";e.onclick=action;return e}
async function api<T>(path:string,body?:object):Promise<T>{
 const r=await fetch(path,body===undefined?{cache:"no-store"}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const v=await r.json();if(!r.ok)throw Error(v.error||"Ошибка локального сервера");return v as T;
}
function err(e:unknown){return e instanceof Error?e.message:"Операция не выполнена"}
function localDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")}
export function setupWorkspace(bind:(id:string,open:()=>void)=>void,run:<T>(id:"workIcon"|"docsIcon",operation:()=>Promise<T>)=>Promise<T>){
 const intelligence=<T>(value:object)=>api<T>("/api/agent/workspace",value);
 const workApi=<T>(path:string,body?:object)=>run("workIcon",()=>api<T>(path,body));
 const diskApi=<T>(path:string,body?:object)=>run("docsIcon",()=>api<T>(path,body));
 const wd=id<HTMLDialogElement>("workDialog"),dd=id<HTMLDialogElement>("diskDialog");
 let rows:RecordRow[]=[],kind:WorkKind="staff",editing:number|null=null,workBusy=false;
 const workStatus=id("workStatus"),workForm=id<HTMLFormElement>("workForm"),workFields=id("workFields"),workTable=id("workTable"),workFilter=id<HTMLInputElement>("workSearch"),archived=id<HTMLInputElement>("workArchived");
 const desc=(r:RecordRow)=>String(r.fields.name||r.fields.plate||r.fields.number||"#"+r.id)+(r.archived?" (архив)":"");
 const valueText=(f:Field,v:Value)=>f.type==="ref"&&v!==null?(rows.find(r=>r.id===v)?desc(rows.find(r=>r.id===v)!):"#"+v):String(v??"—");
 function edit(r?:RecordRow){
  editing=r?.id??null;workFields.replaceChildren();id("workEditTitle").textContent=r?"Редактирование #"+r.id:"Новая запись";
  for(const f of sections[kind].fields){
   const label=node("label",f.label),v=r?.fields[f.key];let input:HTMLInputElement|HTMLSelectElement;
   if(f.type==="ref"){
    const select=node("select"),empty=node("option",f.optional?"Не выбрано":"Выберите запись");empty.value="";select.append(empty);
    for(const record of rows.filter(x=>x.kind===f.ref&&(!x.archived||x.id===v))){const o=node("option",desc(record));o.value=String(record.id);select.append(o)}
    select.value=v==null?"":String(v);input=select;
   }else{
    const field=node("input");field.type=f.type;field.maxLength=500;
    if(f.type==="number"){field.step="0.001";field.min=f.key==="liters"?"0.001":"0";field.max=String(f.max??1000000000)}
    field.value=v==null?(f.type==="date"?localDate():""):String(v);input=field;
   }
   input.name=f.key;input.required=!f.optional;label.append(input);workFields.append(label);
  }
 }
 function renderWork(){
  const q=workFilter.value.trim().toLocaleLowerCase("ru"),fields=sections[kind].fields,filtered=rows.filter(r=>r.kind===kind&&(!r.archived||archived.checked)&&fields.map(f=>valueText(f,r.fields[f.key])).join(" ").toLocaleLowerCase("ru").includes(q));
  for(const tab of Array.from(id("workTabs").querySelectorAll<HTMLButtonElement>("button")))tab.classList.toggle("active",tab.dataset.kind===kind);
  id("workTitle").textContent=sections[kind].title;const total=kind==="timesheet"?" · "+filtered.filter(r=>!r.archived).reduce((a,r)=>a+Number(r.fields.hours),0).toLocaleString("ru")+" ч":kind==="fuel"?" · "+filtered.filter(r=>!r.archived).reduce((a,r)=>a+Number(r.fields.liters),0).toLocaleString("ru")+" л · "+filtered.filter(r=>!r.archived).reduce((a,r)=>a+Number(r.fields.cost),0).toLocaleString("ru")+" ₽":"";
  id("workTotal").textContent=filtered.length+" записей"+total;
  workTable.replaceChildren();if(!filtered.length){workTable.append(node("p","Записей пока нет.","workspace-empty"));return}
  const table=node("table"),head=node("thead"),tr=node("tr");for(const f of fields)tr.append(node("th",f.label));tr.append(node("th","Действия"));head.append(tr);table.append(head);const body=node("tbody");
  for(const r of filtered){
   const row=node("tr");if(r.archived)row.className="archived-row";
   for(const f of fields)row.append(node("td",valueText(f,r.fields[f.key])));
   const actions=node("td","","workspace-actions");
   actions.append(button("История",()=>void showRecord(r.id)),button("Изменить",()=>edit(r)),button(r.archived?"Восстановить":"В архив",()=>{if(!r.archived&&!window.confirm("Перенести запись в архив?"))return;void changeWork({kind:r.kind,id:r.id,archived:!r.archived})}));row.append(actions);body.append(row);
  }
  table.append(body);workTable.append(table);
 }
async function showRecord(recordId:number){
 try{const data=await intelligence<{record:RecordRow;related:RecordRow[];related_total:number;versions:{created:string;before:RecordRow|null;after:RecordRow}[];note:string}>({action:"record",id:recordId});const out=id("workOverview");out.replaceChildren(node("h3","Карточка #"+recordId),node("p",data.note));
 const pre=node("pre",JSON.stringify(data.record.fields,null,2));out.append(pre,node("h4","Связанные записи: "+data.related_total));
 for(const r of data.related){const b=button(sections[r.kind].title+" · #"+r.id+(r.archived?" · архив":""),()=>{const original=rows.find(x=>x.id===r.id);if(!original)return;kind=original.kind;edit(original);renderWork()});out.append(b)}
 const details=node("details");details.append(node("summary","Изменения: "+data.versions.length));for(const v of data.versions)details.append(node("pre",v.created+"\n"+JSON.stringify(v.before?.fields??null)+" → "+JSON.stringify(v.after.fields)));out.append(details)
 }catch(e){workStatus.textContent=err(e)}
 }
 id("garageOverview").onclick=async()=>{const month=id<HTMLInputElement>("garageMonth").value||localDate().slice(0,7);try{
 const data=await intelligence<{month:string;counts:Record<string,number>;liters:string;cost:string;hours:string;vehicles:{id:number;name:string;liters:string;cost:string;liters_per_100km:string|null}[];staff:{id:number;name:string;hours:string;days:number}[];daily:{date:string;liters:string;cost:string}[];anomalies:{total:number;issues:{text:string}[]};note:string}>({action:"garage",month});
 const out=id("workOverview");out.replaceChildren(node("h3","Гараж · "+data.month),node("p",Object.entries(data.counts).map(([k,v])=>sections[k as WorkKind].title+": "+v).join(" · ")),node("p",data.liters+" л · "+data.cost+" ₽ · "+data.hours+" ч"),node("p","Замечаний: "+data.anomalies.total),node("p",data.note));
 for(const r of data.vehicles)out.append(button(r.name+" · "+r.liters+" л · "+r.cost+" ₽ · "+(r.liters_per_100km??"нет пробега")+" л/100 км",()=>void showRecord(r.id)));
 for(const r of data.staff)out.append(button(r.name+" · "+r.hours+" ч · "+r.days+" дней",()=>void showRecord(r.id)));
 const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");svg.setAttribute("viewBox","0 0 500 130");svg.setAttribute("aria-label","Суммы заправок по дням");svg.setAttribute("role","img");const max=Math.max(1,...data.daily.map(d=>Number(d.cost)));data.daily.forEach((d,i)=>{const bar=document.createElementNS(ns,"rect"),h=100*Number(d.cost)/max;bar.setAttribute("x",String(10+i*480/Math.max(1,data.daily.length)));bar.setAttribute("y",String(110-h));bar.setAttribute("height",String(h));bar.setAttribute("width",String(Math.max(2,450/Math.max(1,data.daily.length))));bar.setAttribute("fill","#77d9c7");const t=document.createElementNS(ns,"title");t.textContent=d.date+": "+d.cost+" ₽";bar.append(t);svg.append(bar)});if(data.daily.length)out.append(svg);
 for(const issue of data.anomalies.issues.slice(0,15))out.append(node("p",issue.text));
 }catch(e){workStatus.textContent=err(e)}};
 id<HTMLInputElement>("garageMonth").value=localDate().slice(0,7);
 async function loadWork(reset=true){const result=await workApi<{records:RecordRow[]}>("/api/work");rows=result.records;renderWork();if(reset)edit()}
 async function changeWork(payload:object){
  if(workBusy)return;workBusy=true;workStatus.textContent="Сохранение…";
  try{await workApi("/api/work",payload);await loadWork();workStatus.textContent="Сохранено локально"}
  catch(e){workStatus.textContent=err(e)}
  finally{workBusy=false}
 }
 for(const [k,s] of Object.entries(sections)){
  const tab=button(s.title,()=>{if(workBusy)return;kind=k as WorkKind;workFilter.value="";edit();renderWork()});tab.dataset.kind=k;id("workTabs").append(tab);
 }
 workFilter.oninput=renderWork;archived.onchange=renderWork;id("workNew").onclick=()=>edit();
 workForm.onsubmit=e=>{e.preventDefault();if(workBusy)return;const data=new FormData(workForm),fields:Record<string,Value>={};
  for(const f of sections[kind].fields){const v=String(data.get(f.key)??"");fields[f.key]=f.type==="number"?Number(v):f.type==="ref"?(v?Number(v):null):v}
  void changeWork({kind,id:editing,fields});
 };
 bind("workIcon",()=>{if(!wd.open)wd.showModal();workStatus.textContent="Загрузка…";void loadWork().then(()=>workStatus.textContent="Локальное хранение").catch(e=>workStatus.textContent=err(e))});
 id("workClose").onclick=()=>wd.close();
 let parent:number|null=null,trash=false,entries:Entry[]=[],diskBusy=false,revision=0,tiles=false;
 const diskStatus=id("diskStatus"),diskList=id("diskList"),diskSearch=id<HTMLInputElement>("diskSearch"),upload=id<HTMLInputElement>("diskUpload");
 function renderDisk(){
  const q=diskSearch.value.trim().toLocaleLowerCase("ru");diskList.replaceChildren();diskList.classList.toggle("disk-tiles",tiles);
  const visible=entries.filter(x=>x.name.toLocaleLowerCase("ru").includes(q));
  if(!visible.length){diskList.append(node("p",trash?"Корзина пуста":"Здесь пока нет файлов.","workspace-empty"));return}
  for(const r of visible){
   const row=node("div","","disk-row"),title=button((r.kind==="folder"?"▱  ":"▤  ")+r.name,()=>{
    if(trash)return;if(r.kind==="folder"){parent=r.id;void refreshDisk()}else window.location.assign("/api/disk/download?id="+r.id)
   });title.className="disk-name";title.disabled=trash;row.append(title,node("small",r.kind==="folder"?"Папка":(r.size/1024).toLocaleString("ru",{maximumFractionDigits:1})+" КБ"));
   const actions=node("div","","workspace-actions");
   if(trash)actions.append(button("Восстановить",()=>void diskChange({action:"restore",id:r.id})));
   else{
    if(r.kind==="file"&&/\.(txt|md|csv|log|json|docx|xlsx|pdf|tsv)$/i.test(r.name))actions.append(button("Просмотр",()=>void preview(r)));
    actions.append(button("Переместить",()=>void chooseMove(r)),button("Переименовать",()=>{const n=window.prompt("Новое имя",r.name);if(n&&n!==r.name)void diskChange({action:"rename",id:r.id,name:n})}),button("В корзину",()=>{if(window.confirm("Перенести в корзину: "+r.name+"?"))void diskChange({action:"trash",id:r.id})}));
   }
   row.append(actions);diskList.append(row);
  }
 }
 async function chooseMove(r:Entry){
  try{const data=await intelligence<{items:TreeItem[]}>({action:"tree"});const out=id("diskInsight");out.replaceChildren(node("p","Переместить "+r.name));
   const select=node("select"),root=node("option","Корень");root.value="";select.append(root);
   for(const f of data.items.filter(x=>x.kind==="folder"&&x.id!==r.id)){const o=node("option","—".repeat(Math.min(12,f.depth))+f.name);o.value=String(f.id);select.append(o)}
   out.append(select,button("Подтвердить",()=>{void diskChange({action:"move",id:r.id,parent:select.value?Number(select.value):null});out.replaceChildren()}))
  }catch(e){diskStatus.textContent=err(e)}
 }
 async function preview(r:Entry){
  try{const data=await run("docsIcon",()=>intelligence<{title:string;kind:string;text?:string;columns?:string[];rows?:Record<string,string>[];total_rows?:number;note?:string;truncated?:boolean}>({action:"preview",id:r.id}));id("diskPreviewTitle").textContent=data.title;const out=id("diskPreviewText");out.replaceChildren();
   if(data.kind==="pdf"){const a=node("a","Открыть PDF в браузере");a.href="/api/disk/pdf?id="+r.id;a.target="_blank";a.rel="noopener noreferrer";out.append(a)}
   else if(data.kind==="table"){const columns=data.columns??[],table=node("table"),header=node("tr");for(const c of columns)header.append(node("th",c));table.append(header);for(const row of data.rows??[]){const tr=node("tr");for(const c of columns)tr.append(node("td",row[c]??""));table.append(tr)}out.append(table,node("p","Строк: "+data.total_rows))}
   else out.textContent=data.text??"";
   if(data.note||data.truncated)out.append(node("p",data.note??"Показана ограниченная выдержка"));id("diskPreview").hidden=false
  }catch(e){diskStatus.textContent=err(e)}
 }
 id("diskTree").onclick=async()=>{try{const data=await intelligence<{items:TreeItem[];truncated:boolean}>({action:"tree"});const out=id("diskInsight");out.replaceChildren(node("p","Иерархия диска"+(data.truncated?" · ограниченная":"")));for(const f of data.items){const b=button((f.kind==="folder"?"▱ ":"▤ ")+f.name,()=>{if(f.kind==="folder"){parent=f.id;trash=false;void refreshDisk()}else void preview({...f,updated:""})});b.style.marginLeft=Math.min(14,f.depth)*12+"px";out.append(b)}}catch(e){diskStatus.textContent=err(e)}};
 id("diskDuplicates").onclick=async()=>{try{const data=await intelligence<{groups:{size:number;files:{id:number;name:string}[]}[];hashed:number;skipped_count:number;note:string}>({action:"duplicates"});const out=id("diskInsight");out.replaceChildren(node("p",data.note),node("p","Групп: "+data.groups.length+" · проверено "+data.hashed+" · пропущено "+data.skipped_count));for(const g of data.groups)out.append(node("p",g.files.map(f=>"#"+f.id+" "+f.name).join(" = ")+" · "+g.size+" байт"))}catch(e){diskStatus.textContent=err(e)}};
 id("diskClassify").onclick=async()=>{try{const data=await intelligence<{items:{id:number;name:string;tags:{label:string;basis:string}[]}[];note:string;truncated:boolean}>({action:"classify"});const out=id("diskInsight");out.replaceChildren(node("p",data.note+(data.truncated?" · ограничено первыми 100 файлами":"")));for(const f of data.items)out.append(node("p",f.name+" · "+(f.tags.map(t=>t.label+" ("+t.basis+")").join(", ")||"нет предложения")))}catch(e){diskStatus.textContent=err(e)}};
 async function refreshDisk(){
  const rev=++revision,folder=parent,inTrash=trash;diskStatus.textContent="Загрузка…";id("diskPreview").hidden=true;
  try{const state=await diskApi<DiskState>("/api/disk?"+(inTrash?"trash=1":folder===null?"":"parent="+folder));if(rev!==revision)return;
   entries=state.entries;const crumbs=id("diskCrumbs");crumbs.replaceChildren(button("Документы",()=>{trash=false;parent=null;void refreshDisk()}));
   if(inTrash)crumbs.append(node("span"," / Корзина"));else for(const c of state.crumbs){crumbs.append(node("span"," / "),button(c.name,()=>{parent=c.id;void refreshDisk()}))}
   id<HTMLButtonElement>("diskFolder").disabled=inTrash;upload.disabled=inTrash;id<HTMLButtonElement>("diskTrash").textContent=inTrash?"К файлам":"Корзина";renderDisk();diskStatus.textContent=entries.length+" объектов · локально";
  }catch(e){if(rev===revision)diskStatus.textContent=err(e)}
 }
 async function diskChange(payload:object){
  if(diskBusy)return;diskBusy=true;
  try{await diskApi("/api/disk",payload);await refreshDisk()}catch(e){diskStatus.textContent=err(e)}finally{diskBusy=false}
 }
 id("diskFolder").onclick=()=>{if(trash)return;const name=window.prompt("Название папки");if(name)void diskChange({action:"folder",parent,name})};
 id("diskTrash").onclick=()=>{trash=!trash;parent=null;diskSearch.value="";void refreshDisk()};
 id("diskView").onclick=()=>{tiles=!tiles;id("diskView").textContent=tiles?"Список":"Плитки";renderDisk()};
 id("diskPreviewClose").onclick=()=>id("diskPreview").hidden=true;diskSearch.oninput=renderDisk;
 upload.onchange=async()=>{
  if(diskBusy||trash)return;const files=Array.from(upload.files??[]),folder=parent;if(!files.length)return;diskBusy=true;upload.disabled=true;
  const errors:string[]=[];
  for(const file of files){
   try{if(file.size>25*1024*1024)throw Error("лимит 25 МиБ");
    diskStatus.textContent="Загрузка: "+file.name;const query=new URLSearchParams({name:file.name});if(folder!==null)query.set("parent",String(folder));
    await run("docsIcon",async()=>{const response=await fetch("/api/disk/upload?"+query,{method:"POST",headers:{"Content-Type":"application/octet-stream"},body:file});const result=await response.json();if(!response.ok)throw Error(result.error||"Ошибка загрузки")});
   }catch(e){errors.push(file.name+": "+err(e))}
  }
  upload.value="";diskBusy=false;upload.disabled=trash;await refreshDisk();if(errors.length)diskStatus.textContent=errors.join("; ");
 };
 bind("docsIcon",()=>{if(!dd.open)dd.showModal();void refreshDisk()});id("diskClose").onclick=()=>dd.close();
 return {openRecord:async(k:WorkKind,recordId:number)=>{
  if(workBusy)return;
  if(!wd.open)wd.showModal();kind=k;workFilter.value="";workStatus.textContent="Загрузка…";
  try{await loadWork();const record=rows.find(r=>r.kind===k&&r.id===recordId&&!r.archived);if(record){edit(record);workStatus.textContent="Запись #"+recordId}else workStatus.textContent="Запись уже недоступна"}
  catch(e){workStatus.textContent=err(e)}
 }};
}
