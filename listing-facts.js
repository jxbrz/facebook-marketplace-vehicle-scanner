(function initialiseListingFacts(root, factory) {
  const catalogue = typeof module === "object" && module.exports
    ? require("./vehicle-catalogue.js")
    : root.VehicleCatalogue;
  const api = factory(catalogue);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ListingFacts = api;
})(typeof globalThis === "object" ? globalThis : this, function createListingFacts(VehicleCatalogue) {
  "use strict";

  const TRANSMISSIONS = ["manual", "automatic", "semiautomatic"];
  const FUELS = ["petrol", "diesel", "hybrid", "plug-in hybrid", "electric", "lpg", "other"];
  const COLOURS = ["black", "white", "silver", "grey", "blue", "red", "green", "yellow", "orange", "brown", "beige", "purple", "gold", "bronze", "other"];
  const BODY_TYPES = ["hatchback", "saloon", "estate", "suv", "coupe", "convertible", "mpv", "pickup", "van", "other"];

  function text(value, limit = 20000) {
    const result = String(value || "").trim().replace(/\r\n/g, "\n");
    return result ? result.slice(0, limit) : null;
  }

  function integer(value, options = {}) {
    if (value === null || value === undefined || value === "") return null;
    const number = typeof value === "number"
      ? value
      : Number(String(value).replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(number)) return null;
    const rounded = Math.round(number);
    if (rounded < (options.minimum ?? 0) || rounded > (options.maximum ?? Number.MAX_SAFE_INTEGER)) return null;
    return rounded;
  }

  function parsePrice(value) {
    if (typeof value === "string") {
      const match = value.replace(/,/g, "").match(/(?:£|gbp\s*)?(\d{1,7})/i);
      return integer(match?.[1], { maximum: 10_000_000 });
    }
    return integer(value, { maximum: 10_000_000 });
  }

  function parseMileage(value) {
    if (typeof value === "string") {
      const compact = value.replace(/,/g, "");
      const match = compact.match(/(\d+(?:\.\d+)?)\s*(k)?\s*(?:miles?|mi)?/i);
      if (!match) return null;
      return integer(Number(match[1]) * (match[2] ? 1000 : 1), { maximum: 1_000_000 });
    }
    return integer(value, { maximum: 1_000_000 });
  }

  function parseYear(value) {
    if (typeof value === "string") value = value.match(/\b(19\d{2}|20\d{2}|2100)\b/)?.[1];
    return integer(value, { minimum: 1886, maximum: 2100 });
  }

  function normaliseTransmission(value) {
    const raw = VehicleCatalogue.key(value);
    if (!raw) return "unknown";
    if (/semi automatic|semi auto|semiautomatic|automatic manual|dsg/.test(raw)) return "semiautomatic";
    if (/automatic|auto|cvt/.test(raw)) return "automatic";
    if (/manual/.test(raw)) return "manual";
    if (raw === "other") return "other";
    return "unknown";
  }

  function normaliseFuel(value) {
    const raw = VehicleCatalogue.key(value);
    if (!raw) return "unknown";
    if (/plug in hybrid|phev/.test(raw)) return "plug-in hybrid";
    if (/hybrid/.test(raw)) return "hybrid";
    if (/electric|ev/.test(raw)) return "electric";
    if (/diesel/.test(raw)) return "diesel";
    if (/petrol|gasoline/.test(raw)) return "petrol";
    if (/lpg|liquefied petroleum/.test(raw)) return "lpg";
    return "other";
  }

  function normaliseControlled(value, allowed, aliases = {}) {
    const raw = VehicleCatalogue.key(value);
    if (!raw) return "unknown";
    const mapped = aliases[raw] || raw;
    return allowed.includes(mapped) ? mapped : "other";
  }

  function normaliseColour(value) {
    const raw = VehicleCatalogue.key(value).replace(/\b(?:metallic|pearlescent|pearl|solid)\b/g, "").trim();
    if (!raw) return "unknown";
    const found = COLOURS.find(colour => colour !== "other" && new RegExp(`(?:^| )${colour === "grey" ? "gr(?:e|a)y" : colour}(?: |$)`).test(raw));
    return found || "other";
  }

  function normaliseBodyType(value) {
    return normaliseControlled(value, BODY_TYPES, {
      "sport utility vehicle": "suv", "4x4": "suv", sedan: "saloon", wagon: "estate",
      cabriolet: "convertible", roadster: "convertible", peoplecarrier: "mpv", "people carrier": "mpv"
    });
  }

  function normaliseCategory(input = {}) {
    const supplied = VehicleCatalogue.key(input.categoryStatus || input.category);
    const categoryMap = {
      s: "cat_s", "cat s": "cat_s", "category s": "cat_s", cat_s: "cat_s",
      n: "cat_n", "cat n": "cat_n", "category n": "cat_n", cat_n: "cat_n",
      c: "cat_c", "cat c": "cat_c", "category c": "cat_c", cat_c: "cat_c",
      d: "cat_d", "cat d": "cat_d", "category d": "cat_d", cat_d: "cat_d",
      clean: "clean", other: "other", unknown: "unknown"
    };
    if (input.categoryDetected && categoryMap[supplied]) return categoryMap[supplied];
    if (categoryMap[supplied] && supplied !== "unknown") return categoryMap[supplied];
    const evidence = [input.title, input.description, input.categoryEvidence].filter(Boolean).join(" ");
    if (/\b(?:hpi|insurance|write[- ]?off)\s+clear\b|\bclear\s+(?:hpi|insurance history)\b/i.test(evidence)) return "clean";
    return "unknown";
  }

  function describedAsRepaired(input = {}) {
    const evidence = [input.title, input.description, input.categoryEvidence].filter(Boolean).join(" ");
    return /\b(?:(?:fully|professionally|previously)\s+)?repaired\b/i.test(evidence);
  }

  function source(value, fallback) {
    return text(value, 80) || fallback;
  }

  function normaliseListingFacts(input = {}) {
    const title = text(input.title, 500);
    const description = text(input.description);
    const identity = VehicleCatalogue.detectIdentity({
      make: input.make,
      model: input.model,
      title,
      text: input.identityText
    });
    const facts = {
      listingId: text(input.listingId, 160),
      listingUrl: text(input.listingUrl || input.url, 4000),
      title,
      description,
      price: parsePrice(input.price),
      mileage: parseMileage(input.mileage),
      year: parseYear(input.year),
      make: identity.make,
      model: identity.model,
      derivative: text(input.derivative || input.trim, 160),
      transmission: normaliseTransmission(input.transmission),
      fuelType: normaliseFuel(input.fuelType),
      colour: normaliseColour(input.colour),
      bodyType: normaliseBodyType(input.bodyType || input.bodyStyle),
      categoryStatus: normaliseCategory(input),
      categoryEvidence: text(input.categoryEvidence || input.categoryMatch, 240),
      repairedVehicle: describedAsRepaired(input),
      sellerType: /\bdealer(?:ship)?\b/i.test(input.sellerType || "") ? "dealer" : /\bprivate\b/i.test(input.sellerType || "") ? "private" : "unknown",
      location: text(input.location, 240),
      distance: integer(input.distance, { maximum: 10_000 }),
      textCorpus: [title, description, text(input.cardText, 2000)].filter(Boolean).join("\n").toLowerCase(),
      sources: {
        price: source(input.sources?.price, "unknown"), mileage: source(input.sources?.mileage, "unknown"),
        year: source(input.sources?.year, "unknown"), make: source(input.sources?.make, identity.source || "unknown"),
        model: source(input.sources?.model, identity.source || "unknown"), transmission: source(input.sources?.transmission, "unknown"),
        fuelType: source(input.sources?.fuelType, "unknown"), colour: source(input.sources?.colour, "unknown"),
        bodyType: source(input.sources?.bodyType, "unknown"), categoryStatus: source(input.sources?.categoryStatus, "category_evidence"),
        textCorpus: source(input.sources?.textCorpus, description ? "listing_detail" : "search_card")
      },
      confidence: {
        price: input.confidence?.price || (parsePrice(input.price) === null ? "unknown" : "moderate"),
        mileage: input.confidence?.mileage || (parseMileage(input.mileage) === null ? "unknown" : "moderate"),
        year: input.confidence?.year || (parseYear(input.year) === null ? "unknown" : "moderate"),
        make: input.confidence?.make || identity.confidence,
        model: input.confidence?.model || (identity.model ? identity.confidence : "unknown"),
        transmission: input.confidence?.transmission || (normaliseTransmission(input.transmission) === "unknown" ? "unknown" : "moderate"),
        fuelType: input.confidence?.fuelType || (normaliseFuel(input.fuelType) === "unknown" ? "unknown" : "moderate"),
        colour: input.confidence?.colour || (normaliseColour(input.colour) === "unknown" ? "unknown" : "moderate"),
        bodyType: input.confidence?.bodyType || (normaliseBodyType(input.bodyType || input.bodyStyle) === "unknown" ? "unknown" : "moderate"),
        categoryStatus: input.confidence?.categoryStatus || (normaliseCategory(input) === "unknown" ? "unknown" : "high")
      },
      rawValues: {
        price: text(input.price, 120), mileage: text(input.mileage, 120), year: text(input.year, 120),
        make: text(input.make, 120), model: text(input.model, 160), transmission: text(input.transmission, 120),
        fuelType: text(input.fuelType, 120), colour: text(input.colour, 120), bodyType: text(input.bodyType || input.bodyStyle, 120),
        categoryStatus: text(input.categoryStatus || input.category, 120)
      }
    };
    facts.unknownFields = ["price", "mileage", "year", "make", "model", "transmission", "fuelType", "colour", "bodyType", "categoryStatus"]
      .filter(field => facts[field] === null || facts[field] === "unknown");
    return facts;
  }

  return {
    BODY_TYPES, COLOURS, FUELS, TRANSMISSIONS,
    describedAsRepaired, normaliseBodyType, normaliseCategory, normaliseColour, normaliseFuel,
    normaliseListingFacts, normaliseTransmission, parseMileage, parsePrice, parseYear
  };
});
