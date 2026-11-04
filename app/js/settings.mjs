// Preferences stay separate for each signed-in account, in this browser.
const STORAGE_KEY_PREFIX = "finance-ai-display-settings-v1";
export const defaultAppearance = Object.freeze({
  design: "bloom", theme: "light", accent: "violet", textSize: "standard", reduceMotion: false,
});
const choices = {
  design: new Set(["bloom", "sunrise", "ocean"]),
  theme: new Set(["system", "light", "dark"]),
  accent: new Set(["mint", "ocean", "violet", "coral"]),
  textSize: new Set(["standard", "large"]),
};

// Old saved preferences remain valid; accounts without a design start in Bloom.
export function normalizeAppearance(saved = {}) {
  const result = { ...defaultAppearance };
  if (!saved || typeof saved !== "object") return result;
  for (const [name, allowed] of Object.entries(choices)) {
    if (allowed.has(saved[name])) result[name] = saved[name];
  }
  if (typeof saved.reduceMotion === "boolean") result.reduceMotion = saved.reduceMotion;
  return result;
}

const root = document.documentElement;
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
let currentUserId = null;
let preferences = { ...defaultAppearance };

// Find the current settings fields, since page navigation replaces their DOM.
function getControls() {
  return {
    theme: document.querySelector("#setting-theme"),
    accent: document.querySelector("#setting-accent"),
    textSize: document.querySelector("#setting-text-size"),
    reduceMotion: document.querySelector("#setting-reduce-motion"),
  };
}
function applyPreferences() {
  root.dataset.design = preferences.design;
  root.dataset.theme = preferences.theme === "system" ? (systemTheme.matches ? "dark" : "light") : preferences.theme;
  root.dataset.accent = preferences.accent;
  root.dataset.textSize = preferences.textSize;
  root.dataset.reduceMotion = String(preferences.reduceMotion);
  for (const [name, control] of Object.entries(getControls())) {
    if (!control) continue;
    if (name === "reduceMotion") control.checked = preferences[name];
    else control.value = preferences[name];
  }
  document.querySelectorAll("[data-design-choice]").forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.designChoice === preferences.design));
  });
}
function savePreferences() {
  applyPreferences();
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + "-" + (currentUserId || "guest"), JSON.stringify(preferences));
  } catch {
    window.dispatchEvent(new CustomEvent("finance-save-error", {
      detail: { message: "Appearance changed for this visit, but could not be saved." },
    }));
  }
}
function loadPreferences(userId) {
  currentUserId = userId ? String(userId) : null;
  try {
    preferences = normalizeAppearance(JSON.parse(localStorage.getItem(STORAGE_KEY_PREFIX + "-" + (currentUserId || "guest"))));
  } catch { preferences = { ...defaultAppearance }; }
  applyPreferences();
}

// Delegated listeners work for the initial page and for later page visits.
document.addEventListener("click", event => {
  const choice = event.target.closest("[data-design-choice]");
  if (choice) {
    preferences.design = choice.dataset.designChoice;
    preferences.accent = { bloom:"violet", sunrise:"coral", ocean:"ocean" }[preferences.design];
    savePreferences();
  } else if (event.target.closest("#settings-reset-button")) {
    preferences = { ...defaultAppearance };
    savePreferences();
  }
});
document.addEventListener("change", event => {
  for (const [name, control] of Object.entries(getControls())) {
    if (control && event.target === control) {
      preferences[name] = name === "reduceMotion" ? control.checked : control.value;
      savePreferences();
    }
  }
});
systemTheme.addEventListener("change", () => {
  if (preferences.theme === "system") applyPreferences();
});
window.addEventListener("finance-page-ready", applyPreferences);
window.addEventListener("finance-user-ready", event => loadPreferences(event.detail.id));
window.addEventListener("finance-user-logout", () => {
  preferences = { ...defaultAppearance };
  currentUserId = null;
  applyPreferences();
});
applyPreferences();
