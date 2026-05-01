const BASE = "/api/v1";
const AUTH_STORAGE_KEY = "dd24_auth_session";
const CLIENT_SESSION_STORAGE_KEY = "dd24_client_session_id";

function readAuthSession() {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeAuthSession(value) {
  if (!value) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } else {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(value));
  }
  window.dispatchEvent(new Event("dd24-auth-changed"));
}

function getClientSessionId() {
  try {
    const storage = window.sessionStorage;
    const existing = storage.getItem(CLIENT_SESSION_STORAGE_KEY);
    if (existing) return existing;
    const next =
      (window.crypto &&
        window.crypto.randomUUID &&
        window.crypto.randomUUID()) ||
      `dd24-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    storage.setItem(CLIENT_SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return "dd24-anon";
  }
}

function buildUrl(path, params = {}) {
  const url = new URL(BASE + path, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

async function parseError(res) {
  const json = await res.json().catch(() => ({}));
  return json.error || `API error ${res.status}`;
}

async function request(path, params = {}, options = {}) {
  const session = readAuthSession();
  const headers = {
    ...(options.headers || {}),
    "X-DD24-Session-Id": getClientSessionId(),
  };

  if (session?.accessToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const res = await fetch(buildUrl(path, params), {
    ...options,
    headers,
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

async function refreshSession(refreshToken) {
  const res = await fetch(buildUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });

  if (!res.ok) {
    writeAuthSession(null);
    return null;
  }

  const json = await res.json();
  writeAuthSession({
    accessToken: json.accessToken,
    refreshToken: json.refreshToken,
    user: json.user,
  });
  return json;
}

async function authRequest(path, options = {}, retry = true) {
  const session = readAuthSession();
  const headers = {
    ...(options.headers || {}),
    "X-DD24-Session-Id": getClientSessionId(),
  };

  if (session?.accessToken) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const res = await fetch(buildUrl(path), {
    ...options,
    headers,
  });

  if (res.status === 401 && retry && session?.refreshToken) {
    const refreshed = await refreshSession(session.refreshToken).catch(
      () => null,
    );
    if (refreshed?.accessToken) {
      return authRequest(path, options, false);
    }
  }

  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

function persistAuthPayload(json) {
  writeAuthSession({
    accessToken: json.accessToken,
    refreshToken: json.refreshToken,
    user: json.user,
  });
  return json;
}

export function fetchDeals(params) {
  return request("/store-products", params);
}

export function fetchDealStores(params) {
  return request("/store-products/stores", params);
}

export async function fetchDealById(dealId) {
  const res = await request("/store-products", { deal_id: dealId, limit: 1 });
  return res?.data?.[0] || null;
}

export async function postContact(data) {
  const res = await fetch(buildUrl("/contact"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export function getAuthSession() {
  return readAuthSession();
}

export async function completeEmailAuth(token) {
  const res = await fetch(buildUrl("/auth/email-link/complete"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return persistAuthPayload(await res.json());
}

export async function fetchOAuthAuthUrl(provider, state) {
  if (provider !== "google") {
    throw new Error("Unsupported OAuth provider");
  }

  const attempts = [
    buildUrl("/auth/google/url", { state }),
    new URL(
      `/api/auth/google/url${state ? `?state=${encodeURIComponent(state)}` : ""}`,
      window.location.origin,
    ).toString(),
  ];

  let lastError = null;
  for (const url of attempts) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url);
    if (res.ok) {
      // eslint-disable-next-line no-await-in-loop
      return res.json();
    }
    if (res.status === 404 || res.status === 405) {
      lastError = new Error(`API error ${res.status}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    throw new Error(await parseError(res));
  }

  throw new Error(lastError?.message || "OAuth URL endpoint not available");
}

export async function loginWithOAuthCode(provider, code, postcode) {
  if (provider !== "google") {
    throw new Error("Unsupported OAuth provider");
  }

  const postBody = JSON.stringify({
    code,
    postcode: postcode || undefined,
  });
  const attempts = [
    {
      url: buildUrl("/auth/google"),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: postBody,
      },
    },
    {
      url: new URL("/api/auth/google", window.location.origin).toString(),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: postBody,
      },
    },
    {
      url: buildUrl("/auth/google/callback", {
        code,
        postcode: postcode || undefined,
      }),
      init: { method: "GET" },
    },
    {
      url: new URL(
        `/api/auth/google/callback?code=${encodeURIComponent(code)}${
          postcode ? `&postcode=${encodeURIComponent(postcode)}` : ""
        }`,
        window.location.origin,
      ).toString(),
      init: { method: "GET" },
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(attempt.url, attempt.init);
    if (res.ok) {
      // eslint-disable-next-line no-await-in-loop
      const payload = await res.json();
      if (payload?.pending_email_confirmation) return payload;
      return persistAuthPayload(payload);
    }
    if (res.status === 404 || res.status === 405) {
      lastError = new Error(`API error ${res.status}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    throw new Error(await parseError(res));
  }

  throw new Error(lastError?.message || "OAuth login endpoint not available");
}

export async function logoutUser() {
  const session = readAuthSession();
  if (session?.refreshToken) {
    await fetch(buildUrl("/auth/logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    }).catch(() => {});
  }
  writeAuthSession(null);
}

export function fetchMe() {
  return authRequest("/auth/me");
}

export function fetchAdminStats() {
  return authRequest("/admin-dashboard/stats");
}

export function updateAuthSessionUser(user) {
  const session = readAuthSession();
  if (!session) return;
  writeAuthSession({ ...session, user: { ...(session.user || {}), ...user } });
}

export function fetchBookmarks() {
  return authRequest("/bookmarks", { cache: "no-store" });
}

export function addBookmark(dealId) {
  return authRequest(`/bookmarks/${encodeURIComponent(dealId)}`, {
    method: "POST",
  });
}

export function removeBookmark(dealId) {
  return authRequest(`/bookmarks/${encodeURIComponent(dealId)}`, {
    method: "DELETE",
  });
}

export async function startEmailAuth({ email, referral_code } = {}) {
  const res = await fetch(buildUrl("/auth/email-link/start"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, referral_code }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export function fetchBrands() {
  return authRequest("/admin-dashboard/brands");
}

export function triggerBrandRemap(brands) {
  return authRequest("/admin-dashboard/brands/remap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brands }),
  });
}

export function fetchRemapStatus(jobId) {
  return authRequest(`/admin-dashboard/brands/remap-status/${jobId}`);
}

export function fetchCanonicalStats() {
  return authRequest("/admin-dashboard/canonical-stats");
}

export function fetchCanonicalPriceData(canonicalId, excludeStoreId) {
  const qs = excludeStoreId ? `?exclude_store_id=${encodeURIComponent(excludeStoreId)}` : "";
  return authRequest(`/admin-dashboard/review-queue/canonical/${encodeURIComponent(canonicalId)}/price-data${qs}`);
}

export function reprocessUnmapped() {
  return authRequest("/admin-dashboard/reprocess-unmapped", { method: "POST" });
}

export function fetchReviewQueue({ status = "pending", page = 1, search = "" } = {}) {
  return authRequest(`/admin-dashboard/review-queue?status=${encodeURIComponent(status)}&page=${page}&search=${encodeURIComponent(search)}`);
}

export function confirmQueueItem(id, canonicalId) {
  return authRequest(`/admin-dashboard/review-queue/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ canonical_id: canonicalId }),
  });
}

export function dismissQueueItem(id) {
  return authRequest(`/admin-dashboard/review-queue/${encodeURIComponent(id)}/dismiss`, {
    method: "POST",
  });
}

export function createCanonicalFromQueue(data) {
  return authRequest("/admin-dashboard/review-queue/canonical", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function updateCanonical(id, data) {
  return authRequest(`/admin-dashboard/review-queue/canonical/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export function fetchMappedProducts() {
  return authRequest("/admin-dashboard/mapped-products");
}

export function fetchReplacements(canonicalId, storeId, dealId) {
  return request("/store-products/replacements", {
    canonical_id: canonicalId,
    store_id: storeId,
    ...(dealId && { deal_id: dealId }),
  });
}

export function fetchSameProductOtherStores(canonicalId, storeId) {
  return request("/store-products/same-product-other-stores", {
    canonical_id: canonicalId,
    store_id: storeId,
  });
}

// ── Shopping lists ────────────────────────────────────────────────────────────

export function fetchLists() {
  return authRequest("/lists");
}

export async function createList(name) {
  return authRequest("/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function fetchList(listId) {
  return authRequest(`/lists/${listId}`);
}

export async function addListItem(listId, item) {
  return authRequest(`/lists/${listId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
}

export async function removeListItem(listId, itemId) {
  return authRequest(`/lists/${listId}/items/${itemId}`, { method: "DELETE" });
}

export async function mergeCartIntoList(listId, cartItems) {
  return Promise.all(cartItems.map(item => addListItem(listId, item)));
}

// ── Comparison ────────────────────────────────────────────────────────────────

export async function runComparison(listId) {
  return authRequest(`/lists/${listId}/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function cartTransfer(listId, storeId, items) {
  return authRequest(`/lists/${listId}/cart-transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ store_id: storeId, items }),
  });
}
