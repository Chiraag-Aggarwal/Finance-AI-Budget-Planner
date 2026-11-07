// Shared sign-in, verification, recovery and sign-out controls.
// Page modules receive only the authenticated public profile through finance-user-ready.

import { flushPageSaves } from "./pending_saves.mjs";

const authScreen = document.querySelector("#auth-screen");
const sessionScreen = document.querySelector("#session-screen");
const sessionStatus = document.querySelector("#session-status");
const sessionError = document.querySelector("#session-error");
const sessionRetry = document.querySelector("#session-retry");
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
const profileLink = document.querySelector("#profile-link");
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


async function sendAccountRequest(path, method, fields, signal) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  } catch {
    throw new Error("Could not connect to the account server. Check your connection and try again.");
  }

  let result = {};
  try {
    result = await response.json();
  } catch {
    throw new Error("Could not connect to the account server. Check your connection and try again.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "The account request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return result;
}


function showSignedIn(user, freshLogin = false) {
  const firstSignIn = !signedInUser || signedInUser.id !== user.id;
  signedInUser = user;
  sessionScreen.hidden = true;
  authScreen.hidden = true;
  appShell.hidden = false;
  appNavigation.hidden = false;
  siteFooter.hidden = false;
  profileLink.hidden = false;
  signOutButton.hidden = false;
  signedInName.textContent = user.name;
  profileAvatar.textContent = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
  clearAuthError();

  // The account's saved region is the starting region for goal planning.
  const goalRegion = document.querySelector('#finance-form [name="region"]');
  if (goalRegion) {
    goalRegion.value = user.region;
  }

  if (firstSignIn) {
    window.dispatchEvent(new CustomEvent("finance-user-ready", { detail: { ...user, freshLogin } }));
  }
  window.dispatchEvent(new CustomEvent("finance-user-profile", { detail: user }));
}


function showSignedOut() {
  const wasSignedIn = Boolean(signedInUser);
  signedInUser = null;
  sessionScreen.hidden = true;
  authScreen.hidden = false;
  appShell.hidden = true;
  appNavigation.hidden = true;
  siteFooter.hidden = true;
  profileLink.hidden = true;
  signOutButton.hidden = true;
  signedInName.textContent = "";
  profileAvatar.textContent = "";
  loginForm.reset();
  signupForm.reset();
  resetRequestForm.reset();
  verificationRequestForm.reset();
  resetForm.reset();
  if (saveErrorAlert) saveErrorAlert.hidden = true;
  window.clearTimeout(saveErrorTimer);
  if (wasSignedIn) {
    window.dispatchEvent(new CustomEvent("finance-user-logout"));
  }
}

window.addEventListener("finance-profile-updated", (event) => {
  if (signedInUser && String(event.detail.id) === String(signedInUser.id)) {
    showSignedIn(event.detail);
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
    showSignedIn(result.user, true);
    announceAccountChange();
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
  try {
    await flushPageSaves();
    await sendAccountRequest("/api/logout", "POST", {});
  } catch (error) {
    setAuthError(error.message);
    return;
  }
  showSignedOut();
  announceAccountChange();
  setAccountView("login");
});


// Wait once for page modules to register their account-ready listeners.
// Reusing this promise also lets Retry work after DOMContentLoaded has fired.
const pageReady = document.readyState === "complete"
  ? Promise.resolve()
  : new Promise((resolve) => {
    document.addEventListener("DOMContentLoaded", resolve, { once: true });
  });
let restoringSession = false;

async function restoreSession() {
  if (restoringSession) return;
  restoringSession = true;
  sessionScreen.hidden = false;
  authScreen.hidden = true;
  appShell.hidden = true;
  sessionStatus.hidden = false;
  sessionError.hidden = true;
  sessionRetry.hidden = true;
  sessionRetry.disabled = true;

  // A dropped connection should offer Retry instead of leaving a permanent loader.
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    const result = await sendAccountRequest("/api/me", "GET", undefined, controller.signal);
    if (!result.user || result.user.id == null || typeof result.user.name !== "string") {
      throw new Error("Invalid account response.");
    }
    await pageReady;
    showSignedIn(result.user);
  } catch (error) {
    if (error.status === 401) {
      // Only an absent or expired session should open the login form.
      showSignedOut();
    } else {
      sessionStatus.hidden = true;
      sessionError.textContent = "We couldn't check your sign-in. Check your connection and try again.";
      sessionError.hidden = false;
      sessionRetry.hidden = false;
    }
  } finally {
    window.clearTimeout(timeout);
    sessionRetry.disabled = false;
    restoringSession = false;
  }
}

sessionRetry.addEventListener("click", restoreSession);
window.addEventListener("finance-session-expired", () => {
  if (!signedInUser) return;
  showSignedOut();
  setAccountView("login");
  setAuthMessage("Your session has expired. Please sign in again.");
});


const emailVerificationToken = new URLSearchParams(window.location.hash.slice(1)).get("verify_email");
const resetToken = new URLSearchParams(window.location.hash.slice(1)).get("reset_token");
if (emailVerificationToken) {
  showSignedOut();
  // Remove the one-time token from the address bar before sending it to the server.
  window.history.replaceState({}, "", window.location.pathname);
  setAccountView("login");
  setAuthMessage("Checking your verification link…");
  sendAccountRequest("/api/email-verification/complete", "POST", { token: emailVerificationToken })
    .then((result) => setAuthMessage(result.message))
    .catch((error) => setAuthError(error.message));
} else if (resetToken) {
  showSignedOut();
  resetForm.elements.token.value = resetToken;
  // Remove the one-time token from the address bar as soon as it is read.
  window.history.replaceState({}, "", window.location.pathname);
  setAccountView("reset-complete");
} else {
  restoreSession();
}

// Cookies are shared between tabs. Invalidate cached notes after an account change.
function announceAccountChange() {
  try { window.localStorage.setItem("finance-ai-account-change", String(Date.now()) + Math.random()); }
  catch { /* Server ownership checks still protect requests when storage is blocked. */ }
}
window.addEventListener("storage", event => {
  if (event.key !== "finance-ai-account-change") return;
  showSignedOut();
  setAccountView("login");
  setAuthMessage("Your account changed in another tab. Please sign in again.");
});
// Hide private content before a browser history snapshot is taken.
window.addEventListener("pagehide", () => {
  appShell.hidden = true;
  appNavigation.hidden = true;
  siteFooter.hidden = true;
  profileLink.hidden = true;
});
window.addEventListener("pageshow", event => {
  if (!event.persisted) return;
  showSignedOut();
  restoreSession();
});
