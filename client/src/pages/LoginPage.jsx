import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  fetchEmailStatus,
  fetchOAuthAuthUrl,
  loginUser,
  registerUser,
} from "../utils/api";

const OAUTH_STATE_STORAGE_PREFIX = "dd24_oauth_state:";
const POST_AUTH_REDIRECT_STORAGE_KEY = "dd24_post_auth_redirect";

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M19.6 10.23c0-.68-.06-1.36-.18-2H10v3.79h5.4a4.62 4.62 0 01-2 3.03v2.52h3.24c1.9-1.75 3-4.33 3-7.34z"
        fill="#4285F4"
      />
      <path
        d="M10 20c2.7 0 4.97-.9 6.62-2.43l-3.24-2.52c-.9.6-2.04.96-3.38.96-2.6 0-4.8-1.75-5.59-4.11H1.07v2.6A10 10 0 0010 20z"
        fill="#34A853"
      />
      <path
        d="M4.41 11.9A6.02 6.02 0 014.1 10c0-.66.11-1.3.31-1.9V5.5H1.07A10 10 0 000 10c0 1.61.38 3.13 1.07 4.5l3.34-2.6z"
        fill="#FBBC04"
      />
      <path
        d="M10 3.96a5.44 5.44 0 013.84 1.5L16.7 2.6A9.65 9.65 0 0010 0 10 10 0 001.07 5.5l3.34 2.6C5.2 5.71 7.4 3.96 10 3.96z"
        fill="#E94235"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="10" fill="#1877F2" />
      <path
        d="M13.5 10H11.5v6h-2.5v-6H7.5V7.8H9V6.5C9 4.8 9.9 4 11.5 4c.7 0 1.5.1 1.5.1v1.7h-.9c-.8 0-1.1.5-1.1 1v1h2l-.5 2.2z"
        fill="white"
      />
    </svg>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const prefilledEmail = String(searchParams.get("email") || "").trim();
  const [step, setStep] = useState("email"); // email | password | register
  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [postcode, setPostcode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState("");
  const [emailStatus, setEmailStatus] = useState(null);

  useEffect(() => {
    if (prefilledEmail && !email) {
      setEmail(prefilledEmail);
    }
  }, [email, prefilledEmail]);

  async function handleEmailContinue(e) {
    e.preventDefault();
    const cleanEmail = String(email || "").trim();
    if (!cleanEmail) return;

    setError("");
    setInfo("");
    setSubmitting(true);
    try {
      const status = await fetchEmailStatus(cleanEmail);
      setEmailStatus(status);
      if (status?.lookupUnavailable) {
        setStep("password");
        setInfo(
          "Could not verify this email on the server. Try password login, or create account instead.",
        );
        return;
      }
      if (status?.exists) {
        setStep("password");
        if (!status?.hasPassword) {
          setInfo(
            "This email exists in our user DB. Enter password if set, or use Google/Facebook login.",
          );
        }
      } else {
        setStep("register");
      }
    } catch (err) {
      setError(err?.message || "Could not verify email");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setSubmitting(true);
    try {
      await loginUser({ email, password });
      navigate("/waitlist", { replace: true });
    } catch (err) {
      setError(err?.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    setError("");
    setInfo("");
    setSubmitting(true);
    try {
      await registerUser({ email, password: newPassword, postcode });
      navigate("/waitlist", { replace: true });
    } catch (err) {
      setError(err?.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOAuth(provider) {
    setError("");
    setInfo("");
    setOauthLoading(provider);
    try {
      const state = `dd24:${provider}:${Date.now()}:${Math.random()
        .toString(36)
        .slice(2, 10)}`;
      sessionStorage.setItem(`${OAUTH_STATE_STORAGE_PREFIX}${provider}`, state);
      sessionStorage.setItem(POST_AUTH_REDIRECT_STORAGE_KEY, "/waitlist");
      const payload = await fetchOAuthAuthUrl(provider, state);
      if (!payload?.authUrl) {
        throw new Error(`Missing ${provider} OAuth URL`);
      }
      window.location.href = payload.authUrl;
    } catch (err) {
      const raw = String(err?.message || "").toLowerCase();
      if (
        raw.includes("not configured") ||
        raw.includes("501") ||
        raw.includes("oauth url endpoint not available")
      ) {
        setError(
          `${provider === "google" ? "Google" : "Facebook"} login is not configured on server yet.`,
        );
      } else {
        setError(err?.message || `${provider} login failed`);
      }
      setOauthLoading("");
    }
  }

  function goBackToEmail() {
    setStep("email");
    setPassword("");
    setNewPassword("");
    setPostcode("");
    setError("");
    setInfo("");
  }

  return (
    <div className="min-h-screen bg-[#f7f7f7] flex items-center justify-center px-4 py-10 relative overflow-hidden">
      <div className="absolute top-[-100px] left-[-128px] w-[512px] h-[410px] bg-[rgba(22,163,74,0.05)] rounded-full blur-[32px] pointer-events-none" />
      <div className="absolute bottom-[-100px] right-[-128px] w-[512px] h-[410px] bg-[rgba(22,163,74,0.05)] rounded-full blur-[32px] pointer-events-none" />

      <div className="relative w-full max-w-[480px] bg-white border border-[#e2e8f0] rounded-[12px] shadow-[0px_20px_25px_-5px_rgba(226,232,240,0.5),0px_8px_10px_-6px_rgba(226,232,240,0.5)] px-[41px] pt-[41px] pb-[57px] flex flex-col gap-8">
        <h1 className="text-[30px] font-bold text-[#0f172a] text-center leading-[36px]">
          {step === "email"
            ? "Welcome back"
            : step === "password"
              ? "Enter your password"
              : "Create your account"}
        </h1>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="flex items-center justify-center gap-3 w-full bg-white border border-[#e2e8f0] rounded-[8px] px-4 py-[13px] text-[14px] font-semibold text-[#334155] hover:bg-[#f8fafc] transition-colors disabled:opacity-60"
            onClick={() => handleOAuth("google")}
            disabled={Boolean(oauthLoading)}
          >
            <GoogleIcon />
            {oauthLoading === "google"
              ? "Redirecting to Google..."
              : "Continue with Google"}
          </button>
          <button
            type="button"
            className="flex items-center justify-center gap-3 w-full bg-white border border-[#e2e8f0] rounded-[8px] px-4 py-[13px] text-[14px] font-semibold text-[#334155] hover:bg-[#f8fafc] transition-colors disabled:opacity-60"
            onClick={() => handleOAuth("facebook")}
            disabled={Boolean(oauthLoading)}
          >
            <FacebookIcon />
            {oauthLoading === "facebook"
              ? "Redirecting to Facebook..."
              : "Continue with Facebook"}
          </button>
        </div>

        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#e2e8f0]" />
          </div>
          <div className="relative bg-white px-4">
            <span className="text-[12px] font-medium text-[#94a3b8] uppercase tracking-[1.2px]">
              or
            </span>
          </div>
        </div>

        {step === "email" && (
          <form onSubmit={handleEmailContinue} className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-semibold text-[#0f172a]">
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                required
                autoFocus
                className="w-full bg-white border border-[#e2e8f0] rounded-[8px] px-[17px] py-[14px] text-[16px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#16a34a] focus:ring-1 focus:ring-[#16a34a] transition-colors"
              />
            </div>
            {error ? (
              <p className="text-sm text-red-600 -mt-2">{error}</p>
            ) : null}
            {info ? (
              <p className="text-sm text-[#64748b] -mt-2">{info}</p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#16a34a] text-white font-bold text-[14px] py-[14px] rounded-[8px] shadow-sm hover:bg-[#15803d] transition-colors disabled:opacity-60"
            >
              {submitting ? "Checking..." : "Continue"}
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-6">
            <div className="flex items-center justify-between bg-[#f8fafc] border border-[#e2e8f0] rounded-[8px] px-4 py-3">
              <span className="text-[14px] text-[#334155] truncate">
                {email}
              </span>
              <button
                type="button"
                onClick={goBackToEmail}
                className="text-[12px] font-semibold text-[#16a34a] hover:underline shrink-0 ml-3"
              >
                Change
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-semibold text-[#0f172a]">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoFocus
                className="w-full bg-white border border-[#e2e8f0] rounded-[8px] px-[17px] py-[14px] text-[16px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#16a34a] focus:ring-1 focus:ring-[#16a34a] transition-colors"
              />
            </div>
            {error ? (
              <p className="text-sm text-red-600 -mt-2">{error}</p>
            ) : null}
            {info ? (
              <p className="text-sm text-[#64748b] -mt-2">{info}</p>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setStep("register");
                setError("");
                setInfo("");
                setPassword("");
              }}
              className="text-[13px] font-semibold text-[#16a34a] hover:underline text-left -mt-2"
            >
              Create account instead
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#16a34a] text-white font-bold text-[14px] py-[14px] rounded-[8px] shadow-sm hover:bg-[#15803d] transition-colors disabled:opacity-60"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}

        {step === "register" && (
          <form onSubmit={handleRegisterSubmit} className="flex flex-col gap-6">
            <div className="flex items-center justify-between bg-[#f8fafc] border border-[#e2e8f0] rounded-[8px] px-4 py-3">
              <span className="text-[14px] text-[#334155] truncate">
                {email}
              </span>
              <button
                type="button"
                onClick={goBackToEmail}
                className="text-[12px] font-semibold text-[#16a34a] hover:underline shrink-0 ml-3"
              >
                Change
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-semibold text-[#0f172a]">
                Create Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                minLength={8}
                required
                autoFocus
                className="w-full bg-white border border-[#e2e8f0] rounded-[8px] px-[17px] py-[14px] text-[16px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#16a34a] focus:ring-1 focus:ring-[#16a34a] transition-colors"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-semibold text-[#0f172a]">
                Postcode
              </label>
              <input
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                placeholder="80331"
                required
                className="w-full bg-white border border-[#e2e8f0] rounded-[8px] px-[17px] py-[14px] text-[16px] text-[#0f172a] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#16a34a] focus:ring-1 focus:ring-[#16a34a] transition-colors"
              />
            </div>

            {error ? (
              <p className="text-sm text-red-600 -mt-2">{error}</p>
            ) : null}
            {info ? (
              <p className="text-sm text-[#64748b] -mt-2">{info}</p>
            ) : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-[#16a34a] text-white font-bold text-[14px] py-[14px] rounded-[8px] shadow-sm hover:bg-[#15803d] transition-colors disabled:opacity-60"
            >
              {submitting ? "Creating account..." : "Create account"}
            </button>
          </form>
        )}

        <p className="text-sm text-[#64748b] text-center">
          Need a separate signup screen?{" "}
          <Link
            to="/register"
            className="font-semibold text-[#16a34a] hover:underline"
          >
            Open register page
          </Link>
        </p>

        {emailStatus?.exists ? (
          <p className="text-[12px] text-[#94a3b8] text-center -mt-4">
            Email found in user DB. Password login enabled.
          </p>
        ) : null}
      </div>
    </div>
  );
}
