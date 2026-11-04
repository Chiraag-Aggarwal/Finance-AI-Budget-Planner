import assert from "node:assert/strict";
import test from "node:test";
import {forecastNextMonthSpending,closedBudgetMonths} from "../js/budget_forecast.mjs";
const now=new Date(2026,9,31,12);
const expense=(month,category,amount,day="15")=>({
  id:month+category+day,type:"expense",category,date:month+"-"+day,amount,note:"",
});

test("one expense gives an immediate provisional estimate; no months are required",()=>{
  const result=forecastNextMonthSpending([expense("2026-10","Housing and rent",15000)],[],now);
  assert.equal(result.status,"ready");
  assert.equal(result.total,15000);
  assert.equal(result.provisional,true);
  assert.equal(result.categories[0].source,"recorded-amount");
});
test("repeated variable spending uses trained synthetic starter coefficients",()=>{
  const entries=[expense("2026-10","Food and groceries",1000,"01"),expense("2026-10","Food and groceries",1200,"05")];
  const result=forecastNextMonthSpending(entries,[],new Date(2026,9,10));
  assert.equal(result.status,"ready");
  assert.equal(result.usesSyntheticStarter,true);
  assert.ok(result.total>=2200 && result.total<=22000);
  assert.equal(result.categories[0].source,"synthetic-starter");
});
test("fixed bills and EMI are not multiplied by day-of-month",()=>{
  const entries=[expense("2026-10","Loan EMI",6000,"01"),expense("2026-10","Housing and rent",18000,"02")];
  assert.equal(forecastNextMonthSpending(entries,[],new Date(2026,9,3)).total,24000);
});
test("one planner draft provides immediate aggregate estimates without inventing categories",()=>{
  const result=forecastNextMonthSpending([],[],now,{
    monthlyEssentialExpenses:20000,monthlyDiscretionaryExpenses:5000,monthlyDebtPayment:2000,
  });
  assert.equal(result.status,"ready");
  assert.equal(result.total,27000);
  assert.deepEqual(result.categories.map(item=>item.category),["Essential expenses (plan)","Flexible expenses (plan)","Loan EMI"]);
  assert.equal(result.usesSyntheticStarter,false);
});
test("missing entries are unknown, even if legacy month confirmations exist",()=>{
  const result=forecastNextMonthSpending([],["2026-08","2026-09","2026-10"],now);
  assert.equal(result.status,"needs-input");
  assert.equal(result.categories.length,0);
  assert.deepEqual(result.historyMonths,[]);
});
test("income, invalid dates, future dates and unknown categories do not train expenses",()=>{
  const entries=[
    expense("2026-10","Transport",3000),
    expense("2026-11","Transport",100000),
    {...expense("2026-10","Salary",90000),type:"income"},
    expense("2026-10","Unknown",50000),
    expense("2026-02","Transport",50000,"31"),
    expense("2026-10","Transport",Infinity),
  ];
  assert.equal(forecastNextMonthSpending(entries,[],now).total,3000);
});
test("gaps and absent categories are not replaced with zero",()=>{
  const result=forecastNextMonthSpending([
    expense("2026-07","Transport",3000),
    expense("2026-09","Transport",3000),
    expense("2026-08","Health",4000),
  ],[],now);
  assert.equal(result.status,"ready");
  assert.equal(result.total,3000);
  assert.equal(result.categories.length,1);
});
test("personal trends use actual month spacing, with capped changes",()=>{
  const result=forecastNextMonthSpending([
    expense("2026-07","Food and groceries",10000),
    expense("2026-08","Food and groceries",11000),
    expense("2026-09","Food and groceries",12000),
  ],[],now);
  assert.equal(result.total,12500);
  assert.equal(result.categories[0].source,"personal-trend");
});
test("old records alone request fresh inputs, not a three-month wait",()=>{
  const result=forecastNextMonthSpending([expense("2026-01","Transport",5000)],[],now);
  assert.equal(result.status,"needs-input");
});
test("calendar closure handles month/year rollover without creating missing months",()=>{
  const rows=[expense("2026-12","Transport",500),expense("2027-01","Transport",400)];
  assert.deepEqual(closedBudgetMonths(rows,new Date(2026,11,31)),[]);
  assert.deepEqual(closedBudgetMonths(rows,new Date(2027,0,1)),["2026-12"]);
  assert.deepEqual(closedBudgetMonths(rows,new Date(2027,2,1)),["2026-12","2027-01"]);
  assert.deepEqual(closedBudgetMonths([],new Date(2027,2,1)),[]);
});
test("closed-month derivation ignores impossible dates and updates after deletion",()=>{
  assert.deepEqual(closedBudgetMonths([expense("2026-02","Transport",1,"31")],now),[]);
  const row=expense("2026-09","Transport",400);
  assert.deepEqual(closedBudgetMonths([row],now),["2026-09"]);
  assert.deepEqual(closedBudgetMonths([],now),[]);
});
