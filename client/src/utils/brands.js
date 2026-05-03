// Map<lowercase_alias_or_name, canonical_name> — populated once on app start
let _map = null;

export async function loadBrands() {
  try {
    const res = await fetch("/api/v1/catalog/known-brands");
    const json = await res.json();
    _map = new Map();
    for (const { name, aliases } of json.data || []) {
      _map.set(name.toLowerCase(), name);
      for (const alias of aliases || []) {
        if (alias) _map.set(alias.toLowerCase(), name);
      }
    }
  } catch {
    // non-fatal — falls back to null (no brand detection)
  }
}

export function matchBrand(candidate) {
  if (!_map || !candidate) return null;
  return _map.get(candidate.toLowerCase()) || null;
}
