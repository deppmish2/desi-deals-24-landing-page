import React, { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CartContext } from "../hooks/CartContext";
import {
  getAuthSession,
  createList,
  fetchLists,
  removeListItem,
  mergeCartIntoList,
} from "../utils/api";

export default function ListPage() {
  const { items: cartItems, clearCart } = useContext(CartContext);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const navigate = useNavigate();
  const session = getAuthSession();

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    fetchLists()
      .then(async (res) => {
        const data = res.ok ? await res.json() : null;
        if (data?.data?.length) setList(data.data[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleMergeCart() {
    if (!cartItems.length) return;
    setMerging(true);
    let target = list;
    if (!target) {
      const res = await createList("My Shopping List");
      const data = await res.json();
      target = data.data || data;
    }
    await mergeCartIntoList(target.id, cartItems);
    clearCart();
    const res = await fetchLists();
    const data = res.ok ? await res.json() : null;
    setList(data?.data?.[0] || target);
    setMerging(false);
  }

  async function handleRemove(itemId) {
    if (!list) return;
    await removeListItem(list.id, itemId);
    setList(l => ({ ...l, items: (l.items || []).filter(i => i.id !== itemId) }));
  }

  if (loading) return <div className="p-6 text-center text-gray-500">Loading…</div>;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-sm text-orange-600 hover:text-orange-700">← Back</button>
        <h1 className="text-2xl font-bold text-gray-900">Shopping List</h1>
      </div>

      {cartItems.length > 0 && (
        <div className="mb-6 bg-orange-50 rounded-2xl p-4 border border-orange-100">
          <p className="text-sm font-semibold text-orange-700 mb-2">
            {cartItems.length} item{cartItems.length > 1 ? "s" : ""} in your cart
          </p>
          <ul className="space-y-1 mb-3">
            {cartItems.map((item, i) => (
              <li key={i} className="text-sm text-gray-700 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-orange-200 text-orange-700 text-xs flex items-center justify-center font-bold">{item.item_count || 1}</span>
                {item.raw_item_text}
                {item.quantity ? <span className="text-gray-400 text-xs">{item.quantity}{item.quantity_unit || ""}</span> : null}
              </li>
            ))}
          </ul>
          {session ? (
            <button
              onClick={handleMergeCart}
              disabled={merging}
              className="bg-orange-500 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {merging ? "Saving…" : "Save to my list"}
            </button>
          ) : (
            <p className="text-sm text-gray-600">
              <a href="/" className="text-orange-600 font-semibold">Sign in</a> to save your list and compare prices.
            </p>
          )}
        </div>
      )}

      {list ? (
        <>
          <p className="text-sm text-gray-400 mb-3">{(list.items || []).length} items saved</p>
          <ul className="space-y-2 mb-6">
            {(list.items || []).map(item => (
              <li key={item.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 shadow-sm">
                <span className="text-sm text-gray-800">
                  {item.raw_item_text}
                  {item.quantity ? <span className="text-gray-400 text-xs ml-1">{item.quantity}{item.quantity_unit || ""}</span> : null}
                </span>
                <button
                  onClick={() => handleRemove(item.id)}
                  className="text-gray-300 hover:text-red-400 text-xs ml-4 transition-colors"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          {(list.items || []).length > 0 && (
            <button
              onClick={() => navigate(`/list/${list.id}/compare`)}
              className="w-full bg-orange-500 text-white font-bold py-3.5 rounded-2xl hover:bg-orange-600 transition-colors text-base"
            >
              Compare prices across stores →
            </button>
          )}
        </>
      ) : session && cartItems.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No items yet. Add products from the deals page.</p>
      ) : null}
    </div>
  );
}
