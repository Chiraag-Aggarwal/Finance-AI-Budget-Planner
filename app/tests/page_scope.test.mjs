import assert from "node:assert/strict";
import test from "node:test";
globalThis.window = new EventTarget();
const {createPageScope} = await import("../js/page_scope.mjs");
const {flushPageSaves} = await import("../js/pending_saves.mjs");
const store = await import("../js/finance_data.mjs");
const reply = (data, status=200) => ({ok:status===200,status,json:async()=>data});
const signIn = id => window.dispatchEvent(new CustomEvent("finance-user-ready",{detail:{id}}));

test("leaving a page removes its global listeners and save handler", async () => {
  signIn("owner-a");
  const scope=createPageScope({querySelector:()=>null});
  let events=0,saves=0,ready=0,cleanup=0;
  scope.listen(window,"page-test",()=>events++);
  scope.registerSave(()=>{saves++;});
  scope.onReady(()=>{ready++;});
  scope.onDispose(()=>{cleanup++;});
  await scope.start({id:"owner-a"});
  window.dispatchEvent(new Event("page-test"));
  await flushPageSaves();
  assert.deepEqual([events,saves,ready],[1,1,1]);
  scope.dispose();
  scope.dispose();
  window.dispatchEvent(new Event("page-test"));
  await flushPageSaves();
  await scope.start({id:"owner-b"});
  assert.deepEqual([events,saves,ready,cleanup],[1,1,1,1]);
});

test("page visits reuse saved data and see the latest acknowledged edit", async () => {
  signIn("owner-a");
  let gets=0;
  globalThis.fetch=async (_url,options)=> {
    if(options.method==="GET"){gets++;return reply({data:{transactions:[]}});}
    return reply({data:JSON.parse(options.body)});
  };
  await store.loadFinanceData();
  await store.loadFinanceData();
  await store.saveFinanceDataField("transactions",[{id:"new-entry"}]);
  const current=await store.loadFinanceData();
  assert.equal(gets,1);
  assert.equal(current.transactions[0].id,"new-entry");
});

test("a delayed response cannot load another account's private figures", async () => {
  signIn("owner-a");
  let release;
  globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});
  const old=store.loadFinanceData();
  const rejected=assert.rejects(old,/account changed/);
  window.dispatchEvent(new Event("finance-user-logout"));
  signIn("owner-b");
  release(reply({data:{privateValue:"owner-a-only"}}));
  await rejected;
  globalThis.fetch=async()=>reply({data:{privateValue:"owner-b-only"}});
  assert.deepEqual(await store.loadFinanceData(),{privateValue:"owner-b-only"});
});

test("a delayed request is also rejected after signing back into the same account", async () => {
  signIn("owner-a");
  let release;
  globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});
  const rejected=assert.rejects(store.loadFinanceData(),/account changed/);
  window.dispatchEvent(new Event("finance-user-logout"));
  signIn("owner-a");
  release(reply({data:{stale:true}}));
  await rejected;
});

test("an unauthorized private request reports session expiry", async () => {
  signIn("owner-a");
  let expired=0;
  const onExpired=()=>{expired++;};
  window.addEventListener("finance-session-expired",onExpired);
  globalThis.fetch=async()=>reply({error:"A sign-in session is required."},401);
  await assert.rejects(store.loadFinanceData(),/sign-in session/);
  assert.equal(expired,1);
  window.removeEventListener("finance-session-expired",onExpired);
});

test("private saves identify the active owner and discard queued old-account work",async()=>{
  signIn("first");
  let release;
  const calls=[];
  globalThis.fetch=(_url,options)=>{
    calls.push(options);
    return new Promise(resolve=>{release=resolve;});
  };
  const first=store.saveFinanceDataField("transactions",[]);
  const firstRejected=assert.rejects(first,/account changed/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls[0].headers["X-Finance-Owner"],"first");
  const queued=store.saveFinanceDataField("transactions",[{id:"old-note"}]);
  const queuedRejected=assert.rejects(queued,/Sign in/);
  window.dispatchEvent(new Event("finance-user-logout"));
  signIn("second");
  release(reply({data:{transactions:[]}}));
  await firstRejected;
  await queuedRejected;
  assert.equal(calls.length,1);
});
