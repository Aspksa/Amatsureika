import assert from "node:assert/strict";
import {visibleRange} from "../public/chat_virtual.js";
const h=Array(500).fill(100);let r=visibleRange(h,20000,600,200);assert.deepEqual([r.start,r.end,r.top,r.bottom],[198,208,19800,29200]);assert.equal(r.total,50000);r=visibleRange([40,200,70],60,100,0);assert.deepEqual([r.start,r.end],[1,2]);r=visibleRange([],0,100);assert.equal(r.total,0);console.log("Variable-height virtual window passed");
