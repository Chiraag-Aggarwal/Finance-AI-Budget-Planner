// Run against tests/browser_server.py, never against the production website.
// Playwright supplies a real browser; every account/API response below is synthetic.
import assert from "node:assert/strict";
const {chromium} = await import(process.env.FINANCE_AI_PLAYWRIGHT_MODULE || "playwright");
const base = process.argv[2];
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base || "")) throw new Error("Pass the local test server URL.");
const browser = await chromium.launch({
  headless:true,
  ...(process.env.FINANCE_AI_TEST_BROWSER ? {executablePath:process.env.FINANCE_AI_TEST_BROWSER} : {}),
});
let checks=0;
const errors=[];
const paths=["/","/budget.html","/planner.html","/insights.html","/profile.html","/settings.html"];
const json=(data,status=200)=>({status,contentType:"application/json",body:JSON.stringify(data)});
const today=new Date().toLocaleDateString("en-CA");
const newData=()=>({
  transactions:[
    {id:"income",type:"income",category:"Salary",date:today,amount:80000,note:"Demo salary"},
    {id:"food",type:"expense",category:"Food and groceries",date:today,amount:10000,note:"Demo groceries"},
  ],
  completedMonths:[],
});
async function setup(viewport,{noPreload=false}={}) {
  const context=await browser.newContext({viewport});
  let user={id:"owner-a",name:"Demo User",email:"demo@example.test",region:"Pune"};
  let data=newData();
  let failSave=false,expired=false,failPage=false,holdPage=null;
  const counts={me:0,gets:0,patches:0,documents:0};
  await context.addInitScript(({noPreload})=>{
    window.documentMarker=Math.random();
    if(noPreload) window.requestIdleCallback=()=>1;
  },{noPreload});
  await context.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const method=route.request().method();
    if(path==="/api/me") {counts.me++;return route.fulfill(json({user}));}
    if(path==="/api/logout") return route.fulfill(json({}));
    if(path==="/api/login") {
      expired=false;
      user={id:"owner-b",name:"Second User",email:"second@example.test",region:"Delhi"};
      data={transactions:[],completedMonths:[]};
      return route.fulfill(json({user}));
    }
    if(expired) return route.fulfill(json({error:"A sign-in session is required."},401));
    const requestedOwner=route.request().headers()["x-finance-owner"];
    if(requestedOwner && requestedOwner!==user.id)
      return route.fulfill(json({error:"Your account changed. Please sign in again."},401));
    if(path==="/api/finance-data") {
      if(method==="GET") counts.gets++;
      else {
        counts.patches++;
        if(failSave) return route.fulfill(json({error:"Test connection failure"},503));
        Object.assign(data,route.request().postDataJSON());
      }
      return route.fulfill(json({data}));
    }
    if(path==="/api/profile") {
      Object.assign(user,route.request().postDataJSON());
      return route.fulfill(json({user}));
    }
    if(path==="/api/account/export") return route.fulfill(json({user,data}));
    return route.fulfill(json({message:"Test request completed."}));
  });
  await context.route("**/insights.html",async route=>{
    if(failPage) return route.abort("failed");
    if(holdPage) await holdPage;
    return route.continue();
  });
  const page=await context.newPage();
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame()) counts.documents++;});
  const ready=async path=>{
    await page.waitForFunction(path=>{
      const normalized=location.pathname==="/index.html"?"/":location.pathname;
      return normalized===path && !!document.querySelector(".page-view") && !document.querySelector("#app-shell").inert;
    },path);
  };
  const nav=async path=>{
    await page.locator("#main-menu-button").click();
    await page.locator('#main-menu a[href="'+path+'"]').click();
    await ready(new URL(path,base).pathname);
    assert.equal(await page.locator("#auth-screen").isVisible(),false);
    assert.equal(await page.locator("#session-screen").isVisible(),false);
  };
  await page.goto(base+"/");
  await ready("/");
  return {context,page,nav,ready,counts,getData:()=>data,
    failSave:value=>{failSave=value;},expire:()=>{expired=true;},
    failPage:value=>{failPage=value;},holdPage:value=>{holdPage=value;}};
}
try {
  for(const viewport of [{width:1365,height:900},{width:390,height:844}]) {
    const t=await setup(viewport);
    const {page,nav,counts}=t;
    const marker=await page.evaluate(()=>window.documentMarker);
    for(let round=0;round<2;round++) {
      for(const path of paths) {
        await nav(path);
        assert.equal(await page.evaluate(()=>window.documentMarker),marker);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
        if(path!=="/" || round!==0) {
          assert.equal(await page.evaluate(()=>document.activeElement.matches("#app-shell h1, #app-shell h2")),true);
        }
        checks++;
      }
    }
    assert.equal(counts.documents,1);
    assert.equal(counts.me,1);
    assert.equal(counts.gets,1);
    checks++;

    await nav("/budget.html");
    await page.locator("#transaction-amount").fill("321");
    await page.locator("#transaction-note").fill("One new test entry");
    await page.locator('#transaction-form button[type="submit"]').click();
    await nav("/");
    assert.match(await page.locator("#dashboard-expenses").innerText(),/10,321/);
    assert.equal(t.getData().transactions.filter(x=>x.note==="One new test entry").length,1);
    await nav("/budget.html");
    assert.equal(await page.locator("#transaction-rows tr").count(),3);
    checks++;

    await nav("/planner.html");
    assert.equal(await page.locator("#planner-editor").isVisible(),false);
    await page.locator("#add-new-goal").click();
    await page.locator('[data-goal-choice="saving"]').click();
    await page.locator('[name="monthlyTakeHomeIncome"]').fill("90000");
    await nav("/budget.html"); // Must flush the 250 ms planner draft timer.
    assert.equal(t.getData().plannerProfile.monthlyTakeHomeIncome,90000);
    await nav("/planner.html");
    await page.locator("#continue-draft").click();
    assert.equal(await page.locator('[name="monthlyTakeHomeIncome"]').inputValue(),"90000");
    checks++;

    await page.locator("#emergency-months-choice").selectOption("0");
    await nav("/budget.html");
    assert.equal(t.getData().plannerProfile.emergencyFundMonths,0);
    await nav("/planner.html");
    await page.locator("#continue-draft").click();
    assert.equal(await page.locator("#emergency-months-choice").inputValue(),"0");
    await page.locator("#emergency-months-choice").selectOption("custom");
    await page.locator('[name="emergencyFundMonths"]').fill("18");
    await nav("/budget.html");
    await nav("/planner.html");
    await page.locator("#continue-draft").click();
    assert.equal(await page.locator("#emergency-months-choice").inputValue(),"custom");
    assert.equal(await page.locator('[name="emergencyFundMonths"]').inputValue(),"18");
    await page.locator('[name="emergencyFundMonths"]').fill("121");
    assert.equal(await page.locator('[name="emergencyFundMonths"]').evaluate(node=>node.checkValidity()),false);
    await page.locator('[name="emergencyFundMonths"]').fill("18");
    await page.locator("#language-toggle").click();
    assert.match(await page.locator("#emergency-months-help").innerText(),/\p{Script=Devanagari}/u);
    await page.locator("#language-toggle").click();
    assert.doesNotMatch(await page.locator("#emergency-months-help").innerText(),/\p{Script=Devanagari}/u);
    checks++;

    await nav("/budget.html");
    assert.equal(await page.locator("#budget-complete-month").count(),0);
    await page.locator("#transaction-note").fill("petrol fuel bike");
    await page.locator("#transaction-category-suggestion").waitFor({state:"visible"});
    assert.equal(await page.locator("#transaction-category-suggestion-name").innerText(),"Transport");
    await page.locator("#use-transaction-category-suggestion").click();
    assert.equal(await page.locator("#transaction-category").inputValue(),"Transport");
    await page.locator("#transaction-note").fill("private albatross");
    assert.equal(await page.locator("#transaction-category-suggestion").isVisible(),false);
    await nav("/insights.html");
    assert.equal(await page.locator("#budget-complete-month").count(),0);
    assert.equal(await page.locator("#spending-forecast-results").isVisible(),true);
    assert.doesNotMatch(await page.locator("#spending-forecast-status").innerText(),/Mark 3/);
    checks++;

    await nav("/profile.html");
    await page.locator('#profile-edit-form [name="name"]').fill("Updated Demo");
    await nav("/settings.html");
    assert.equal(await page.locator("#signed-in-name").innerText(),"Updated Demo");
    await page.locator("#setting-theme").selectOption("dark");
    for(const design of ["sunrise","ocean","bloom"]) {
      await page.locator('[data-design-choice="'+design+'"]').click();
      assert.equal(await page.locator("html").getAttribute("data-design"),design);
    }
    await page.locator("#setting-reduce-motion").check();
    await nav("/budget.html");
    await nav("/settings.html");
    assert.equal(await page.locator("#setting-theme").inputValue(),"dark");
    assert.equal(await page.locator("#setting-reduce-motion").isChecked(),true);
    await page.locator("#language-toggle").click();
    await nav("/budget.html");
    assert.equal(await page.locator("html").getAttribute("lang"),"hi");
    await page.locator("#language-toggle").click();
    assert.equal(await page.locator("html").getAttribute("lang"),"en");
    checks++;

    await nav("/planner.html");
    await nav("/insights.html");
    await page.goBack();
    await t.ready("/planner.html");
    await page.goForward();
    await t.ready("/insights.html");
    assert.equal(counts.documents,1);
    assert.equal(counts.me,1);
    checks++;

    // A failed write must keep the old page and unsaved entry available.
    await nav("/budget.html");
    t.failSave(true);
    await page.locator("#transaction-amount").fill("654");
    await page.locator("#transaction-note").fill("Retry this entry");
    await page.locator('#transaction-form button[type="submit"]').click();
    await page.locator("#save-error-alert").waitFor({state:"visible"});
    await page.locator("#main-menu-button").click();
    await page.locator('#main-menu a[href="/"]').click();
    await page.locator("#page-transition-retry").waitFor({state:"visible"});
    assert.equal(new URL(page.url()).pathname,"/budget.html");
    assert.match(await page.locator("#transaction-rows").innerText(),/Retry this entry/);
    t.failSave(false);
    await page.locator("#page-transition-retry").focus();
    await page.keyboard.press("Enter");
    await t.ready("/");
    assert.equal(t.getData().transactions.filter(x=>x.note==="Retry this entry").length,1);
    checks++;

    // Refresh still validates the session and loads the saved data again.
    await page.reload();
    await t.ready("/");
    assert.equal(counts.me,2);
    assert.match(await page.locator("#dashboard-expenses").innerText(),/10,975/);
    checks++;

    // Personal note labels must not be learned by the next account.
    await nav("/budget.html");
    await page.locator("#transaction-category").selectOption("Health");
    await page.locator("#transaction-amount").fill("101");
    await page.locator("#transaction-note").fill("private albatross");
    await page.locator('#transaction-form button[type="submit"]').click();
    await nav("/");
    await nav("/budget.html");
    await page.locator("#transaction-note").fill("private albatross");
    await page.locator("#transaction-category-suggestion").waitFor({state:"visible"});
    assert.equal(await page.locator("#transaction-category-suggestion-name").innerText(),"Health");
    checks++;

    // A rejected private API request ends the UI session, not just the request.
    t.expire();
    await page.locator("#transaction-amount").fill("999");
    await page.locator('#transaction-form button[type="submit"]').click();
    await page.locator("#login-form").waitFor({state:"visible"});
    assert.equal(await page.locator("#app-shell").innerText(),"");
    await page.locator('#login-form [name="email"]').fill("second@example.test");
    await page.locator('#login-form [name="password"]').fill("Synthetic-test-password");
    await page.locator('#login-form button[type="submit"]').click();
    await t.ready("/");
    assert.equal(await page.locator("#dashboard-income").isVisible(),true);
    await page.goBack();
    await t.ready("/"); // Older login's history is ignored.
    await nav("/budget.html");
    assert.equal(await page.locator("#transaction-note").inputValue(),"");
    assert.equal(await page.locator("#transaction-rows tr").count(),0);
    await page.locator("#transaction-note").fill("private albatross");
    assert.equal(await page.locator("#transaction-category-suggestion").isVisible(),false);
    assert.equal(await page.locator("#signed-in-name").innerText(),"Second User");
    await page.locator("#main-menu-button").click();
    await page.locator("#sign-out-button").click();
    await page.locator("#login-form").waitFor({state:"visible"});
    assert.equal(await page.locator("#app-shell").innerText(),"");
    checks++;
    await t.context.close();
  }

  const slow=await setup({width:1365,height:900},{noPreload:true});
  let release;
  slow.holdPage(new Promise(resolve=>{release=resolve;}));
  await slow.page.locator("#main-menu-button").click();
  await slow.page.locator('#main-menu a[href="/insights.html"]').click();
  await slow.page.waitForTimeout(400);
  assert.equal(new URL(slow.page.url()).pathname,"/");
  assert.equal(await slow.page.locator("#dashboard-income").isVisible(),true);
  assert.equal(await slow.page.locator("#session-screen").isVisible(),false);
  release();
  await slow.ready("/insights.html");
  checks++;
  await slow.context.close();

  const failure=await setup({width:390,height:844},{noPreload:true});
  failure.failPage(true);
  await failure.page.locator("#main-menu-button").click();
  await failure.page.locator('#main-menu a[href="/insights.html"]').click();
  await failure.page.locator("#page-transition-retry").waitFor({state:"visible"});
  assert.equal(new URL(failure.page.url()).pathname,"/");
  failure.failPage(false);
  await failure.page.locator("#page-transition-retry").click();
  await failure.ready("/insights.html");
  checks++;
  await failure.context.close();

  // The latest menu choice wins even if an earlier page response arrives later.
  const rapid=await setup({width:1365,height:900},{noPreload:true});
  let finishFirst;
  rapid.holdPage(new Promise(resolve=>{finishFirst=resolve;}));
  await rapid.page.locator("#main-menu-button").click();
  await rapid.page.locator('#main-menu a[href="/insights.html"]').click();
  if(!await rapid.page.locator("#main-menu").isVisible()) await rapid.page.locator("#main-menu-button").click();
  await rapid.page.locator('#main-menu a[href="/settings.html"]').click();
  await rapid.ready("/settings.html");
  finishFirst();
  await rapid.page.waitForTimeout(150);
  assert.equal(new URL(rapid.page.url()).pathname,"/settings.html");
  assert.equal(rapid.counts.me,1);
  checks++;
  await rapid.context.close();

  // Back must not discard an entry after a failed save.
  const back=await setup({width:390,height:844});
  await back.nav("/budget.html");
  back.failSave(true);
  await back.page.locator("#transaction-amount").fill("123");
  await back.page.locator("#transaction-note").fill("Keep on Back");
  await back.page.locator('#transaction-form button[type="submit"]').click();
  await back.page.locator("#save-error-alert").waitFor({state:"visible"});
  await back.page.goBack();
  await back.page.locator("#page-transition-retry").waitFor({state:"visible"});
  await back.page.waitForURL(base+"/budget.html");
  assert.match(await back.page.locator("#transaction-rows").innerText(),/Keep on Back/);
  back.failSave(false);
  await back.page.locator("#page-transition-retry").click();
  await back.ready("/");
  assert.equal(back.getData().transactions.filter(x=>x.note==="Keep on Back").length,1);
  checks++;
  await back.context.close();

  // Separate URLs still work when opened directly, including the /index alias.
  for(const path of [...paths,"/index.html"]) {
    const direct=await setup({width:1365,height:900});
    await direct.page.goto(base+path);
    await direct.ready(path==="/index.html"?"/":path);
    assert.equal(direct.counts.me,2);
    assert.equal(await direct.page.locator("#page-transition-status").isVisible(),false);
    checks++;
    await direct.context.close();
  }

  // Past recorded months close automatically, including old manual confirmations.
  const calendar=await setup({width:1365,height:900});
  const previous=new Date();
  previous.setDate(1);
  previous.setMonth(previous.getMonth()-1);
  const closedMonth=previous.toLocaleDateString("en-CA").slice(0,7);
  const currentMonth=today.slice(0,7);
  calendar.getData().transactions.push({id:"old",type:"expense",category:"Transport",date:closedMonth+"-15",amount:150,note:"Last month bus"});
  calendar.getData().completedMonths=[currentMonth]; // Obsolete manual checkbox data.
  await calendar.page.reload();
  await calendar.ready("/");
  await calendar.nav("/budget.html");
  await calendar.nav("/");
  assert.deepEqual(calendar.getData().completedMonths,[closedMonth]);
  assert.equal(calendar.getData().transactions.length,3);
  checks++;
  await calendar.context.close();

  // Same-browser tabs share a cookie, but must not keep another account's DOM.
  const tabs=await setup({width:1365,height:900});
  const second=await tabs.context.newPage();
  second.on("pageerror",error=>errors.push(error.message));
  await second.goto(base+"/budget.html");
  await second.locator(".page-view").waitFor();
  await second.locator("#transaction-note").fill("private unsaved note");
  await tabs.page.locator("#main-menu-button").click();
  await tabs.page.locator("#sign-out-button").click();
  await second.locator("#login-form").waitFor({state:"visible"});
  assert.equal(await second.locator("#app-shell").innerText(),"");
  await tabs.page.locator('#login-form [name="email"]').fill("second@example.test");
  await tabs.page.locator('#login-form [name="password"]').fill("Synthetic-test-password");
  await tabs.page.locator('#login-form button[type="submit"]').click();
  await tabs.ready("/");
  assert.equal(new URL(tabs.page.url()).pathname,"/");
  assert.equal(await second.locator("#app-shell").innerText(),"");
  checks++;
  await tabs.context.close();

  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:checks,failed:0,pageErrors:errors.length,viewports:["desktop","mobile"]}));
} finally {
  await browser.close();
}
