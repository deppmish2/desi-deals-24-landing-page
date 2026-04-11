import React, { useEffect, useState } from "react";
import { getAuthSession, postContact } from "../utils/api";
import { trackAnalyticsEvent } from "../utils/analytics";
import { buildFeedbackMessage, resolveFeedbackSender } from "../utils/feedback";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function FeedbackWidget() {
  const [authSession, setAuthSession] = useState(() => getAuthSession());
  const [open, setOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const authUser = authSession?.user || null;
  const isLoggedIn = Boolean(authUser?.email);
  const sender = resolveFeedbackSender({
    user: authUser,
    name: guestName,
    email: guestEmail,
  });

  useEffect(() => {
    const syncSession = () => setAuthSession(getAuthSession());
    window.addEventListener("dd24-auth-changed", syncSession);
    return () => window.removeEventListener("dd24-auth-changed", syncSession);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const canSubmit =
    !submitting &&
    message.trim().length > 3 &&
    sender.name.trim().length > 0 &&
    EMAIL_RE.test(sender.email);

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);

    try {
      if (!sender.name.trim()) {
        throw new Error("Please enter your name.");
      }
      if (!EMAIL_RE.test(sender.email)) {
        throw new Error("Please enter a valid email address.");
      }
      const payload = buildFeedbackMessage(message, {
        source: window.location.pathname,
        user: authUser,
        name: guestName,
        email: guestEmail,
      });
      await postContact({
        name: payload.sender.name,
        email: payload.sender.email,
        subject: "Feedback (24deals)",
        message: payload.message,
      });
      trackAnalyticsEvent("feedback_submit", {
        page_type: "feedback_widget",
        source_path: window.location.pathname,
        logged_in: isLoggedIn ? 1 : 0,
      });
      setSent(true);
      setMessage("");
      if (!isLoggedIn) {
        setGuestName("");
        setGuestEmail("");
      }
    } catch (err) {
      setError(err?.message || "Could not send feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          trackAnalyticsEvent("feedback_open", {
            source_path: window.location.pathname,
            logged_in: isLoggedIn ? 1 : 0,
          });
          setSent(false);
          setError("");
          setOpen(true);
        }}
        className="dd24-feedback-trigger fixed z-40 bg-white hover:bg-white text-slate-600 hover:text-slate-900 font-bold rounded-full px-4 py-2.5 sm:px-4 sm:py-2.5 px-3.5 py-2 border border-slate-200 shadow-[0px_18px_40px_rgba(15,23,42,0.10)] transition-colors text-[13px] sm:text-[14px]"
        style={{ letterSpacing: 0.1 }}
      >
        Feedback
      </button>

      {open ? (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-0 flex items-end sm:items-center justify-center p-4">
            <div className="w-full max-w-[520px] bg-white rounded-[18px] border border-slate-200 overflow-hidden shadow-[0px_30px_80px_rgba(15,23,42,0.25)]">
              <div className="px-6 py-5 flex items-start justify-between gap-4 border-b border-slate-100">
                <div>
                  <div className="text-slate-900 font-extrabold text-[18px] leading-[22px]">
                    Share feedback
                  </div>
                  <div className="text-slate-500 text-[13px] leading-[18px] mt-1">
                    Bugs, feature requests, store suggestions — anything helps.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    trackAnalyticsEvent("feedback_close", {
                      source_path: window.location.pathname,
                    });
                    setOpen(false);
                  }}
                  className="text-slate-500 hover:text-slate-900 font-bold text-[16px] leading-[16px] px-2 py-2 rounded-md"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={onSubmit} className="px-6 py-5">
                {!isLoggedIn ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-[12px] font-bold text-slate-700 tracking-[1.2px] uppercase">
                        Name
                      </label>
                      <input
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        placeholder="Your name"
                        className="mt-2 w-full rounded-[12px] border border-slate-200 px-4 py-3 text-[16px] outline-none focus:border-[#16a34a]"
                        autoComplete="name"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="block text-[12px] font-bold text-slate-700 tracking-[1.2px] uppercase">
                        Email
                      </label>
                      <input
                        type="email"
                        value={guestEmail}
                        onChange={(e) => setGuestEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="mt-2 w-full rounded-[12px] border border-slate-200 px-4 py-3 text-[16px] outline-none focus:border-[#16a34a]"
                        autoComplete="email"
                      />
                    </div>
                  </div>
                ) : null}

                <label className="block text-[12px] font-bold text-slate-700 tracking-[1.2px] uppercase mt-5">
                  Feedback
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what to improve…"
                  rows={5}
                  className="mt-2 w-full rounded-[12px] border border-slate-200 px-4 py-3 text-[16px] outline-none focus:border-[#16a34a] resize-none"
                  autoFocus={!isLoggedIn}
                />

                {error ? (
                  <div className="mt-3 text-[13px] text-red-600">{error}</div>
                ) : null}
                {sent ? (
                  <div className="mt-3 text-[13px] text-[#16a34a] font-semibold">
                    Thanks — feedback sent.
                  </div>
                ) : null}

                <div className="mt-5 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      trackAnalyticsEvent("feedback_close", {
                        source_path: window.location.pathname,
                      });
                      setOpen(false);
                    }}
                    className="px-4 py-2.5 rounded-[12px] font-bold text-slate-600 hover:bg-slate-50 border border-slate-200"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="px-5 py-2.5 rounded-[12px] font-extrabold text-white bg-[#16a34a] hover:bg-[#15803d] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
