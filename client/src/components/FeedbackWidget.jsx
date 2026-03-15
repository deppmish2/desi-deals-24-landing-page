import React, { useEffect, useMemo, useState } from "react";
import { getAuthSession, postContact } from "../utils/api";

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const sessionEmail = useMemo(() => {
    const session = getAuthSession?.();
    return String(session?.user?.email || "").trim();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const canSubmit = !submitting && message.trim().length > 3;

  async function onSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError("");
    setSubmitting(true);

    try {
      const normalizedEmail = sessionEmail;
      if (!normalizedEmail) {
        throw new Error("Please log in to send feedback.");
      }
      const name = normalizedEmail.split("@")[0] || "DesiDeals24 user";
      await postContact({
        name,
        email: normalizedEmail,
        subject: "Feedback (24deals)",
        message: `${message.trim()}\n\nSource: ${window.location.pathname}`,
      });
      setSent(true);
      setMessage("");
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
          setSent(false);
          setError("");
          setOpen(true);
        }}
        className="fixed bottom-6 right-6 z-40 bg-white/80 hover:bg-white text-slate-600 hover:text-slate-900 font-bold rounded-full px-4 py-2.5 border border-slate-200 backdrop-blur-md shadow-[0px_18px_40px_rgba(15,23,42,0.10)] transition-colors"
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
                  onClick={() => setOpen(false)}
                  className="text-slate-500 hover:text-slate-900 font-bold text-[16px] leading-[16px] px-2 py-2 rounded-md"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={onSubmit} className="px-6 py-5">
                <label className="block text-[12px] font-bold text-slate-700 tracking-[1.2px] uppercase mt-5">
                  Feedback
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what to improve…"
                  rows={5}
                  className="mt-2 w-full rounded-[12px] border border-slate-200 px-4 py-3 text-[16px] outline-none focus:border-[#16a34a] resize-none"
                  autoFocus
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
                    onClick={() => setOpen(false)}
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
