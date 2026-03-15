import React, { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { loginWithOAuthCode } from "../utils/api";

const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";
const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";
const AUTH_ERROR_STORAGE_KEY = "dd24_auth_error";

export default function OAuthCallbackPage() {
  const navigate = useNavigate();
  const { provider } = useParams();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  useEffect(() => {
    const oauthError =
      searchParams.get("error_description") || searchParams.get("error");
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const postcode = searchParams.get("postcode");
    const safeProvider = provider === "google" ? provider : null;

    if (!safeProvider) {
      setError("Unsupported sign-in provider.");
      return;
    }
    if (oauthError) {
      setError(String(oauthError));
      return;
    }
    const stateKey = `${OAUTH_STATE_STORAGE_PREFIX}${safeProvider}`;
    const expectedState = sessionStorage.getItem(stateKey);
    if (expectedState && state && state !== expectedState) {
      setError("OAuth state mismatch. Please retry login.");
      sessionStorage.removeItem(stateKey);
      return;
    }
    if (expectedState && !state) {
      setWarning("OAuth provider did not return state; continuing.");
    }
    sessionStorage.removeItem(stateKey);
    if (!code) {
      setError("Missing OAuth code.");
      return;
    }

    loginWithOAuthCode(safeProvider, code, postcode)
      .then(() => {
        const redirectTo =
          sessionStorage.getItem(POST_AUTH_REDIRECT_STORAGE_KEY) || "/waitlist";
        sessionStorage.removeItem(POST_AUTH_REDIRECT_STORAGE_KEY);
        navigate(redirectTo, { replace: true });
      })
      .catch((err) => {
        const message = err?.message || "OAuth login failed";
        sessionStorage.setItem(AUTH_ERROR_STORAGE_KEY, message);
        setError(message);
        navigate("/waitlist", { replace: true });
      });
  }, [navigate, provider, searchParams]);

  return (
    <div className="min-h-screen bg-[#f7f7f7] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-[#e2e8f0] rounded-xl p-6 shadow-sm">
        {!error ? (
          <>
            <h1 className="text-xl font-bold text-[#0f172a] mb-2">
              Finishing Google sign in...
            </h1>
            <p className="text-sm text-[#64748b]">
              Please wait while we complete your Google login.
            </p>
            {warning ? (
              <p className="text-xs text-amber-600 mt-2">{warning}</p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold text-[#0f172a] mb-2">
              Google Login Failed
            </h1>
            <p className="text-sm text-red-600 mb-4">{error}</p>
            <button
              type="button"
              onClick={() => navigate("/waitlist", { replace: true })}
              className="inline-flex items-center justify-center bg-[#16a34a] text-white font-bold text-sm px-4 py-2.5 rounded-lg hover:bg-[#15803d] transition-colors"
            >
              Back to Waitlist
            </button>
          </>
        )}
      </div>
    </div>
  );
}
