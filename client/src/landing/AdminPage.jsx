import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAdminStats, getAuthSession, logoutUser } from "../utils/api";

function BarChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[120px] text-slate-300 text-sm">
        No data yet
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.count), 1);
  const chartH = 100;
  const barW = Math.min(20, Math.floor(560 / data.length) - 2);
  const totalW = data.length * (barW + 2);

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(totalW, 200)} height={chartH + 24} className="block">
        {data.map((d, i) => {
          const barH = Math.max(2, Math.round((d.count / max) * chartH));
          const x = i * (barW + 2);
          const y = chartH - barH;
          const every = Math.max(1, Math.ceil(data.length / 8));
          return (
            <g key={d.day}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                fill="#16a34a"
                rx={2}
              />
              {d.count > 0 && (
                <text
                  x={x + barW / 2}
                  y={y - 3}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#64748b"
                >
                  {d.count}
                </text>
              )}
              {i % every === 0 && (
                <text
                  x={x + barW / 2}
                  y={chartH + 16}
                  textAnchor="middle"
                  fontSize={8}
                  fill="#94a3b8"
                >
                  {d.day ? d.day.slice(5) : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function KpiCard({ label, value }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-5 py-5">
      <div className="text-[10px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-2">
        {label}
      </div>
      <div className="text-[34px] font-extrabold text-slate-900 leading-none">
        {value ?? "—"}
      </div>
    </div>
  );
}

function formatActorLabel(search) {
  if (search.user_email) return search.user_email;
  if (search.session_id) {
    const value = String(search.session_id);
    return `anon · ${value.slice(0, 10)}`;
  }
  return "unknown";
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusPill({ status }) {
  const normalized = String(status || "").toLowerCase();
  const styles =
    normalized === "completed"
      ? "bg-green-50 text-green-700"
      : normalized === "failed"
        ? "bg-red-50 text-red-700"
        : normalized.includes("warning")
          ? "bg-amber-50 text-amber-700"
          : "bg-slate-100 text-slate-500";

  return (
    <span
      className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${styles}`}
    >
      {status || "unknown"}
    </span>
  );
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = getAuthSession();
    if (!session?.accessToken && import.meta.env.PROD) {
      navigate("/", { replace: true });
      return;
    }

    fetchAdminStats()
      .then(setStats)
      .catch((err) => {
        const msg = String(err?.message || "");
        if (
          msg.includes("401") ||
          msg.includes("Missing") ||
          msg.includes("expired")
        ) {
          navigate("/", { replace: true });
        } else {
          setError(msg || "Failed to load dashboard");
        }
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  async function handleLogout() {
    await logoutUser();
    navigate("/", { replace: true });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-slate-900 font-extrabold text-xl mb-2">
            Access denied
          </div>
          <div className="text-slate-500 text-sm mb-6">{error}</div>
          <button
            onClick={() => navigate("/")}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (!stats?.kpis) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-slate-900 font-extrabold text-xl mb-2">
            Unexpected response
          </div>
          <div className="text-slate-500 text-sm mb-6">
            The server returned an unexpected response. Make sure the backend is
            running and restart it.
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const {
    kpis,
    latest_crawl,
    recent_crawl_runs,
    signups_by_day,
    searches_by_day,
    top_search_terms,
    recent_searches,
    recent_users,
  } = stats;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-extrabold text-slate-900 text-base">
              DesiDeals24
            </span>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[11px] font-bold uppercase tracking-wide">
              Admin
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KpiCard label="Total users" value={kpis.total_users} />
          <KpiCard label="New users (30d)" value={kpis.new_users_30d} />
          <KpiCard label="Searches today" value={kpis.searches_today} />
          <KpiCard
            label="Unique searchers (30d)"
            value={kpis.unique_searchers_30d}
          />
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400">
                Latest crawl
              </div>
              <div className="text-lg font-extrabold text-slate-900 mt-1">
                {latest_crawl?.crawl_date || "No crawl yet"}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Started {formatDateTime(latest_crawl?.started_at)}
              </div>
            </div>
            <StatusPill status={latest_crawl?.status || "unknown"} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Stores ok"
              value={latest_crawl?.stores_succeeded ?? 0}
            />
            <KpiCard
              label="Stores failed"
              value={latest_crawl?.stores_failed ?? 0}
            />
            <KpiCard
              label="Deals found"
              value={latest_crawl?.deals_found ?? 0}
            />
            <KpiCard
              label="Finished"
              value={latest_crawl?.finished_at ? "Yes" : "No"}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-6">
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-3">
                  Store crawl report
                </div>
                {!latest_crawl?.store_results?.length ? (
                  <div className="text-slate-300 text-sm py-4">
                    No crawl store results yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {latest_crawl.store_results.map((store) => (
                      <div
                        key={`${latest_crawl.id}-${store.store_id}`}
                        className="rounded-2xl border border-slate-100 px-4 py-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[14px] font-bold text-slate-800">
                              {store.store_name}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {store.store_url}
                            </div>
                          </div>
                          <StatusPill status={store.status} />
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                              Scraped
                            </div>
                            <div className="text-base font-extrabold text-slate-900">
                              {store.deals_scraped}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                              New
                            </div>
                            <div className="text-base font-extrabold text-slate-900">
                              {store.deals_inserted}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                              Changed
                            </div>
                            <div className="text-base font-extrabold text-slate-900">
                              {store.deals_updated}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                              Removed
                            </div>
                            <div className="text-base font-extrabold text-slate-900">
                              {store.deals_removed}
                            </div>
                          </div>
                          <div className="rounded-xl bg-slate-50 px-3 py-2">
                            <div className="text-[10px] uppercase font-bold tracking-wide text-slate-400">
                              History rows
                            </div>
                            <div className="text-base font-extrabold text-slate-900">
                              {store.history_rows_written}
                            </div>
                          </div>
                        </div>

                        {store.error_message ? (
                          <div className="mt-3 text-[12px] text-red-600 bg-red-50 rounded-xl px-3 py-2">
                            {store.error_message}
                          </div>
                        ) : null}

                        <div className="mt-3 flex flex-wrap gap-2">
                          {Object.entries(store.category_counts || {})
                            .slice(0, 10)
                            .map(([category, count]) => (
                              <span
                                key={`${store.store_id}-${category}`}
                                className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium"
                              >
                                {category} · {count}
                              </span>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-100 px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-3">
                  Category totals
                </div>
                {!latest_crawl?.category_totals?.length ? (
                  <div className="text-slate-300 text-sm">
                    No category data yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {latest_crawl.category_totals.slice(0, 12).map((row) => (
                      <div
                        key={row.category}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="text-slate-600">{row.category}</span>
                        <span className="font-extrabold text-[#16a34a]">
                          {row.count}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-100 px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-3">
                  Recent crawl runs
                </div>
                {!recent_crawl_runs?.length ? (
                  <div className="text-slate-300 text-sm">
                    No crawl history yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recent_crawl_runs.map((run) => (
                      <div
                        key={run.id}
                        className="flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-slate-700">
                            {run.crawl_date || "No date"}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {run.stores_succeeded}/{run.stores_attempted} stores
                            · {run.deals_found} deals
                          </div>
                        </div>
                        <StatusPill status={run.status} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
            <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
              Signups — last 30 days
            </div>
            <BarChart data={signups_by_day} />
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
            <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
              Searches — last 30 days
            </div>
            <BarChart data={searches_by_day} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
            <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
              Top search terms
            </div>
            {top_search_terms.length === 0 ? (
              <div className="text-slate-300 text-sm py-4">No searches yet</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] font-bold uppercase tracking-[1px] text-slate-400 border-b border-slate-100">
                    <th className="pb-2 pr-3">#</th>
                    <th className="pb-2 pr-3">Query</th>
                    <th className="pb-2 text-right">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {top_search_terms.map((term, i) => (
                    <tr
                      key={`${term.normalized_query}-${i}`}
                      className="border-b border-slate-50 last:border-0"
                    >
                      <td className="py-2.5 pr-3 text-slate-300 font-mono text-xs">
                        {i + 1}
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-700 text-[13px] truncate max-w-[240px]">
                          {term.query}
                        </div>
                        <div className="text-slate-400 text-[11px] truncate max-w-[240px]">
                          {term.unique_searchers} unique searchers
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-extrabold text-[#16a34a]">
                        {term.search_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
            <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
              Recent searches
            </div>
            {recent_searches.length === 0 ? (
              <div className="text-slate-300 text-sm py-4">No searches yet</div>
            ) : (
              <div className="space-y-3">
                {recent_searches.map((search, index) => (
                  <div
                    key={`${search.created_at}-${search.query}-${index}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-slate-700 truncate">
                        {search.query}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {formatActorLabel(search)}
                        {search.result_count != null
                          ? ` · ${search.result_count} results`
                          : ""}
                      </div>
                      {search.created_at && (
                        <div className="text-[10px] text-slate-300 mt-0.5">
                          {new Date(search.created_at).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500">
                      Search
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-6 py-5">
          <div className="text-[11px] font-bold uppercase tracking-[1.2px] text-slate-400 mb-4">
            Recent users
          </div>
          {recent_users.length === 0 ? (
            <div className="text-slate-300 text-sm py-4">No users yet</div>
          ) : (
            <div className="space-y-3">
              {recent_users.map((user) => (
                <div
                  key={user.email}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-slate-700 truncate">
                      {user.name || user.email.split("@")[0]}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {user.email}
                    </div>
                    {user.created_at && (
                      <div className="text-[10px] text-slate-300 mt-0.5">
                        Joined{" "}
                        {new Date(user.created_at).toLocaleString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                      user.email_verified
                        ? "bg-green-50 text-green-700"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {user.email_verified ? "Verified" : "Signed up"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
