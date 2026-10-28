const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const appNavigation = document.querySelector("#app-navigation");
const siteFooter = document.querySelector("#site-footer");
const authError = document.querySelector("#auth-error");
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");
const profileForm = document.querySelector("#profile-form");
const profileStatus = document.querySelector("#profile-status");
const editProfileButton = document.querySelector("#edit-profile-button");
const signOutButton = document.querySelector("#sign-out-button");
const signedInName = document.querySelector("#signed-in-name");

let signedInUser = null;


function translated(message) {
  return window.financeTranslate ? window.financeTranslate(message) : message;
}


function setAuthError(message) {
  authError.textContent = translated(message);
  authError.hidden = false;
}


function clearAuthError() {
  authError.textContent = "";
  authError.hidden = true;
}


async function sendAccountRequest(path, method, fields) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  } catch {
    throw new Error("Could not connect to the account server. Start the app with python server.py.");
  }

  let result = {};
  try {
    result = await response.json();
  } catch {
    throw new Error("Could not connect to the account server. Start the app with python server.py.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "The account request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}


function fillProfileForm(user) {
  profileForm.elements.namedItem("name").value = user.name;
  profileForm.elements.namedItem("email").value = user.email;
  profileForm.elements.namedItem("region").value = user.region;
}


function showSignedIn(user) {
  const firstSignIn = !signedInUser || signedInUser.id !== user.id;
  signedInUser = user;
  authScreen.hidden = true;
  appShell.hidden = false;
  appNavigation.hidden = false;
  siteFooter.hidden = false;
  signOutButton.hidden = false;
  signedInName.hidden = false;
  signedInName.textContent = user.name;
  document.querySelector("#profile-summary").textContent = `${user.name} · ${user.email} · ${user.region}`;
  fillProfileForm(user);
  profileForm.hidden = true;
  editProfileButton.hidden = false;
  profileStatus.textContent = "";
  clearAuthError();

  // The account's saved region is the starting region for goal planning.
  const goalRegion = document.querySelector('#finance-form [name="region"]');
  if (goalRegion) {
    goalRegion.value = user.region;
  }

  if (firstSignIn) {
    window.dispatchEvent(new CustomEvent("finance-user-ready", { detail: user }));
  }
  window.dispatchEvent(new CustomEvent("finance-user-profile", { detail: user }));
}


function showSignedOut() {
  const wasSignedIn = Boolean(signedInUser);
  signedInUser = null;
  authScreen.hidden = false;
  appShell.hidden = true;
  appNavigation.hidden = true;
  siteFooter.hidden = true;
  signOutButton.hidden = true;
  signedInName.hidden = true;
  if (wasSignedIn) {
    window.dispatchEvent(new CustomEvent("finance-user-logout"));
  }
}


function setAccountView(view) {
  const signup = view === "signup";
  loginForm.hidden = signup;
  signupForm.hidden = !signup;
  document.querySelector("#show-login-button").classList.toggle("active", !signup);
  document.querySelector("#show-signup-button").classList.toggle("active", signup);
  document.querySelector("#show-login-button").setAttribute("aria-pressed", String(!signup));
  document.querySelector("#show-signup-button").setAttribute("aria-pressed", String(signup));
  document.querySelector("#auth-title").textContent = signup
    ? "Create your Finance AI account"
    : "Sign in to Finance AI";
  clearAuthError();
}


document.querySelector("#show-login-button").addEventListener("click", () => setAccountView("login"));
document.querySelector("#show-signup-button").addEventListener("click", () => setAccountView("signup"));


loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!loginForm.reportValidity()) {
    return;
  }
  clearAuthError();
  const fields = Object.fromEntries(new FormData(loginForm));
  try {
    const result = await sendAccountRequest("/api/login", "POST", fields);
    loginForm.reset();
    showSignedIn(result.user);
  } catch (error) {
    setAuthError(error.message);
  }
});


signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!signupForm.reportValidity()) {
    return;
  }
  clearAuthError();
  const fields = Object.fromEntries(new FormData(signupForm));
  if (fields.password !== fields.confirmPassword) {
    setAuthError("The passwords do not match.");
    return;
  }
  delete fields.confirmPassword;

  try {
    const result = await sendAccountRequest("/api/signup", "POST", fields);
    signupForm.reset();
    showSignedIn(result.user);
  } catch (error) {
    setAuthError(error.message);
  }
});


editProfileButton.addEventListener("click", () => {
  if (!signedInUser) {
    return;
  }
  fillProfileForm(signedInUser);
  profileForm.hidden = false;
  profileStatus.textContent = "";
  profileForm.elements.namedItem("name").focus();
});


document.querySelector("#cancel-profile-button").addEventListener("click", () => {
  if (signedInUser) {
    fillProfileForm(signedInUser);
  }
  profileForm.hidden = true;
});


profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!signedInUser || !profileForm.reportValidity()) {
    return;
  }
  profileStatus.textContent = "Saving profile…";
  const fields = {
    name: profileForm.elements.namedItem("name").value,
    region: profileForm.elements.namedItem("region").value,
  };
  try {
    const result = await sendAccountRequest("/api/profile", "PUT", fields);
    showSignedIn(result.user);
    profileStatus.textContent = translated("Your profile has been updated.");
  } catch (error) {
    profileStatus.textContent = translated(error.message);
  }
});


signOutButton.addEventListener("click", async () => {
  try {
    await sendAccountRequest("/api/logout", "POST", {});
  } catch (error) {
    setAuthError(error.message);
    return;
  }
  showSignedOut();
  setAccountView("login");
});


// Restore a valid server-side session when the page opens again.
async function restoreSession() {
  try {
    const result = await sendAccountRequest("/api/me", "GET");
    showSignedIn(result.user);
  } catch (error) {
    showSignedOut();
    if (error.status !== 401) {
      setAuthError(error.message);
    }
  }
}


restoreSession();
