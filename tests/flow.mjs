import assert from "node:assert/strict";
import {runQuietFlow,particleAt,PARTICLES} from "../public/flow.js";
function hooks(log,{failure=false,duplicate=false,gate=null}={}){
 return {leg:async leg=>{log.push(leg)},waiting:active=>log.push(active?"wait":"stop-wait"),
 send:async()=>{log.push("send");if(gate)await gate;if(failure)throw Error("network");return {duplicate}},
 committed:()=>log.push("committed"),duplicate:r=>r.duplicate,
 deliver:()=>log.push("deliver"),remember:async()=>{log.push("memory")}};
}
let log=[],release;const gate=new Promise(r=>release=r);
const active=runQuietFlow(true,hooks(log,{gate}));
await new Promise(r=>setTimeout(r,0));
assert.deepEqual(log,["chat-core","core-cloud","wait","send"]);
release();await active;
assert.deepEqual(log,["chat-core","core-cloud","wait","send","stop-wait","committed","cloud-core","core-chat","memory","deliver"]);
log=[];await runQuietFlow(false,hooks(log));
assert.deepEqual(log,["chat-core","send","committed","core-chat","memory","deliver"]);
log=[];await assert.rejects(runQuietFlow(true,hooks(log,{failure:true})),/network/);
assert.deepEqual(log,["chat-core","core-cloud","wait","send","stop-wait"]);
log=[];await runQuietFlow(true,hooks(log,{duplicate:true}));
assert.deepEqual(log,["chat-core","core-cloud","wait","send","stop-wait","committed","deliver"]);
for(const speed of [.25,1,2])for(let i=0;i<PARTICLES;i++){
 assert.equal(particleAt(-1,i,speed).opacity,0);
 assert.equal(particleAt(3000,i,speed).done,true);
 assert.equal(particleAt(3000,i,speed).opacity,0);
 assert(particleAt(150,i,speed).radius<=1.5);
}
assert.notEqual(particleAt(180,0,1).progress,particleAt(180,1,1).progress);
console.log("Quiet request route, delayed response, local mode, failure, duplicate and independent particle timing passed");

log=[];await runQuietFlow(true,{...hooks(log),prepare:async()=>{log.push("lookup");return false}});
assert.deepEqual(log,["chat-core","lookup","send","committed","core-chat","memory","deliver"]);
log=[];await runQuietFlow(true,{...hooks(log),prepare:async()=>{log.push("lookup");return true}});
assert.deepEqual(log,["chat-core","lookup","core-cloud","wait","send","stop-wait","committed","cloud-core","core-chat","memory","deliver"]);
