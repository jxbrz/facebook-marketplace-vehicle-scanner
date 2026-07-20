(function initialiseListingDetailsExtractor(root, factory) {
  const extractor = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = extractor;
  }

  root.ListingDetailsExtractor = extractor;

  if (
    typeof document === "object" &&
    typeof chrome === "object" &&
    chrome.runtime?.onMessage
  ) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type !== "EXTRACT_RENDERED_LISTING_DETAILS") return false;
      extractor.collectRenderedListingDetails(String(message.listingId || ""), {
        debug: message.debug === true
      })
        .then(result => sendResponse({ ok: true, result }))
        .catch(error => sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        }));
      return true;
    });
  }
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
    mileageOriginalTextCharacters: 120,
    maximumJsonNodes: 25000,
    maximumDepth: 30
  };

  const LISTING_ID_KEYS = new Set([
    "id",
    "listing_id",
    "listingId",
    "marketplace_listing_id",
    "marketplaceListingId"
  ]);
  const URL_KEYS = new Set(["url", "canonical_url", "canonicalUrl", "listing_url", "listingUrl"]);
  const DESCRIPTION_KEYS = new Set(["redacted_description", "redactedDescription", "description", "seller_description", "sellerDescription"]);
  const TITLE_KEYS = new Set(["marketplace_listing_title", "marketplaceListingTitle", "listing_title", "listingTitle", "title"]);
  const PHOTO_KEYS = new Set(["listing_photos", "listingPhotos", "photo_urls", "photoUrls", "photos", "listing_media", "listingMedia"]);
  const ATTRIBUTE_KEYS = new Set(["attribute_data", "attributeData", "vehicle_attributes", "vehicleAttributes", "vehicle_specs", "vehicleSpecs"]);
  const SELLER_KEYS = new Set(["marketplace_listing_seller", "marketplaceListingSeller", "marketplaceSeller", "seller"]);
  const LISTED_AT_KEYS = new Set(["listed_at_text", "listedAtText", "creation_time_text", "creationTimeText", "listing_date_text", "listingDateText"]);
  const UI_LINE_PATTERN = /^(?:see more|see less|show more|show less|next|previous|share|save|message)$/i;
  const EXCLUDED_IMAGE_ANCESTRY = new Set(["seller", "recommended", "nearby-listing", "navigation", "ui"]);
  const SECTION_STOP_PATTERN = /^(?:about this vehicle|seller['’]s description|seller information|about the seller|seller details|location|marketplace|you may also like|more from this seller|sponsored)$/i;

  function decodeEntities(value) {
    return String(value)
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
    for (const key of ["text", "value", "display_value", "displayValue", "name", "label"]) {
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
      if (!/type\s*=\s*["']application\/(?:json|ld\+json)["']/i.test(attributes) && !/\bdata-sjs\b/i.test(attributes)) continue;
      const source = decodeEntities(match[2] || "").trim();
      if (!source || source.length > 8 * 1024 * 1024) continue;
      try {
        values.push(JSON.parse(source));
      } catch {
        // Non-JSON Facebook bootstrap scripts are intentionally ignored.
      }
    }
    return values;
  }

  function canonicalListingPath(value) {
    try {
      return new URL(value, "https://www.facebook.com").pathname.replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  function directListingReference(value, listingId, canonicalUrl) {
    if (!listingId || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const expectedPath = canonicalListingPath(canonicalUrl);
    for (const [key, item] of Object.entries(value)) {
      if (LISTING_ID_KEYS.has(key) && String(item) === listingId) return true;
      if (URL_KEYS.has(key) && typeof item === "string") {
        const itemPath = canonicalListingPath(item);
        if (item.includes(`/marketplace/item/${listingId}`) || (expectedPath && itemPath === expectedPath)) return true;
      }
      if (key === listingId && item && typeof item === "object") return true;
    }
    return false;
  }

  function semanticKeyScore(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    const keys = new Set(Object.keys(value));
    let score = 0;
    if ([...DESCRIPTION_KEYS].some(key => keys.has(key))) score += 20;
    if ([...PHOTO_KEYS].some(key => keys.has(key))) score += 20;
    if ([...ATTRIBUTE_KEYS].some(key => keys.has(key))) score += 15;
    if ([...SELLER_KEYS].some(key => keys.has(key))) score += 5;
    if ([...LISTED_AT_KEYS].some(key => keys.has(key))) score += 5;
    return score;
  }

  function findListingCandidates(values, listingId, canonicalUrl) {
    const candidates = new Map();
    let visited = 0;
    const stack = values.map(value => ({ value, depth: 0, ancestors: [] }));

    while (stack.length && visited < LIMITS.maximumJsonNodes) {
      const current = stack.pop();
      const value = current.value;
      if (!value || typeof value !== "object") continue;
      visited += 1;

      if (!Array.isArray(value) && directListingReference(value, listingId, canonicalUrl)) {
        candidates.set(value, 100 + semanticKeyScore(value));
        current.ancestors.slice(-3).reverse().forEach((ancestor, index) => {
          if (!Array.isArray(ancestor)) {
            candidates.set(ancestor, Math.max(candidates.get(ancestor) || 0, 70 - index * 10 + semanticKeyScore(ancestor)));
          }
        });
      }

      if (current.depth >= LIMITS.maximumDepth) continue;
      const ancestors = [...current.ancestors.slice(-3), value];
      for (const child of Array.isArray(value) ? value : Object.values(value)) {
        if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1, ancestors });
      }
    }

    return [...candidates.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([value]) => value)
      .slice(0, 8);
  }

  function findNamedValues(root, keys, maximumDepth = 6) {
    const values = [];
    const stack = [{ value: root, depth: 0 }];
    const seen = new Set();
    while (stack.length && seen.size < 5000) {
      const current = stack.pop();
      if (!current.value || typeof current.value !== "object" || seen.has(current.value)) continue;
      seen.add(current.value);
      if (!Array.isArray(current.value)) {
        for (const [key, value] of Object.entries(current.value)) {
          if (keys.has(key)) values.push(value);
        }
      }
      if (current.depth >= maximumDepth) continue;
      for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) {
        if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return values;
  }

  function hasForeignListingReference(value, listingId) {
    if (!listingId || !value || typeof value !== "object" || Array.isArray(value)) return false;
    const entries = Object.entries(value);
    const looksLikeListing = entries.some(([key, item]) =>
      PHOTO_KEYS.has(key) ||
      URL_KEYS.has(key) && typeof item === "string" && /\/marketplace\/item\/\d+/.test(item)
    );
    if (!looksLikeListing) return false;
    return entries.some(([key, item]) =>
      LISTING_ID_KEYS.has(key) && /^\d+$/.test(String(item)) && String(item) !== listingId ||
      URL_KEYS.has(key) && typeof item === "string" &&
        /\/marketplace\/item\/(\d+)/.test(item) && !item.includes(`/marketplace/item/${listingId}`)
    );
  }

  function findListingScopedNamedValues(root, keys, listingId, maximumDepth = 6) {
    const values = [];
    const stack = [{ value: root, depth: 0 }];
    const seen = new Set();
    while (stack.length && seen.size < 5000) {
      const current = stack.pop();
      if (!current.value || typeof current.value !== "object" || seen.has(current.value)) continue;
      seen.add(current.value);
      if (current.depth > 0 && hasForeignListingReference(current.value, listingId)) continue;
      if (!Array.isArray(current.value)) {
        for (const [key, value] of Object.entries(current.value)) {
          if (keys.has(key)) values.push(value);
        }
      }
      if (current.depth >= maximumDepth) continue;
      for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) {
        if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return values;
  }

  function parseMileageDetail(value) {
    const text = normaliseText(value, LIMITS.mileageOriginalTextCharacters);
    if (!text) return null;
    const match = text.match(/\b(\d{1,3}(?:[,. ]\d{3})+|\d{1,6})\s*(km|kilometres?|kilometers?|miles?|mi)\b/i);
    if (!match) return null;
    const number = Number(match[1].replace(/[,. ]/g, ""));
    if (!Number.isFinite(number) || number < 0 || number > 1000000) return null;
    const unit = /^(?:km|kilomet)/i.test(match[2]) ? "km" : "mi";
    return { value: number, unit, originalText: match[0].trim() };
  }

  function imageQuality(candidate) {
    const width = Number(candidate.width) || 0;
    const height = Number(candidate.height) || 0;
    const area = Math.min(width * height, 20000000);
    const sourceScore = candidate.source === "rendered-srcset" ? 4000 : candidate.source === "embedded" ? 3500 : candidate.source === "rendered-src" ? 2500 : 0;
    return (candidate.listingOwned === false ? -1000000 : 100000) + sourceScore + Math.round(area / 1000) - (candidate.thumbnail ? 20000 : 0);
  }

  function facebookAssetIdentity(value) {
    if (!isFacebookImageUrl(value)) return null;
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}${url.pathname}`;
  }

  function shortPathHash(value) {
    let hash = 2166136261;
    for (const character of String(value || "")) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function rejectImageCandidate(candidate) {
    const rawUrl = String(candidate?.url || "");
    if (/^blob:/i.test(rawUrl)) return "blob URL";
    if (/^data:/i.test(rawUrl)) return "data URL";
    if (/^javascript:/i.test(rawUrl)) return "malformed URL";
    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return "malformed URL";
    }
    if (parsed.protocol !== "https:") return "insecure URL";
    if (!isFacebookImageUrl(rawUrl)) return "unsupported source";
    if (candidate.foreignListingId) return "outside active listing";
    if (EXCLUDED_IMAGE_ANCESTRY.has(candidate.ancestryCategory)) {
      if (candidate.ancestryCategory === "seller") return "seller avatar/profile";
      if (["recommended", "nearby-listing"].includes(candidate.ancestryCategory)) return "recommended listing";
      return "navigation/UI asset";
    }
    if (candidate.listingOwned === false || candidate.insideListingRoot === false) return "outside active listing";
    if (candidate.insideGallery === false) return "outside main gallery";
    const width = Number(candidate.width) || 0;
    const height = Number(candidate.height) || 0;
    if (width > 0 && height > 0 && ((width <= 128 && height <= 128) || width * height < 10000)) {
      return "tiny/icon-sized";
    }
    return null;
  }

  function candidateDiagnostic(candidate, accepted, reason = null) {
    let host = "invalid";
    let pathHash = "invalid";
    try {
      const parsed = new URL(String(candidate?.url || ""));
      host = parsed.hostname.toLowerCase().slice(0, 120);
      pathHash = shortPathHash(parsed.pathname);
    } catch {
      // The diagnostic deliberately records no URL content.
    }
    return {
      host,
      pathHash,
      width: Number(candidate?.width) || 0,
      height: Number(candidate?.height) || 0,
      ancestryCategory: String(candidate?.ancestryCategory || "unknown").slice(0, 40),
      insideListingRoot: candidate?.insideListingRoot !== false,
      matchedMainGallery: candidate?.insideGallery !== false,
      accepted,
      reason
    };
  }

  function filterOwnedImageCandidates(candidates) {
    const accepted = [];
    const rejected = [];
    const rejectionReasons = Object.create(null);
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      const reason = rejectImageCandidate(candidate);
      if (reason) {
        rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
        rejected.push(candidateDiagnostic(candidate, false, reason));
      } else {
        accepted.push(candidate);
      }
    }
    return { accepted, rejected, rejectionReasons };
  }

  function rankImageCandidates(candidates) {
    const filtered = filterOwnedImageCandidates(candidates);
    const bestByIdentity = new Map();
    let discoveryIndex = 0;
    for (const raw of filtered.accepted) {
      const candidate = { ...raw, discoveryIndex: raw.discoveryIndex ?? discoveryIndex++ };
      const stableMediaId = candidate.mediaId && !/^(?:rendered|embedded-order):?/i.test(candidate.mediaId)
        ? candidate.mediaId
        : null;
      const identity = stableMediaId
        ? `media:${stableMediaId}`
        : `asset:${facebookAssetIdentity(candidate.url)}`;
      const existing = bestByIdentity.get(identity);
      if (existing) {
        filtered.rejectionReasons.duplicate = (filtered.rejectionReasons.duplicate || 0) + 1;
      }
      if (!existing || imageQuality(candidate) > imageQuality(existing)) {
        bestByIdentity.set(identity, {
          ...candidate,
          order: existing ? Math.min(Number(existing.order) || 0, Number(candidate.order) || 0) : candidate.order,
          discoveryIndex: existing ? Math.min(existing.discoveryIndex, candidate.discoveryIndex) : candidate.discoveryIndex
        });
      }
    }
    const ordered = [...bestByIdentity.values()].sort((left, right) =>
      (Number(left.order) || 0) - (Number(right.order) || 0) ||
      left.discoveryIndex - right.discoveryIndex ||
      left.url.localeCompare(right.url)
    );
    const seenAssets = new Set();
    const ranked = ordered.filter(candidate => {
      const identity = facebookAssetIdentity(candidate.url) || candidate.url;
      if (seenAssets.has(identity)) {
        filtered.rejectionReasons.duplicate = (filtered.rejectionReasons.duplicate || 0) + 1;
        return false;
      }
      seenAssets.add(identity);
      return true;
    }).slice(0, LIMITS.imageCount);
    return {
      primaryImageUrl: ranked[0]?.url ?? null,
      imageUrls: ranked.map(candidate => candidate.url),
      imageDiagnostics: {
        candidateCount: (Array.isArray(candidates) ? candidates : []).length,
        acceptedCount: ranked.length,
        rejectedCount: (Array.isArray(candidates) ? candidates : []).length - ranked.length,
        rejectionReasons: { ...filtered.rejectionReasons },
        candidates: [
          ...ranked.slice(0, 10).map(candidate => candidateDiagnostic(candidate, true)),
          ...filtered.rejected.slice(0, 10)
        ].slice(0, 20)
      }
    };
  }

  function collectImageCandidates(value, context, output, depth = 0) {
    if (!value || typeof value !== "object" || depth > 8) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => collectImageCandidates(item, {
        ...context,
        order: context.order + index,
        mediaId: context.mediaId || `embedded-order:${context.order + index}`
      }, output, depth + 1));
      return;
    }
    const width = Number(value.width ?? value.image_width ?? value.original_width ?? context.width) || 0;
    const height = Number(value.height ?? value.image_height ?? value.original_height ?? context.height) || 0;
    const mediaId = textFromValue(value.photo_id ?? value.photoId ?? value.media_id ?? value.mediaId ?? value.id, 160) || context.mediaId;
    for (const key of ["uri", "url", "src", "image_url", "imageUrl"]) {
      const url = value[key];
      if (typeof url === "string" && isFacebookImageUrl(url)) {
        output.push({
          url,
          width,
          height,
          mediaId,
          order: context.order,
          source: "embedded",
          listingOwned: true,
          insideListingRoot: true,
          insideGallery: true,
          ancestryCategory: "listing-gallery",
          thumbnail: /thumbnail|thumb/i.test(key) || (width > 0 && width < 500)
        });
      }
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") collectImageCandidates(child, { ...context, width, height, mediaId }, output, depth + 1);
    }
  }

  function addAttribute(target, labelValue, contentValue) {
    if (Object.keys(target).length >= LIMITS.attributeCount) return;
    const label = textFromValue(labelValue, LIMITS.attributeKeyCharacters);
    const content = textFromValue(contentValue, LIMITS.attributeValueCharacters);
    if (!label || !content || ["__proto__", "constructor", "prototype"].includes(label.toLowerCase())) return;
    target[label] = content;
  }

  function extractAttributes(candidates) {
    const attributes = Object.create(null);
    for (const candidate of candidates) {
      for (const source of findNamedValues(candidate, ATTRIBUTE_KEYS)) {
        if (Array.isArray(source)) {
          for (const item of source) {
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            addAttribute(attributes, item.label ?? item.name ?? item.key ?? item.display_name, item.value ?? item.text ?? item.display_value ?? item.displayValue);
          }
        } else if (source && typeof source === "object") {
          for (const [label, content] of Object.entries(source)) addAttribute(attributes, label, content);
        }
      }
      if (Object.keys(attributes).length) break;
    }
    return attributes;
  }

  function recognisedFields(attributes) {
    let mileageDetail = null;
    let transmission = null;
    let fuelType = null;
    let detectedMake = null;
    let detectedModel = null;
    for (const [label, value] of Object.entries(attributes || {})) {
      const key = label.toLowerCase();
      if (!mileageDetail && /mileage|distance|kilomet|miles/.test(key)) mileageDetail = parseMileageDetail(value);
      if (!transmission && /transmission|gearbox/.test(key)) transmission = normaliseText(value, 80);
      if (!fuelType && /fuel|gasoline|petrol|diesel/.test(key)) fuelType = normaliseText(value, 80);
      if (!detectedMake && /^(?:make|manufacturer|marque)$/.test(key)) detectedMake = normaliseText(value, 80);
      if (!detectedModel && /^(?:model|vehicle model)$/.test(key)) detectedModel = normaliseText(value, 80);
    }
    return { mileageDetail, transmission, fuelType, detectedMake, detectedModel };
  }

  function firstNamedText(candidates, keys, maximumLength) {
    for (const candidate of candidates) {
      for (const value of findNamedValues(candidate, keys)) {
        const text = textFromValue(value, maximumLength);
        if (text) return text;
      }
    }
    return null;
  }

  function extractEmbeddedImages(candidates, html, listingId, debug = false) {
    const imageCandidates = [];
    for (const candidate of candidates) {
      let order = 0;
      for (const value of findListingScopedNamedValues(candidate, PHOTO_KEYS, listingId)) {
        collectImageCandidates(value, { order: order * 100, width: 0, height: 0, mediaId: null }, imageCandidates);
        order += 1;
      }
      if (imageCandidates.length) break;
    }
    const structuredCandidateCount = imageCandidates.length;
    if (!structuredCandidateCount && candidates.length) {
      for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const tag = match[0];
        const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
        const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
        if (!/^og:image(?::url)?$/i.test(property || "") || !content) continue;
        const url = decodeEntities(content);
        if (isFacebookImageUrl(url)) imageCandidates.push({
          url,
          width: 0,
          height: 0,
          mediaId: "og-image",
          order: 0,
          source: "og",
          listingOwned: true,
          insideListingRoot: true,
          insideGallery: true,
          ancestryCategory: "listing-open-graph",
          thumbnail: true
        });
      }
    }
    const ranked = rankImageCandidates(imageCandidates);
    const { imageDiagnostics, ...images } = ranked;
    return {
      ...images,
      imageDiagnostics: debug ? {
        ...imageDiagnostics,
        extractionSource: structuredCandidateCount ? "listing-scoped-embedded-data" : "listing-open-graph",
        galleryContainerIdentity: structuredCandidateCount ? "embedded-photo-field" : "open-graph-fallback",
        wrapped: false,
        finalImageCount: images.imageUrls.length
      } : null,
      imageExtractionStatus: structuredCandidateCount && images.imageUrls.length
        ? "complete"
        : images.imageUrls.length
          ? "partial"
          : "unavailable"
    };
  }

  function extractListingDetails(html, options = {}) {
    const source = typeof html === "string" ? html : "";
    const listingId = options.listingId ? String(options.listingId) : null;
    const candidates = findListingCandidates(parseEmbeddedJson(source), listingId, options.canonicalUrl);
    const vehicleAttributes = extractAttributes(candidates);
    const fields = recognisedFields(vehicleAttributes);
    const images = extractEmbeddedImages(candidates, source, listingId, options.debug === true);

    let sellerName = null;
    let sellerProfileUrl = null;
    for (const candidate of candidates) {
      for (const seller of findNamedValues(candidate, SELLER_KEYS)) {
        if (!seller || typeof seller !== "object" || Array.isArray(seller)) continue;
        sellerName = textFromValue(seller.name ?? seller.display_name ?? seller.displayName, LIMITS.sellerNameCharacters);
        sellerProfileUrl = normaliseFacebookProfileUrl(seller.url ?? seller.profile_url ?? seller.profileUrl);
        if (sellerName || sellerProfileUrl) break;
      }
      if (sellerName || sellerProfileUrl) break;
    }

    return {
      listingTitle: firstNamedText(candidates, TITLE_KEYS, 500),
      fullDescription: firstNamedText(candidates, DESCRIPTION_KEYS, LIMITS.fullDescriptionCharacters),
      ...images,
      vehicleAttributes,
      ...fields,
      sellerName,
      sellerProfileUrl,
      listedAtText: firstNamedText(candidates, LISTED_AT_KEYS, LIMITS.listedAtTextCharacters),
      structuredDetailsFound: candidates.length > 0,
      extractionSource: candidates.length ? "listing-scoped-embedded-data" : "static-html-fallback"
    };
  }

  function splitVisibleLines(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .split(/\n+/)
      .map(line => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  function cleanSectionLines(lines, headingPattern, maximumLength = LIMITS.attributeValueCharacters) {
    const output = [];
    for (const line of Array.isArray(lines) ? lines : []) {
      const text = normaliseText(line, maximumLength);
      if (!text || headingPattern.test(text) || UI_LINE_PATTERN.test(text)) continue;
      if (SECTION_STOP_PATTERN.test(text)) break;
      output.push(text);
    }
    return output;
  }

  function extractRenderedSnapshotDetails(snapshot) {
    const descriptionLines = cleanSectionLines(snapshot?.descriptionLines, /seller['’]s description/i, LIMITS.fullDescriptionCharacters);
    const aboutLines = cleanSectionLines(snapshot?.aboutLines, /about this vehicle/i);
    const vehicleAttributes = Object.create(null);
    const consumed = new Set();
    let mileageDetail = null;
    let transmission = null;
    let fuelType = null;

    function setAttribute(label, value, index) {
      if (!value || Object.keys(vehicleAttributes).length >= LIMITS.attributeCount) return;
      vehicleAttributes[label] = normaliseText(value, LIMITS.attributeValueCharacters);
      consumed.add(index);
    }

    for (let index = 0; index < aboutLines.length; index += 1) {
      const line = aboutLines[index];
      const next = aboutLines[index + 1];
      const mileage = parseMileageDetail(line);
      if (mileage && !mileageDetail) {
        mileageDetail = mileage;
        setAttribute("Mileage", mileage.originalText, index);
        continue;
      }
      const transmissionMatch = line.match(/\b(automatic|manual|semi-automatic|cvt)\b(?:\s+transmission)?/i);
      if (transmissionMatch && !transmission) {
        transmission = transmissionMatch[1].replace(/\b\w/g, character => character.toUpperCase());
        setAttribute("Transmission", transmission, index);
        continue;
      }
      const fuelMatch = line.match(/(?:fuel\s*type\s*[:\-]?\s*)?\b(gasoline|petrol|diesel|electric|hybrid|plug-in hybrid|lpg)\b/i);
      if (fuelMatch && !fuelType) {
        fuelType = fuelMatch[1].replace(/\b\w/g, character => character.toUpperCase());
        setAttribute("Fuel type", fuelType, index);
        continue;
      }
      const exteriorMatch = line.match(/exterior\s+colo(?:u)?r\s*[:\-]?\s*([^·|]+)/i);
      const interiorMatch = line.match(/interior\s+colo(?:u)?r\s*[:\-]?\s*([^·|]+)/i);
      if (exteriorMatch) setAttribute("Exterior colour", exteriorMatch[1].trim(), index);
      if (interiorMatch) setAttribute("Interior colour", interiorMatch[1].trim(), index);
      if (exteriorMatch || interiorMatch) continue;
      if (/^exterior\s+colo(?:u)?r$/i.test(line) && next) {
        setAttribute("Exterior colour", next, index);
        consumed.add(index + 1);
        continue;
      }
      if (/^interior\s+colo(?:u)?r$/i.test(line) && next) {
        setAttribute("Interior colour", next, index);
        consumed.add(index + 1);
        continue;
      }
      const pair = line.match(/^([^:]{2,80}):\s*(.{1,500})$/);
      if (pair) setAttribute(pair[1].trim(), pair[2].trim(), index);
    }

    let detailNumber = 1;
    aboutLines.forEach((line, index) => {
      if (consumed.has(index) || UI_LINE_PATTERN.test(line) || line.length > LIMITS.attributeValueCharacters) return;
      setAttribute(`Detail ${detailNumber++}`, line, index);
    });

    const ranked = rankImageCandidates(snapshot?.imageCandidates || []);
    const { imageDiagnostics, ...images } = ranked;
    const recognised = recognisedFields(vehicleAttributes);
    return {
      listingTitle: normaliseText(snapshot?.listingTitle, 500),
      fullDescription: descriptionLines.length ? descriptionLines.join("\n") : null,
      ...images,
      imageExtractionStatus: snapshot?.imageExtractionStatus || (images.imageUrls.length ? "complete" : "unavailable"),
      imageDiagnostics: snapshot?.includeImageDiagnostics ? {
        ...imageDiagnostics,
        ...(snapshot.galleryDiagnostics || {})
      } : null,
      vehicleAttributes,
      mileageDetail,
      transmission,
      fuelType,
      detectedMake: recognised.detectedMake,
      detectedModel: recognised.detectedModel,
      sellerName: null,
      sellerProfileUrl: null,
      listedAtText: normaliseText(snapshot?.listedAtText, LIMITS.listedAtTextCharacters),
      structuredDetailsFound: Boolean(descriptionLines.length || aboutLines.length || images.imageUrls.length),
      extractionSource: "rendered-semantic-dom"
    };
  }

  function mergeListingDetails(embedded, rendered) {
    if (!rendered) return embedded;
    const imageSources = [embedded, rendered];
    const selectedImages = imageSources.find(details =>
      details?.imageExtractionStatus === "complete" && details.imageUrls?.length
    ) || imageSources.find(details =>
      details?.imageExtractionStatus === "partial" && details.imageUrls?.length
    ) || null;
    const imageUrls = selectedImages?.imageUrls || [];
    return {
      fullDescription: rendered.fullDescription || embedded?.fullDescription || null,
      listingTitle: embedded?.listingTitle || rendered.listingTitle || null,
      primaryImageUrl: selectedImages?.primaryImageUrl || imageUrls[0] || null,
      imageUrls,
      imageExtractionStatus: selectedImages?.imageExtractionStatus || "unavailable",
      imageDiagnostics: rendered.imageDiagnostics || embedded?.imageDiagnostics || null,
      vehicleAttributes: { ...(embedded?.vehicleAttributes || {}), ...(rendered.vehicleAttributes || {}) },
      mileageDetail: embedded?.mileageDetail || rendered.mileageDetail || null,
      transmission: embedded?.transmission || rendered.transmission || null,
      fuelType: embedded?.fuelType || rendered.fuelType || null,
      detectedMake: embedded?.detectedMake || rendered.detectedMake || null,
      detectedModel: embedded?.detectedModel || rendered.detectedModel || null,
      sellerName: embedded?.sellerName || rendered.sellerName || null,
      sellerProfileUrl: embedded?.sellerProfileUrl || rendered.sellerProfileUrl || null,
      listedAtText: embedded?.listedAtText || rendered.listedAtText || null,
      structuredDetailsFound: Boolean(embedded?.structuredDetailsFound || rendered.structuredDetailsFound),
      extractionSource: `${embedded?.extractionSource || "static-html"}+${rendered.extractionSource}`
    };
  }

  function resolveListingImages(details, fallback = {}) {
    const status = ["complete", "partial", "unavailable"].includes(details?.imageExtractionStatus)
      ? details.imageExtractionStatus
      : "unavailable";
    const detailImages = rankImageCandidates(
      (Array.isArray(details?.imageUrls) ? details.imageUrls : []).map((url, index) => ({
        url,
        width: 0,
        height: 0,
        mediaId: null,
        order: index,
        source: "validated-detail",
        listingOwned: true,
        insideListingRoot: true,
        insideGallery: true,
        ancestryCategory: "listing-gallery"
      }))
    ).imageUrls;
    if (status === "complete" || status === "partial" && detailImages.length) {
      return {
        imageUrl: detailImages[0] || null,
        imageUrls: detailImages,
        imageExtractionStatus: status
      };
    }

    const fallbackOwned = String(fallback.listingId || "") &&
      String(fallback.listingId || "") === String(fallback.sourceListingId || "") &&
      isFacebookImageUrl(fallback.imageUrl) &&
      new URL(fallback.imageUrl).protocol === "https:";
    if (fallbackOwned) {
      return {
        imageUrl: fallback.imageUrl,
        imageUrls: [fallback.imageUrl],
        imageExtractionStatus: "partial"
      };
    }
    return { imageUrl: null, imageUrls: [], imageExtractionStatus: "unavailable" };
  }

  function needsRenderedFallback(details) {
    return !details?.fullDescription ||
      (details.imageUrls?.length || 0) < 2 ||
      Object.keys(details.vehicleAttributes || {}).length < 2 ||
      !details.mileageDetail;
  }

  function elementText(element) {
    return normaliseText(element?.innerText || element?.textContent || "", 25000) || "";
  }

  function isVisible(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") return false;
    const rect = element.getBoundingClientRect();
    const style = globalThis.getComputedStyle?.(element);
    return rect.width > 0 && rect.height > 0 && style?.display !== "none" && style?.visibility !== "hidden";
  }

  function findHeading(names) {
    const expected = names.map(value => value.toLowerCase().replace(/[’]/g, "'"));
    const candidates = document.querySelectorAll('h1,h2,h3,h4,[role="heading"],span,div');
    for (const element of candidates) {
      const text = elementText(element).toLowerCase().replace(/[’]/g, "'");
      if (expected.includes(text) && isVisible(element)) return element;
    }
    return null;
  }

  function sectionLinesFromHeading(heading, headingPattern, maximumLength) {
    if (!heading) return [];
    let ancestor = heading.parentElement;
    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      const lines = splitVisibleLines(elementText(ancestor));
      const headingIndex = lines.findIndex(line => headingPattern.test(line));
      if (headingIndex < 0) continue;
      const after = cleanSectionLines(lines.slice(headingIndex + 1), headingPattern, maximumLength);
      if (after.length && after.join(" ").length >= 8 && after.join(" ").length <= LIMITS.fullDescriptionCharacters) return after;
    }
    return [];
  }

  function parseSrcset(value) {
    return String(value || "").split(",").map(item => {
      const match = item.trim().match(/^(\S+)\s+(\d+)w$/);
      return match ? { url: match[1], width: Number(match[2]) } : null;
    }).filter(Boolean);
  }

  function semanticAncestryCategory(image, foreignListingId) {
    if (foreignListingId) return "nearby-listing";
    if (image.closest?.('nav,[role="navigation"],[role="banner"]')) return "navigation";
    if (image.closest?.('a[href*="/profile.php"],a[href*="/marketplace/profile"],[aria-label*="seller" i]')) return "seller";
    const context = image.closest?.('a,[role="article"],section');
    const text = elementText(context);
    if (/\b(?:you may also like|recommended|more from this seller|sponsored)\b/i.test(text)) return "recommended";
    if (/avatar|profile picture|logo|icon|emoji/i.test(String(image.alt || ""))) return "ui";
    return "listing-gallery";
  }

  function findActiveListingRoot(listingId) {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(isVisible);
    const exactDialog = dialogs.find(dialog =>
      dialog.querySelector?.(`a[href*="/marketplace/item/${listingId}"]`)
    );
    if (exactDialog) return { root: exactDialog, identity: "active-listing-dialog" };
    const semanticDialog = dialogs.find(dialog =>
      /seller['â€™]s description|about this vehicle/i.test(elementText(dialog)) &&
      dialog.querySelector?.("img")
    );
    if (semanticDialog) return { root: semanticDialog, identity: "semantic-listing-dialog" };
    const main = [...document.querySelectorAll('[role="main"]')].find(isVisible);
    return main ? { root: main, identity: "marketplace-main" } : null;
  }

  function findGalleryContext(listingId) {
    const active = findActiveListingRoot(listingId);
    if (!active) return null;
    const eligible = [...active.root.querySelectorAll("img")]
      .filter(isVisible)
      .filter(image => {
        const linkedId = image.closest?.('a[href*="/marketplace/item/"]')?.href?.match(/\/marketplace\/item\/(\d+)/)?.[1];
        const foreignId = linkedId && linkedId !== listingId ? linkedId : null;
        return !foreignId && !EXCLUDED_IMAGE_ANCESTRY.has(semanticAncestryCategory(image, null));
      })
      .map(image => ({ image, rect: image.getBoundingClientRect() }))
      .filter(item => item.rect.width >= 240 && item.rect.height >= 160)
      .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height);
    const primary = eligible[0]?.image || null;
    if (!primary) return null;

    let galleryRoot = null;
    let ancestor = primary.parentElement;
    const primaryRect = primary.getBoundingClientRect();
    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      if (!active.root.contains(ancestor)) break;
      const hasGalleryNext = [...ancestor.querySelectorAll("button[aria-label]")].some(button =>
        /^(?:next|next photo|next image)/i.test(button.getAttribute("aria-label") || "") &&
        !button.disabled && button.getAttribute("aria-disabled") !== "true" && isVisible(button) &&
        (() => {
          const rect = button.getBoundingClientRect();
          const centreY = rect.top + rect.height / 2;
          return rect.left <= primaryRect.right + 120 && rect.right >= primaryRect.left - 120 &&
            centreY >= primaryRect.top - 60 && centreY <= primaryRect.bottom + 60;
        })()
      );
      if (hasGalleryNext) {
        galleryRoot = ancestor;
        break;
      }
      if (ancestor === active.root) break;
    }
    galleryRoot ||= primary.closest?.('button,[role="group"]') || primary.parentElement || null;

    if (!galleryRoot || !active.root.contains(galleryRoot)) return null;
    const labels = [...galleryRoot.querySelectorAll("[aria-label]")]
      .map(element => element.getAttribute("aria-label") || "");
    const declaredCount = labels.reduce((maximum, label) => {
      const match = label.match(/(?:photo|image)?\s*\d+\s*(?:of|\/)\s*(\d+)/i);
      return Math.max(maximum, Number(match?.[1]) || 0);
    }, 0) || null;
    return {
      listingRoot: active.root,
      galleryRoot,
      containerIdentity: `${active.identity}:${galleryRoot.getAttribute?.("role") || galleryRoot.tagName?.toLowerCase() || "element"}`,
      declaredCount
    };
  }

  function captureImageCandidates(listingId, orderOffset = 0, context = findGalleryContext(listingId)) {
    if (!context?.listingRoot || !context.galleryRoot) return { candidates: [], primaryIdentity: null, context: null };
    const output = [];
    const galleryImages = [...context.galleryRoot.querySelectorAll("img")].filter(isVisible);
    const primaryImage = galleryImages
      .map(image => ({ image, rect: image.getBoundingClientRect() }))
      .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height)[0]?.image || null;

    [...context.listingRoot.querySelectorAll("img")].forEach((image, index) => {
      if (!isVisible(image)) return;
      const listingLink = image.closest?.('a[href*="/marketplace/item/"]');
      const linkedId = listingLink?.href?.match(/\/marketplace\/item\/(\d+)/)?.[1] || null;
      const foreignListingId = linkedId && linkedId !== listingId ? linkedId : null;
      const buttonLabel = image.closest?.("button")?.getAttribute?.("aria-label") || "";
      const labelledOrder = Number(buttonLabel.match(/(?:photo|image)\s+(\d+)/i)?.[1]);
      const order = Number.isFinite(labelledOrder) && labelledOrder > 0 ? labelledOrder - 1 : orderOffset + index;
      const rect = image.getBoundingClientRect();
      const naturalWidth = Number(image.naturalWidth) || Math.round(rect.width);
      const naturalHeight = Number(image.naturalHeight) || Math.round(rect.height);
      const mediaId = image.getAttribute?.("data-media-id") || image.dataset?.mediaId || `rendered:${orderOffset + index}`;
      const style = globalThis.getComputedStyle?.(image);
      const common = {
        height: naturalHeight,
        mediaId,
        order,
        listingOwned: !foreignListingId,
        insideListingRoot: true,
        insideGallery: context.galleryRoot.contains(image),
        foreignListingId,
        ancestryCategory: semanticAncestryCategory(image, foreignListingId),
        thumbnail: naturalWidth > 0 && naturalWidth < 500,
        isPrimary: image === primaryImage
      };
      if (/blur/i.test(style?.filter || "")) {
        output.push({ ...common, url: image.currentSrc || image.src, width: naturalWidth, listingOwned: false, ancestryCategory: "ui", source: "rendered-blurred" });
        return;
      }
      for (const item of parseSrcset(image.getAttribute?.("srcset"))) {
        output.push({ ...common, url: item.url, width: item.width, source: "rendered-srcset", thumbnail: item.width < 500 });
      }
      const url = image.currentSrc || image.src;
      if (url) output.push({ ...common, url, width: naturalWidth, source: "rendered-src" });
    });
    const primaryUrl = primaryImage?.currentSrc || primaryImage?.src || null;
    return {
      candidates: output,
      primaryIdentity: facebookAssetIdentity(primaryUrl),
      context
    };
  }

  function captureRenderedSnapshot(listingId, imageCandidates) {
    const descriptionHeading = findHeading(["Seller's description", "Seller’s description"]);
    const aboutHeading = findHeading(["About this vehicle"]);
    const mainLines = splitVisibleLines(elementText(document.querySelector('[role="main"]') || document.body));
    const listingTitle = [...document.querySelectorAll('[role="main"] h1,[role="main"] [role="heading"][aria-level="1"]')]
      .map(elementText)
      .find(text => text && !/marketplace/i.test(text)) || null;
    const listedAtText = mainLines.find(line => /^listed\b/i.test(line) && line.length <= LIMITS.listedAtTextCharacters) || null;
    return {
      listingId,
      listingTitle,
      descriptionLines: sectionLinesFromHeading(descriptionHeading, /seller['’]s description/i, LIMITS.fullDescriptionCharacters),
      aboutLines: sectionLinesFromHeading(aboutHeading, /about this vehicle/i, LIMITS.attributeValueCharacters),
      listedAtText,
      imageCandidates
    };
  }

  function nextGalleryIterationState(current = {}, primaryIdentity, declaredCount = null) {
    const seen = new Set(Array.isArray(current.seen) ? current.seen : []);
    const firstIdentity = current.firstIdentity || primaryIdentity || null;
    const wrapped = Boolean(
      primaryIdentity && firstIdentity && primaryIdentity === firstIdentity && seen.size > 1
    );
    const noChangeCount = primaryIdentity && primaryIdentity === current.lastIdentity
      ? (Number(current.noChangeCount) || 0) + 1
      : primaryIdentity
        ? 0
        : (Number(current.noChangeCount) || 0) + 1;
    if (primaryIdentity) seen.add(primaryIdentity);
    const declaredComplete = Number(declaredCount) > 0 && seen.size >= Math.min(Number(declaredCount), LIMITS.imageCount);
    return {
      firstIdentity,
      lastIdentity: primaryIdentity || current.lastIdentity || null,
      seen: [...seen],
      noChangeCount,
      wrapped,
      stop: wrapped || noChangeCount >= 2 || declaredComplete,
      stopReason: wrapped
        ? "wrapped gallery repeat"
        : noChangeCount >= 2
          ? "carousel no change"
          : declaredComplete
            ? "declared gallery count reached"
            : null
    };
  }

  function findNextCarouselButton(galleryRoot) {
    if (!galleryRoot) return null;
    return [...galleryRoot.querySelectorAll("button[aria-label]")].find(button =>
      /^(?:next|next photo|next image)/i.test(button.getAttribute("aria-label") || "") &&
      !button.disabled &&
      button.getAttribute("aria-disabled") !== "true" &&
      isVisible(button)
    ) || null;
  }

  function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function collectRenderedListingDetails(listingId, options = {}) {
    const currentId = location.pathname.match(/\/marketplace\/item\/(\d+)/)?.[1] || null;
    if (!listingId || currentId !== listingId) throw new Error("Rendered listing ID did not match the requested listing.");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (findHeading(["Seller's description", "Seller’s description"]) || findHeading(["About this vehicle"])) break;
      await delay(250);
    }

    const allImages = [];
    let iterationState = {};
    let galleryContainerIdentity = null;
    let declaredCount = null;
    for (let step = 0; step < LIMITS.imageCount; step += 1) {
      const captured = captureImageCandidates(listingId, step * 1000);
      if (!captured.context) break;
      galleryContainerIdentity = captured.context.containerIdentity;
      declaredCount = captured.context.declaredCount;
      const nextState = nextGalleryIterationState(iterationState, captured.primaryIdentity, declaredCount);
      if (nextState.wrapped) {
        iterationState = nextState;
        break;
      }
      allImages.push(...captured.candidates);
      iterationState = nextState;
      if (nextState.stop) break;
      const next = findNextCarouselButton(captured.context.galleryRoot);
      if (!next) break;
      next.click();
      await delay(250);
    }

    const rankedImages = rankImageCandidates(allImages);
    const incompleteDeclaredGallery = Number(declaredCount) > 0 &&
      iterationState.seen?.length < Math.min(Number(declaredCount), LIMITS.imageCount);
    const imageExtractionStatus = galleryContainerIdentity && rankedImages.imageUrls.length
      ? incompleteDeclaredGallery || iterationState.stopReason === "carousel no change"
        ? "partial"
        : "complete"
      : "unavailable";
    let snapshot = {
      ...captureRenderedSnapshot(listingId, allImages),
      imageExtractionStatus,
      includeImageDiagnostics: options.debug === true,
      galleryDiagnostics: {
        extractionSource: "rendered-semantic-dom",
        galleryContainerIdentity,
        declaredCount,
        wrapped: Boolean(iterationState.wrapped),
        noChangeCount: Number(iterationState.noChangeCount) || 0,
        stopReason: iterationState.stopReason || null,
        finalImageCount: rankedImages.imageUrls.length
      }
    };
    if (!snapshot.descriptionLines.length || !snapshot.aboutLines.length) {
      const about = findHeading(["About this vehicle"]);
      (about || document.documentElement).scrollIntoView?.({ block: "center" });
      await delay(500);
      snapshot = { ...snapshot, ...captureRenderedSnapshot(listingId, allImages) };
    }
    return extractRenderedSnapshotDetails(snapshot);
  }

  return {
    LIMITS,
    collectRenderedListingDetails,
    extractListingDetails,
    extractRenderedSnapshotDetails,
    facebookAssetIdentity,
    filterOwnedImageCandidates,
    isFacebookImageUrl,
    mergeListingDetails,
    needsRenderedFallback,
    nextGalleryIterationState,
    parseMileageDetail,
    rankImageCandidates,
    resolveListingImages
  };
});
