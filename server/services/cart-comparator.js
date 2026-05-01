"use strict";

/**
 * Compares a cart of canonical items across all stores.
 * Returns ranked store results with confirmed totals, coverage, and per-item status.
 *
 * @param {object} db    - db instance (async: .prepare().all/.get/.run return Promises)
 * @param {Array}  items - [{ canonical_id, quantity, any_brand }]
 * @returns {Promise<object>} { stores: [...], item_count: N }
 */
async function compareCart(db, items) {
  if (!items || items.length === 0) return { stores: [], item_count: 0 };

  const allStores = await db.prepare("SELECT id, name, url, platform FROM stores").all();
  const listingStmt = db.prepare(`
    SELECT sp.id, sp.product_name, sp.sale_price, sp.original_price,
           sp.discount_percent, sp.price_per_kg
    FROM store_product_mappings spm
    JOIN store_products sp ON sp.id = spm.deal_id
    WHERE spm.canonical_id = ?
      AND sp.store_id = ?
      AND sp.is_active = 1
    ORDER BY sp.sale_price ASC
    LIMIT 1
  `);

  const results = [];

  for (const store of allStores) {
    const storeItems = [];
    let confirmedTotal = 0;
    let availableCount = 0;

    for (const cartItem of items) {
      const qty = cartItem.quantity || 1;

      const listing = await listingStmt.get(cartItem.canonical_id, store.id);

      if (listing) {
        availableCount++;
        confirmedTotal += listing.sale_price * qty;
        storeItems.push({
          canonical_id: cartItem.canonical_id,
          name: listing.product_name,
          price: listing.sale_price,
          quantity: qty,
          store_product_id: listing.id,
          status: "confirmed",
        });
      } else {
        storeItems.push({
          canonical_id: cartItem.canonical_id,
          name: null,
          price: null,
          quantity: qty,
          store_product_id: null,
          status: "unavailable",
        });
      }
    }

    // Skip stores with no items available
    if (availableCount === 0) continue;

    const coveragePct = availableCount / items.length;

    results.push({
      store: { id: store.id, name: store.name },
      confirmed_total: Math.round(confirmedTotal * 100) / 100,
      estimated_total: null,
      shipping_cost: 0,
      coverage_pct: coveragePct,
      items: storeItems,
    });
  }

  // Sort by confirmed_total ascending
  results.sort((a, b) => a.confirmed_total - b.confirmed_total);

  return { stores: results, item_count: items.length };
}

module.exports = { compareCart };
