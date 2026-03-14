const BASE = "/api/v1";
const AUTH_STORAGE_KEY = "dd24_auth_session";

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

function buildUrl(path, params = {}) {
  const url = new URL(BASE + path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return url.toString();
}

async function parseError(res) {
  const json = await res.json().catch(() => ({}));
  return json.error || `API error ${res.status}`;
}

async function request(path, params = {}) {
  const res = await fetch(buildUrl(path, params));
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

async function authRequest(path, options = {}, retry = true) {
  const session = readAuthSession();
  const headers = {
    ...(options.headers || {}),
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

export function fetchDeals(params) {
  return request("/deals", params);
}

export function fetchDeal(id) {
  return request(`/deals/${id}`);
}

export function fetchStores() {
  return request("/stores");
}

export function fetchStore(id) {
  return request(`/stores/${id}`);
}

export function fetchCategories() {
  return request("/categories");
}

export function fetchCrawlStatus() {
  return request("/admin/crawl/status");
}

export function warmup() {
  return request("/admin/crawl/warmup");
}

export function fetchSuggestions(q) {
  return fetchAutocomplete(q)
    .then((data) => {
      const primary = (data?.suggestions || [])
        .map((item) => {
          if (typeof item === "string") return item;
          return item?.label || "";
        })
        .filter(Boolean);

      if (primary.length > 0) {
        return { suggestions: primary };
      }

      return request("/deals/suggest", { q }).then((fallback) => ({
        suggestions: (fallback?.suggestions || [])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      }));
    })
    .catch(() => request("/deals/suggest", { q }));
}

export function buildDealsSearchPath(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) return "/deals";

  const params = new URLSearchParams();
  params.set("q", q);
  params.set("availability", "in_stock");

  if (options?.bundle) {
    const selected = String(options?.selected || "").trim();
    const merged = [];
    const seen = new Set();

    for (const value of [selected, ...(options?.suggestions || [])]) {
      const text = String(value || "").trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(text);
      if (merged.length >= 12) break;
    }

    if (merged.length > 0) {
      params.set("bundle", "1");
      if (selected) params.set("selected", selected);
      params.set("suggested", JSON.stringify(merged));
    }
  }

  return `/deals?${params.toString()}`;
}

export function fetchAutocomplete(q) {
  return request("/search/autocomplete", { q });
}

export async function postContact(data) {
  const res = await fetch("/api/v1/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export function getAuthSession() {
  return readAuthSession();
}

export function updateAuthSessionUser(userPatch) {
  const session = readAuthSession();
  if (!session?.user || !userPatch || typeof userPatch !== "object") {
    return;
  }

  writeAuthSession({
    ...session,
    user: {
      ...session.user,
      ...userPatch,
    },
  });
}

export function isAuthenticated() {
  const session = readAuthSession();
  return Boolean(session?.accessToken);
}

export async function registerUser(payload) {
  const res = await fetch(buildUrl("/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));

  const json = await res.json();
  if (json?.accessToken && json?.refreshToken && json?.user) {
    writeAuthSession({
      accessToken: json.accessToken,
      refreshToken: json.refreshToken,
      user: json.user,
    });
  }
  return json;
}

export async function startEmailAuth(payload) {
  const res = await fetch(buildUrl("/auth/email-link/start"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function completeEmailAuth(token) {
  const res = await fetch(buildUrl("/auth/email-link/complete"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(await parseError(res));

  const json = await res.json();
  writeAuthSession({
    accessToken: json.accessToken,
    refreshToken: json.refreshToken,
    user: json.user,
  });
  return json;
}

export async function fetchEmailStatus(email) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();

  const attempts = [
    {
      url: buildUrl("/auth/email-status"),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      },
    },
    {
      url: buildUrl("/auth/email-status", { email: normalizedEmail }),
      init: { method: "GET" },
    },
    {
      url: new URL("/api/auth/email-status", window.location.origin).toString(),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      },
    },
    {
      url: new URL(
        `/api/auth/email-status?email=${encodeURIComponent(normalizedEmail)}`,
        window.location.origin,
      ).toString(),
      init: { method: "GET" },
    },
    {
      url: buildUrl("/auth/check-email"),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      },
    },
    {
      url: buildUrl("/auth/check-email", { email: normalizedEmail }),
      init: { method: "GET" },
    },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(attempt.url, attempt.init);
    if (res.ok) {
      // eslint-disable-next-line no-await-in-loop
      const payload = await res.json().catch(() => ({}));
      return {
        exists: Boolean(payload?.exists),
        email: payload?.email || normalizedEmail,
        hasPassword: Boolean(payload?.hasPassword),
        emailVerified: Boolean(payload?.emailVerified),
        providers: {
          google: Boolean(payload?.providers?.google),
          facebook: Boolean(payload?.providers?.facebook),
        },
        lookupUnavailable: false,
      };
    }
    if (res.status === 404 || res.status === 405) {
      lastError = new Error(`API error ${res.status}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    throw new Error(await parseError(res));
  }

  return {
    exists: false,
    email: normalizedEmail,
    hasPassword: false,
    emailVerified: false,
    providers: { google: false, facebook: false },
    lookupUnavailable: true,
    error: lastError?.message || "Email status endpoint not available",
  };
}

export async function fetchOAuthAuthUrl(provider, state) {
  const safeProvider =
    provider === "google" || provider === "facebook" ? provider : null;
  if (!safeProvider) throw new Error("Unsupported OAuth provider");

  const attempts = [
    buildUrl(`/auth/${safeProvider}/url`, { state }),
    new URL(
      `/api/auth/${safeProvider}/url${state ? `?state=${encodeURIComponent(state)}` : ""}`,
      window.location.origin,
    ).toString(),
  ];

  let lastErr = null;
  for (const url of attempts) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(url);
    if (res.ok) {
      // eslint-disable-next-line no-await-in-loop
      return res.json();
    }
    if (res.status === 404 || res.status === 405) {
      lastErr = new Error(`API error ${res.status}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    throw new Error(await parseError(res));
  }

  throw new Error(lastErr?.message || "OAuth URL endpoint not available");
}

export async function loginWithOAuthCode(provider, code, postcode) {
  const safeProvider =
    provider === "google" || provider === "facebook" ? provider : null;
  if (!safeProvider) throw new Error("Unsupported OAuth provider");

  const postBody = JSON.stringify({
    code,
    postcode: postcode || undefined,
  });
  const attempts = [
    {
      url: buildUrl(`/auth/${safeProvider}`),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: postBody,
      },
    },
    {
      url: new URL(
        `/api/auth/${safeProvider}`,
        window.location.origin,
      ).toString(),
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: postBody,
      },
    },
    {
      url: buildUrl(`/auth/${safeProvider}/callback`, {
        code,
        postcode: postcode || undefined,
      }),
      init: { method: "GET" },
    },
    {
      url: new URL(
        `/api/auth/${safeProvider}/callback?code=${encodeURIComponent(code)}${
          postcode ? `&postcode=${encodeURIComponent(postcode)}` : ""
        }`,
        window.location.origin,
      ).toString(),
      init: { method: "GET" },
    },
  ];

  let lastErr = null;
  let json = null;
  for (const attempt of attempts) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(attempt.url, attempt.init);
    if (res.ok) {
      // eslint-disable-next-line no-await-in-loop
      json = await res.json();
      break;
    }
    if (res.status === 404 || res.status === 405) {
      lastErr = new Error(`API error ${res.status}`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    throw new Error(await parseError(res));
  }

  if (!json) {
    throw new Error(lastErr?.message || "OAuth login endpoint not available");
  }

  writeAuthSession({
    accessToken: json.accessToken,
    refreshToken: json.refreshToken,
    user: json.user,
  });
  return json;
}

export async function loginUser(payload) {
  const res = await fetch(buildUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));

  const json = await res.json();
  writeAuthSession({
    accessToken: json.accessToken,
    refreshToken: json.refreshToken,
    user: json.user,
  });
  return json;
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
  return authRequest("/me");
}

export function updateMe(payload) {
  return authRequest("/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function fetchWaitlistMe() {
  return authRequest("/waitlist/me");
}

export function claimWaitlistReferral(referralCode) {
  return authRequest("/waitlist/claim-referral", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ referral_code: referralCode }),
  });
}

export function createList(payload) {
  return authRequest("/lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function fetchLists() {
  return authRequest("/lists");
}

export function fetchList(id) {
  return authRequest(`/lists/${id}`);
}

export function updateList(id, payload) {
  return authRequest(`/lists/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export function deleteList(id) {
  return authRequest(`/lists/${id}`, {
    method: "DELETE",
  });
}

export function addListItem(listId, payload) {
  return authRequest(`/lists/${listId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export function updateListItem(listId, itemId, payload) {
  return authRequest(`/lists/${listId}/items/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export function deleteListItem(listId, itemId) {
  return authRequest(`/lists/${listId}/items/${itemId}`, {
    method: "DELETE",
  });
}

export function recommendList(id, payload) {
  return authRequest(`/lists/${id}/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export function buildListStoreCartTransfer(id, payload) {
  return authRequest(`/lists/${id}/cart-transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export function searchListReplacements(id, payload) {
  return authRequest(`/lists/${id}/replacement-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

export function fetchAlerts() {
  return authRequest("/me/alerts");
}

export function createAlert(payload) {
  return authRequest("/me/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateAlert(id, payload) {
  return authRequest(`/me/alerts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteAlert(id) {
  return authRequest(`/me/alerts/${id}`, {
    method: "DELETE",
  });
}
