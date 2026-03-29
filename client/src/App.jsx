import React, { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import DealsPage from "./pages/DealsPage";

const OAuthCallbackPage = lazy(() => import("./pages/OAuthCallbackPage"));
const SavedDealsPage = lazy(() => import("./pages/SavedDealsPage"));
const DealSharePage = lazy(() => import("./pages/DealSharePage"));
const AdminPage = lazy(() => import("./landing/AdminPage"));
const FeedbackWidget = lazy(() => import("./components/FeedbackWidget"));

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace" }}>
          <h2 style={{ color: "red" }}>Render error</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{String(this.state.error)}</pre>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;
    let idleId = null;

    const enableFeedback = () => {
      if (!cancelled) setShowFeedback(true);
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(enableFeedback, { timeout: 1800 });
    } else {
      timeoutId = window.setTimeout(enableFeedback, 1200);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<DealsPage />} />
          <Route path="/deal/:dealId" element={<DealsPage />} />
          <Route path="/share/deal/:dealId" element={<DealSharePage />} />
          <Route path="/saved" element={<SavedDealsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route
            path="/oauth/:provider/callback"
            element={<OAuthCallbackPage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {showFeedback ? <FeedbackWidget /> : null}
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
