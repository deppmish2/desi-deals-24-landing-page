import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { registerUser } from "../utils/api";

export default function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(
    () => String(searchParams.get("email") || "").trim(),
  );
  const [password, setPassword] = useState("");
  const [postcode, setPostcode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await registerUser({ email, password, postcode });
      navigate("/waitlist", { replace: true });
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-near-black mb-2">
        Create Account
      </h1>
      <p className="text-sm text-text-secondary mb-6">
        Sign up with email and postcode for personalized recommendations.
      </p>

      <form
        onSubmit={onSubmit}
        className="bg-card border border-border rounded-xl p-5 space-y-4"
      >
        <div>
          <label className="block text-sm font-medium text-near-black mb-1">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="aura-input"
            placeholder="you@example.com"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-near-black mb-1">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="aura-input"
            placeholder="Minimum 8 characters"
            minLength={8}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-near-black mb-1">
            Postcode
          </label>
          <input
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
            className="aura-input"
            placeholder="80331"
            required
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          className="btn-primary w-full"
          disabled={submitting}
        >
          {submitting ? "Creating account..." : "Register"}
        </button>

        <p className="text-sm text-text-secondary text-center">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Login
          </Link>
        </p>
      </form>
    </div>
  );
}
