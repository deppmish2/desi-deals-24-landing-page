import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import OAuthCallbackPage from "./pages/OAuthCallbackPage";
import WaitlistPage from "./landing/WaitlistPage";
import Deals24Page from "./landing/Deals24Page";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/waitlist" replace />} />
        <Route path="/waitlist" element={<WaitlistPage />} />
        <Route path="/24deals" element={<Deals24Page />} />
        <Route
          path="/oauth/:provider/callback"
          element={<OAuthCallbackPage />}
        />
        <Route path="*" element={<Navigate to="/waitlist" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
