import React from "react";
import { Link } from "react-router-dom";

export default function EmptyState({ title, message, cta }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
      <span className="text-6xl mb-4">🛒</span>
      <h3 className="text-lg font-semibold text-text-primary mb-2">
        {title || "No deals found"}
      </h3>
      <p className="text-text-secondary text-sm max-w-sm mb-6">
        {message ||
          "Try adjusting your search or filters, or check back after the next crawl."}
      </p>
      {cta && (
        <Link to={cta.href} className="btn-primary text-sm">
          {cta.label}
        </Link>
      )}
    </div>
  );
}
