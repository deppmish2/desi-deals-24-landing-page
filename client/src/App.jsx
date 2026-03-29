import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import DealsPage from "./pages/DealsPage";
import SavedDealsPage from "./pages/SavedDealsPage";
import DealSharePage from "./pages/DealSharePage";
import AdminPage from "./landing/AdminPage";
import FeedbackWidget from "./components/FeedbackWidget";

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

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
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
        <FeedbackWidget />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
