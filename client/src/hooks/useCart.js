import { useState, useCallback } from "react";

const CART_KEY = "dd24_cart_v1";

function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
}

export function useCart() {
  const [items, setItems] = useState(readCart);

  const addItem = useCallback((item) => {
    setItems(prev => {
      const key = item.canonical_id || item.raw_item_text.toLowerCase().trim();
      const exists = prev.find(i =>
        (item.canonical_id && i.canonical_id === item.canonical_id) ||
        i.raw_item_text.toLowerCase().trim() === key
      );
      const next = exists
        ? prev.map(i => (i === exists ? { ...i, item_count: (i.item_count || 1) + 1 } : i))
        : [...prev, { ...item, item_count: item.item_count || 1 }];
      writeCart(next);
      return next;
    });
  }, []);

  const removeItem = useCallback((index) => {
    setItems(prev => {
      const next = prev.filter((_, i) => i !== index);
      writeCart(next);
      return next;
    });
  }, []);

  const updateItem = useCallback((index, patch) => {
    setItems(prev => {
      const next = prev.map((item, i) => (i === index ? { ...item, ...patch } : item));
      writeCart(next);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    localStorage.removeItem(CART_KEY);
    setItems([]);
  }, []);

  const setBrand = useCallback((canonicalId, brand, anyBrand) => {
    setItems(prev => {
      const next = prev.map(item =>
        item.canonical_id === canonicalId
          ? { ...item, brand: brand ?? null, anyBrand: anyBrand ?? false }
          : item
      );
      writeCart(next);
      return next;
    });
  }, []);

  return { items, addItem, removeItem, updateItem, clearCart, setBrand, count: items.length };
}
