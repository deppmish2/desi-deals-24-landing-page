// Map<lowercase_alias_or_name, canonical_name> — populated once on app start
let _map = null;
let _promise = null;

export function loadBrands() {
  if (_promise) return _promise;
  _promise = fetch("/api/v1/catalog/known-brands")
    .then((r) => r.json())
    .then((json) => {
      _map = new Map();
      for (const { name, aliases } of json.data || []) {
        _map.set(name.toLowerCase(), name);
        for (const alias of aliases || []) {
          if (alias) _map.set(alias.toLowerCase(), name);
        }
      }
    })
    .catch(() => {});
  return _promise;
}

export function isBrandsLoaded() {
  return _map !== null;
}

export function matchBrand(candidate) {
  if (!_map || !candidate) return null;
  return _map.get(candidate.toLowerCase()) || null;
}
