import React, { Suspense, lazy, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import AdLandingPage from "./pages/AdLandingPage";
import DealsPage from "./pages/DealsPage";
import { initGoogleAnalytics, trackPageView } from "./utils/analytics";
import { useCart } from "./hooks/useCart";
import { CartContext } from "./hooks/CartContext";

const OAuthCallbackPage = lazy(() => import("./pages/OAuthCallbackPage"));
const SavedDealsPage = lazy(() => import("./pages/SavedDealsPage"));
const DealSharePage = lazy(() => import("./pages/DealSharePage"));
const AdminPage = lazy(() => import("./landing/AdminPage"));
const FeedbackWidget = lazy(() => import("./components/FeedbackWidget"));
const ListPage = lazy(() => import("./pages/ListPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const CatalogPage = lazy(() => import("./pages/CatalogPage"));

function RedirectToCompare() {
  const { id } = useParams();
  return <Navigate to={`/compare/${id}`} replace />;
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace" }}>
          <h2 style={{ color: "red" }}>Render error</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
            {String(this.state.error)}
          </pre>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteAnalytics() {
  const location = useLocation();

  useEffect(() => {
    initGoogleAnalytics();
    trackPageView(
      `${location.pathname}${location.search}${location.hash}`,
      document.title,
    );
  }, [location.hash, location.pathname, location.search]);

  return null;
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
      if (
        idleId !== null &&
        typeof window !== "undefined" &&
        "cancelIdleCallback" in window
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  return (
    <BrowserRouter>
      <RouteAnalytics />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<DealsPage />} />
          <Route path="/deals" element={<DealsPage />} />
          <Route path="/insta" element={<AdLandingPage />} />
          <Route path="/deal/:dealId" element={<DealsPage />} />
          <Route path="/share/deal/:dealId" element={<DealSharePage />} />
          <Route path="/saved" element={<SavedDealsPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/compare/:id" element={<ComparePage />} />
          <Route path="/products" element={<CatalogPage />} />
          <Route path="/list" element={<Navigate to="/cart" replace />} />
          <Route path="/list/:id/compare" element={<RedirectToCompare />} />
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
  const cart = useCart();
  return (
    <ErrorBoundary>
      <CartContext.Provider value={cart}>
        <AppShell />
      </CartContext.Provider>
    </ErrorBoundary>
  );
}
