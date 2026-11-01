import { flushPageSaves } from "./pending_saves.mjs";

const button = document.querySelector("#main-menu-button");
const menu = document.querySelector("#main-menu");
const wrap = document.querySelector("#main-menu-wrap");
let navigating = false;

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
window.addEventListener("finance-user-ready", () => { wrap.hidden = false; });
window.addEventListener("finance-user-logout", () => { wrap.hidden = true; closeMenu(); });

const currentPath = location.pathname === "/index.html" ? "/" : location.pathname;
document.querySelectorAll("#app-navigation a, #main-menu a").forEach((link) => {
  if (link.pathname === currentPath && !link.hash) link.setAttribute("aria-current", "page");
});

// Keep old bookmarked section links useful, without disturbing recovery tokens.
const oldSections = { "#planner":"/planner.html#planner", "#results":"/planner.html#results", "#budget-tracker":"/budget.html", "#settings":"/settings.html" };
if (currentPath === "/" && oldSections[location.hash]) location.replace(oldSections[location.hash]);

document.addEventListener("click", async (event) => {
  const link = event.target.closest("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target || link.hasAttribute("download")) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || url.pathname === location.pathname) return;
  event.preventDefault();
  if (navigating) return;
  navigating = true;
  link.setAttribute("aria-busy", "true");
  try {
    await flushPageSaves();
    location.assign(url.href);
  } catch (error) {
    window.dispatchEvent(new CustomEvent("finance-save-error", { detail: { message: error.message } }));
    navigating = false;
    link.removeAttribute("aria-busy");
  }
});
