/** Event-driven request choreography, independent of DOM and transport. */
export type Leg="chat-core"|"core-cloud"|"cloud-core"|"core-chat";
export type FlowHooks<T>={
 leg:(leg:Leg)=>Promise<void>;
 prepare?:(requested:boolean)=>Promise<boolean>;
 waiting:(active:boolean)=>void;
 send:()=>Promise<T>;
 committed:(result:T)=>void;
 duplicate:(result:T)=>boolean;
 deliver:(result:T)=>void;
 remember:(result:T)=>Promise<void>;
};
export async function runQuietFlow<T>(paid:boolean,h:FlowHooks<T>):Promise<T>{
 await h.leg("chat-core");
 if(h.prepare)paid=await h.prepare(paid);
 if(paid)await h.leg("core-cloud");
 if(paid)h.waiting(true);
 let result:T;
 try{result=await h.send()}finally{if(paid)h.waiting(false)}
 h.committed(result);
 if(h.duplicate(result)){h.deliver(result);return result}
 if(paid)await h.leg("cloud-core");
 await Promise.all([h.leg("core-chat").then(()=>h.deliver(result)),h.remember(result)]);
 return result;
}
export const PARTICLES=3;
/** Each particle has its own start, duration, radius and fade, no trail. */
export function particleAt(elapsed:number,index:number,speed:number){
 const scale=Math.max(.25,Math.min(2,Number.isFinite(speed)?speed:1));
 const delay=index*62/scale,duration=(330+index*49)/scale;
 const t=(elapsed-delay)/duration;
 return {progress:Math.max(0,Math.min(1,t)),opacity:t<=0||t>=1?0:Math.min(1,t*7,(1-t)*7)*(.95-index*.15),
 radius:1.45-index*.22,done:t>=1};
}
