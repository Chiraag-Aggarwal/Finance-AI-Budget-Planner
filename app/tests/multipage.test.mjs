import assert from "node:assert/strict";
import test from "node:test";

test("appearance keeps old preferences and offers all three designs with Bloom as default", async () => {
  globalThis.document = { documentElement:{dataset:{}}, querySelector:()=>null,
    querySelectorAll:()=>[], addEventListener(){} };
  globalThis.window = { matchMedia:()=>({matches:false,addEventListener(){}}), addEventListener(){} };
  const { normalizeAppearance } = await import("../js/settings.mjs");
  assert.equal(normalizeAppearance().design, "bloom");
  assert.equal(normalizeAppearance().theme, "light");
  assert.equal(normalizeAppearance({theme:"dark",accent:"mint"}).accent,"mint");
  assert.equal(normalizeAppearance({theme:"dark"}).theme,"dark");
  for (const design of ["bloom","sunrise","ocean"]) assert.equal(normalizeAppearance({design}).design,design);
  assert.equal(normalizeAppearance({design:"invalid",theme:"invalid"}).design,"bloom");
});

test("page navigation waits for queued saves and captures an immutable input snapshot", async () => {
  globalThis.window = new EventTarget();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    await gate;
    return {ok:true, json:async()=>({data:sent.at(-1)})};
  };
  const {saveFinanceDataField, waitForFinanceSaves} = await import("../js/finance_data.mjs");
  window.dispatchEvent(new CustomEvent("finance-user-ready",{detail:{id:"test-owner"}}));
  const input = {monthlyTakeHomeIncome:80000};
  const saving = saveFinanceDataField("plannerProfile",input);
  input.monthlyTakeHomeIncome = 1;
  let finished = false;
  const leaving = waitForFinanceSaves().then(()=>{finished=true;});
  await Promise.resolve();
  assert.equal(finished,false);
  assert.equal(sent[0].plannerProfile.monthlyTakeHomeIncome,80000);
  release();
  await Promise.all([saving,leaving]);
  assert.equal(finished,true);
});

test("a failed save blocks navigation until a successful retry", async () => {
  const {saveFinanceDataField, waitForFinanceSaves} = await import("../js/finance_data.mjs");
  globalThis.fetch = async () => ({ok:false,json:async()=>({error:"Test save failed"})});
  await assert.rejects(saveFinanceDataField("transactions",[]), /Test save failed/);
  await assert.rejects(waitForFinanceSaves(), /Test save failed/);
  globalThis.fetch = async () => ({ok:true,json:async()=>({data:{transactions:[]}})});
  await saveFinanceDataField("transactions",[]);
  await waitForFinanceSaves();
});
