(function initialiseListingDetailsExtractor(root, factory) {
  const extractor = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = extractor;
  }

  root.ListingDetailsExtractor = extractor;
})(typeof globalThis === "object" ? globalThis : this, function createListingDetailsExtractor() {
  "use strict";

  const LIMITS = {
    fullDescriptionCharacters: 20000,
    imageCount: 20,
    urlCharacters: 4000,
    attributeCount: 40,
    attributeKeyCharacters: 80,
    attributeValueCharacters: 500,
    sellerNameCharacters: 240,
    listedAtTextCharacters: 240,
    maximumJsonNodes: 25000,
    maximumDepth: 30
  };

  const LISTING_ID_KEYS = new Set([
    "id",
    "listing_id",
    "listingId",
    "marketplace_listing_id"
  ]);
  const DESCRIPTION_KEYS = ["redacted_description", "description"];
  const PHOTO_KEYS = ["listing_photos", "listingPhotos", "photo_urls", "photos"];
  const ATTRIBUTE_KEYS = ["attribute_data", "vehicle_attributes", "vehicleAttributes", "vehicle_specs"];
  const SELLER_KEYS = ["marketplace_listing_seller", "marketplaceSeller", "seller"];
  const LISTED_AT_KEYS = ["listed_at_text", "listedAtText", "creation_time_text", "creationTimeText", "listing_date_text"];

  function decodeEntities(value) {
    return value
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;/gi, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }

  function normaliseText(value, maximumLength) {
    if (typeof value !== "string") return null;
    const text = decodeEntities(value).replace(/\r\n?/g, "\n").trim();
    return text ? text.slice(0, maximumLength) : null;
  }

  function textFromValue(value, maximumLength) {
    if (typeof value === "string") return normaliseText(value, maximumLength);
    if (typeof value === "number" || typeof value === "boolean") {
      return normaliseText(String(value), maximumLength);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    for (const key of ["text", "value", "display_value", "displayValue", "name"]) {
      const text = normaliseText(value[key], maximumLength);
      if (text) return text;
    }
    return null;
  }

  function isHttpUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && url.toString().length <= LIMITS.urlCharacters;
    } catch {
      return false;
    }
  }

  function isFacebookImageUrl(value) {
    if (!isHttpUrl(value)) return false;
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "fbcdn.net" || hostname.endsWith(".fbcdn.net");
  }

  function normaliseFacebookProfileUrl(value) {
    if (typeof value !== "string" || !isHttpUrl(value)) return null;
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "facebook.com" || hostname.endsWith(".facebook.com")
      ? url.toString()
      : null;
  }

  function parseEmbeddedJson(html) {
    const values = [];
    const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    for (const match of html.matchAll(pattern)) {
      const attributes = match[1] || "";
      if (!/type\s*=\s*["']application\/(?:json|ld\+json)["']/i.test(attributes) && !/\bdata-sjs\b/i.test(attributes)) {
        continue;
      }
      const source = decodeEntities(match[2] || "").trim();
      if (!source || source.length > 8 * 1024 * 1024) continue;
      try {
        values.push(JSON.parse(source));
      } catch {
        // Facebook frequently includes non-JSON scripts. Unparseable values are ignored.
      }
    }
    return values;
  }

  function hasDirectListingId(value, listingId) {
    if (!listingId || !value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.entries(value).some(([key, item]) => LISTING_ID_KEYS.has(key) && String(item) === listingId);
  }

  function candidateScore(value, listingId) {
    if (!hasDirectListingId(value, listingId)) return -1;
    const keys = new Set(Object.keys(value));
    let score = 100;
    if (DESCRIPTION_KEYS.some(key => keys.has(key))) score += 20;
    if (PHOTO_KEYS.some(key => keys.has(key))) score += 20;
    if (ATTRIBUTE_KEYS.some(key => keys.has(key))) score += 10;
    if (SELLER_KEYS.some(key => keys.has(key))) score += 5;
    return score;
  }

  function findListingObject(values, listingId) {
    let visited = 0;
    let best = null;
    let bestScore = -1;
    const stack = values.map(value => ({ value, depth: 0 }));

    while (stack.length && visited < LIMITS.maximumJsonNodes) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== "object") continue;
      visited += 1;

      if (!Array.isArray(value)) {
        const score = candidateScore(value, listingId);
        if (score > bestScore) {
          best = value;
          bestScore = score;
        }
      }

      if (current.depth >= LIMITS.maximumDepth) continue;
      for (const child of Array.isArray(value) ? value : Object.values(value)) {
        if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
      }
    }

    return best;
  }

  function collectUrls(value, output, depth = 0) {
    if (output.length >= LIMITS.imageCount || depth > 8 || value === null || value === undefined) return;
    if (typeof value === "string") {
      if (isFacebookImageUrl(value) && !output.includes(value)) output.push(value);
      return;
    }
    if (typeof value !== "object") return;
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      collectUrls(child, output, depth + 1);
      if (output.length >= LIMITS.imageCount) return;
    }
  }

  function extractImages(listing, html) {
    const urls = [];
    if (listing) {
      for (const key of PHOTO_KEYS) {
        if (key in listing) collectUrls(listing[key], urls);
      }
    }

    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = match[0];
      const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
      const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!/^og:image(?::url)?$/i.test(property || "") || !content) continue;
      const value = decodeEntities(content);
      if (isFacebookImageUrl(value) && !urls.includes(value)) urls.push(value);
      if (urls.length >= LIMITS.imageCount) break;
    }
    return urls;
  }

  function extractAttributes(listing) {
    const attributes = Object.create(null);
    if (!listing) return attributes;

    function add(labelValue, contentValue) {
      if (Object.keys(attributes).length >= LIMITS.attributeCount) return;
      const label = textFromValue(labelValue, LIMITS.attributeKeyCharacters);
      const content = textFromValue(contentValue, LIMITS.attributeValueCharacters);
      if (!label || !content || ["__proto__", "constructor", "prototype"].includes(label.toLowerCase())) return;
      attributes[label] = content;
    }

    for (const key of ATTRIBUTE_KEYS) {
      const source = listing[key];
      if (Array.isArray(source)) {
        for (const item of source) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          add(item.label ?? item.name ?? item.key ?? item.display_name, item.value ?? item.text ?? item.display_value ?? item.displayValue);
        }
      } else if (source && typeof source === "object") {
        for (const [label, content] of Object.entries(source)) add(label, content);
      }
    }
    return attributes;
  }

  function extractListingDetails(html, options = {}) {
    const source = typeof html === "string" ? html : "";
    const listingId = options.listingId ? String(options.listingId) : null;
    const listing = findListingObject(parseEmbeddedJson(source), listingId);

    let fullDescription = null;
    if (listing) {
      for (const key of DESCRIPTION_KEYS) {
        fullDescription = textFromValue(listing[key], LIMITS.fullDescriptionCharacters);
        if (fullDescription) break;
      }
    }

    let sellerName = null;
    let sellerProfileUrl = null;
    if (listing) {
      for (const key of SELLER_KEYS) {
        const seller = listing[key];
        if (!seller || typeof seller !== "object" || Array.isArray(seller)) continue;
        sellerName = textFromValue(seller.name ?? seller.display_name ?? seller.displayName, LIMITS.sellerNameCharacters);
        sellerProfileUrl = normaliseFacebookProfileUrl(seller.url ?? seller.profile_url ?? seller.profileUrl);
        if (sellerName || sellerProfileUrl) break;
      }
    }

    let listedAtText = null;
    if (listing) {
      for (const key of LISTED_AT_KEYS) {
        listedAtText = textFromValue(listing[key], LIMITS.listedAtTextCharacters);
        if (listedAtText) break;
      }
    }

    return {
      fullDescription,
      imageUrls: extractImages(listing, source),
      vehicleAttributes: extractAttributes(listing),
      sellerName,
      sellerProfileUrl,
      listedAtText,
      structuredDetailsFound: Boolean(listing)
    };
  }

  return { LIMITS, extractListingDetails, isFacebookImageUrl };
});
