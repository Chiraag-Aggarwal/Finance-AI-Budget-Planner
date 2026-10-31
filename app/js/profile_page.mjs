const form = document.querySelector("#profile-edit-form");
const statusMessage = document.querySelector("#profile-page-status");
const saveButton = form.querySelector('button[type="submit"]');
const accountDataSection = document.querySelector("#account-data-section");
const accountDataStatus = document.querySelector("#account-data-status");
const exportButton = document.querySelector("#export-account-data");
const deleteDialog = document.querySelector("#delete-account-dialog");
const deleteForm = document.querySelector("#delete-account-form");
const deleteError = document.querySelector("#delete-account-error");
const confirmDeleteButton = document.querySelector("#confirm-delete-account");
let signedInUserId = null;
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

function clearThisBrowserAccountData(userId) {
  try {
    for (const prefix of [
      "finance-ai-display-settings-v1",
      "finance-ai-planner-profile-v1",
      "finance-ai-monthly-entries-v1",
    ]) {
      window.localStorage.removeItem(`${prefix}-${userId}`);
    }
  } catch {
    // Account records are already deleted from the server if browser storage is unavailable.
  }
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
    signedInUserId = String(result.user.id);
    window.dispatchEvent(new CustomEvent("finance-user-ready", { detail: result.user }));
    form.hidden = false;
    accountDataSection.hidden = false;
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

exportButton.addEventListener("click", async () => {
  exportButton.disabled = true;
  accountDataStatus.textContent = "Preparing your download…";
  try {
    const response = await fetch("/api/account/export", { credentials: "same-origin" });
    if (!response.ok) {
      let result = {};
      try { result = await response.json(); } catch { /* Keep a short fallback message. */ }
      throw new Error(result.error || "Your account data could not be exported.");
    }
    const file = await response.blob();
    const address = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = address;
    link.download = "finance-ai-account-export.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(address), 1000);
    accountDataStatus.textContent = "Your data export has been downloaded.";
  } catch (error) {
    accountDataStatus.textContent = error.message || "Your account data could not be exported.";
  } finally {
    exportButton.disabled = false;
  }
});

document.querySelector("#open-delete-account").addEventListener("click", () => {
  deleteForm.reset();
  deleteError.textContent = "";
  deleteError.hidden = true;
  deleteDialog.showModal();
  deleteForm.elements.namedItem("password").focus();
});

document.querySelector("#cancel-delete-account").addEventListener("click", () => deleteDialog.close());

deleteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!deleteForm.reportValidity()) return;
  const fields = Object.fromEntries(new FormData(deleteForm));
  confirmDeleteButton.disabled = true;
  deleteError.textContent = "";
  deleteError.hidden = true;
  try {
    const result = await requestJSON("/api/account/delete", "POST", fields);
    deleteDialog.close();
    clearThisBrowserAccountData(signedInUserId);
    form.hidden = true;
    exportButton.hidden = true;
    document.querySelector("#open-delete-account").hidden = true;
    accountDataStatus.textContent = result.message;
    window.setTimeout(() => window.location.replace("/"), 1500);
  } catch (error) {
    deleteError.textContent = error.message || "Your account could not be deleted.";
    deleteError.hidden = false;
  } finally {
    confirmDeleteButton.disabled = false;
  }
});

loadProfile();
