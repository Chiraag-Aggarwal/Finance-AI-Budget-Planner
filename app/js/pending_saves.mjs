import { waitForFinanceSaves } from "./finance_data.mjs";

// Moving to another page must not discard a form's 250 ms autosave timer.
const saveHandlers = new Set();
export function registerPageSave(handler) {
  saveHandlers.add(handler);
}

export async function flushPageSaves() {
  for (const save of saveHandlers) await save();
  await waitForFinanceSaves();
}
