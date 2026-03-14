"use strict";

/**
 * Extract the best image URL from a Cheerio img element.
 * Priority: data-zoom-src → data-src → srcset (highest width) → src
 * Resolves relative paths against baseUrl if provided.
 */
function resolveImage($img, baseUrl) {
  if (!$img || !$img.length) return null;

  const candidates = [
    $img.attr("data-zoom-src"),
    $img.attr("data-src"),
    $img.attr("data-original"),
    $img.attr("data-lazy-src"),
  ];

  // srcset: pick the highest-width descriptor
  const srcset = $img.attr("srcset") || $img.attr("data-srcset");
  if (srcset) {
    const parts = srcset
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let best = null,
      bestW = 0;
    for (const part of parts) {
      const [url, descriptor] = part.split(/\s+/);
      const w = descriptor ? parseInt(descriptor) : 0;
      if (w > bestW) {
        bestW = w;
        best = url;
      }
    }
    if (best) candidates.push(best);
  }

  candidates.push($img.attr("src"));

  const url = candidates.find((c) => c && c.trim() !== "");
  if (!url) return null;

  // Resolve relative URLs
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/") && baseUrl) {
    try {
      const base = new URL(baseUrl);
      return `${base.protocol}//${base.host}${url}`;
    } catch {
      return url;
    }
  }
  return url;
}

module.exports = { resolveImage };
