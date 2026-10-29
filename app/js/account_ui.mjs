const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const appNavigation = document.querySelector("#app-navigation");
const siteFooter = document.querySelector("#site-footer");
const authError = document.querySelector("#auth-error");
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");
const profileMenuButton = document.querySelector("#profile-menu-button");
const profileMenu = document.querySelector("#profile-menu");
const profileAvatar = document.querySelector("#profile-avatar");
const signOutButton = document.querySelector("#sign-out-button");
const signedInName = document.querySelector("#signed-in-name");

let signedInUser = null;


function setAuthError(message) {
  authError.textContent = message;
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


function showSignedIn(user) {
  const firstSignIn = !signedInUser || signedInUser.id !== user.id;
  signedInUser = user;
  authScreen.hidden = true;
  appShell.hidden = false;
  appNavigation.hidden = false;
  siteFooter.hidden = false;
  profileMenuButton.hidden = false;
  signOutButton.hidden = false;
  signedInName.textContent = user.name;
  profileAvatar.textContent = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
  closeProfileMenu();
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
  profileMenuButton.hidden = true;
  closeProfileMenu();
  if (wasSignedIn) {
    window.dispatchEvent(new CustomEvent("finance-user-logout"));
  }
}


function closeProfileMenu(returnFocus = false) {
  profileMenu.hidden = true;
  profileMenuButton.setAttribute("aria-expanded", "false");
  if (returnFocus) {
    profileMenuButton.focus();
  }
}


profileMenuButton.addEventListener("click", () => {
  const shouldOpen = profileMenu.hidden;
  profileMenu.hidden = !shouldOpen;
  profileMenuButton.setAttribute("aria-expanded", String(shouldOpen));
});

profileMenu.addEventListener("click", (event) => {
  if (event.target.closest("a")) {
    closeProfileMenu();
  }
});

document.addEventListener("click", (event) => {
  if (!profileMenu.hidden && !event.target.closest("#account-menu-wrap")) {
    closeProfileMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileMenu.hidden) {
    closeProfileMenu(true);
  }
});


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


signOutButton.addEventListener("click", async () => {
  closeProfileMenu();
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
