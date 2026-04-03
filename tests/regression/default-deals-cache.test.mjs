import test from "node:test";
import assert from "node:assert/strict";

import {
  getBerlinDateKey,
  isDefaultDealsRequest,
} from "../../client/src/utils/defaultDealsCache.mjs";

test("isDefaultDealsRequest matches the default first-page live feed request", () => {
  assert.equal(
    isDefaultDealsRequest({
      page: 1,
      limit: 20,
      in_stock: "1",
    }),
    true,
  );
});

test("isDefaultDealsRequest rejects filtered, searched, or paginated requests", () => {
  assert.equal(
    isDefaultDealsRequest({
      page: 2,
      limit: 20,
      in_stock: "1",
    }),
    false,
  );
  assert.equal(
    isDefaultDealsRequest({
      page: 1,
      limit: 20,
      in_stock: "1",
      q: "rice",
    }),
    false,
  );
  assert.equal(
    isDefaultDealsRequest({
      page: 1,
      limit: 20,
      in_stock: "1",
      category: "Rice & Grains",
    }),
    false,
  );
});

test("getBerlinDateKey uses Europe/Berlin calendar date boundaries", () => {
  assert.equal(
    getBerlinDateKey(new Date("2026-01-15T22:30:00.000Z")),
    "2026-01-15",
  );
  assert.equal(
    getBerlinDateKey(new Date("2026-01-15T23:30:00.000Z")),
    "2026-01-16",
  );
});
