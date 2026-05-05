import React, { useState } from "react";
import { fetchOAuthAuthUrl } from "../utils/api";
import { trackAnalyticsEvent } from "../utils/analytics";

const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";
const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";
export const POST_LOGIN_RESUME_STATE_STORAGE_KEY = "dd24_post_login_resume_state";

function createOAuthState() {
  if (typeof window !== "undefined" && window.crypto?.randomUUID)
    return window.crypto.randomUUID();
  return `dd24-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function GoogleIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      <path fill="none" d="M0 0h48v48H0z"/>
    </svg>
  );
}

export default function LoginModal({ message, resumeState, onClose }) {
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  async function handleGoogle() {
    setAuthError("");
    setLoading(true);
    trackAnalyticsEvent("login_google_click", { source: "login_modal" });
    try {
      const state = createOAuthState();
      const redirectTo = `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
      sessionStorage.setItem(`${OAUTH_STATE_STORAGE_PREFIX}google`, state);
      sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, redirectTo);
      if (resumeState) {
        sessionStorage.setItem(POST_LOGIN_RESUME_STATE_STORAGE_KEY, JSON.stringify(resumeState));
      } else {
        sessionStorage.removeItem(POST_LOGIN_RESUME_STATE_STORAGE_KEY);
      }
      const payload = await fetchOAuthAuthUrl("google", state);
      const authUrl = payload?.authUrl || payload?.url;
      if (!authUrl) throw new Error("Google sign-in unavailable right now.");
      window.location.assign(authUrl);
    } catch (err) {
      setLoading(false);
      setAuthError(err?.message || "Unable to start Google sign-in.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: "rgba(15,23,42,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-7 max-w-sm w-full shadow-2xl flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {message && (
          <div className="rounded-xl overflow-hidden" style={{ background: "#16a34a" }}>
            <div className="px-5 py-4">
              <p className="text-[15px] font-extrabold text-white">Unlock this feature</p>
              <p className="text-[13px] mt-0.5" style={{ color: "rgba(255,255,255,0.85)" }}>{message}</p>
            </div>
          </div>
        )}
        {authError && (
          <p className="text-[13px] text-red-600 bg-red-50 rounded-lg px-3 py-2">{authError}</p>
        )}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl py-3.5 px-4 text-[15px] font-semibold text-[#1e293b] transition-colors shadow-sm disabled:opacity-60"
        >
          <GoogleIcon size={20} />
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>
        <button type="button" onClick={onClose} className="text-center text-[13px] text-slate-400 hover:text-slate-600 transition-colors">
          Maybe later
        </button>
      </div>
    </div>
  );
}
