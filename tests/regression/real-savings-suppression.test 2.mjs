import test from "node:test";
import assert from "node:assert/strict";

import realSavingsModule from "../../server/services/real-savings.js";

const { computeRealSavings } = realSavingsModule;

// Reference pool: €10/kg → any deal at €7/kg = 30% real savings
const HIST_30PCT = {
  reference_price_per_kg: 10.00,
  reference_source: "canonical_historical",
  observations: 5,
  canonical_id: "canon-test",
};

// Reference pool: €10/kg → deal at €8/kg = 20% real savings
const HIST_20PCT = {
  reference_price_per_kg: 10.00,
  reference_source: "canonical_historical",
  observations: 5,
  canonical_id: "canon-test",
};

function deal30pct(discountPct) {
  // price_per_kg=7 vs reference 10 → 30% real savings
  return {
    id: "deal-1",
    price_per_kg: 7.00,
    sale_price: 3.50,
    original_price: null,
    discount_percent: discountPct ?? null,
  };
}

function deal20pct(discountPct) {
  // price_per_kg=8 vs reference 10 → 20% real savings
  return {
    id: "deal-1",
    price_per_kg: 8.00,
    sale_price: 4.00,
    original_price: null,
    discount_percent: discountPct ?? null,
  };
}

// ── No store discount available — badge always shows if evidence is sufficient ─

test("shows badge when discount_percent is null (no comparison possible)", () => {
  const rs = computeRealSavings(deal30pct(null), HIST_30PCT);
  assert.notEqual(rs, null, "should show badge when no store discount available");
  assert.equal(rs.real_discount_pct, 30);
});

// ── Condition 2: suppress when real savings > store discount ─────────────────
// (real > store means our data thinks the deal is BETTER than the store claims,
//  which is suspicious and potentially misleading)

test("suppresses badge when real savings is greater than store discount", () => {
  // real = 30%, store = 20% → real > store → suppress
  const rs = computeRealSavings(deal30pct(20), HIST_30PCT);
  assert.equal(rs, null, "real (30) > store (20): should suppress");
});

test("suppresses badge when real savings greatly exceeds store discount", () => {
  // real = 30%, store = 5% → real >> store → suppress
  const rs = computeRealSavings(deal30pct(5), HIST_30PCT);
  assert.equal(rs, null, "real (30) >> store (5): should suppress");
});

test("suppresses badge when real savings > store discount even when gap = 5pp", () => {
  // real = 30%, store = 25% → real > store AND gap = 5pp → suppress via condition 2
  const rs = computeRealSavings(deal30pct(25), HIST_30PCT);
  assert.equal(rs, null, "real (30) > store (25): condition 2 suppresses even at 5pp gap");
});

// ── Condition 1: suppress when |real_savings − discount| < 5pp ──────────────
// (the badge adds no meaningful information if the numbers are nearly identical)

test("suppresses badge when gap between real and store discount is 0pp", () => {
  // real = 30%, store = 30% → gap = 0pp → suppress
  const rs = computeRealSavings(deal30pct(30), HIST_30PCT);
  assert.equal(rs, null, "gap = 0pp: should suppress");
});

test("suppresses badge when gap is < 5pp even when store overstates (real < store)", () => {
  // real = 30%, store = 34% → real < store, gap = 4pp → suppress via condition 1
  const rs = computeRealSavings(deal30pct(34), HIST_30PCT);
  assert.equal(rs, null, "real (30) < store (34) but gap only 4pp: should suppress");
});

test("suppresses badge when gap is 1pp", () => {
  // real = 30%, store = 31% → gap = 1pp → suppress
  const rs = computeRealSavings(deal30pct(31), HIST_30PCT);
  assert.equal(rs, null, "gap = 1pp: should suppress");
});

// ── Boundary at exactly 5pp gap ──────────────────────────────────────────────

test("shows badge when store discount > real savings by exactly 5pp", () => {
  // real = 30%, store = 35% → real < store, gap = 5pp → show
  const rs = computeRealSavings(deal30pct(35), HIST_30PCT);
  assert.notEqual(rs, null, "real (30) < store (35), gap = 5pp: should show");
  assert.equal(rs.real_discount_pct, 30);
});

test("shows badge when store discount > real savings by more than 5pp", () => {
  // real = 20%, store = 40% → real < store, gap = 20pp → show
  const rs = computeRealSavings(deal20pct(40), HIST_20PCT);
  assert.notEqual(rs, null, "real (20) < store (40), gap = 20pp: should show");
  assert.equal(rs.real_discount_pct, 20);
});

// ── Combined: both conditions clear → show ───────────────────────────────────

test("shows badge when real savings < store discount AND gap >= 5pp", () => {
  // real = 30%, store = 50% → real < store, gap = 20pp → show
  const rs = computeRealSavings(deal30pct(50), HIST_30PCT);
  assert.notEqual(rs, null, "real (30) < store (50): both conditions clear, show badge");
});

// ── Layer 2 (store_original) — same rules apply ──────────────────────────────

test("suppresses Layer 2 badge when real savings > store discount", () => {
  // original_price gives 30% savings; store states 10% → real (30) > store (10) → suppress
  const d = {
    id: "deal-l2",
    price_per_kg: null,
    sale_price: 7.00,
    original_price: 10.00,   // (10-7)/10 * 100 = 30%
    discount_percent: 10,
  };
  const rs = computeRealSavings(d, null);
  assert.equal(rs, null, "Layer 2: real (30) > store (10): should suppress");
});

test("suppresses Layer 2 badge when gap < 5pp", () => {
  // original_price gives 30%; store states 33% → real < store but gap = 3pp → suppress
  const d = {
    id: "deal-l2",
    price_per_kg: null,
    sale_price: 7.00,
    original_price: 10.00,   // 30%
    discount_percent: 33,
  };
  const rs = computeRealSavings(d, null);
  assert.equal(rs, null, "Layer 2: gap = 3pp: should suppress");
});

test("shows Layer 2 badge when real savings < store discount and gap >= 5pp", () => {
  // original_price gives 30%; store states 40% → real (30) < store (40), gap = 10pp → show
  const d = {
    id: "deal-l2",
    price_per_kg: null,
    sale_price: 7.00,
    original_price: 10.00,   // 30%
    discount_percent: 40,
  };
  const rs = computeRealSavings(d, null);
  assert.notEqual(rs, null, "Layer 2: real (30) < store (40), gap = 10pp: should show");
});
