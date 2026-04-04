"use strict";

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return function () {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function dateSeed(dateStr) {
  let h = 2166136261;
  for (let i = 0; i < dateStr.length; i += 1) {
    h = Math.imul(h ^ dateStr.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function seededShuffle(arr, seed) {
  const copy = [...arr];
  const rand = seededRandom(seed);
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function getDealStoreId(deal) {
  return String(deal?.store?.id || deal?.store_id || "").trim();
}

function scoreStoreCandidate(
  storeId,
  totalDeals,
  position,
  totalPerStore,
  placedPerStore,
  queues,
  storePriority,
) {
  const expectedPlaced =
    ((totalPerStore.get(storeId) || 0) / totalDeals) * position;
  const deficit = expectedPlaced - (placedPerStore.get(storeId) || 0);
  return {
    storeId,
    deficit,
    remaining: queues.get(storeId)?.length || 0,
    priority: storePriority.get(storeId) || 0,
  };
}

function buildDiversifiedPages(deals, pageSize, seed) {
  const safeDeals = Array.isArray(deals) ? deals.filter(Boolean) : [];
  if (safeDeals.length === 0) {
    return {
      pages: [],
      enforcePageCap: false,
      relaxedAdjacencyUsed: false,
      relaxedCapUsed: false,
      maxPerStore: Math.max(1, Math.floor(pageSize * 0.2)),
      uniqueStoreCount: 0,
    };
  }

  const queues = new Map();
  const totalPerStore = new Map();
  for (const deal of safeDeals) {
    const storeId = getDealStoreId(deal) || "__unknown__";
    if (!queues.has(storeId)) queues.set(storeId, []);
    queues.get(storeId).push(deal);
    totalPerStore.set(storeId, (totalPerStore.get(storeId) || 0) + 1);
  }

  const storeIds = Array.from(queues.keys());
  const maxPerStore = Math.max(1, Math.floor(pageSize * 0.2));
  const minStoresNeeded = Math.max(1, Math.ceil(pageSize / maxPerStore));
  const enforcePageCap = storeIds.length >= minStoresNeeded;
  const storePriority = new Map(
    seededShuffle(storeIds, seed).map((storeId, index) => [storeId, index]),
  );
  const perStoreLimit = enforcePageCap ? maxPerStore : Number.POSITIVE_INFINITY;
  const placedPerStore = new Map();
  const ordered = [];
  let currentPageCounts = new Map();
  let relaxedAdjacencyUsed = false;
  let relaxedCapUsed = false;

  while (ordered.length < safeDeals.length) {
    if (ordered.length > 0 && ordered.length % pageSize === 0) {
      currentPageCounts = new Map();
    }

    const previousStoreId =
      ordered.length > 0
        ? getDealStoreId(ordered[ordered.length - 1]) || "__unknown__"
        : null;
    const position = ordered.length + 1;

    let candidates = storeIds.filter((storeId) => {
      const remaining = queues.get(storeId)?.length || 0;
      const pageCount = currentPageCounts.get(storeId) || 0;
      return (
        remaining > 0 &&
        storeId !== previousStoreId &&
        pageCount < perStoreLimit
      );
    });

    if (candidates.length === 0) {
      candidates = storeIds.filter((storeId) => {
        const remaining = queues.get(storeId)?.length || 0;
        const pageCount = currentPageCounts.get(storeId) || 0;
        return remaining > 0 && pageCount < perStoreLimit;
      });
      if (candidates.length > 0) relaxedAdjacencyUsed = true;
    }

    if (candidates.length === 0) {
      candidates = storeIds.filter((storeId) => {
        const remaining = queues.get(storeId)?.length || 0;
        return remaining > 0 && storeId !== previousStoreId;
      });
      if (candidates.length > 0) relaxedCapUsed = true;
    }

    if (candidates.length === 0) {
      candidates = storeIds.filter(
        (storeId) => (queues.get(storeId)?.length || 0) > 0,
      );
      if (candidates.length > 0) {
        relaxedAdjacencyUsed = true;
        relaxedCapUsed = true;
      }
    }

    if (candidates.length === 0) break;

    const scoredCandidates = candidates
      .map((storeId) =>
        scoreStoreCandidate(
          storeId,
          safeDeals.length,
          position,
          totalPerStore,
          placedPerStore,
          queues,
          storePriority,
        ),
      )
      .sort((a, b) => {
        if (b.deficit !== a.deficit) return b.deficit - a.deficit;
        if (b.remaining !== a.remaining) return b.remaining - a.remaining;
        return a.priority - b.priority;
      });

    const selectedStoreId = scoredCandidates[0]?.storeId;
    const selectedDeal = selectedStoreId
      ? queues.get(selectedStoreId)?.shift()
      : null;
    if (!selectedDeal) break;

    ordered.push(selectedDeal);
    placedPerStore.set(
      selectedStoreId,
      (placedPerStore.get(selectedStoreId) || 0) + 1,
    );
    currentPageCounts.set(
      selectedStoreId,
      (currentPageCounts.get(selectedStoreId) || 0) + 1,
    );
  }

  const orderedPages = [];
  for (let index = 0; index < ordered.length; index += pageSize) {
    orderedPages.push(ordered.slice(index, index + pageSize));
  }

  return {
    pages: orderedPages,
    enforcePageCap,
    relaxedAdjacencyUsed,
    relaxedCapUsed,
    maxPerStore,
    uniqueStoreCount: storeIds.length,
  };
}

function buildStableDisplayOrder(deals, pageSize, seed) {
  return buildDiversifiedPages(deals, pageSize, seed).pages.flat();
}

module.exports = {
  dateSeed,
  seededShuffle,
  getDealStoreId,
  buildDiversifiedPages,
  buildStableDisplayOrder,
};
