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

async function request(path, params = {}) {
  const res = await fetch(buildUrl(path, params));
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
  return request("/deals", params);
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

export async function startEmailAuth({ email, referral_code } = {}) {
  const res = await fetch(buildUrl("/auth/email-link/start"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, referral_code }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}
