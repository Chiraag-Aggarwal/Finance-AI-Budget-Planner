import test from "node:test";
import assert from "node:assert/strict";
import {monthlySuggestions,sumExpenseItems,upsertGoal} from "../js/planning_helpers.mjs";

test("expense items add to a rounded total and reject invalid inputs",()=>{
  assert.equal(sumExpenseItems([{name:"Rent",amount:10000},{name:"Food",amount:2000.25}]),12000.25);
  for(const items of [[{name:"",amount:10}],[{name:"Food",amount:NaN}],[{name:"Food",amount:-1}],[{name:"Food",amount:10000001}]]) assert.throws(()=>sumExpenseItems(items));
});
test("history suggestions separate EMI and personal costs, never invent zeroes",()=>{
  const e=(category,amount,type="expense",date="2026-10-01")=>({category,amount,type,date});
  const result=monthlySuggestions([e("Salary",60000,"income"),e("Housing and rent",12000),
    e("Loan EMI",5000),e("Personal",2000),e("Other",700),e("Utilities",1000,"expense","2026-11-02"),
    e("Personal",999,"expense","2026-12-01")],new Date(2026,10,7));
  assert.equal(result[0].current,true);
  assert.deepEqual(result[1].values,{monthlyTakeHomeIncome:60000,monthlyEssentialExpenses:12000,
    monthlyDebtPayment:5000,monthlyDiscretionaryExpenses:2000});
  assert.equal(result[0].values.monthlyTakeHomeIncome,undefined);
});
test("editing updates only the selected goal; snapshots do not share references",()=>{
  const profile={includeGoal:true,goalType:"car",goalPrice:100000,activeGoalId:"g1"};
  const first=upsertGoal([],"g1","Car",profile,"2026-11-01");
  const two=upsertGoal(first,"g2","Another car",{...profile,goalPrice:200000},"2026-11-02");
  const edited=upsertGoal(two,"g1","Car edited",{...profile,goalPrice:150000},"2026-11-03");
  assert.equal(edited.length,2);assert.equal(edited[1].profile.goalPrice,200000);
  assert.equal(edited[0].createdAt,"2026-11-01");assert.equal(edited[0].updatedAt,"2026-11-03");
  assert.equal(first[0].profile.goalPrice,100000);assert.equal(edited[0].profile.activeGoalId,undefined);
});
