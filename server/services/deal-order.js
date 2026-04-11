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

function getDealDiscount(deal) {
  return Number(deal?.discount_percent) || 0;
}

/**
 * Score a store candidate for placement at the current position.
 * Higher score = more preferred.
 */
function scoreStoreCandidate(
  storeId,
  totalDeals,
  position,
  totalPerStore,
  placedPerStore,
  remaining,
  storePriority,
) {
  const expectedPlaced =
    ((totalPerStore.get(storeId) || 0) / totalDeals) * position;
  const deficit = expectedPlaced - (placedPerStore.get(storeId) || 0);
  return {
    storeId,
    deficit,
    remaining,
    priority: storePriority.get(storeId) || 0,
  };
}

/**
 * Build diversified pages of deals with two guarantees for early pages:
 *   1. No single store occupies more than `maxStoreRatio` of a page.
 *   2. At least `qualityFloorRatio` of deals on the first `qualityPages` pages
 *      have `discount_percent > qualityMinDiscount`.
 *
 * Implementation uses separate quality / standard queues per store so that
 * quality consumption can be precisely controlled — avoiding both over-use
 * (starving later quality pages) and under-use (not hitting the floor).
 *
 * @param {Array}  deals
 * @param {number} pageSize
 * @param {number} seed        - Seeded RNG seed for reproducible shuffle
 * @param {object} [opts]
 * @param {number} [opts.maxStoreRatio=0.25]       - Max fraction of a page from one store
 * @param {number} [opts.qualityFloorRatio=0.40]   - Min fraction of quality deals per early page
 * @param {number} [opts.qualityMinDiscount=25]    - discount_percent threshold for "quality"
 * @param {number} [opts.qualityPages=2]           - Apply quality floor to first N pages
 */
function buildDiversifiedPages(deals, pageSize, seed, opts = {}) {
  const {
    maxStoreRatio = 0.25,
    qualityFloorRatio = 0.40,
    qualityMinDiscount = 25,
    qualityPages = 2,
  } = opts;

  const safeDeals = Array.isArray(deals) ? deals.filter(Boolean) : [];
  if (safeDeals.length === 0) {
    return {
      pages: [],
      enforcePageCap: false,
      relaxedAdjacencyUsed: false,
      relaxedCapUsed: false,
      maxPerStore: Math.max(1, Math.floor(pageSize * maxStoreRatio)),
      uniqueStoreCount: 0,
    };
  }

  // Per-store split queues: quality deals and standard deals kept separate.
  // This allows precise control over when quality deals are consumed vs held back.
  const qualityQueues = new Map();
  const standardQueues = new Map();
  const totalPerStore = new Map();

  for (const deal of safeDeals) {
    const storeId = getDealStoreId(deal) || "__unknown__";
    const isQual = getDealDiscount(deal) > qualityMinDiscount;
    const target = isQual ? qualityQueues : standardQueues;
    if (!target.has(storeId)) target.set(storeId, []);
    target.get(storeId).push(deal);
    totalPerStore.set(storeId, (totalPerStore.get(storeId) || 0) + 1);
  }

  const storeIds = [
    ...new Set([...qualityQueues.keys(), ...standardQueues.keys()]),
  ];

  function storeRemaining(storeId) {
    return (
      (qualityQueues.get(storeId)?.length || 0) +
      (standardQueues.get(storeId)?.length || 0)
    );
  }

  function storeHasQuality(storeId) {
    return (qualityQueues.get(storeId)?.length || 0) > 0;
  }

  function storeHasStandard(storeId) {
    return (standardQueues.get(storeId)?.length || 0) > 0;
  }

  /**
   * Pop a deal from a store.
   * @param {boolean} wantQuality - Draw from quality queue first if true
   */
  function popDeal(storeId, wantQuality) {
    if (wantQuality && storeHasQuality(storeId)) {
      return qualityQueues.get(storeId).shift();
    }
    if (storeHasStandard(storeId)) {
      return standardQueues.get(storeId).shift();
    }
    // Fallback: take quality even when not wanted (exhausted standard supply)
    return qualityQueues.get(storeId)?.shift() ?? null;
  }

  const maxPerStore = Math.max(1, Math.floor(pageSize * maxStoreRatio));
  const minStoresNeeded = Math.max(1, Math.ceil(pageSize / maxPerStore));
  const enforcePageCap = storeIds.length >= minStoresNeeded;
  const storePriority = new Map(
    seededShuffle(storeIds, seed).map((storeId, index) => [storeId, index]),
  );
  const perStoreLimit = enforcePageCap ? maxPerStore : Number.POSITIVE_INFINITY;
  const placedPerStore = new Map();
  const ordered = [];
  let currentPageCounts = new Map();
  let highQualityOnPage = 0;
  let relaxedAdjacencyUsed = false;
  let relaxedCapUsed = false;

  // Cap per-page quality target to available supply spread evenly across quality pages.
  // Prevents page 1 from consuming all quality deals when supply is limited.
  const qualityTarget = Math.ceil(pageSize * qualityFloorRatio);
  const totalQualityAvailable = safeDeals.filter(
    (d) => getDealDiscount(d) > qualityMinDiscount,
  ).length;
  const effectiveQualityTarget =
    qualityPages > 0
      ? Math.min(qualityTarget, Math.floor(totalQualityAvailable / qualityPages))
      : qualityTarget;

  while (ordered.length < safeDeals.length) {
    // Reset per-page counters at each page boundary
    if (ordered.length > 0 && ordered.length % pageSize === 0) {
      currentPageCounts = new Map();
      highQualityOnPage = 0;
    }

    const pageIndex = Math.floor(ordered.length / pageSize);
    const posOnPage = ordered.length % pageSize;
    const remainingOnPage = pageSize - posOnPage;
    const onQualityPage = pageIndex < qualityPages;
    const qualityNeeded = onQualityPage
      ? Math.max(0, effectiveQualityTarget - highQualityOnPage)
      : 0;
    // Must force a quality pick when remaining slots exactly equal quality still needed
    const mustTakeQuality = qualityNeeded > 0 && qualityNeeded >= remainingOnPage;
    const preferQuality = qualityNeeded > 0 && !mustTakeQuality;
    // Over-budget: page hit its quality cap and future quality pages still need their share
    const overQualityBudget =
      onQualityPage &&
      !preferQuality &&
      !mustTakeQuality &&
      highQualityOnPage >= effectiveQualityTarget &&
      pageIndex + 1 < qualityPages;

    const previousStoreId =
      ordered.length > 0
        ? getDealStoreId(ordered[ordered.length - 1]) || "__unknown__"
        : null;
    const position = ordered.length + 1;

    // Build candidate list with progressive relaxation
    let candidates = storeIds.filter((id) => {
      const pageCount = currentPageCounts.get(id) || 0;
      return storeRemaining(id) > 0 && id !== previousStoreId && pageCount < perStoreLimit;
    });

    if (candidates.length === 0) {
      candidates = storeIds.filter((id) => {
        const pageCount = currentPageCounts.get(id) || 0;
        return storeRemaining(id) > 0 && pageCount < perStoreLimit;
      });
      if (candidates.length > 0) relaxedAdjacencyUsed = true;
    }

    if (candidates.length === 0) {
      candidates = storeIds.filter(
        (id) => storeRemaining(id) > 0 && id !== previousStoreId,
      );
      if (candidates.length > 0) relaxedCapUsed = true;
    }

    if (candidates.length === 0) {
      candidates = storeIds.filter((id) => storeRemaining(id) > 0);
      if (candidates.length > 0) {
        relaxedAdjacencyUsed = true;
        relaxedCapUsed = true;
      }
    }

    if (candidates.length === 0) break;

    // When forced to take quality, narrow to stores that actually have quality deals.
    // Fall back to all candidates gracefully if quality supply is exhausted.
    if (mustTakeQuality) {
      const qualCandidates = candidates.filter(storeHasQuality);
      if (qualCandidates.length > 0) candidates = qualCandidates;
    }

    // When over quality budget, prefer stores with standard deals to reserve
    // quality deals for the next quality page. Fall back if all stores are quality-only.
    if (overQualityBudget) {
      const stdCandidates = candidates.filter(storeHasStandard);
      if (stdCandidates.length > 0) candidates = stdCandidates;
    }

    const wantQuality = mustTakeQuality || preferQuality;

    const scoredCandidates = candidates
      .map((storeId) => {
        const rem = storeRemaining(storeId);
        const base = scoreStoreCandidate(
          storeId,
          safeDeals.length,
          position,
          totalPerStore,
          placedPerStore,
          rem,
          storePriority,
        );
        // Quality bonus: when softly preferring quality, boost stores with quality available
        const qualityBonus =
          preferQuality && storeHasQuality(storeId) ? 1000 : 0;
        return { ...base, qualityBonus };
      })
      .sort((a, b) => {
        if (b.qualityBonus !== a.qualityBonus) return b.qualityBonus - a.qualityBonus;
        if (b.deficit !== a.deficit) return b.deficit - a.deficit;
        if (b.remaining !== a.remaining) return b.remaining - a.remaining;
        return a.priority - b.priority;
      });

    const selectedStoreId = scoredCandidates[0]?.storeId;
    if (!selectedStoreId) break;
    const selectedDeal = popDeal(selectedStoreId, wantQuality);
    if (!selectedDeal) break;

    ordered.push(selectedDeal);
    if (getDealDiscount(selectedDeal) > qualityMinDiscount) highQualityOnPage++;
    placedPerStore.set(selectedStoreId, (placedPerStore.get(selectedStoreId) || 0) + 1);
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

function buildStableDisplayOrder(deals, pageSize, seed, opts = {}) {
  return buildDiversifiedPages(deals, pageSize, seed, opts).pages.flat();
}

module.exports = {
  dateSeed,
  seededShuffle,
  getDealStoreId,
  buildDiversifiedPages,
  buildStableDisplayOrder,
};
