// Keep appearance preferences in this browser only.
const STORAGE_KEY = "finance-ai-display-settings-v1";
const defaults = Object.freeze({
  theme: "dark",
  accent: "mint",
  textSize: "standard",
  reduceMotion: false,
});
const allowedThemes = new Set(["system", "light", "dark"]);
const allowedAccents = new Set(["mint", "ocean", "violet"]);
const allowedTextSizes = new Set(["standard", "large"]);
const root = document.documentElement;
const dialog = document.querySelector("#display-settings-dialog");
const controls = {
  theme: document.querySelector("#setting-theme"),
  accent: document.querySelector("#setting-accent"),
  textSize: document.querySelector("#setting-text-size"),
  reduceMotion: document.querySelector("#setting-reduce-motion"),
};
const saveStatus = document.querySelector("#settings-save-status");
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const preferences = { ...defaults };

function readSavedPreferences() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    if (allowedThemes.has(saved.theme)) preferences.theme = saved.theme;
    if (allowedAccents.has(saved.accent)) preferences.accent = saved.accent;
    if (allowedTextSizes.has(saved.textSize)) preferences.textSize = saved.textSize;
    if (typeof saved.reduceMotion === "boolean") preferences.reduceMotion = saved.reduceMotion;
  } catch {
    // Keep the simple defaults if browser storage is unavailable or invalid.
  }
}

function applyPreferences() {
  const theme = preferences.theme === "system"
    ? (systemTheme.matches ? "dark" : "light")
    : preferences.theme;

  root.dataset.theme = theme;
  root.dataset.accent = preferences.accent;
  root.dataset.textSize = preferences.textSize;
  root.dataset.reduceMotion = String(preferences.reduceMotion);

  if (controls.theme) controls.theme.value = preferences.theme;
  if (controls.accent) controls.accent.value = preferences.accent;
  if (controls.textSize) controls.textSize.value = preferences.textSize;
  if (controls.reduceMotion) controls.reduceMotion.checked = preferences.reduceMotion;
}

function savePreferences() {
  preferences.theme = controls.theme.value;
  preferences.accent = controls.accent.value;
  preferences.textSize = controls.textSize.value;
  preferences.reduceMotion = controls.reduceMotion.checked;
  applyPreferences();

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    saveStatus.textContent = "Appearance saved in this browser.";
  } catch {
    saveStatus.textContent = "Appearance changed for this visit, but could not be saved.";
  }
}

function openSettings() {
  if (!dialog) return;

  const menu = document.querySelector("#profile-menu");
  const menuButton = document.querySelector("#profile-menu-button");
  if (menu && menuButton) {
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }
  dialog.showModal();
  controls.theme?.focus();
}

if (dialog) {
  document.querySelectorAll("[data-open-settings]").forEach((button) => {
    button.addEventListener("click", openSettings);
  });
  document.querySelector("#settings-close-button").addEventListener("click", () => dialog.close());
  document.querySelector("#settings-reset-button").addEventListener("click", () => {
    Object.assign(preferences, defaults);
    applyPreferences();
    savePreferences();
  });
  Object.values(controls).forEach((control) => control.addEventListener("change", savePreferences));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener("finance-open-settings", openSettings);
}

systemTheme.addEventListener("change", () => {
  if (preferences.theme === "system") applyPreferences();
});

readSavedPreferences();
applyPreferences();
