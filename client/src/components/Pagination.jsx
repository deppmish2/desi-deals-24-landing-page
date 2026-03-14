import React from "react";

const DELTA = 2;

export default function Pagination({ pagination, onPageChange }) {
  if (!pagination || pagination.total_pages <= 1) return null;

  const { page, total_pages } = pagination;

  const visiblePages = [];
  for (
    let i = Math.max(1, page - DELTA);
    i <= Math.min(total_pages, page + DELTA);
    i++
  ) {
    visiblePages.push(i);
  }

  const showEndEllipsis = total_pages > page + DELTA + 1;
  const showLastPage =
    total_pages > page + DELTA && !visiblePages.includes(total_pages);

  return (
    <div className="flex justify-center mt-8 pt-8">
      <div
        className="bg-white border border-[#f1f5f9] rounded-[32px] flex items-center gap-3 p-[11px]"
        style={{
          boxShadow:
            "0px 20px 25px -5px rgba(241,245,249,0.5),0px 8px 10px -6px rgba(241,245,249,0.5)",
        }}
      >
        {/* Prev */}
        <button
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
          className="w-11 h-11 flex items-center justify-center rounded-[24px] disabled:opacity-30 hover:bg-[#f8fafc] transition-colors"
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
            <path
              d="M6 10L2 6l4-4"
              stroke="#475569"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Page numbers */}
        {visiblePages.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className="w-11 h-11 flex items-center justify-center rounded-[24px] text-[14px] font-bold transition-colors"
            style={
              p === page
                ? {
                    backgroundColor: "#16a34a",
                    color: "#fff",
                    boxShadow:
                      "0px 10px 15px -3px rgba(22,163,74,0.3),0px 4px 6px -4px rgba(22,163,74,0.3)",
                  }
                : { color: "#475569" }
            }
          >
            {p}
          </button>
        ))}

        {/* Ellipsis */}
        {showEndEllipsis && (
          <span className="text-[#cbd5e1] text-[16px] px-2">...</span>
        )}

        {/* Last page */}
        {showLastPage && (
          <button
            onClick={() => onPageChange(total_pages)}
            className="w-11 h-11 flex items-center justify-center rounded-[24px] text-[14px] font-bold text-[#475569] hover:bg-[#f8fafc] transition-colors"
          >
            {total_pages}
          </button>
        )}

        {/* Next */}
        <button
          disabled={page === total_pages}
          onClick={() => onPageChange(page + 1)}
          className="w-11 h-11 flex items-center justify-center rounded-[24px] disabled:opacity-30 hover:bg-[#f8fafc] transition-colors"
        >
          <svg width="8" height="12" viewBox="0 0 8 12" fill="none">
            <path
              d="M2 2l4 4-4 4"
              stroke="#475569"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
