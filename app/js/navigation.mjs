import { flushPageSaves } from "./pending_saves.mjs";
import { loadFinanceData } from "./finance_data.mjs";

// URLs stay bookmarkable. Only public templates/modules are prefetched.
// Personal figures come from the existing account-scoped data store.
const routes = {
  "/": ["dashboard.mjs"],
  "/budget.html": ["budget_ui.mjs"],
  "/planner.html": ["app.mjs"],
  "/insights.html": ["budget_savings_ui.mjs", "budget_ui.mjs"],
  "/profile.html": ["profile_page.mjs"],
  "/settings.html": [],
};
const pathFor = (url) => url.pathname === "/index.html" ? "/" : url.pathname;
const shell = document.querySelector("#app-shell");
const button = document.querySelector("#main-menu-button");
const menu = document.querySelector("#main-menu");
const wrap = document.querySelector("#main-menu-wrap");
const status = document.querySelector("#page-transition-status");
const message = document.querySelector("#page-transition-message");
const retry = document.querySelector("#page-transition-retry");
const templates = new Map();
let currentUser = null;
let accountEpoch = 0;
let pageMounted = false;
let currentPath = pathFor(location);
let currentMounts = [];
let navigationId = 0;
let historyIndex = 0;
let ignoreNextPop = false;
let retryUrl = null;
let routeSession = null;
const ROUTE_SESSION_KEY = "finance-ai-navigation-session";

// Store a random navigation generation and owner ID, never personal page data.
function savedRouteSession() {
  try { return JSON.parse(sessionStorage.getItem(ROUTE_SESSION_KEY)); } catch { return null; }
}
function resetRouteSession(user) {
  routeSession = { owner:String(user.id), token:crypto.randomUUID() };
  try { sessionStorage.setItem(ROUTE_SESSION_KEY, JSON.stringify(routeSession)); } catch {}
  historyIndex = 0;
  ignoreNextPop = false;
  history.replaceState({ financePage:true, index:0, session:routeSession.token }, "", "/");
}

const initialHistorySession = history.state?.session;
const initialHistoryIndex = Number.isInteger(history.state?.index) ? history.state.index : 0;
const initialTemplate = { html: shell.innerHTML, title: document.title, page: document.body.dataset.page };
templates.set(currentPath, Promise.resolve(initialTemplate));
history.replaceState({ ...history.state, financePage: true, index: historyIndex }, "", location.href);

function closeMenu(returnFocus = false) {
  menu.hidden = true;
  button.setAttribute("aria-expanded", "false");
  if (returnFocus) button.focus();
}
button.addEventListener("click", () => {
  menu.hidden = !menu.hidden;
  button.setAttribute("aria-expanded", String(!menu.hidden));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !menu.hidden) closeMenu(true);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest("#main-menu-wrap")) closeMenu();
});
document.addEventListener("focusin", (event) => {
  if (!wrap.contains(event.target)) closeMenu();
});

function updateActiveLinks() {
  document.querySelectorAll("#app-navigation a, #main-menu a").forEach((link) => {
    if (pathFor(link) === currentPath && !link.hash) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

function loadTemplate(path) {
  if (!templates.has(path)) {
    const request = fetch(path, { credentials: "same-origin", signal: AbortSignal.timeout(15000) })
      .then(async (response) => {
        if (!response.ok) throw new Error("Page could not be loaded.");
        const document = new DOMParser().parseFromString(await response.text(), "text/html");
        const content = document.querySelector("#app-shell");
        if (!content || !document.body.dataset.page) throw new Error("Invalid page response.");
        return { html: content.innerHTML, title: document.title, page: document.body.dataset.page };
      })
      .catch((error) => {
        templates.delete(path); // A failed preload must remain retryable.
        throw error;
      });
    templates.set(path, request);
  }
  return templates.get(path);
}

function loadModules(path) {
  return Promise.all(routes[path].map(name => import("./" + name)));
}

function disposePage() {
  for (const mount of currentMounts) mount.dispose();
  currentMounts = [];
}

function moveFocus(url, restoreScroll) {
  if (restoreScroll) {
    window.scrollTo({ top: restoreScroll.y, left: restoreScroll.x, behavior: "instant" });
    return;
  }
  let target = null;
  try { target = url.hash ? document.getElementById(decodeURIComponent(url.hash.slice(1))) : null; }
  catch { /* A malformed bookmark falls back to the page heading. */ }
  target ||= shell.querySelector("h1, h2") || shell;
  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  if (url.hash) target.scrollIntoView({ behavior: "instant", block: "start" });
  else window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

function showError(url) {
  retryUrl = url;
  message.textContent = "Could not open that page. Your current page is still here. Try again.";
  retry.hidden = false;
  status.hidden = false;
}

// Prepare the next view while the current one stays visible. Replace it only
// when the template, modules and pending account saves are ready.
async function openPage(url, { initial = false, popState = null } = {}) {
  if (!currentUser) return;
  const path = pathFor(url);
  if (!routes[path]) return;
  const requestId = ++navigationId;
  const epoch = accountEpoch;
  const mounts = [];
  retryUrl = null;
  status.hidden = true;
  retry.hidden = true;
  const loadingTimer = window.setTimeout(() => {
    if (requestId !== navigationId) return;
    message.textContent = "Opening page…";
    status.hidden = false;
  }, 200);

  try {
    if (!initial && path === currentPath && pageMounted) {
      await flushPageSaves();
      if (requestId !== navigationId || epoch !== accountEpoch || !currentUser) return;
      if (popState) historyIndex = popState.index;
      else if (url.href !== location.href) {
        history.replaceState({ ...history.state, scroll: {x:scrollX, y:scrollY} }, "", location.href);
        history.pushState({ financePage:true, session:routeSession?.token, index:++historyIndex }, "", url.href);
      }
      closeMenu();
      moveFocus(url, popState?.scroll);
      status.hidden = true;
      return;
    }
    const [template, modules] = await Promise.all([
      loadTemplate(path), loadModules(path), flushPageSaves(), loadFinanceData(),
    ]);
    if (requestId !== navigationId || epoch !== accountEpoch || !currentUser) return;
    // Also catch edits made while a slow template was being fetched.
    await flushPageSaves();
    if (requestId !== navigationId || epoch !== accountEpoch || !currentUser) return;
    shell.inert = true;
    const view = document.createElement("div");
    view.className = "page-view";
    view.innerHTML = template.html;
    for (const module of modules) mounts.push(module.mountPage(view, currentUser));
    for (const mount of mounts) await mount.ready;
    if (requestId !== navigationId || epoch !== accountEpoch || !currentUser) return;

    // Keep Back/Forward and separate URLs without reloading the document.
    if (!initial && !popState) {
      history.replaceState({ ...history.state, scroll: {x:scrollX, y:scrollY} }, "", location.href);
      historyIndex++;
      history.pushState({ financePage:true, session:routeSession?.token, index:historyIndex }, "", url.href);
    } else if (popState) {
      historyIndex = popState.index;
    }
    disposePage();
    currentMounts = mounts.splice(0);
    shell.replaceChildren(view);
    pageMounted = true;
    shell.inert = false;
    currentPath = path;
    document.body.dataset.page = template.page;
    document.title = template.title;
    updateActiveLinks();
    closeMenu();
    window.dispatchEvent(new CustomEvent("finance-page-ready", { detail: {path} }));
    // Translate newly attached content synchronously, before it can flash English.
    window.translateFinancePage?.(view);
    if (!initial) moveFocus(url, popState?.scroll);
    status.hidden = true;
  } catch {
    if (requestId !== navigationId || epoch !== accountEpoch || !currentUser) return;
    // Back already changed the URL. Restore it if saving/loading prevented leaving.
    if (popState && Number.isInteger(popState.index) && popState.index !== historyIndex) {
      ignoreNextPop = true;
      history.go(historyIndex - popState.index);
    }
    showError(url);
  } finally {
    window.clearTimeout(loadingTimer);
    for (const mount of mounts) mount.dispose();
    if (requestId === navigationId) shell.inert = !pageMounted;
  }
}

retry.addEventListener("click", () => {
  if (retryUrl) openPage(retryUrl);
});

function prefetch(path) {
  if (!currentUser || !routes[path]) return;
  Promise.all([loadTemplate(path), loadModules(path)]).catch(() => {});
}
document.addEventListener("pointerover", event => {
  const link = event.target.closest("a[href]");
  if (link?.origin === location.origin) prefetch(pathFor(link));
});
document.addEventListener("focusin", event => {
  const link = event.target.closest("a[href]");
  if (link?.origin === location.origin) prefetch(pathFor(link));
});

window.addEventListener("finance-user-ready", event => {
  currentUser = event.detail;
  accountEpoch++;
  const previous = savedRouteSession();
  const changedAccount = previous && previous.owner !== String(currentUser.id);
  const staleHistory = initialHistorySession && initialHistorySession !== previous?.token;
  if (currentUser.freshLogin || changedAccount || staleHistory) {
    resetRouteSession(currentUser);
    disposePage();
    shell.replaceChildren();
    pageMounted = false;
  }
  else {
    routeSession = previous || { owner:String(currentUser.id), token:crypto.randomUUID() };
    try { sessionStorage.setItem(ROUTE_SESSION_KEY, JSON.stringify(routeSession)); } catch {}
    historyIndex = initialHistoryIndex;
    history.replaceState({ financePage:true, index:historyIndex, session:routeSession.token }, "", location.href);
  }
  wrap.hidden = false;
  openPage(new URL(location.href), { initial:true });
  // Idle preloading makes later menu clicks independent of a template round trip.
  const preload = () => Object.keys(routes).forEach(prefetch);
  if (window.requestIdleCallback) window.requestIdleCallback(preload, { timeout:1000 });
  else window.setTimeout(preload, 0);
});
window.addEventListener("finance-user-profile", event => {
  if (currentUser && String(currentUser.id) === String(event.detail.id)) currentUser = event.detail;
});
window.addEventListener("finance-user-logout", () => {
  currentUser = null;
  routeSession = null;
  historyIndex = 0;
  ignoreNextPop = false;
  try { sessionStorage.removeItem(ROUTE_SESSION_KEY); } catch {}
  history.replaceState({}, "", "/");
  accountEpoch++;
  pageMounted = false;
  navigationId++;
  disposePage();
  shell.replaceChildren(); // Never retain personal form values for the next account.
  shell.inert = false;
  status.hidden = true;
  retryUrl = null;
  wrap.hidden = true;
  closeMenu();
});

document.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (!currentUser || !link || event.defaultPrevented || event.button !== 0 ||
      event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
      link.target || link.hasAttribute("download")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || !routes[pathFor(url)] ||
      /(?:reset_token|verify_email)=/.test(url.hash)) return;
  event.preventDefault();
  openPage(url);
});
window.addEventListener("popstate", event => {
  if (ignoreNextPop) { ignoreNextPop = false; return; }
  if (!currentUser) { history.replaceState({}, "", "/"); return; }
  if (!event.state?.financePage || event.state.session !== routeSession?.token) {
    // Browser history cannot be erased. Reject routes from a previous login.
    resetRouteSession(currentUser);
    openPage(new URL("/", location.href), { initial:true });
    return;
  }
  openPage(new URL(location.href), { popState:event.state });
});

// Keep existing bookmarked section links, including direct visits, working.
const oldSections = { "#planner":"/planner.html#planner", "#results":"/planner.html#results",
  "#budget-tracker":"/budget.html", "#settings":"/settings.html" };
if (currentPath === "/" && oldSections[location.hash]) location.replace(oldSections[location.hash]);
document.addEventListener("finance-open-settings", () => {
  if (currentUser) openPage(new URL("/settings.html", location.href));
});
updateActiveLinks();
