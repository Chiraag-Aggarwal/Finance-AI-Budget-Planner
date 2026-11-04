import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

// Execute the real account UI with a small DOM and controlled network responses.
// Only the unrelated save-queue import is replaced; authentication logic is unchanged.
const source = readFileSync(new URL("../js/account_ui.mjs", import.meta.url), "utf8")
  .replace(/^import .*pending_saves\.mjs";\r?\n/, "");
const html = ["layout", "auth"].map(name =>
  readFileSync(new URL("../" + name + ".html", import.meta.url), "utf8")).join("\n");
const tick = () => new Promise(resolve => setImmediate(resolve));
const account = { id: "test-owner", name: "Demo User", region: "Pune" };
const response = (status, body) => ({
  status, ok: status >= 200 && status < 300, json: async () => body,
});

class Element extends EventTarget {
  constructor(hidden = false) {
    super();
    this.hidden = hidden;
    this.textContent = "";
    this.disabled = false;
    this.attributes = new Map();
    this.elements = { token: {value: ""}, email: {value: ""} };
    this.classList = { toggle() {} };
  }
  setAttribute(name, value) { this.attributes.set(name, value); }
  focus() {}
  reset() {}
}

function start(fetch, { hash = "", readyState = "complete" } = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements.set("#" + match[1], new Element(/\bhidden(?:\s|>)/.test(match[0])));
  }
  elements.set(".auth-intro", new Element());
  const document = new EventTarget();
  Object.assign(document, {
    readyState,
    querySelector: selector => elements.get(selector) || null,
    querySelectorAll: () => [],
  });
  const window = new EventTarget();
  const timers = new Map();
  let nextTimer = 0;
  Object.assign(window, {
    location: { hash, pathname: "/budget.html" },
    history: { replaceState: () => { window.location.hash = ""; } },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  });
  let readyEvents = 0;
  let logoutEvents = 0;
  window.addEventListener("finance-user-ready", () => { readyEvents++; });
  window.addEventListener("finance-user-logout", () => { logoutEvents++; });
  vm.runInNewContext(source, {
    window, document, fetch, AbortController, URLSearchParams, CustomEvent,
    flushPageSaves: async () => {},
  });
  return {
    get: id => elements.get("#" + id),
    document, window, timers,
    readyEvents: () => readyEvents,
    logoutEvents: () => logoutEvents,
    click: id => elements.get("#" + id).dispatchEvent(new Event("click")),
  };
}

test("HTML hides login and private content before JavaScript runs", () => {
  assert.match(html, /<section id="auth-screen"[^>]*\bhidden>/);
  assert.match(html, /<div id="app-shell"[^>]*\bhidden>/);
  assert.match(html, /id="session-status"[^>]*role="status"/);
  assert.match(html, /id="session-error"[^>]*role="alert"[^>]*hidden/);
});

test("a slow valid session opens the requested page without showing login", async () => {
  let finish;
  const ui = start((_url, options) => {
    assert.equal(options.credentials, "same-origin");
    return new Promise(resolve => { finish = resolve; });
  });
  await tick();
  assert.equal(ui.get("auth-screen").hidden, true);
  assert.equal(ui.get("app-shell").hidden, true);
  assert.equal(ui.get("session-screen").hidden, false);
  finish(response(200, { user: account }));
  await tick();
  assert.equal(ui.get("auth-screen").hidden, true);
  assert.equal(ui.get("session-screen").hidden, true);
  assert.equal(ui.get("app-shell").hidden, false);
  assert.equal(ui.window.location.pathname, "/budget.html");
  assert.equal(ui.readyEvents(), 1);
  assert.equal(ui.timers.size, 0);
});

test("only a missing or expired session opens sign-in", async () => {
  const ui = start(async () => response(401, { error: "A sign-in session is required." }));
  await tick();
  assert.equal(ui.get("auth-screen").hidden, false);
  assert.equal(ui.get("app-shell").hidden, true);
  assert.equal(ui.get("session-screen").hidden, true);
  assert.equal(ui.readyEvents(), 0);
});

for (const [label, failedRequest] of [
  ["server unavailable", async () => response(503, {error: "Database unavailable"})],
  ["offline", async () => { throw new TypeError("Network failed"); }],
  ["non-JSON response", async () => ({
    ok: true, status: 200, json: async () => { throw new Error("Invalid JSON"); },
  })],
  ["missing user", async () => response(200, {})],
]) {
  test(label + " offers Retry without login, logout or private data", async () => {
    let calls = 0;
    const ui = start((...args) => ++calls === 1
      ? failedRequest(...args) : Promise.resolve(response(200, {user: account})));
    await tick();
    assert.equal(ui.get("auth-screen").hidden, true);
    assert.equal(ui.get("app-shell").hidden, true);
    assert.equal(ui.get("session-error").hidden, false);
    assert.equal(ui.get("session-retry").hidden, false);
    assert.equal(ui.get("session-retry").disabled, false);
    assert.equal(ui.logoutEvents(), 0);
    ui.click("session-retry");
    await tick();
    assert.equal(calls, 2);
    assert.equal(ui.get("session-screen").hidden, true);
    assert.equal(ui.get("app-shell").hidden, false);
    assert.equal(ui.readyEvents(), 1);
  });
}

test("a stalled session request times out and offers Retry", async () => {
  const ui = start((_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Aborted")), {once:true});
  }));
  [...ui.timers.values()][0]();
  await tick();
  assert.equal(ui.get("session-retry").hidden, false);
  assert.equal(ui.get("auth-screen").hidden, true);
  assert.equal(ui.get("app-shell").hidden, true);
  assert.equal(ui.timers.size, 0);
});

test("Retry cannot start overlapping session requests", async () => {
  let calls = 0, finish;
  const ui = start(async () => {
    calls++;
    if (calls === 1) return response(503, {});
    return new Promise(resolve => { finish = resolve; });
  });
  await tick();
  ui.click("session-retry");
  ui.click("session-retry");
  assert.equal(calls, 2);
  assert.equal(ui.get("session-retry").disabled, true);
  finish(response(200, {user: account}));
  await tick();
  assert.equal(ui.readyEvents(), 1);
});

test("account-ready waits for modules; Retry reuses DOM readiness", async () => {
  let calls = 0;
  const ui = start(async () => ++calls === 1
    ? response(503, {}) : response(200, {user: account}), {readyState: "interactive"});
  await tick();
  ui.document.dispatchEvent(new Event("DOMContentLoaded"));
  ui.click("session-retry");
  await tick();
  assert.equal(ui.get("app-shell").hidden, false);
  assert.equal(ui.readyEvents(), 1);
  const early = start(async () => response(200, {user: account}), {readyState: "interactive"});
  await tick();
  assert.equal(early.readyEvents(), 0);
  assert.equal(early.get("app-shell").hidden, true);
  early.document.dispatchEvent(new Event("DOMContentLoaded"));
  await tick();
  assert.equal(early.readyEvents(), 1);
});

test("password-reset links still show their form without a session check", async () => {
  let calls = 0;
  const ui = start(async () => { calls++; }, {hash:"#reset_token=test-token"});
  await tick();
  assert.equal(calls, 0);
  assert.equal(ui.get("auth-screen").hidden, false);
  assert.equal(ui.get("session-screen").hidden, true);
  assert.equal(ui.get("password-reset-form").hidden, false);
  assert.equal(ui.get("login-form").hidden, true);
  assert.equal(ui.get("password-reset-form").elements.token.value, "test-token");
  assert.equal(ui.window.location.hash, "");
});

test("verification links still show their result without a session check", async () => {
  const calls = [];
  const ui = start(async url => {
    calls.push(url);
    return response(200, {message: "Email verified."});
  }, {hash:"#verify_email=test-token"});
  await tick();
  assert.deepEqual(calls, ["/api/email-verification/complete"]);
  assert.equal(ui.get("auth-screen").hidden, false);
  assert.equal(ui.get("session-screen").hidden, true);
  assert.equal(ui.get("auth-message").textContent, "Email verified.");
  assert.equal(ui.window.location.hash, "");
});

test("explicit sign-out still returns to login", async () => {
  const ui = start(async url => response(200, url === "/api/me" ? {user: account} : {}));
  await tick();
  ui.click("sign-out-button");
  await tick();
  assert.equal(ui.get("auth-screen").hidden, false);
  assert.equal(ui.get("app-shell").hidden, true);
  assert.equal(ui.get("session-screen").hidden, true);
  assert.equal(ui.logoutEvents(), 1);
});
