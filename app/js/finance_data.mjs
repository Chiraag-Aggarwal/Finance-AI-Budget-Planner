// Shared client for the account-scoped Python finance API.
// The server chooses storage; the browser never connects to MongoDB directly.
let signedInUserId = null;
// Incrementing the epoch invalidates responses from an earlier sign-in, even for the same ID.
let accountEpoch = 0;
let savedDataPromise = null;
let saveQueue = Promise.resolve();
let lastSaveError = null;

window.addEventListener("finance-user-ready", (event) => {
  accountEpoch++;
  signedInUserId = String(event.detail.id);
  savedDataPromise = null;
  saveQueue = Promise.resolve();
  lastSaveError = null;
});

window.addEventListener("finance-user-logout", () => {
  accountEpoch++;
  signedInUserId = null;
  savedDataPromise = null;
  saveQueue = Promise.resolve();
  lastSaveError = null;
});

async function request(path, method = "GET", body = undefined) {
  const requestedEpoch = accountEpoch;
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-Finance-Owner": signedInUserId || "",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Small autosaves can finish even if the user refreshes during the request.
      keepalive: body !== undefined && new Blob([JSON.stringify(body)]).size < 60000,
    });
  } catch {
    throw new Error("Could not sync your saved details. Check your connection and try again.");
  }

  let result = {};
  try {
    result = await response.json();
  } catch {
    const contentType = response.headers.get("content-type") || "unknown content type";
    throw new Error(
      `Finance server returned HTTP ${response.status} (${contentType}) instead of account data.`,
    );
  }
  if (requestedEpoch !== accountEpoch) {
    throw new Error("Your account changed before the request finished. Please try again.");
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new CustomEvent("finance-session-expired"));
    throw new Error(result.error || "The saved details could not be updated.");
  }
  return result;
}

export async function loadFinanceData() {
  if (!signedInUserId) return {};
  if (!savedDataPromise) {
    const loading = request("/api/finance-data")
      .then((result) => result.data || {})
      .catch((error) => {
        if (savedDataPromise === loading) savedDataPromise = null;
        throw error;
      });
    savedDataPromise = loading;
  }
  return savedDataPromise;
}

// Queue snapshots in order so a slow earlier save cannot overwrite a later edit.
export function saveFinanceDataField(field, value) {
  const ownerId = signedInUserId;
  const epoch = accountEpoch;
  const snapshot = structuredClone(value);
  const operation = saveQueue.then(async () => {
    if (!ownerId || signedInUserId !== ownerId || epoch !== accountEpoch) {
      throw new Error("Sign in before saving personal finance details.");
    }
    // The server merges this patch with the account's existing data, so save directly.
    const result = await request("/api/finance-data", "PATCH", { [field]: snapshot });
    if (signedInUserId !== ownerId || epoch !== accountEpoch) {
      throw new Error("Your account changed before the save finished. Please try again.");
    }
    savedDataPromise = Promise.resolve(result.data || {});
    lastSaveError = null;
    return result.data || {};
  });
  const reportedOperation = operation.catch((error) => {
    if (epoch !== accountEpoch) throw error;
    lastSaveError = error;
    window.dispatchEvent(
      new CustomEvent("finance-save-error", {
        detail: { message: error?.message || "A change could not be saved." },
      }),
    );
    throw error;
  });
  saveQueue = reportedOperation.catch(() => {});
  return reportedOperation;
}

export async function waitForFinanceSaves() {
  await saveQueue;
  if (lastSaveError) throw lastSaveError;
}
