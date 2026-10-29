const form = document.querySelector("#profile-edit-form");
const statusMessage = document.querySelector("#profile-page-status");
const saveButton = form.querySelector('button[type="submit"]');
let profileSaveTimer = null;
let profileSaveQueue = Promise.resolve();
let lastSavedProfileSignature = null;

async function requestJSON(path, method = "GET", fields = null) {
  const options = { method, credentials: "same-origin" };
  if (fields) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(fields);
  }

  const response = await fetch(path, options);
  let result = {};
  try {
    result = await response.json();
  } catch {
    throw new Error("The account server could not be reached.");
  }

  if (!response.ok) {
    const error = new Error(result.error || "The profile could not be loaded.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function fillForm(user) {
  form.elements.namedItem("name").value = user.name;
  form.elements.namedItem("email").value = user.email;
  form.elements.namedItem("region").value = user.region;
  lastSavedProfileSignature = JSON.stringify({ name: user.name, region: user.region });
}

function getProfileFields() {
  return {
    name: form.elements.namedItem("name").value,
    region: form.elements.namedItem("region").value,
  };
}

function saveProfileInBackground() {
  if (!form.checkValidity()) return Promise.resolve();
  const fields = getProfileFields();
  const signature = JSON.stringify(fields);

  const operation = profileSaveQueue.then(async () => {
    if (signature === lastSavedProfileSignature) return;
    const result = await requestJSON("/api/profile", "PUT", fields);
    lastSavedProfileSignature = JSON.stringify({
      name: result.user.name,
      region: result.user.region,
    });
    if (JSON.stringify(getProfileFields()) === signature) {
      fillForm(result.user);
    }
  });
  profileSaveQueue = operation.catch(() => {});
  return operation;
}

function scheduleProfileAutoSave(immediate = false) {
  window.clearTimeout(profileSaveTimer);
  if (!form.checkValidity()) return;
  if (immediate) {
    saveProfileInBackground().catch((error) => {
      console.error("Finance AI profile auto-save failed.", error);
    });
    return;
  }
  profileSaveTimer = window.setTimeout(() => {
    saveProfileInBackground().catch((error) => {
      console.error("Finance AI profile auto-save failed.", error);
    });
  }, 250);
}

async function loadProfile() {
  try {
    const result = await requestJSON("/api/me");
    fillForm(result.user);
    window.dispatchEvent(new CustomEvent("finance-user-ready", { detail: result.user }));
    form.hidden = false;
    statusMessage.textContent = "";
  } catch (error) {
    if (error.status === 401) {
      window.location.replace("/");
      return;
    }
    statusMessage.textContent = error.message;
  }
}

form.addEventListener("input", () => scheduleProfileAutoSave());
form.addEventListener("change", () => scheduleProfileAutoSave(true));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  saveButton.disabled = true;
  try {
    await saveProfileInBackground();
  } catch (error) {
    console.error("Finance AI could not save the profile.", error);
  } finally {
    saveButton.disabled = false;
  }
});

loadProfile();
