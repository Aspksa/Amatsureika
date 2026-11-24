type WorkKind="staff"|"timesheet"|"cards"|"vehicles"|"fuel";
type Field={key:string;label:string;type:"text"|"number"|"date"|"ref";optional?:boolean;ref?:WorkKind;max?:number};
type Value=string|number|null;
type RecordRow={id:number;kind:WorkKind;fields:Record<string,Value>;archived:boolean};
type Entry={id:number;parent:number|null;name:string;kind:"folder"|"file";size:number;updated:string};
type DiskState={entries:Entry[];crumbs:{id:number;name:string}[]};
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
   actions.append(button("Изменить",()=>edit(r)),button(r.archived?"Восстановить":"В архив",()=>{if(!r.archived&&!window.confirm("Перенести запись в архив?"))return;void changeWork({kind:r.kind,id:r.id,archived:!r.archived})}));row.append(actions);body.append(row);
  }
  table.append(body);workTable.append(table);
 }
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
    if(r.kind==="file"&&r.size<=262144&&/\.(txt|md|csv|log|json)$/i.test(r.name))actions.append(button("Просмотр",()=>void preview(r)));
    actions.append(button("Переименовать",()=>{const n=window.prompt("Новое имя",r.name);if(n&&n!==r.name)void diskChange({action:"rename",id:r.id,name:n})}),button("В корзину",()=>{if(window.confirm("Перенести в корзину: "+r.name+"?"))void diskChange({action:"trash",id:r.id})}));
   }
   row.append(actions);diskList.append(row);
  }
 }
 async function preview(r:Entry){
  try{const text=await run("docsIcon",async()=>{const response=await fetch("/api/disk/download?id="+r.id);if(!response.ok)throw Error("Файл недоступен");return response.text()});id("diskPreviewTitle").textContent=r.name;id("diskPreviewText").textContent=text;id("diskPreview").hidden=false}
  catch(e){diskStatus.textContent=err(e)}
 }
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
}
