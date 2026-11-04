import assert from "node:assert/strict";
import test from "node:test";
import {createCategoryHelper,suggestStarterCategory} from "../js/category_starter.mjs";

test("starter suggestions work without account history for English, Hindi and Hinglish",()=>{
  for(const [note,category] of [
    ["petrol fuel bike","Transport"],["monthly house rent","Housing and rent"],
    ["दूध सब्जी राशन","Food and groceries"],["doodh sabzi rashan","Food and groceries"],
    ["doctor consultation","Health"],["school tuition fees","Education"],
    ["car loan emi","Loan EMI"],
  ]) {
    const result=suggestStarterCategory("expense",note);
    assert.equal(result.status,"suggestion",note);
    assert.equal(result.category,category,note);
    assert.equal(result.source,"synthetic-starter");
  }
});
test("unknown, negated and ambiguous notes do not force irrelevant categories",()=>{
  for(const note of ["UPI payment","abc xyz","not rent","petrol groceries",""]) {
    assert.notEqual(suggestStarterCategory("expense",note).status,"suggestion",note);
  }
});
test("income and expenses are separate prediction classes",()=>{
  assert.equal(suggestStarterCategory("income","monthly salary credited").category,"Salary");
  assert.notEqual(suggestStarterCategory("expense","monthly salary credited").category,"Salary");
});
test("personal exact matches are scoped to owner and disposed on logout",()=>{
  const a=createCategoryHelper("user-a"),b=createCategoryHelper("user-b");
  const privateRows=[{type:"expense",category:"Health",note:"private albatross",ownerId:"user-a"}];
  assert.equal(a.suggest("user-a",privateRows,"expense","private albatross").category,"Health");
  assert.equal(a.suggest("user-b",privateRows,"expense","private albatross").status,"wrong-account");
  assert.notEqual(b.suggest("user-b",privateRows,"expense","private albatross").status,"suggestion");
  assert.notEqual(b.suggest("user-b",[],"expense","private albatross").status,"suggestion");
  a.dispose();
  assert.equal(a.suggest("user-a",privateRows,"expense","private albatross").status,"wrong-account");
});
test("conflicting personal labels ask the user to choose instead of copying an arbitrary label",()=>{
  const helper=createCategoryHelper("a");
  const records=["Health","Personal"].map(category=>({type:"expense",note:"same note",category}));
  assert.equal(helper.suggest("a",records,"expense","same note").status,"uncertain-match");
});
