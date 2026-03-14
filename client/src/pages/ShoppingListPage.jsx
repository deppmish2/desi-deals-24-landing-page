import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  addListItem,
  createList,
  deleteList,
  deleteListItem,
  fetchDeals,
  fetchList,
  fetchLists,
  fetchSuggestions,
  getAuthSession,
  updateList,
  updateListItem,
} from "../utils/api";
import { formatPricePerKg } from "../utils/formatters";
import {
  SMART_LIST_SESSION_KEY,
  readSmartListSessionDrafts,
  writeSmartListSessionDrafts,
} from "../utils/smartListSession";

const DEFAULT_RAW_INPUT = "basmati rice, toor dal, garam masala";
const AUTO_LIST_PREFIX = "Smart List";
const HIDDEN_RECENT_SUGGESTIONS_KEY = "dd24_hidden_recent_suggestions_v1";
const SEARCH_SUGGESTION_LIMIT = 8;
const IMAGE_PLACEHOLDER =
  'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect fill="%23f1f5f9" width="200" height="200"/><text fill="%2394a3b8" font-size="48" text-anchor="middle" dominant-baseline="middle" x="100" y="100">🛒</text></svg>';
const MASS_VOL_UNITS = new Set(["kg", "g", "l", "ml"]);
const QUANTITY_UNIT_TOKEN_PATTERN =
  "(kg|kilo|kilos|gm|gms|g|gram|grams|l|litre|litres|liter|liters|ml|milliliter|milliliters|pcs?|pieces?|pack|packs|packet|packets)";
const QUANTITY_UNIT_RE = new RegExp(
  `(\\d+(?:[.,]\\d+)?)\\s*${QUANTITY_UNIT_TOKEN_PATTERN}\\b`,
  "i",
);

const CATEGORY_CONFIG = {
  rice: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["pcs", "g", "kg"],
  },
  dal: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["pcs", "g", "kg"],
  },
  eggs: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["pcs"],
  },
  masala: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["pcs", "g", "kg"],
  },
  flour: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["pcs", "g", "kg"],
  },
  oil: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["pcs", "ml", "l"],
  },
  beverage: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["pcs", "ml", "l"],
  },
  produce: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["g", "kg", "pcs"],
  },
  snack: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["g", "kg", "pcs"],
  },
  other: {
    defaultQuantity: "1",
    defaultUnit: "pcs",
    units: ["pcs", "g", "kg", "ml", "l"],
  },
};

function normalizeUnit(value) {
  const unit = String(value || "")
    .trim()
    .toLowerCase();
  if (!unit) return "";
  if (
    unit === "piece" ||
    unit === "pieces" ||
    unit === "pc" ||
    unit === "pcs"
  ) {
    return "pcs";
  }
  if (unit === "kilo" || unit === "kilos") return "kg";
  if (unit === "gm" || unit === "gms") return "g";
  if (unit === "gram" || unit === "grams") return "g";
  if (
    unit === "litre" ||
    unit === "litres" ||
    unit === "liter" ||
    unit === "liters"
  )
    return "l";
  if (unit === "milliliter" || unit === "milliliters") return "ml";
  if (unit === "packet" || unit === "packets") return "pack";
  if (unit === "packs") return "pack";
  return unit;
}

function getCategoryConfig(category) {
  return CATEGORY_CONFIG[category] || CATEGORY_CONFIG.other;
}

function detectItemCategory(rawItemText) {
  const text = String(rawItemText || "").toLowerCase();

  if (/\beggs?\b/.test(text)) return "eggs";
  if (
    /\b(rice|basmati|sona masoori|sona masuri|ponni|idli rice|parboiled)\b/.test(
      text,
    )
  ) {
    return "rice";
  }
  if (
    /\b(dal|dhal|lentil|toor|arhar|tuvar|moong|mung|urad|masoor|rajma|chana)\b/.test(
      text,
    )
  ) {
    return "dal";
  }
  if (/\b(masala|spice|powder|seasoning)\b/.test(text)) return "masala";
  if (/\b(atta|maida|besan|flour)\b/.test(text)) return "flour";
  if (/\b(oil|ghee)\b/.test(text)) return "oil";
  if (/\b(milk|juice|drink|tea|coffee)\b/.test(text)) return "beverage";
  if (
    /\b(potato|onion|tomato|vegetable|fruit|apple|banana|okra|spinach)\b/.test(
      text,
    )
  ) {
    return "produce";
  }
  if (/\b(snack|chips|namkeen|biscuit|cookie)\b/.test(text)) return "snack";
  return "other";
}

function parseRawQuantity(value) {
  const text = String(value || "")
    .trim()
    .replace(",", ".");
  if (!text) return "";
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(n);
}

function applyCategoryDefaults(item) {
  const rawItemText = String(item?.raw_item_text || "").trim();
  const category = detectItemCategory(rawItemText);
  const config = getCategoryConfig(category);
  const allowedUnits = config.units;

  let quantity = parseRawQuantity(item?.quantity);
  let quantityUnit = normalizeUnit(item?.quantity_unit);
  let hadInvalidUnit = false;

  if (quantityUnit && !allowedUnits.includes(quantityUnit)) {
    quantityUnit = "";
    hadInvalidUnit = true;
  }
  if (hadInvalidUnit) quantity = "";

  if (!quantity) quantity = config.defaultQuantity;
  if (!quantityUnit) quantityUnit = config.defaultUnit;

  // item_count = number of packs to buy (independent of pack size)
  const rawCount = Number(item?.item_count);
  const itemCount = Number.isFinite(rawCount) && rawCount >= 1 ? Math.round(rawCount) : 1;

  return {
    raw_item_text: rawItemText,
    quantity,
    quantity_unit: quantityUnit,
    item_count: itemCount,
    category,
  };
}

function normalizeSpokenQuantities(value) {
  const wordsToNumber = {
    half: "0.5",
    quarter: "0.25",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
    eleven: "11",
    twelve: "12",
    thirteen: "13",
    fourteen: "14",
    fifteen: "15",
    sixteen: "16",
    seventeen: "17",
    eighteen: "18",
    nineteen: "19",
    twenty: "20",
  };
  const pattern = new RegExp(
    `\\b(${Object.keys(wordsToNumber).join("|")})\\b(?=\\s*${QUANTITY_UNIT_TOKEN_PATTERN}\\b)`,
    "gi",
  );
  return String(value || "").replace(pattern, (match) => {
    const mapped = wordsToNumber[String(match || "").toLowerCase()];
    return mapped || match;
  });
}

function stripSpeechFiller(value) {
  let out = String(value || "").trim();
  const fillerStart = [
    /^(i\s+need\s+to\s+buy)\b[\s,:-]*/i,
    /^(i\s+want\s+to\s+buy)\b[\s,:-]*/i,
    /^(can\s+you\s+add)\b[\s,:-]*/i,
    /^(please\s+add)\b[\s,:-]*/i,
    /^(i\s+need|i\s+want|get\s+me|please|add|buy|get|need|some|the|for|and)\b[\s,:-]*/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of fillerStart) {
      const next = out.replace(re, "");
      if (next !== out) {
        out = next.trim();
        changed = true;
      }
    }
  }
  return out.replace(/^[,.;:\-]+|[,.;:\-]+$/g, "").trim();
}

function parseItemPhrase(value) {
  const text = normalizeSpokenQuantities(value).replace(/\s+/g, " ").trim();
  if (!text) return null;

  const quantityMatch = QUANTITY_UNIT_RE.exec(text);
  if (!quantityMatch) {
    return {
      itemName: stripSpeechFiller(text),
      quantity: "",
      unit: "",
    };
  }

  const quantity = parseRawQuantity(quantityMatch[1]);
  const unit = normalizeUnit(quantityMatch[2]);
  const before = text.slice(0, quantityMatch.index).trim();
  const after = text
    .slice(quantityMatch.index + quantityMatch[0].length)
    .trim();
  const itemName =
    stripSpeechFiller(`${before} ${after}`.trim()) || stripSpeechFiller(text);

  return { itemName, quantity, unit };
}

function parseDraftFromText(line) {
  const parsed = parseItemPhrase(line);
  if (!parsed) return null;
  const itemName = String(parsed.itemName || "").trim();
  if (!itemName) return null;
  return applyCategoryDefaults({
    raw_item_text: itemName,
    quantity: parsed.quantity,
    quantity_unit: parsed.unit,
  });
}

function parseDraftItems(rawInput) {
  return String(rawInput || "")
    .split(/[\n,;]+/)
    .map((line) => parseDraftFromText(line))
    .filter(Boolean);
}

function extractItemName(rawText) {
  const parsed = parseItemPhrase(rawText);
  return String(parsed?.itemName || "").trim();
}

function toNullableQuantity(value) {
  const parsed = parseRawQuantity(value);
  if (!parsed) return null;
  return Number(parsed);
}

function buildRawInputFromDrafts(drafts) {
  return (Array.isArray(drafts) ? drafts : [])
    .map((item) => {
      const text = extractItemName(item?.raw_item_text);
      return text || "";
    })
    .filter(Boolean)
    .join(", ");
}

function normalizeVoiceTranscript(text) {
  const cleaned = normalizeSpokenQuantities(text).replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .replace(/\s+(and|plus|then|also)\s+/gi, ", ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/,+/g, ",")
    .replace(/^,\s*|\s*,$/g, "");
}

function readHiddenRecentSuggestionKeys() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIDDEN_RECENT_SUGGESTIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => normalizeItemKey(value)).filter(Boolean);
  } catch {
    return [];
  }
}

function joinVoiceIntoQuery(base, spoken) {
  const b = String(base || "").trim();
  const s = String(spoken || "").trim();
  if (!b) return s;
  if (!s) return b;
  if (b.endsWith(",")) return `${b} ${s}`.trim();
  return `${b}, ${s}`;
}

function quantityStepForUnit(_unit) {
  return 1;
}

function normalizeItemKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toProxyImageUrl(imageUrl) {
  if (!imageUrl) return IMAGE_PLACEHOLDER;
  return imageUrl;
}

function normalizeFuzzySearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/([aeiou])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function consonantKey(value) {
  return normalizeFuzzySearchText(value).replace(/[aeiou]/g, "");
}

function fuzzyIncludes(query, candidate) {
  const q = normalizeFuzzySearchText(query);
  const c = normalizeFuzzySearchText(candidate);
  if (!q) return true;
  if (!c) return false;
  if (c.includes(q) || q.includes(c)) return true;

  const qKey = consonantKey(q);
  const cKey = consonantKey(c);
  if (qKey && cKey && (cKey.includes(qKey) || qKey.includes(cKey))) return true;

  const qTokens = q.split(/\s+/).filter(Boolean);
  const cTokens = c.split(/\s+/).filter(Boolean);
  if (qTokens.length === 0 || cTokens.length === 0) return false;
  const matchedTokens = qTokens.filter((qt) =>
    cTokens.some((ct) => ct.includes(qt) || qt.includes(ct)),
  ).length;
  return matchedTokens >= Math.max(1, Math.ceil(qTokens.length * 0.6));
}

function normalizeProductMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBestDealMatchForItem(queryText, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const q = normalizeProductMatchText(queryText);
  if (!q) return rows[0];
  const qTokens = q.split(" ").filter(Boolean);

  let bestRow = null;
  let bestScore = -Infinity;

  for (const row of rows) {
    const name = normalizeProductMatchText(row?.product_name);
    if (!name) continue;

    let score = 0;
    if (name === q) {
      score += 1000;
    } else {
      if (
        name.startsWith(`${q} `) ||
        name.endsWith(` ${q}`) ||
        name.includes(` ${q} `)
      ) {
        score += 700;
      } else if (name.includes(q)) {
        score += 420;
      }

      const tokenMatches = qTokens.filter((token) =>
        name.includes(token),
      ).length;
      score += tokenMatches * 40;
      if (qTokens.length > 0 && tokenMatches === qTokens.length) score += 160;

      const lengthGap = Math.abs(name.length - q.length);
      score -= Math.min(120, lengthGap);
    }

    const availability = String(row?.availability || "").toLowerCase();
    if (availability === "in_stock") score += 8;

    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  return bestRow || rows[0];
}

function buildDealMetaString(pricingHint) {
  if (!pricingHint) return null;
  const weightRaw = String(pricingHint?.weight_raw || "").trim();
  const hasPricePerKg =
    Number.isFinite(Number(pricingHint?.price_per_kg)) &&
    Number(pricingHint.price_per_kg) > 0;

  const weightValue = Number(pricingHint?.weight_value);
  const weightUnit = normalizeUnit(pricingHint?.weight_unit);
  const compactWeight =
    weightRaw ||
    (Number.isFinite(weightValue) && weightValue > 0 && weightUnit
      ? `${Number.isInteger(weightValue) ? String(weightValue) : String(Number(weightValue.toFixed(3)))}${weightUnit}`
      : "");

  if (compactWeight && hasPricePerKg) {
    return `${compactWeight} | ${formatPricePerKg(Number(pricingHint.price_per_kg))}`;
  }
  if (compactWeight) return compactWeight;
  if (hasPricePerKg) return formatPricePerKg(Number(pricingHint.price_per_kg));
  return null;
}

function parseWeightFromDealMeta(metaText) {
  const text = String(metaText || "");
  if (!text) return null;
  // Handle "N x Munit" bundle pattern (e.g. "2 x 5kg" → 10kg)
  const bundleMatch = text.match(/(\d+)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (bundleMatch) {
    const count = Number(bundleMatch[1]);
    const packVal = Number(String(bundleMatch[2]).replace(",", "."));
    const unit = normalizeUnit(bundleMatch[3]);
    if (count > 0 && Number.isFinite(packVal) && packVal > 0 && unit) {
      return { value: count * packVal, unit };
    }
  }
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (!match) return null;
  const value = Number(String(match[1]).replace(",", "."));
  const unit = normalizeUnit(match[2]);
  if (!Number.isFinite(value) || value <= 0 || !unit) return null;
  return { value, unit };
}

function buildDraftMetaLabel(pricingHint) {
  const baseMeta = buildDealMetaString(pricingHint);
  return baseMeta || null;
}

function deriveRequestedQuantityFromDealMeta(item, pricingHint) {
  const baseMeta = buildDealMetaString(pricingHint);
  if (!baseMeta) return null;

  const leftPart = String(baseMeta).split("|")[0].trim();
  if (!leftPart || leftPart.includes("/") || leftPart.includes("€")) {
    return null;
  }

  const parsed = parseWeightFromDealMeta(leftPart);
  if (!parsed) return null;

  // Return per-pack size only. Backend multiplies by item_count to get total target.
  return {
    quantity: parsed.value,
    quantity_unit: parsed.unit,
  };
}

function readSessionDrafts() {
  if (typeof window === "undefined") return null;
  if (window.sessionStorage.getItem(SMART_LIST_SESSION_KEY) == null) {
    return null;
  }
  const drafts = readSmartListSessionDrafts();
  return drafts.map((item) =>
    applyCategoryDefaults({
      raw_item_text: extractItemName(item?.raw_item_text),
      quantity: item?.quantity,
      quantity_unit: item?.quantity_unit,
      item_count: item?.item_count ?? 1,
    }),
  );
}

function initialDraftsForSession() {
  const sessionDrafts = readSessionDrafts();
  if (sessionDrafts !== null) return sessionDrafts;
  return parseDraftItems(DEFAULT_RAW_INPUT);
}

function draftsFromListItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) =>
      applyCategoryDefaults({
        raw_item_text: extractItemName(item?.raw_item_text),
        quantity: item?.quantity,
        quantity_unit: item?.quantity_unit,
        item_count: item?.item_count ?? 1,
      }),
    )
    .filter((item) => String(item?.raw_item_text || "").trim());
}

export default function ShoppingListPage() {
  const navigate = useNavigate();
  const session = getAuthSession();
  const isLoggedIn = Boolean(session?.accessToken);
  const initialDrafts = React.useMemo(() => initialDraftsForSession(), []);
  const [name, setName] = useState("");
  const [rawInput, setRawInput] = useState(() =>
    buildRawInputFromDrafts(initialDrafts),
  );
  const [inputMethod, setInputMethod] = useState("text");
  const [error, setError] = useState("");
  const [quantityNotice, setQuantityNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewItems, setPreviewItems] = useState([]);
  const [itemDrafts, setItemDrafts] = useState(() => initialDrafts);
  const [lists, setLists] = useState([]);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deletingListId, setDeletingListId] = useState(null);
  const [selectedBulkListIds, setSelectedBulkListIds] = useState([]);
  const [editingListId, setEditingListId] = useState(null);
  const [itemQuery, setItemQuery] = useState("");
  const [recentSuggestions, setRecentSuggestions] = useState([]);
  const [frequentSuggestions, setFrequentSuggestions] = useState([]);
  const [historySuggestionsLoading, setHistorySuggestionsLoading] =
    useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [searchSuggestionsLoading, setSearchSuggestionsLoading] =
    useState(false);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [activeSearchSuggestionIndex, setActiveSearchSuggestionIndex] =
    useState(-1);
  const [showAllSuggestionChips, setShowAllSuggestionChips] = useState(false);
  const [hiddenRecentSuggestionKeys, setHiddenRecentSuggestionKeys] = useState(
    () => readHiddenRecentSuggestionKeys(),
  );
  const [saveSuccess, setSaveSuccess] = useState("");
  const [selectedListId, setSelectedListId] = useState(null);
  const [selectedListDetail, setSelectedListDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [pricingHintsByItem, setPricingHintsByItem] = useState({});
  const [suggestionImagesByItem, setSuggestionImagesByItem] = useState({});
  const recognitionRef = React.useRef(null);
  const finalVoiceTranscriptRef = React.useRef("");
  const interimVoiceTranscriptRef = React.useRef("");
  const voiceBaseQueryRef = React.useRef("");
  const mobileSearchRef = React.useRef(null);
  const desktopSearchRef = React.useRef(null);

  React.useEffect(() => {
    fetchLists()
      .then((res) => setLists(res?.data || []))
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        HIDDEN_RECENT_SUGGESTIONS_KEY,
        JSON.stringify(hiddenRecentSuggestionKeys),
      );
    } catch {
      // no-op
    }
  }, [hiddenRecentSuggestionKeys]);

  React.useEffect(() => {
    let cancelled = false;
    async function buildUserSuggestions() {
      setHistorySuggestionsLoading(true);
      if (!Array.isArray(lists) || lists.length === 0) {
        setRecentSuggestions([]);
        setFrequentSuggestions([]);
        setHistorySuggestionsLoading(false);
        return;
      }

      const sorted = [...lists]
        .sort(
          (a, b) =>
            new Date(b?.last_used_at || b?.created_at || 0).getTime() -
            new Date(a?.last_used_at || a?.created_at || 0).getTime(),
        )
        .slice(0, 10);

      const details = await Promise.all(
        sorted.map((list) => fetchList(list.id).catch(() => null)),
      );
      if (cancelled) return;
      const hiddenSet = new Set(hiddenRecentSuggestionKeys);

      const recents = [];
      const counts = new Map();
      for (const detail of details) {
        const items = Array.isArray(detail?.items) ? detail.items : [];
        for (const item of items) {
          const text = extractItemName(item?.raw_item_text);
          if (!text) continue;
          const key = normalizeItemKey(text);
          if (hiddenSet.has(key)) continue;
          if (!recents.includes(text)) recents.push(text);
          counts.set(text, (counts.get(text) || 0) + 1);
        }
      }

      const frequent = Array.from(counts.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);

      setRecentSuggestions(recents.slice(0, 12));
      setFrequentSuggestions(frequent.slice(0, 12));
      setHistorySuggestionsLoading(false);
    }

    buildUserSuggestions().catch(() => {
      if (cancelled) return;
      setRecentSuggestions([]);
      setFrequentSuggestions([]);
      setHistorySuggestionsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [lists, hiddenRecentSuggestionKeys]);

  React.useEffect(() => {
    let cancelled = false;
    const query = String(itemQuery || "").trim();
    if (query.length < 2) {
      setSearchSuggestions([]);
      setSearchSuggestionsLoading(false);
      setSearchDropdownOpen(false);
      setActiveSearchSuggestionIndex(-1);
      return () => {};
    }

    setSearchSuggestionsLoading(true);
    const timeoutId = setTimeout(() => {
      fetchSuggestions(query)
        .then((res) => {
          if (cancelled) return;
          const values = (
            Array.isArray(res?.suggestions) ? res.suggestions : []
          )
            .map((item) => String(item || "").trim())
            .filter(Boolean);
          setSearchSuggestions(values.slice(0, SEARCH_SUGGESTION_LIMIT));
          setSearchDropdownOpen(true);
          setActiveSearchSuggestionIndex(-1);
        })
        .catch(() => {
          if (!cancelled) {
            setSearchSuggestions([]);
            setSearchDropdownOpen(true);
            setActiveSearchSuggestionIndex(-1);
          }
        })
        .finally(() => {
          if (!cancelled) setSearchSuggestionsLoading(false);
        });
    }, 70);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [itemQuery]);

  React.useEffect(() => {
    function handleOutsideSearchClick(event) {
      const target = event.target;
      if (
        mobileSearchRef.current?.contains(target) ||
        desktopSearchRef.current?.contains(target)
      ) {
        return;
      }
      setSearchDropdownOpen(false);
      setActiveSearchSuggestionIndex(-1);
    }
    document.addEventListener("mousedown", handleOutsideSearchClick);
    return () =>
      document.removeEventListener("mousedown", handleOutsideSearchClick);
  }, []);

  React.useEffect(() => {
    setItemDrafts((previous) => {
      const parsed = parseDraftItems(rawInput);
      return parsed.map((nextItem, index) => {
        const byIndex = previous[index];
        if (
          byIndex &&
          byIndex.raw_item_text.toLowerCase() ===
            nextItem.raw_item_text.toLowerCase()
        ) {
          return applyCategoryDefaults({
            ...nextItem,
            quantity: byIndex.quantity ?? nextItem.quantity,
            quantity_unit: byIndex.quantity_unit || nextItem.quantity_unit,
            item_count: byIndex.item_count ?? nextItem.item_count ?? 1,
          });
        }

        const byText = previous.find(
          (item) =>
            item.raw_item_text.toLowerCase() ===
            nextItem.raw_item_text.toLowerCase(),
        );
        if (!byText) return nextItem;

        return applyCategoryDefaults({
          ...nextItem,
          quantity: byText.quantity ?? nextItem.quantity,
          quantity_unit: byText.quantity_unit || nextItem.quantity_unit,
          item_count: byText.item_count ?? nextItem.item_count ?? 1,
        });
      });
    });
  }, [rawInput]);

  React.useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      if (recognition) recognition.stop();
      recognitionRef.current = null;
    },
    [],
  );

  React.useEffect(() => {
    writeSmartListSessionDrafts(itemDrafts);
  }, [itemDrafts]);

  const pricingLookupEntries = React.useMemo(() => {
    const seen = new Set();
    const entries = [];
    for (const item of itemDrafts) {
      const queryText = extractItemName(item?.raw_item_text);
      const itemKey = normalizeItemKey(queryText);
      if (!itemKey || seen.has(itemKey)) continue;
      seen.add(itemKey);
      entries.push({ itemKey, queryText });
    }
    return entries;
  }, [itemDrafts]);

  React.useEffect(() => {
    let cancelled = false;

    if (pricingLookupEntries.length === 0) {
      setPricingHintsByItem({});
      return () => {};
    }

    async function loadPricingHints() {
      const pairs = await Promise.all(
        pricingLookupEntries.map(async ({ itemKey, queryText }) => {
          try {
            const res = await fetchDeals({
              q: queryText,
              availability: "all",
              sort: "discount_desc",
              limit: 24,
            });
            const rows = Array.isArray(res?.data) ? res.data : [];
            const matched = pickBestDealMatchForItem(queryText, rows);
            if (!matched) return [itemKey, null];
            return [
              itemKey,
              {
                sale_price: matched.sale_price,
                weight_raw: matched.weight_raw || null,
                weight_value: matched.weight_value,
                weight_unit: matched.weight_unit,
                price_per_kg: matched.price_per_kg,
                currency: matched.currency,
                image_url: matched.image_url || null,
              },
            ];
          } catch {
            return [itemKey, null];
          }
        }),
      );

      if (cancelled) return;

      const next = {};
      for (const [itemKey, hint] of pairs) next[itemKey] = hint;
      setPricingHintsByItem(next);
    }

    loadPricingHints().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pricingLookupEntries]);

  React.useEffect(() => {
    let cancelled = false;
    const names = [];
    const seen = new Set();

    for (const value of [...recentSuggestions, ...frequentSuggestions]) {
      const text = extractItemName(value);
      const key = normalizeItemKey(text);
      if (!text || seen.has(key)) continue;
      seen.add(key);
      names.push(text);
      if (names.length >= 18) break;
    }

    if (names.length === 0) {
      setSuggestionImagesByItem({});
      return () => {};
    }

    async function loadSuggestionImages() {
      const pairs = await Promise.all(
        names.map(async (name) => {
          const key = normalizeItemKey(name);
          try {
            const res = await fetchDeals({
              q: name,
              availability: "all",
              sort: "discount_desc",
              limit: 24,
            });
            const rows = Array.isArray(res?.data) ? res.data : [];
            const matched = pickBestDealMatchForItem(name, rows);
            return [key, matched?.image_url || null];
          } catch {
            return [key, null];
          }
        }),
      );
      if (cancelled) return;
      const next = {};
      for (const [key, imageUrl] of pairs) {
        next[key] = imageUrl;
      }
      setSuggestionImagesByItem(next);
    }

    loadSuggestionImages().catch(() => {
      if (!cancelled) setSuggestionImagesByItem({});
    });
    return () => {
      cancelled = true;
    };
  }, [recentSuggestions, frequentSuggestions]);

  async function handleSelectList(listId) {
    if (selectedListId === listId) {
      setSelectedListId(null);
      setSelectedListDetail(null);
      setDetailError("");
      return;
    }
    setSelectedListId(listId);
    setSelectedListDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const res = await fetchList(listId);
      setSelectedListDetail(res);
    } catch (err) {
      setDetailError(err.message || "Failed to load list details");
    } finally {
      setDetailLoading(false);
    }
  }

  function startVoiceCapture() {
    const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Speech) {
      setError("Voice capture is not supported in this browser.");
      return;
    }

    if (recording && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    setError("");
    const recognition = new Speech();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    finalVoiceTranscriptRef.current = "";
    interimVoiceTranscriptRef.current = "";
    voiceBaseQueryRef.current = String(itemQuery || "").trim();
    setRecording(true);

    recognition.onresult = (event) => {
      const finals = [];
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = String(result?.[0]?.transcript || "").trim();
        if (!transcript) continue;
        if (result.isFinal) finals.push(transcript);
        else interim = transcript;
      }

      if (finals.length > 0) {
        finalVoiceTranscriptRef.current =
          `${finalVoiceTranscriptRef.current} ${finals.join(" ")}`.trim();
      }
      interimVoiceTranscriptRef.current = interim;

      const merged =
        `${finalVoiceTranscriptRef.current} ${interimVoiceTranscriptRef.current}`.trim();
      const transcript = normalizeVoiceTranscript(merged);
      setItemQuery(joinVoiceIntoQuery(voiceBaseQueryRef.current, transcript));
    };

    recognition.onerror = (event) => {
      if (event?.error === "aborted") return;
      if (event?.error === "no-speech") {
        setError("No speech detected. Try again and speak clearly.");
        return;
      }
      if (event?.error === "not-allowed") {
        setError(
          "Microphone permission denied. Please allow microphone access.",
        );
        return;
      }
      setError("Voice input failed. Please try again.");
    };

    recognition.onend = () => {
      const recognitionInstance = recognitionRef.current;
      if (recognitionInstance === recognition) recognitionRef.current = null;
      setRecording(false);

      const merged =
        `${finalVoiceTranscriptRef.current} ${interimVoiceTranscriptRef.current}`.trim();
      finalVoiceTranscriptRef.current = "";
      interimVoiceTranscriptRef.current = "";
      const transcript = normalizeVoiceTranscript(merged);
      voiceBaseQueryRef.current = "";
      if (!transcript) return;
      setItemQuery(
        (previous) =>
          String(previous || "").trim() || joinVoiceIntoQuery("", transcript),
      );
    };

    recognition.start();
  }

  function findExistingListByName() {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) return null;
    return (
      lists.find(
        (l) =>
          String(l.name || "")
            .trim()
            .toLowerCase() === trimmed,
      ) || null
    );
  }

  function clearListSelectionState(listId) {
    if (!listId) return;
    if (selectedListId === listId) {
      setSelectedListId(null);
      setSelectedListDetail(null);
      setDetailError("");
    }
    if (editingListId === listId) {
      setEditingListId(null);
    }
    setSelectedBulkListIds((prev) => prev.filter((id) => id !== listId));
  }

  function toggleBulkSelection(listId) {
    setSelectedBulkListIds((prev) => {
      if (prev.includes(listId)) {
        return prev.filter((id) => id !== listId);
      }
      return [...prev, listId];
    });
  }

  function toggleSelectAllSavedLists() {
    setSelectedBulkListIds((prev) => {
      if (lists.length > 0 && prev.length === lists.length) return [];
      return lists.map((list) => list.id);
    });
  }

  function setDraftsAndSync(updater) {
    setItemDrafts((previous) => {
      const next =
        typeof updater === "function" ? updater(previous) : updater || [];
      setRawInput(buildRawInputFromDrafts(next));
      return next;
    });
  }

  function updateDraftItem(index, patch) {
    const nextPatch = { ...(patch || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, "raw_item_text")) {
      nextPatch.raw_item_text = extractItemName(nextPatch.raw_item_text);
    }
    setDraftsAndSync((previous) =>
      previous.map((item, itemIndex) =>
        itemIndex === index
          ? applyCategoryDefaults({ ...item, ...nextPatch })
          : item,
      ),
    );
  }

  function mergeDraftIntoList(previous, draft) {
    const text = extractItemName(draft?.raw_item_text);
    if (!text) return previous;

    const incoming = applyCategoryDefaults({ ...draft, raw_item_text: text });
    const existingIndex = previous.findIndex(
      (item) =>
        String(item.raw_item_text || "").toLowerCase() === text.toLowerCase(),
    );
    if (existingIndex < 0) return [incoming, ...previous];

    return previous.map((item, idx) => {
      if (idx !== existingIndex) return item;
      const unit = normalizeUnit(item.quantity_unit) || incoming.quantity_unit;
      const base = Number(item.quantity || 0);
      const increment =
        Number(incoming.quantity || 0) || quantityStepForUnit(unit);
      const nextQuantity = Math.max(1, base + increment);
      return applyCategoryDefaults({
        ...item,
        quantity:
          parseRawQuantity(String(nextQuantity)) || String(nextQuantity),
        quantity_unit: unit,
      });
    });
  }

  function addDraftsFromFreeText(value) {
    const parsed = parseDraftItems(value);
    if (parsed.length === 0) return;
    setDraftsAndSync((previous) => {
      let next = [...previous];
      for (const parsedDraft of parsed) {
        next = mergeDraftIntoList(next, parsedDraft);
      }
      return next;
    });
    setItemQuery("");
    setSearchSuggestions([]);
    setSearchDropdownOpen(false);
    setActiveSearchSuggestionIndex(-1);
  }

  function addDraftFromName(value) {
    addDraftsFromFreeText(String(value || "").trim());
  }

  function addDraftFromSearchSuggestion(suggestion) {
    const name = extractItemName(suggestion);
    if (!name) return;
    setInputMethod("text");
    addDraftFromName(name);
  }

  function handleSearchInputChange(value) {
    setItemQuery(value);
    if (String(value || "").trim().length < 2) {
      setSearchDropdownOpen(false);
      setActiveSearchSuggestionIndex(-1);
      return;
    }
    setSearchDropdownOpen(true);
    setActiveSearchSuggestionIndex(-1);
  }

  function handleSearchKeyDown(event) {
    if (event.key === "ArrowDown") {
      if (!searchDropdownOpen && searchSuggestions.length > 0) {
        setSearchDropdownOpen(true);
      }
      if (searchSuggestions.length > 0) {
        event.preventDefault();
        setActiveSearchSuggestionIndex((prev) =>
          Math.min(prev + 1, searchSuggestions.length - 1),
        );
      }
      return;
    }
    if (event.key === "ArrowUp") {
      if (searchSuggestions.length > 0) {
        event.preventDefault();
        setActiveSearchSuggestionIndex((prev) => Math.max(prev - 1, 0));
      }
      return;
    }
    if (event.key === "Escape") {
      setSearchDropdownOpen(false);
      setActiveSearchSuggestionIndex(-1);
      return;
    }
    if (event.key !== "Enter") return;

    event.preventDefault();
    setInputMethod("text");
    if (
      searchDropdownOpen &&
      activeSearchSuggestionIndex >= 0 &&
      searchSuggestions[activeSearchSuggestionIndex]
    ) {
      addDraftFromSearchSuggestion(
        searchSuggestions[activeSearchSuggestionIndex],
      );
      return;
    }
    addDraftsFromFreeText(itemQuery);
  }

  function removeRecentSuggestion(value) {
    const key = normalizeItemKey(value);
    if (!key) return;
    setHiddenRecentSuggestionKeys((previous) => {
      if (previous.includes(key)) return previous;
      return [...previous, key];
    });
    setRecentSuggestions((previous) =>
      previous.filter((item) => normalizeItemKey(item) !== key),
    );
    setFrequentSuggestions((previous) =>
      previous.filter((item) => normalizeItemKey(item) !== key),
    );
  }

  function removeDraftByIndex(index) {
    setDraftsAndSync((previous) =>
      previous.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  function bumpDraftQuantity(index, direction) {
    setDraftsAndSync((previous) =>
      previous.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const current = Math.max(1, Number(item.item_count) || 1);
        const nextValue = direction > 0 ? current + 1 : Math.max(1, current - 1);
        if (direction < 0 && current <= 1) {
          setQuantityNotice("Quantity must be at least 1.");
        } else {
          setQuantityNotice("");
        }
        return { ...item, item_count: nextValue };
      }),
    );
  }

  function handleDraftQuantityInputChange(index, rawValue) {
    const raw = String(rawValue ?? "").trim();
    if (!raw) {
      setQuantityNotice("");
      updateDraftItem(index, { item_count: 1 });
      return;
    }

    const n = Math.round(Number(raw.replace(",", ".")));
    if (!Number.isFinite(n)) return;
    if (n <= 0) {
      setQuantityNotice("Quantity must be at least 1.");
      return;
    }

    setQuantityNotice("");
    updateDraftItem(index, { item_count: n });
  }

  function getPrioritizedSuggestions() {
    const out = [];
    const seen = new Set();

    const pushWithTag = (values, tag) => {
      for (const value of values) {
        const text = extractItemName(value);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ name: text, tag });
      }
    };

    pushWithTag(recentSuggestions, "Recent");
    pushWithTag(frequentSuggestions, "Frequent");
    return out.slice(0, 12);
  }

  function buildDesiredItemsFromDrafts() {
    return itemDrafts
      .map((item) => {
        const rawItemText = extractItemName(item?.raw_item_text);
        if (!rawItemText) return null;
        const draftCount = Math.max(1, Number(item?.item_count) || 1);

        // Use pricing hint to get correct per-pack weight (handles "2 x 5kg" → 10kg).
        // Backend multiplies per-pack weight × item_count to get total target.
        const pricingHint =
          pricingHintsByItem[normalizeItemKey(rawItemText)] || null;
        const hintSize = deriveRequestedQuantityFromDealMeta(item, pricingHint);

        if (hintSize?.quantity != null) {
          return {
            raw_item_text: rawItemText,
            quantity: hintSize.quantity,
            quantity_unit: hintSize.quantity_unit,
            item_count: draftCount,
          };
        }

        // No hint available: pass exactly what the user set, no auto-changes.
        return {
          raw_item_text: rawItemText,
          quantity: toNullableQuantity(item?.quantity),
          quantity_unit: normalizeUnit(item?.quantity_unit) || null,
          item_count: draftCount,
        };
      })
      .filter(Boolean);
  }

  async function fetchPricingHintForItem(queryText) {
    const text = String(queryText || "").trim();
    if (!text) return null;
    try {
      const res = await fetchDeals({
        q: text,
        availability: "all",
        sort: "discount_desc",
        limit: 24,
      });
      const rows = Array.isArray(res?.data) ? res.data : [];
      const matched = pickBestDealMatchForItem(text, rows);
      if (!matched) return null;
      return {
        sale_price: matched.sale_price,
        weight_raw: matched.weight_raw || null,
        weight_value: matched.weight_value,
        weight_unit: matched.weight_unit,
        price_per_kg: matched.price_per_kg,
        currency: matched.currency,
        image_url: matched.image_url || null,
      };
    } catch {
      return null;
    }
  }

  async function buildDesiredItemsForPersistence() {
    return itemDrafts
      .map((item) => {
        const rawItemText = extractItemName(item?.raw_item_text);
        if (!rawItemText) return null;
        const draftCount = Math.max(1, Number(item?.item_count) || 1);

        const pricingHint =
          pricingHintsByItem[normalizeItemKey(rawItemText)] || null;
        const hintSize = deriveRequestedQuantityFromDealMeta(item, pricingHint);

        if (hintSize?.quantity != null) {
          return {
            raw_item_text: rawItemText,
            quantity: hintSize.quantity,
            quantity_unit: hintSize.quantity_unit,
            item_count: draftCount,
          };
        }

        return {
          raw_item_text: rawItemText,
          quantity: toNullableQuantity(item?.quantity),
          quantity_unit: normalizeUnit(item?.quantity_unit) || null,
          item_count: draftCount,
        };
      })
      .filter(Boolean);
  }

  function clearAllDrafts() {
    setDraftsAndSync([]);
    setItemQuery("");
    setSearchSuggestions([]);
    setSearchDropdownOpen(false);
    setActiveSearchSuggestionIndex(-1);
    setError("");
    setQuantityNotice("");
    setSaveSuccess("");
  }

  function hasDraftItems() {
    return buildDesiredItemsFromDrafts().length > 0;
  }

  function sameListItemShape(existing, desired) {
    const existingText = String(existing?.raw_item_text || "").trim();
    const desiredText = String(desired?.raw_item_text || "").trim();
    const existingQty =
      existing?.quantity == null ? null : Number(existing.quantity);
    const desiredQty =
      desired?.quantity == null ? null : Number(desired.quantity);
    const existingUnit = normalizeUnit(existing?.quantity_unit) || null;
    const desiredUnit = normalizeUnit(desired?.quantity_unit) || null;
    const existingCount = Math.max(1, Number(existing?.item_count) || 1);
    const desiredCount = Math.max(1, Number(desired?.item_count) || 1);

    return (
      existingText === desiredText &&
      existingQty === desiredQty &&
      existingUnit === desiredUnit &&
      existingCount === desiredCount
    );
  }

  async function saveIntoExistingList(listId, trimmedName) {
    const desiredItems = await buildDesiredItemsForPersistence();
    const normalizedRawInput =
      buildRawInputFromDrafts(itemDrafts) || String(rawInput || "").trim();

    await updateList(listId, {
      name: trimmedName,
      raw_input: normalizedRawInput,
      input_method: inputMethod,
    });

    const current = await fetchList(listId);
    const existingItems = Array.isArray(current?.items) ? current.items : [];
    const commonLen = Math.min(existingItems.length, desiredItems.length);

    for (let index = 0; index < commonLen; index += 1) {
      const existingItem = existingItems[index];
      const desiredItem = desiredItems[index];
      if (!existingItem?.id || sameListItemShape(existingItem, desiredItem)) {
        continue;
      }
      await updateListItem(listId, existingItem.id, {
        raw_item_text: desiredItem.raw_item_text,
        quantity: desiredItem.quantity,
        quantity_unit: desiredItem.quantity_unit,
        item_count: desiredItem.item_count ?? 1,
      });
    }

    for (let index = commonLen; index < desiredItems.length; index += 1) {
      const desiredItem = desiredItems[index];
      await addListItem(listId, {
        raw_item_text: desiredItem.raw_item_text,
        quantity: desiredItem.quantity,
        quantity_unit: desiredItem.quantity_unit,
        item_count: desiredItem.item_count ?? 1,
      });
    }

    for (let index = commonLen; index < existingItems.length; index += 1) {
      const existingItem = existingItems[index];
      if (!existingItem?.id) continue;
      await deleteListItem(listId, existingItem.id);
    }

    const refreshed = await fetchList(listId);
    return {
      data: refreshed?.data || null,
      items: Array.isArray(refreshed?.items) ? refreshed.items : [],
      mode: "updated",
    };
  }

  async function saveCurrentListWithNamePolicy() {
    const trimmedName =
      name.trim() ||
      `${AUTO_LIST_PREFIX} ${new Date()
        .toISOString()
        .slice(0, 16)
        .replace("T", " ")}`;
    const normalizedRawInput =
      buildRawInputFromDrafts(itemDrafts) || String(rawInput || "").trim();
    const desiredItems = await buildDesiredItemsForPersistence();

    const created = await createList({
      name: trimmedName,
      raw_input: normalizedRawInput,
      input_method: inputMethod,
      items: desiredItems,
    });
    const listId = created?.data?.id || null;
    const items = await applyDraftSettings(listId, created?.items || []);
    return {
      data: created?.data || null,
      items,
      mode: "created",
    };
  }

  async function applyDraftSettings(listId, createdItems) {
    if (!listId || !Array.isArray(createdItems) || createdItems.length === 0) {
      return Array.isArray(createdItems) ? createdItems : [];
    }

    const desiredItems = await buildDesiredItemsForPersistence();
    const merged = [...createdItems];
    const updates = [];

    for (let index = 0; index < createdItems.length; index += 1) {
      const createdItem = createdItems[index];
      const desiredItem = desiredItems[index];
      if (!createdItem?.id || !desiredItem) continue;

      const nextQuantity =
        desiredItem.quantity == null ? null : Number(desiredItem.quantity);
      const nextUnit = normalizeUnit(desiredItem.quantity_unit) || null;
      const nextCount = Math.max(1, Number(desiredItem.item_count) || 1);
      const currentQuantity =
        createdItem.quantity == null ? null : Number(createdItem.quantity);
      const currentUnit = normalizeUnit(createdItem.quantity_unit) || null;
      const currentCount = Math.max(1, Number(createdItem.item_count) || 1);

      if (nextQuantity === currentQuantity && nextUnit === currentUnit && nextCount === currentCount) {
        continue;
      }

      updates.push(
        updateListItem(listId, createdItem.id, {
          quantity: nextQuantity,
          quantity_unit: nextUnit,
          item_count: nextCount,
        }).then((res) => ({
          index,
          item: res?.data || null,
        })),
      );
    }

    if (updates.length === 0) return merged;

    const results = await Promise.allSettled(updates);
    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { index, item } = result.value || {};
      if (item && Number.isInteger(index)) merged[index] = item;
    }
    return merged;
  }

  async function handleSaveList() {
    setError("");
    setSaveSuccess("");
    if (!hasDraftItems()) {
      setError("Add at least one item before saving.");
      return;
    }

    setSaving(true);
    try {
      const trimmedName = name.trim();
      const res = await saveCurrentListWithNamePolicy();
      const listId = res?.data?.id || null;
      const items = res?.items || [];
      setPreviewItems(items);
      const next = await fetchLists().catch(() => null);
      if (next?.data) setLists(next.data);
      if (res?.mode === "updated") {
        setEditingListId(listId || null);
        setSelectedListId(listId || null);
        if (listId) {
          const detail = await fetchList(listId).catch(() => null);
          if (detail) setSelectedListDetail(detail);
        }
        setSaveSuccess(`List "${trimmedName}" updated successfully.`);
      } else {
        setEditingListId(null);
        setSaveSuccess(`List "${trimmedName}" saved successfully.`);
      }
    } catch (err) {
      if ((err.message || "").toLowerCase().includes("access token")) {
        navigate("/login");
        return;
      }
      setError(err.message || "Failed to save list");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSavedList(list) {
    const listId = list?.id;
    if (!listId) return;

    const listName = String(list?.name || "this list");
    const confirmed = window.confirm(
      `Delete "${listName}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    setError("");
    setSaveSuccess("");
    setDeletingListId(listId);
    try {
      await deleteList(listId);
      clearListSelectionState(listId);
      const next = await fetchLists();
      setLists(next?.data || []);
      setSaveSuccess(`List "${listName}" removed successfully.`);
    } catch (err) {
      if ((err.message || "").toLowerCase().includes("access token")) {
        navigate("/login");
        return;
      }
      setError(err.message || "Failed to remove list");
    } finally {
      setDeletingListId(null);
    }
  }

  async function handleBulkDeleteSavedLists() {
    const ids = selectedBulkListIds.filter(Boolean);
    if (ids.length === 0) return;

    const confirmed = window.confirm(
      `Delete ${ids.length} selected list(s)? This cannot be undone.`,
    );
    if (!confirmed) return;

    setError("");
    setSaveSuccess("");
    setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => deleteList(id)));
      let removedCount = 0;
      let failedCount = 0;
      for (const result of results) {
        if (result.status === "fulfilled") removedCount += 1;
        else failedCount += 1;
      }

      for (const id of ids) clearListSelectionState(id);
      setSelectedBulkListIds([]);
      const next = await fetchLists();
      setLists(next?.data || []);

      if (removedCount > 0) {
        setSaveSuccess(`Removed ${removedCount} list(s) successfully.`);
      }
      if (failedCount > 0) {
        setError(`Failed to remove ${failedCount} list(s).`);
      }
    } catch (err) {
      if ((err.message || "").toLowerCase().includes("access token")) {
        navigate("/login");
        return;
      }
      setError(err.message || "Failed to remove selected lists");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleEditSavedList(list) {
    const listId = list?.id;
    if (!listId) return;

    setError("");
    setSaveSuccess("");
    try {
      const detail =
        selectedListId === listId && selectedListDetail
          ? selectedListDetail
          : await fetchList(listId);
      const listName = String(
        detail?.data?.name || list?.name || "Saved list",
      ).trim();
      const nextRawInput =
        String(detail?.data?.raw_input || "").trim() ||
        (Array.isArray(detail?.items)
          ? detail.items
              .map((item) => String(item.raw_item_text || "").trim())
              .filter(Boolean)
              .join(", ")
          : "");
      const nextDrafts = Array.isArray(detail?.items)
        ? draftsFromListItems(detail.items)
        : parseDraftItems(nextRawInput || DEFAULT_RAW_INPUT);

      setName(listName || "Weekly Shop");
      setItemDrafts(nextDrafts);
      setRawInput(buildRawInputFromDrafts(nextDrafts) || DEFAULT_RAW_INPUT);
      setInputMethod(String(detail?.data?.input_method || "text"));
      setEditingListId(listId);
      setSelectedListId(listId);
      setSelectedListDetail(detail);
      setPreviewItems(Array.isArray(detail?.items) ? detail.items : []);
      setSaveSuccess(
        `Loaded "${listName}" into editor. Click "Save Shopping List" to update it.`,
      );
    } catch (err) {
      if ((err.message || "").toLowerCase().includes("access token")) {
        navigate("/login");
        return;
      }
      setError(err.message || "Failed to load list for editing");
    }
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setSaveSuccess("");
    if (!hasDraftItems()) {
      setError("Add at least one item before finding prices.");
      return;
    }
    setSubmitting(true);

    try {
      const res = await saveCurrentListWithNamePolicy();
      const list = res?.data;
      const items = res?.items || [];
      setPreviewItems(items);

      if (list?.id) {
        fetchLists()
          .then((next) => setLists(next?.data || []))
          .catch(() => {});
        if (res?.mode === "updated") setEditingListId(list.id);
        else setEditingListId(null);
        // Pass derived item quantities via navigation state so the compare
        // page can include them in the recommend call even if DB save raced.
        const derivedItems = await buildDesiredItemsForPersistence();
        navigate(`/list/compare`, { state: { listId: list.id, items: derivedItems } });
      }
    } catch (err) {
      if ((err.message || "").toLowerCase().includes("access token")) {
        navigate("/login");
        return;
      }
      setError(err.message || "Failed to create list");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <p style={{ fontSize: 40, marginBottom: 16 }}>🔒</p>
        <h1 className="text-xl font-bold text-near-black mb-2">
          Login required
        </h1>
        <p className="text-sm text-text-secondary mb-6">
          You need to be logged in to save and search shopping lists.
        </p>
        <div className="flex justify-center gap-3">
          <Link to="/login" className="btn-primary">
            Login
          </Link>
          <Link to="/register" className="btn-outline">
            Create account
          </Link>
        </div>
      </div>
    );
  }

  const prioritizedSuggestions = getPrioritizedSuggestions();
  const suggestionChips = showAllSuggestionChips
    ? prioritizedSuggestions
    : prioritizedSuggestions.slice(0, 6);
  const queryForDropdown = String(itemQuery || "").trim();
  const showSearchDropdown = searchDropdownOpen && queryForDropdown.length >= 2;

  function historySuggestionImage(name) {
    const key = normalizeItemKey(name);
    return toProxyImageUrl(suggestionImagesByItem[key] || null);
  }

  const SearchSuggestionDropdown = ({ className = "" }) =>
    showSearchDropdown ? (
      <div
        className={`absolute left-0 right-0 top-full mt-2 bg-white border border-[#e2e8f0] rounded-[16px] shadow-lg z-50 overflow-hidden ${className}`}
      >
        {searchSuggestionsLoading ? (
          <p className="px-4 py-3 text-sm text-[#64748b]">Loading items...</p>
        ) : searchSuggestions.length === 0 ? (
          <p className="px-4 py-3 text-sm text-[#64748b]">
            No items found for "{queryForDropdown}".
          </p>
        ) : (
          <ul className="max-h-[320px] overflow-y-auto">
            {searchSuggestions.map((suggestion, index) => (
              <li
                key={`${suggestion}-${index}`}
                onMouseDown={() => addDraftFromSearchSuggestion(suggestion)}
                onMouseEnter={() => setActiveSearchSuggestionIndex(index)}
                className={`px-4 py-2.5 text-sm cursor-pointer ${
                  index === activeSearchSuggestionIndex
                    ? "bg-[#dcfce7] text-[#166534] font-medium"
                    : "text-[#334155] hover:bg-[#f8fafc]"
                }`}
              >
                {suggestion}
              </li>
            ))}
            <li
              onMouseDown={() => {
                setInputMethod("text");
                addDraftsFromFreeText(queryForDropdown);
              }}
              className="px-4 py-2 text-sm cursor-pointer text-[#16a34a] font-semibold border-t border-[#e2e8f0] hover:bg-[#f0fdf4]"
            >
              Add "{queryForDropdown}" as typed
            </li>
          </ul>
        )}
      </div>
    ) : null;

  const MicButton = ({ className = "" }) => (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-full ${recording ? "text-red-600" : "text-[#16a34a]"} ${className}`}
      onClick={() => {
        setInputMethod("voice");
        startVoiceCapture();
      }}
      aria-label={recording ? "Stop microphone" : "Start microphone"}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    </button>
  );

  const TrashIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );

  const BasketIcon = ({ size = 33 }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={Math.round(size * 0.88)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#94a3b8"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );

  const FindBestPricesIcon = () => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );

  return (
    <form onSubmit={onSubmit} className="min-h-screen bg-[#f8fdf9]">
      {/* ═══════════════════════════════════════════════════════
          MOBILE: Page-level header (hidden on sm+)
      ═══════════════════════════════════════════════════════ */}
      <div className="sm:hidden bg-white border-b border-[#f1f5f9] shadow-sm">
        <div className="flex items-center justify-between px-4 py-4">
          <Link
            to="/deals"
            className="p-2 rounded-full inline-flex items-center justify-center text-[#0f172a] hover:bg-[#f1f5f9]"
            aria-label="Back"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="22"
              viewBox="0 0 13 22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="11 1 1 11 11 21" />
            </svg>
          </Link>
          <h1 className="text-[20px] font-bold text-[#0f172a] tracking-[-0.5px]">
            Smart Shopping List
          </h1>
          <Link
            to="/profile"
            className="p-1 rounded-full inline-flex items-center justify-center text-[#0f172a] hover:bg-[#f1f5f9]"
            aria-label="Profile"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </Link>
        </div>
        {/* Mobile search bar */}
        <div className="px-4 pb-6">
          <div ref={mobileSearchRef} className="relative">
            <div className="relative flex items-center">
              <span className="absolute left-[19px] text-[#16a34a] pointer-events-none">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                value={itemQuery}
                onChange={(e) => handleSearchInputChange(e.target.value)}
                onFocus={() => {
                  if (String(itemQuery || "").trim().length >= 2) {
                    setSearchDropdownOpen(true);
                  }
                }}
                onKeyDown={handleSearchKeyDown}
                className="w-full bg-[#f8fafc] border border-[#f1f5f9] rounded-[12px] py-5 pl-[49px] pr-10 text-[16px] text-[#1e293b] placeholder:text-[#475569] outline-none"
                style={{ boxShadow: "inset 0px 2px 4px 1px rgba(0,0,0,0.05)" }}
                placeholder="Search items like toor dal, basmati rice ..."
              />
              <MicButton className="absolute right-4 p-1" />
            </div>
            <SearchSuggestionDropdown />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          DESKTOP: Two-column layout (hidden on mobile)
      ═══════════════════════════════════════════════════════ */}
      <div className="hidden sm:flex gap-8 items-start p-8 max-w-[1440px] mx-auto">
        {/* Left column: heading + search + current list */}
        <div className="flex-1 flex flex-col gap-6 min-w-0 overflow-clip pr-4">
          <div>
            <h1 className="text-[36px] font-black text-[#0f172a] tracking-[-0.9px] leading-[40px]">
              My Smart List
            </h1>
            <p className="mt-2 text-[18px] text-[#64748b] leading-[28px]">
              AI-powered grocery suggestions tailored for you.
            </p>
          </div>

          {/* Desktop search input */}
          <div ref={desktopSearchRef} className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#64748b] pointer-events-none">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              value={itemQuery}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              onFocus={() => {
                if (String(itemQuery || "").trim().length >= 2) {
                  setSearchDropdownOpen(true);
                }
              }}
              onKeyDown={handleSearchKeyDown}
              className="w-full bg-white rounded-[24px] py-5 pl-12 pr-4 text-[18px] text-[#1e293b] placeholder:text-[#94a3b8] outline-none"
              style={{
                boxShadow:
                  "0px 0px 0px 1px #e2e8f0, 0px 1px 2px rgba(0,0,0,0.05)",
              }}
              placeholder="Search items like toor dal, basmati rice ..."
            />
            <SearchSuggestionDropdown />
          </div>

          {/* Current List card */}
          <div
            className="bg-white rounded-[16px] flex flex-col"
            style={{
              boxShadow:
                "0px 0px 0px 1px #e2e8f0, 0px 20px 25px -5px rgba(0,0,0,0.1), 0px 8px 10px -6px rgba(0,0,0,0.1)",
              maxHeight: "calc(100vh - 220px)",
            }}
          >
            {/* Card header */}
            <div className="border-b border-[#f1f5f9] px-6 pt-6 pb-7 shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-[20px] font-black text-[#0f172a]">
                  Current List
                </h2>
                <div className="flex items-center gap-3">
                  {itemDrafts.length > 0 && (
                    <button
                      type="button"
                      onClick={clearAllDrafts}
                      className="text-[12px] font-bold text-[#94a3b8] hover:text-red-500"
                    >
                      Clear List
                    </button>
                  )}
                  <span className="bg-[rgba(22,163,74,0.2)] text-[#166534] text-[12px] font-bold px-2 py-[4px] rounded-full">
                    {itemDrafts.length} items
                  </span>
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto p-4">
              {itemDrafts.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  <div className="w-24 h-24 rounded-full bg-[#f1f5f9] flex items-center justify-center mb-4">
                    <BasketIcon size={40} />
                  </div>
                  <h3 className="text-[18px] font-bold text-[#0f172a] text-center mb-2">
                    Your list is empty
                  </h3>
                  <p className="text-[14px] text-[#64748b] text-center max-w-[292px] leading-[22.75px]">
                    Search or add items from your history to get started.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-4">
                  {itemDrafts.map((item, index) => {
                    const pricingHint =
                      pricingHintsByItem[
                        normalizeItemKey(item.raw_item_text)
                      ] || null;
                    const metaLabel = buildDraftMetaLabel(pricingHint);
                    return (
                      <li
                        key={`${item.raw_item_text}-${index}`}
                        className={`rounded-[24px] flex gap-4 items-start p-[18px] relative ${
                          index === 0
                            ? "bg-[rgba(22,163,74,0.05)] border-2 border-[rgba(22,163,74,0.3)]"
                            : "bg-[rgba(248,250,252,0.5)] border border-[#f1f5f9]"
                        }`}
                      >
                        {index === 0 && (
                          <span className="absolute -top-2 right-[-4px] bg-[#16a34a] text-white text-[10px] font-black tracking-[0.5px] uppercase px-2 py-[2px] rounded-full">
                            Just Added
                          </span>
                        )}
                        <img
                          src={toProxyImageUrl(pricingHint?.image_url)}
                          alt={item.raw_item_text}
                          className="w-16 h-16 rounded-[16px] bg-[#f8fafc] border border-[#f1f5f9] shadow-sm shrink-0 object-contain p-1"
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.src = IMAGE_PLACEHOLDER;
                          }}
                        />
                        <div className="flex-1 min-w-0 flex flex-col justify-between self-stretch">
                          <div>
                            <p className="text-[16px] font-bold text-[#0f172a] leading-[22px] break-words">
                              {item.raw_item_text}
                            </p>
                            <p className="text-[12px] text-[#64748b] leading-[16px] mt-0.5">
                              {metaLabel || "Price info unavailable"}
                            </p>
                          </div>
                          <div className="flex items-center justify-between pt-2">
                            <div
                              className="bg-white rounded-[16px] flex items-center p-1"
                              style={{ boxShadow: "0px 0px 0px 1px #e2e8f0" }}
                            >
                              <button
                                type="button"
                                onClick={() => bumpDraftQuantity(index, -1)}
                                className="w-6 h-6 flex items-center justify-center rounded-[8px] hover:bg-[#f1f5f9]"
                                aria-label={`Decrease ${item.raw_item_text}`}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="9"
                                  height="2"
                                  viewBox="0 0 10 2"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                >
                                  <line x1="1" y1="1" x2="9" y2="1" />
                                </svg>
                              </button>
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={item.item_count || 1}
                                onChange={(e) =>
                                  handleDraftQuantityInputChange(
                                    index,
                                    e.target.value,
                                  )
                                }
                                className="w-8 text-center text-[14px] font-bold text-[#0f172a] bg-transparent outline-none"
                                aria-label={`Quantity for ${item.raw_item_text}`}
                              />
                              <button
                                type="button"
                                onClick={() => bumpDraftQuantity(index, 1)}
                                className="w-6 h-6 flex items-center justify-center rounded-[8px] hover:bg-[#f1f5f9]"
                                aria-label={`Increase ${item.raw_item_text}`}
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="9"
                                  height="9"
                                  viewBox="0 0 10 10"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                >
                                  <line x1="5" y1="1" x2="5" y2="9" />
                                  <line x1="1" y1="5" x2="9" y2="5" />
                                </svg>
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeDraftByIndex(index)}
                              className="flex items-center justify-center text-[#94a3b8] hover:text-red-500"
                              aria-label={`Delete ${item.raw_item_text}`}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            {quantityNotice && (
              <p className="px-6 pb-2 text-xs font-semibold text-amber-700">
                {quantityNotice}
              </p>
            )}

            {/* Card footer — CTA */}
            <div className="bg-[#f8fafc] border-t border-[#f1f5f9] px-6 py-6 shrink-0 flex flex-col gap-3">
              <button
                type="submit"
                disabled={submitting || saving || itemDrafts.length === 0}
                className={`w-full py-4 rounded-[24px] flex items-center justify-center gap-2 font-black text-[16px] transition-colors text-white ${
                  submitting || saving || itemDrafts.length === 0
                    ? "bg-[#e2e8f0]"
                    : "bg-[#16a34a]"
                }`}
                style={
                  itemDrafts.length > 0 && !submitting && !saving
                    ? {
                        boxShadow:
                          "0px 10px 15px -3px rgba(0,0,0,0.1), 0px 4px 6px -4px rgba(0,0,0,0.1)",
                      }
                    : {}
                }
              >
                <FindBestPricesIcon />
                <span>
                  {submitting ? "Finding best prices..." : "Find Best Prices"}
                </span>
              </button>
              <p className="text-[12px] font-medium text-[#94a3b8] text-center">
                Comparing 12 grocery stores
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {saveSuccess && (
            <p className="text-sm text-green-600">{saveSuccess}</p>
          )}
        </div>

        {/* Right aside — Recent & Frequent */}
        <aside className="w-[400px] shrink-0 flex flex-col gap-4 sticky top-4 max-h-[calc(100vh-100px)] overflow-y-auto pr-2">
          {/* Section header */}
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-[24px] font-bold text-[#0f172a] leading-[32px]">
                Recent & Frequent
              </h2>
              {prioritizedSuggestions.length > 0 && (
                <p className="text-[12px] font-semibold text-[#16a34a] tracking-[0.6px] uppercase mt-0.5">
                  Restock Mode Active
                </p>
              )}
            </div>
            {prioritizedSuggestions.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllSuggestionChips((p) => !p)}
                className="flex items-center gap-1 text-[14px] font-bold text-[#16a34a]"
              >
                {showAllSuggestionChips ? "Show Less" : "View All"}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="6"
                  height="10"
                  viewBox="0 0 6 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="1 1 5 5 1 9" />
                </svg>
              </button>
            )}
          </div>

          {historySuggestionsLoading ? (
            <p className="text-sm text-[#64748b] py-4">
              Loading suggestions...
            </p>
          ) : prioritizedSuggestions.length === 0 ? (
            <div className="border-2 border-dashed border-[#e2e8f0] rounded-[16px] flex flex-col items-center py-[50px] px-[18px]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="27"
                height="39"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#94a3b8"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <p className="mt-3 text-[16px] font-medium text-[#64748b] text-center leading-[24px] max-w-[280px]">
                No recent items yet. Your most frequent purchases will appear
                here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {suggestionChips.map((suggestion) => (
                <div
                  key={`${suggestion.tag}-${suggestion.name}`}
                  className="bg-white border border-[#f1f5f9] rounded-[24px] flex items-center gap-4 p-[13px]"
                >
                  <img
                    src={historySuggestionImage(suggestion.name)}
                    alt={suggestion.name}
                    className="w-14 h-14 rounded-[16px] bg-[#f8fafc] border border-[#f1f5f9] shrink-0 object-contain p-1"
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.src = IMAGE_PLACEHOLDER;
                    }}
                  />
                  <div className="flex-1 min-w-0 relative group/tip">
                    <p className="text-[16px] font-bold text-[#1e293b] leading-[24px] truncate">
                      {suggestion.name}
                    </p>
                    <div className="pointer-events-none absolute bottom-full left-0 mb-2 z-20 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
                      <div className="bg-[#1e293b] text-white text-[12px] font-medium px-2.5 py-1.5 rounded-[8px] shadow-lg max-w-[220px] leading-[1.4]">
                        {suggestion.name}
                      </div>
                      <div className="w-2 h-2 bg-[#1e293b] rotate-45 ml-3 -mt-1" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setInputMethod("text");
                      addDraftFromName(suggestion.name);
                    }}
                    className="w-8 h-8 flex items-center justify-center rounded-full border-2 border-[#16a34a] text-[#16a34a] shrink-0 hover:bg-[rgba(22,163,74,0.08)] transition-colors"
                    aria-label={`Add ${suggestion.name} to list`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* ═══════════════════════════════════════════════════════
          MOBILE: Scrollable content (hidden on sm+)
      ═══════════════════════════════════════════════════════ */}
      <div className="sm:hidden pb-[128px]">
        {/* Recent & Frequent card */}
        <div className="px-4 pt-4 pb-6">
          <div className="bg-white border border-[#f1f5f9] rounded-[16px] shadow-sm p-[17px] flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-[14px] font-semibold tracking-[0.7px] uppercase text-[#64748b]">
                Recent & Frequent
              </span>
              {prioritizedSuggestions.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllSuggestionChips((p) => !p)}
                  className="text-[12px] font-bold text-[#16a34a]"
                >
                  {showAllSuggestionChips ? "SHOW LESS" : "VIEW ALL"}
                </button>
              )}
            </div>

            {historySuggestionsLoading ? (
              <p className="text-xs text-[#64748b] text-center py-6">
                Loading suggestions...
              </p>
            ) : prioritizedSuggestions.length === 0 ? (
              <div className="border-2 border-dashed border-[#f1f5f9] rounded-[12px] bg-[rgba(248,250,252,0.5)] flex flex-col items-center py-[34px] px-6">
                <div className="mb-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                </div>
                <p className="text-[13px] text-[#64748b] text-center leading-[1.4] max-w-[188px]">
                  No recent items yet. Your most frequent purchases will appear
                  here.
                </p>
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {suggestionChips.map((suggestion) => (
                  <div
                    key={`${suggestion.tag}-${suggestion.name}`}
                    className="shrink-0 w-[144px] bg-[#f8fafc] border border-[#f1f5f9] rounded-[12px] shadow-sm p-[13px]"
                  >
                    <img
                      src={historySuggestionImage(suggestion.name)}
                      alt={suggestion.name}
                      className="w-full h-16 rounded-[10px] object-contain bg-white border border-[#f1f5f9] mb-2 p-1"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.src = IMAGE_PLACEHOLDER;
                      }}
                    />
                    <div className="relative group/tip">
                      <p className="text-[13px] font-medium text-[#334155] leading-[16.25px] w-full h-[40px] overflow-hidden line-clamp-2">
                        {suggestion.name}
                      </p>
                      <div className="pointer-events-none absolute bottom-full left-0 mb-2 z-20 opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
                        <div className="bg-[#1e293b] text-white text-[12px] font-medium px-2.5 py-1.5 rounded-[8px] whitespace-nowrap shadow-lg max-w-[200px] break-words">
                          {suggestion.name}
                        </div>
                        <div className="w-2 h-2 bg-[#1e293b] rotate-45 ml-3 -mt-1" />
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wide text-[#64748b] font-medium">
                        {suggestion.tag}
                      </span>
                      {suggestion.tag === "Recent" && (
                        <button
                          type="button"
                          onClick={() =>
                            removeRecentSuggestion(suggestion.name)
                          }
                          className="flex items-center justify-center text-[#94a3b8] hover:text-red-500"
                          aria-label={`Remove ${suggestion.name} from recent`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="8"
                            height="8"
                            viewBox="0 0 8 8"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          >
                            <line x1="1" y1="1" x2="7" y2="7" />
                            <line x1="7" y1="1" x2="1" y2="7" />
                          </svg>
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setInputMethod("text");
                        addDraftFromName(suggestion.name);
                      }}
                      className="mt-2 w-full flex items-center justify-center border-2 border-[#16a34a] text-[#16a34a] rounded-[20px] py-1.5 hover:bg-[rgba(22,163,74,0.06)] transition-colors"
                      aria-label={`Add ${suggestion.name} to list`}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.8"
                        strokeLinecap="round"
                      >
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Current List — rounded-top bottom sheet */}
        <div className="px-4">
          <div className="bg-white border-l border-r border-t border-[#f1f5f9] rounded-tl-[24px] rounded-tr-[24px] shadow-[0px_-4px_12px_0px_rgba(0,0,0,0.03)] p-[17px] pb-[22px] flex flex-col gap-6">
            <div className="flex items-center px-1">
              <h2 className="flex-1 text-[18px] font-bold text-[#0f172a] leading-[28px]">
                Current List ({itemDrafts.length} items)
              </h2>
              {itemDrafts.length > 0 && (
                <button
                  type="button"
                  className="text-[14px] font-medium text-[#ef4444] hover:underline"
                  onClick={clearAllDrafts}
                >
                  Clear All
                </button>
              )}
            </div>

            {itemDrafts.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-[273px]">
                <div className="w-20 h-20 rounded-full bg-[#f8fafc] flex items-center justify-center mb-4">
                  <BasketIcon size={33} />
                </div>
                <h3 className="text-[18px] font-semibold text-[#1e293b] text-center mb-2">
                  Your list is empty
                </h3>
                <p className="text-[14px] text-[#64748b] text-center leading-[22.75px] max-w-[242px]">
                  Add items from your recent history or search above to get
                  started.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-4">
                {itemDrafts.map((item, index) => {
                  const pricingHint =
                    pricingHintsByItem[normalizeItemKey(item.raw_item_text)] ||
                    null;
                  const metaLabel = buildDraftMetaLabel(pricingHint);
                  return (
                    <li
                      key={`${item.raw_item_text}-${index}`}
                      className="bg-[#f8fafc] border border-[#f1f5f9] rounded-[16px] p-[17px]"
                    >
                      <div className="flex gap-4 items-center">
                        <img
                          src={toProxyImageUrl(pricingHint?.image_url)}
                          alt={item.raw_item_text}
                          className="w-14 h-14 rounded-[12px] object-contain bg-white border border-[#f1f5f9] shrink-0 p-1"
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.src = IMAGE_PLACEHOLDER;
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          {index === 0 && (
                            <span className="bg-[#dcfce7] text-[#166534] text-[9px] font-bold tracking-[0.45px] uppercase px-2 py-[2px] rounded-[6px] mb-1 inline-block">
                              Just Added
                            </span>
                          )}
                          <p className="text-[15px] font-medium text-[#1e293b] leading-[20.63px] break-words">
                            {item.raw_item_text}
                          </p>
                          <p className="text-xs text-[#64748b] mt-0.5">
                            {metaLabel || "Price info unavailable"}
                          </p>
                        </div>
                        <div className="bg-white rounded-[12px] shadow-sm flex items-center p-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => bumpDraftQuantity(index, -1)}
                            className="w-8 h-8 flex items-center justify-center text-[#0f172a] hover:bg-[#f1f5f9] rounded-[8px]"
                            aria-label={`Decrease quantity for ${item.raw_item_text}`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="9"
                              height="2"
                              viewBox="0 0 10 2"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            >
                              <line x1="1" y1="1" x2="9" y2="1" />
                            </svg>
                          </button>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={item.item_count || 1}
                            onChange={(e) =>
                              handleDraftQuantityInputChange(
                                index,
                                e.target.value,
                              )
                            }
                            className="w-8 text-center text-[14px] font-bold text-[#0f172a] bg-transparent outline-none"
                            aria-label={`Quantity for ${item.raw_item_text}`}
                          />
                          <button
                            type="button"
                            onClick={() => bumpDraftQuantity(index, 1)}
                            className="w-8 h-8 flex items-center justify-center text-[#0f172a] hover:bg-[#f1f5f9] rounded-[8px]"
                            aria-label={`Increase quantity for ${item.raw_item_text}`}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="9"
                              height="9"
                              viewBox="0 0 10 10"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                            >
                              <line x1="5" y1="1" x2="5" y2="9" />
                              <line x1="1" y1="5" x2="9" y2="5" />
                            </svg>
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeDraftByIndex(index)}
                          className="flex items-center justify-center text-[#94a3b8] hover:text-red-500 shrink-0"
                          aria-label={`Delete ${item.raw_item_text}`}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {quantityNotice && (
              <p className="text-xs font-semibold text-amber-700">
                {quantityNotice}
              </p>
            )}

            <input type="hidden" value={rawInput} readOnly />
            {error && <p className="text-sm text-red-600">{error}</p>}
            {saveSuccess && (
              <p className="text-sm text-green-600">{saveSuccess}</p>
            )}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          MOBILE: Floating bottom navigation (hidden on sm+)
      ═══════════════════════════════════════════════════════ */}
      <div
        className="sm:hidden fixed bottom-0 left-0 right-0 flex flex-col gap-4 p-4"
        style={{
          background:
            "linear-gradient(to top, #f8fdf9 50%, rgba(248,253,249,0) 100%)",
        }}
      >
        <button
          type="submit"
          disabled={submitting || saving || itemDrafts.length === 0}
          className={`w-full py-4 rounded-[12px] flex items-center justify-center gap-2 font-bold text-[16px] transition-colors ${
            submitting || saving || itemDrafts.length === 0
              ? "bg-[#f1f5f9] text-[#94a3b8]"
              : "bg-[#16a34a] text-white"
          }`}
          style={
            itemDrafts.length > 0 && !submitting && !saving
              ? {
                  boxShadow:
                    "0px 10px 15px -3px rgba(22,163,74,0.3), 0px 4px 6px -4px rgba(22,163,74,0.3)",
                }
              : {}
          }
        >
          <FindBestPricesIcon />
          <span>
            {submitting ? "Finding best prices..." : "Find Best Prices"}
          </span>
        </button>

        <nav
          className="bg-white border border-[#f1f5f9] rounded-[16px] flex items-center justify-between px-[26px] py-3"
          style={{
            boxShadow:
              "0px 20px 25px -5px rgba(0,0,0,0.1), 0px 8px 10px -6px rgba(0,0,0,0.1)",
          }}
        >
          <Link to="/" className="flex flex-col items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#475569"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span className="text-[11px] text-[#475569]">Home</span>
          </Link>
          <Link to="/list" className="flex flex-col items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#475569"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span className="text-[11px] text-[#475569]">History</span>
          </Link>
          <Link to="/deals" className="flex flex-col items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#475569"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
            <span className="text-[11px] text-[#475569]">Deals</span>
          </Link>
          <Link to="/list" className="flex flex-col items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#16a34a"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <span className="text-[11px] font-bold text-[#16a34a]">
              Smart List
            </span>
          </Link>
        </nav>
      </div>
    </form>
  );
}
