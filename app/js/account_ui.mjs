const authScreen = document.querySelector("#auth-screen");
const appShell = document.querySelector("#app-shell");
const appNavigation = document.querySelector("#app-navigation");
const siteFooter = document.querySelector("#site-footer");
const authError = document.querySelector("#auth-error");
const authMessage = document.querySelector("#auth-message");
const authTitle = document.querySelector("#auth-title");
const authIntro = document.querySelector(".auth-intro");
const authTabs = document.querySelector("#auth-tabs");
const loginForm = document.querySelector("#login-form");
const signupForm = document.querySelector("#signup-form");
const resetRequestForm = document.querySelector("#password-reset-request-form");
const verificationRequestForm = document.querySelector("#email-verification-request-form");
const resetForm = document.querySelector("#password-reset-form");
const profileMenuButton = document.querySelector("#profile-menu-button");
const profileMenu = document.querySelector("#profile-menu");
const profileAvatar = document.querySelector("#profile-avatar");
const signOutButton = document.querySelector("#sign-out-button");
const signedInName = document.querySelector("#signed-in-name");
const saveErrorAlert = document.querySelector("#save-error-alert");

let signedInUser = null;
let saveErrorTimer = null;

window.addEventListener("finance-save-error", (event) => {
  if (!saveErrorAlert) return;
  saveErrorAlert.textContent = event.detail?.message || "A change could not be saved.";
  saveErrorAlert.hidden = false;
  window.clearTimeout(saveErrorTimer);
  saveErrorTimer = window.setTimeout(() => {
    saveErrorAlert.hidden = true;
  }, 10000);
});


function setAuthError(message) {
  authMessage.textContent = "";
  authMessage.hidden = true;
  authError.textContent = message;
  authError.hidden = false;
}


function setAuthMessage(message) {
  clearAuthError();
  authMessage.textContent = message;
  authMessage.hidden = false;
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
  const requestingReset = view === "reset-request";
  const requestingVerification = view === "verification-request";
  const completingReset = view === "reset-complete";
  loginForm.hidden = signup || requestingReset || requestingVerification || completingReset;
  signupForm.hidden = !signup;
  resetRequestForm.hidden = !requestingReset;
  verificationRequestForm.hidden = !requestingVerification;
  resetForm.hidden = !completingReset;
  authTabs.hidden = requestingReset || requestingVerification || completingReset;

  const loginButton = document.querySelector("#show-login-button");
  const signupButton = document.querySelector("#show-signup-button");
  loginButton.classList.toggle("active", !signup);
  signupButton.classList.toggle("active", signup);
  loginButton.setAttribute("aria-pressed", String(!signup));
  signupButton.setAttribute("aria-pressed", String(signup));

  const titles = {
    login: "Sign in to Finance AI",
    signup: "Create your Finance AI account",
    "reset-request": "Reset your password",
    "verification-request": "Verify your email",
    "reset-complete": "Set a new password",
  };
  const introductions = {
    login: "Create an account to keep your profile and region together when you return.",
    signup: "Create an account to keep your profile and region together when you return.",
    "reset-request": "Enter the email address used for your Finance AI account.",
    "verification-request": "Enter the email address you used to create your account.",
    "reset-complete": "Choose a new password for your account.",
  };
  authTitle.textContent = titles[view] || titles.login;
  authIntro.textContent = introductions[view] || introductions.login;
  clearAuthError();
  authMessage.textContent = "";
  authMessage.hidden = true;
}


document.querySelector("#show-login-button").addEventListener("click", () => setAccountView("login"));
document.querySelector("#show-signup-button").addEventListener("click", () => setAccountView("signup"));
document.querySelector("#forgot-password-button").addEventListener("click", () => {
  resetRequestForm.elements.email.value = loginForm.elements.email.value.trim();
  setAccountView("reset-request");
  resetRequestForm.elements.email.focus();
});
document.querySelector("#resend-verification-button").addEventListener("click", () => {
  verificationRequestForm.elements.email.value = loginForm.elements.email.value.trim();
  setAccountView("verification-request");
  verificationRequestForm.elements.email.focus();
});
document.querySelectorAll("[data-show-login]").forEach((button) => {
  button.addEventListener("click", () => setAccountView("login"));
});


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
    loginForm.elements.email.value = fields.email;
    setAccountView("login");
    setAuthMessage(result.message);
  } catch (error) {
    setAuthError(error.message);
  }
});


verificationRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!verificationRequestForm.reportValidity()) return;
  clearAuthError();
  const fields = Object.fromEntries(new FormData(verificationRequestForm));
  try {
    const result = await sendAccountRequest("/api/email-verification/resend", "POST", fields);
    setAuthMessage(result.message);
  } catch (error) {
    setAuthError(error.message);
  }
});


resetRequestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!resetRequestForm.reportValidity()) return;
  clearAuthError();
  const fields = Object.fromEntries(new FormData(resetRequestForm));
  try {
    const result = await sendAccountRequest("/api/password-reset/request", "POST", fields);
    setAuthMessage(result.message);
  } catch (error) {
    setAuthError(error.message);
  }
});


resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!resetForm.reportValidity()) return;
  clearAuthError();
  const fields = Object.fromEntries(new FormData(resetForm));
  if (fields.password !== fields.confirmPassword) {
    setAuthError("The passwords do not match.");
    return;
  }
  delete fields.confirmPassword;

  try {
    const result = await sendAccountRequest("/api/password-reset/complete", "POST", fields);
    resetForm.reset();
    window.history.replaceState({}, "", window.location.pathname);
    setAccountView("login");
    setAuthMessage(result.message);
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
  // Let the planner and budget modules register their account-ready listeners first.
  if (document.readyState !== "complete") {
    await new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

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


const emailVerificationToken = new URLSearchParams(window.location.hash.slice(1)).get("verify_email");
const resetToken = new URLSearchParams(window.location.hash.slice(1)).get("reset_token");
if (emailVerificationToken) {
  // Remove the one-time token from the address bar before sending it to the server.
  window.history.replaceState({}, "", window.location.pathname);
  setAccountView("login");
  setAuthMessage("Checking your verification link…");
  sendAccountRequest("/api/email-verification/complete", "POST", { token: emailVerificationToken })
    .then((result) => setAuthMessage(result.message))
    .catch((error) => setAuthError(error.message));
} else if (resetToken) {
  resetForm.elements.token.value = resetToken;
  // Remove the one-time token from the address bar as soon as it is read.
  window.history.replaceState({}, "", window.location.pathname);
  setAccountView("reset-complete");
} else {
  restoreSession();
}
