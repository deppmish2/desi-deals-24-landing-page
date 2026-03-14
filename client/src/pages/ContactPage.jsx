import React, { useState } from "react";
import { Link } from "react-router-dom";
import { postContact } from "../utils/api";

export default function ContactPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
  });
  const [status, setStatus] = useState(null); // null | 'sending' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState("");

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");
    try {
      await postContact(form);
      setStatus("success");
      setForm({ name: "", email: "", subject: "", message: "" });
    } catch (err) {
      setStatus("error");
      setErrorMsg(err.message || "Something went wrong. Please try again.");
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8">
        <Link to="/" className="text-sm text-text-secondary hover:text-primary">
          ← Back to Home
        </Link>
        <h1 className="text-3xl font-bold text-near-black mt-3">Contact Us</h1>
        <p className="text-text-secondary mt-2">
          Have a question, suggestion, or spotted a missing store? We'd love to
          hear from you.
        </p>
      </div>

      {status === "success" ? (
        <div className="bg-success/10 border border-success/30 rounded-xl p-8 text-center">
          <p className="text-4xl mb-3">✅</p>
          <h2 className="text-lg font-semibold text-near-black mb-2">
            Message sent!
          </h2>
          <p className="text-sm text-text-secondary mb-5">
            Thanks for reaching out. We'll get back to you as soon as possible.
          </p>
          <button
            onClick={() => setStatus(null)}
            className="btn-primary text-sm"
          >
            Send another message
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-5"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label
                className="block text-sm font-medium text-text-primary mb-1.5"
                htmlFor="name"
              >
                Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                value={form.name}
                onChange={handleChange}
                placeholder="Your name"
                className="w-full border border-border rounded-md px-3 py-2 text-sm text-text-primary bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium text-text-primary mb-1.5"
                htmlFor="email"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                value={form.email}
                onChange={handleChange}
                placeholder="you@example.com"
                className="w-full border border-border rounded-md px-3 py-2 text-sm text-text-primary bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text-primary mb-1.5"
              htmlFor="subject"
            >
              Subject
            </label>
            <input
              id="subject"
              name="subject"
              type="text"
              required
              value={form.subject}
              onChange={handleChange}
              placeholder="What's this about?"
              className="w-full border border-border rounded-md px-3 py-2 text-sm text-text-primary bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-text-primary mb-1.5"
              htmlFor="message"
            >
              Message
            </label>
            <textarea
              id="message"
              name="message"
              required
              rows={6}
              value={form.message}
              onChange={handleChange}
              placeholder="Write your message here..."
              className="w-full border border-border rounded-md px-3 py-2 text-sm text-text-primary bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            />
          </div>

          {status === "error" && (
            <p className="text-sm text-error bg-error/10 border border-error/20 rounded-md px-3 py-2">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "sending"}
            className="btn-primary w-full disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {status === "sending" ? "Sending…" : "Send Message"}
          </button>
        </form>
      )}
    </div>
  );
}
