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
    $img.attr("data-lazyloadsrc"),
    $img.attr("data-o_src"),
    $img.attr("data-large_image"),
    $img.attr("data-thumb"),
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

  const url = candidates.find(
    (candidate) =>
      candidate &&
      candidate.trim() !== "" &&
      !/^data:image\//i.test(candidate.trim()),
  );
  if (!url) return null;

  try {
    return new URL(url, baseUrl).toString();
  } catch {
    if (url.startsWith("//")) return `https:${url}`;
    return url;
  }
}

module.exports = { resolveImage };
