const form = document.querySelector("#profile-edit-form");
const statusMessage = document.querySelector("#profile-page-status");
const saveButton = form.querySelector('button[type="submit"]');

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
}

async function loadProfile() {
  try {
    const result = await requestJSON("/api/me");
    fillForm(result.user);
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  saveButton.disabled = true;
  statusMessage.textContent = "Saving profile…";
  const fields = {
    name: form.elements.namedItem("name").value,
    region: form.elements.namedItem("region").value,
  };

  try {
    const result = await requestJSON("/api/profile", "PUT", fields);
    fillForm(result.user);
    statusMessage.textContent = "Your profile has been updated.";
  } catch (error) {
    statusMessage.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});

loadProfile();
