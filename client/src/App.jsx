import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import DealsPage from "./pages/DealsPage";
import AdminPage from "./landing/AdminPage";
import FeedbackWidget from "./components/FeedbackWidget";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DealsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route
          path="/oauth/:provider/callback"
          element={<OAuthCallbackPage />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <FeedbackWidget />
    </BrowserRouter>
  );
}
