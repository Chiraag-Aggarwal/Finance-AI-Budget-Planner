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
const controls = {
  theme: document.querySelector("#setting-theme"), accent: document.querySelector("#setting-accent"),
  textSize: document.querySelector("#setting-text-size"), reduceMotion: document.querySelector("#setting-reduce-motion"),
};
const status = document.querySelector("#settings-save-status");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
let currentUserId = null;
let preferences = { ...defaultAppearance };

function applyPreferences() {
  root.dataset.design = preferences.design;
  root.dataset.theme = preferences.theme === "system" ? (systemTheme.matches ? "dark" : "light") : preferences.theme;
  root.dataset.accent = preferences.accent;
  root.dataset.textSize = preferences.textSize;
  root.dataset.reduceMotion = String(preferences.reduceMotion);
  for (const [name, control] of Object.entries(controls)) {
    if (!control) continue;
    if (name === "reduceMotion") control.checked = preferences[name];
    else control.value = preferences[name];
  }
  document.querySelectorAll("[data-design-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.designChoice === preferences.design));
  });
}

function savePreferences() {
  applyPreferences();
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}-${currentUserId || "guest"}`, JSON.stringify(preferences));
  } catch {
    window.dispatchEvent(new CustomEvent("finance-save-error", {
      detail: { message: "Appearance changed for this visit, but could not be saved." },
    }));
  }
}

function loadPreferences(userId) {
  currentUserId = userId ? String(userId) : null;
  try {
    preferences = normalizeAppearance(JSON.parse(localStorage.getItem(`${STORAGE_KEY_PREFIX}-${currentUserId || "guest"}`)));
  } catch { preferences = { ...defaultAppearance }; }
  applyPreferences();
}

document.querySelectorAll("[data-design-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    preferences.design = button.dataset.designChoice;
    preferences.accent = { bloom:"violet", sunrise:"coral", ocean:"ocean" }[preferences.design];
    savePreferences();
  });
});
for (const [name, control] of Object.entries(controls)) {
  control?.addEventListener("change", () => {
    preferences[name] = name === "reduceMotion" ? control.checked : control.value;
    savePreferences();
  });
}
document.querySelector("#settings-reset-button")?.addEventListener("click", () => {
  preferences = { ...defaultAppearance }; savePreferences();
});
document.addEventListener("finance-open-settings", () => { location.assign("/settings.html"); });
systemTheme.addEventListener("change", () => {
  if (preferences.theme === "system") applyPreferences();
});
applyPreferences();
window.addEventListener("finance-user-ready", (event) => loadPreferences(event.detail.id));
window.addEventListener("finance-user-logout", () => { preferences = { ...defaultAppearance }; currentUserId = null; applyPreferences(); });
