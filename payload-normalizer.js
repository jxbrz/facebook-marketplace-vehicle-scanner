(function initialisePayloadNormalizer(root, factory) {
  const normalizer = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = normalizer;
  }

  root.PayloadNormalizer = normalizer;
})(typeof globalThis === "object" ? globalThis : this, function createPayloadNormalizer() {
  "use strict";

  const LIMITS = {
    fullDescriptionCharacters: 20000,
    imageCount: 20,
    urlCharacters: 4000,
    attributeCount: 40,
    attributeKeyCharacters: 80,
    attributeValueCharacters: 500,
    sellerNameCharacters: 240,
    listedAtTextCharacters: 240
  };

  const SENSITIVE_ATTRIBUTE_PATTERN = /(?:authorization|bearer|cookie|password|session|token|private\s*message)/i;

  function normaliseRemoteInteger(value, minimum = 0, maximum = null) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const integer = Math.round(number);
    if (integer < minimum || (maximum !== null && integer > maximum)) return null;
    return integer;
  }

  function normaliseRequiredText(value, field, maximumLength) {
    const text = String(value ?? "").trim();
    if (!text) throw new Error(`${field} is required.`);
    if (text.length > maximumLength) {
      throw new Error(`${field} exceeds ${maximumLength} characters.`);
    }
    return text;
  }

  function normaliseNullableText(value, maximumLength) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text.slice(0, maximumLength) : null;
  }

  function normaliseHttpUrl(value, field, nullable = false) {
    if (value === null || value === undefined || value === "") {
      if (nullable) return null;
      throw new Error(`${field} is required.`);
    }

    let parsed;
    try {
      parsed = new URL(String(value));
    } catch {
      throw new Error(`${field} must be a valid URL.`);
    }

    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new Error(`${field} must use HTTP or HTTPS.`);
    }

    const normalised = parsed.toString();
    if (normalised.length > 4000) {
      throw new Error(`${field} exceeds 4000 characters.`);
    }
    return normalised;
  }

  function normalisePreservedText(value, maximumLength) {
    if (typeof value !== "string") return null;
    const text = value.replace(/\r\n?/g, "\n").trim();
    return text ? text.slice(0, maximumLength) : null;
  }

  function normaliseImageUrls(value) {
    if (!Array.isArray(value)) return [];
    const urls = [];
    for (const item of value) {
      try {
        const url = normaliseHttpUrl(item, "imageUrls item");
        if (!urls.includes(url)) urls.push(url);
      } catch {
        // Optional malformed images are omitted; sourceUrl remains fail-closed.
      }
      if (urls.length >= LIMITS.imageCount) break;
    }
    return urls;
  }

  function normaliseVehicleAttributes(value) {
    const result = Object.create(null);
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    const entries = Object.entries(value)
      .filter(([key]) => !["__proto__", "constructor", "prototype"].includes(key.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right));

    for (const [rawKey, rawValue] of entries) {
      if (Object.keys(result).length >= LIMITS.attributeCount) break;
      if (!["string", "number", "boolean"].includes(typeof rawValue)) continue;
      const key = normaliseNullableText(rawKey, LIMITS.attributeKeyCharacters);
      const content = normaliseNullableText(rawValue, LIMITS.attributeValueCharacters);
      if (!key || !content || SENSITIVE_ATTRIBUTE_PATTERN.test(key)) continue;
      result[key] = content;
    }
    return result;
  }

  function normaliseFacebookProfileUrl(value) {
    let url;
    try {
      url = normaliseHttpUrl(value, "sellerProfileUrl", true);
    } catch {
      return null;
    }
    if (!url) return null;
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "facebook.com" || hostname.endsWith(".facebook.com") ? url : null;
  }

  function normaliseTimestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  function normaliseCurrency(value) {
    const currency = String(value || "GBP").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error("currency must be a three-letter code.");
    }
    return currency;
  }

  function normaliseRawMetadata(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("rawMetadata must be an object when provided.");
    }
    return value;
  }

  function normaliseRemoteListing(listing) {
    if (!listing || typeof listing !== "object" || Array.isArray(listing)) {
      throw new Error("Each uploaded listing must be an object.");
    }

    const status = String(listing.status || "").trim();
    if (!["matched", "rejected", "unavailable"].includes(status)) {
      throw new Error("status must be matched, rejected, or unavailable.");
    }

    const categoryType = listing.categoryType === null || listing.categoryType === undefined
      ? null
      : String(listing.categoryType).trim().toUpperCase();
    if (categoryType !== null && !["S", "N", "C", "D"].includes(categoryType)) {
      throw new Error("categoryType must be S, N, C, D, or null.");
    }

    const categoryDetected = listing.categoryDetected === true || categoryType !== null;
    if (listing.categoryDetected === true && categoryType === null) {
      throw new Error("categoryType is required when categoryDetected is true.");
    }

    return {
      externalListingId: normaliseRequiredText(
        listing.externalListingId,
        "externalListingId",
        160
      ),
      sourceUrl: normaliseHttpUrl(listing.sourceUrl, "sourceUrl"),
      title: normaliseNullableText(listing.title, 500),
      price: normaliseRemoteInteger(listing.price),
      currency: normaliseCurrency(listing.currency),
      year: normaliseRemoteInteger(listing.year, 1886, 2100),
      mileage: normaliseRemoteInteger(listing.mileage),
      location: normaliseNullableText(listing.location, 240),
      sellerType: normaliseNullableText(listing.sellerType, 80),
      fuelType: normaliseNullableText(listing.fuelType, 80),
      transmission: normaliseNullableText(listing.transmission, 80),
      bodyStyle: normaliseNullableText(listing.bodyStyle, 80),
      imageUrl: normaliseHttpUrl(listing.imageUrl, "imageUrl", true),
      imageUrls: normaliseImageUrls(listing.imageUrls),
      descriptionExcerpt: normaliseNullableText(listing.descriptionExcerpt, 2000),
      fullDescription: normalisePreservedText(listing.fullDescription, LIMITS.fullDescriptionCharacters),
      vehicleAttributes: normaliseVehicleAttributes(listing.vehicleAttributes),
      sellerName: normalisePreservedText(listing.sellerName, LIMITS.sellerNameCharacters),
      sellerProfileUrl: normaliseFacebookProfileUrl(listing.sellerProfileUrl),
      listedAtText: normalisePreservedText(listing.listedAtText, LIMITS.listedAtTextCharacters),
      status,
      rejectionCode: normaliseNullableText(listing.rejectionCode, 120),
      rejectionReason: normaliseNullableText(listing.rejectionReason, 1000),
      categoryDetected,
      categoryType,
      extractionSource: normaliseNullableText(listing.extractionSource, 120),
      rawMetadata: normaliseRawMetadata(listing.rawMetadata),
      discoveredAt: normaliseTimestamp(listing.discoveredAt),
      processedAt: normaliseTimestamp(listing.processedAt)
    };
  }

  return { LIMITS, normaliseRemoteInteger, normaliseRemoteListing };
});
