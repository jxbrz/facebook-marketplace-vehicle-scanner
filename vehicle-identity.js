(function initialiseVehicleIdentity(root, factory) {
  const identity = factory();
  if (typeof module === "object" && module.exports) module.exports = identity;
  root.VehicleIdentity = identity;
})(typeof globalThis === "object" ? globalThis : this, function createVehicleIdentity() {
  "use strict";

  const MAKE_ALIASES = new Map([
    ["vw", "Volkswagen"],
    ["volkswagen", "Volkswagen"],
    ["merc", "Mercedes-Benz"],
    ["mercedes", "Mercedes-Benz"],
    ["mercedes benz", "Mercedes-Benz"],
    ["bmw", "BMW"],
    ["audi", "Audi"],
    ["seat", "SEAT"],
    ["skoda", "Skoda"],
    ["vauxhall", "Vauxhall"],
    ["opel", "Opel"],
    ["land rover", "Land Rover"],
    ["range rover", "Range Rover"],
    ["ford", "Ford"],
    ["toyota", "Toyota"],
    ["honda", "Honda"],
    ["nissan", "Nissan"],
    ["volvo", "Volvo"],
    ["peugeot", "Peugeot"],
    ["renault", "Renault"],
    ["citroen", "Citroen"],
    ["fiat", "Fiat"],
    ["mini", "MINI"],
    ["kia", "Kia"],
    ["hyundai", "Hyundai"],
    ["mazda", "Mazda"],
    ["lexus", "Lexus"],
    ["jaguar", "Jaguar"]
  ]);

  function cleanDisplay(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
  }

  function normaliseKey(value) {
    return cleanDisplay(value)
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function normaliseFilterValues(value) {
    const input = Array.isArray(value) ? value : String(value || "").split(/[,\r\n]+/);
    const seen = new Set();
    const output = [];
    for (const item of input) {
      const display = cleanDisplay(item);
      const key = normaliseKey(display);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(display);
      if (output.length >= 30) break;
    }
    return output;
  }

  function canonicalMake(value) {
    const key = normaliseKey(value);
    return MAKE_ALIASES.get(key) || cleanDisplay(value);
  }

  function normaliseMakeFilters(value) {
    const seen = new Set();
    const output = [];
    for (const item of normaliseFilterValues(value)) {
      const make = canonicalMake(item);
      const key = normaliseKey(make);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(make);
    }
    return output;
  }

  function tokenPattern(value) {
    const escaped = normaliseKey(value).split(" ").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]+");
    return escaped ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i") : null;
  }

  function findKnownMake(text) {
    const candidate = normaliseKey(text);
    const aliases = [...MAKE_ALIASES.keys()].sort((left, right) => right.length - left.length);
    for (const alias of aliases) {
      const pattern = tokenPattern(alias);
      if (pattern?.test(candidate)) return MAKE_ALIASES.get(alias);
    }
    return null;
  }

  function findMake(text, selectedMakes = []) {
    const known = findKnownMake(text);
    if (known) return known;
    return selectedMakes.find(make => tokenPattern(make)?.test(normaliseKey(text))) || null;
  }

  function findAttribute(attributes, labels) {
    for (const [key, value] of Object.entries(attributes || {})) {
      if (labels.some(label => normaliseKey(key) === label)) return cleanDisplay(value);
    }
    return null;
  }

  function titleBeforeUnrelatedQualifier(title) {
    return cleanDisplay(title).split(/\b(?:with|w\/|wheels?|parts?|spares?|replica|style)\b/i)[0].trim();
  }

  function plausibleVehicleTitle(title, detectedMake) {
    return Boolean(
      detectedMake ||
      /\b(?:19[8-9]\d|20[0-3]\d)\b/.test(title) ||
      /\b\d(?:\.\d)?\s*(?:tsi|tdi|tfsi|gti|diesel|petrol|hybrid|automatic|manual)\b/i.test(title)
    );
  }

  function firstModelAfterMake(title, selectedMakes = []) {
    const key = normaliseKey(title);
    const aliases = [...new Set([
      ...MAKE_ALIASES.keys(),
      ...selectedMakes.map(normaliseKey)
    ])].sort((left, right) => right.length - left.length);
    for (const alias of aliases) {
      const match = tokenPattern(alias)?.exec(key);
      if (!match) continue;
      const remainder = key.slice(match.index + match[0].length)
        .replace(/^\s*(?:19[8-9]\d|20[0-3]\d)\s*/, "")
        .trim();
      const model = remainder.match(/^([a-z0-9]+(?:\s+class)?)/i)?.[1];
      return model ? cleanDisplay(model) : null;
    }
    return null;
  }

  function modelMatch(text, selectedModels) {
    const scopedTitle = titleBeforeUnrelatedQualifier(text);
    return selectedModels.find(model => tokenPattern(model)?.test(normaliseKey(scopedTitle))) || null;
  }

  function detectIdentity(sources, selectedMakes, selectedModels) {
    const structuredMake = cleanDisplay(sources?.structuredMake);
    const structuredModel = cleanDisplay(sources?.structuredModel);
    const listingTitle = cleanDisplay(sources?.listingTitle);
    const attributes = sources?.vehicleAttributes || {};
    const attributeMake = findAttribute(attributes, ["make", "manufacturer", "marque"]);
    const attributeModel = findAttribute(attributes, ["model", "vehicle model"]);
    const cardTitle = cleanDisplay(sources?.cardTitle);
    const candidates = [
      {
        source: "structured_fields",
        text: [structuredMake, structuredModel].filter(Boolean).join(" "),
        make: structuredMake ? canonicalMake(structuredMake) : null,
        model: structuredModel || null
      },
      {
        source: "listing_title",
        text: listingTitle,
        make: findMake(listingTitle, selectedMakes),
        model: modelMatch(listingTitle, selectedModels) || firstModelAfterMake(listingTitle, selectedMakes)
      },
      {
        source: "vehicle_attributes",
        text: [attributeMake, attributeModel].filter(Boolean).join(" "),
        make: attributeMake ? canonicalMake(attributeMake) : null,
        model: attributeModel || null
      },
      {
        source: "card_title",
        text: cardTitle,
        make: findMake(cardTitle, selectedMakes),
        model: modelMatch(cardTitle, selectedModels) || firstModelAfterMake(cardTitle, selectedMakes)
      }
    ];
    const makeCandidate = candidates.find(candidate => candidate.make);
    const modelCandidate = candidates.find(candidate => candidate.model);
    const sourcesUsed = [...new Set([makeCandidate?.source, modelCandidate?.source].filter(Boolean))];
    return {
      make: makeCandidate?.make || null,
      model: modelCandidate?.model || null,
      source: sourcesUsed.join("+") || null,
      sourceText: modelCandidate?.text || makeCandidate?.text || ""
    };
  }

  function evaluateFilters(filters, sources, options = {}) {
    const selectedMakes = normaliseMakeFilters(filters?.acceptedMakes);
    const selectedModels = normaliseFilterValues(filters?.acceptedModels);
    const identity = detectIdentity(sources, selectedMakes, selectedModels);
    const makeKeys = new Set(selectedMakes.map(normaliseKey));
    const makeMatched = !selectedMakes.length || Boolean(identity.make && makeKeys.has(normaliseKey(canonicalMake(identity.make))));
    const matchedModel = identity.model
      ? selectedModels.find(model => tokenPattern(model)?.test(normaliseKey(identity.model))) || null
      : modelMatch(identity.sourceText, selectedModels);
    const titlePlausible = plausibleVehicleTitle(identity.sourceText, identity.make);
    const modelMatched = !selectedModels.length || Boolean(matchedModel && (identity.source !== "listing_title" && identity.source !== "card_title" || titlePlausible));
    const makeKnown = Boolean(identity.make);
    const modelKnown = Boolean(identity.model || matchedModel);

    let rejectionCode = null;
    if (selectedMakes.length && makeKnown && !makeMatched) rejectionCode = "make_not_allowed";
    else if (selectedModels.length && modelKnown && !modelMatched) rejectionCode = "model_not_allowed";
    else if (options.final && selectedMakes.length && !makeMatched) rejectionCode = "make_not_allowed";
    else if (options.final && selectedModels.length && !modelMatched) rejectionCode = "model_not_allowed";

    const selectedMakeText = selectedMakes.slice(0, 20);
    const selectedModelText = selectedModels.slice(0, 20);
    return {
      accepted: rejectionCode === null,
      rejectionCode,
      reason: rejectionCode === "make_not_allowed"
        ? `Detected make ${identity.make || "unknown"} is not allowed`
        : rejectionCode === "model_not_allowed"
          ? `Detected model ${identity.model || "unknown"} is not allowed`
          : null,
      detectedMake: identity.make,
      detectedModel: matchedModel || identity.model,
      source: identity.source,
      diagnostics: {
        detectedMake: identity.make,
        detectedModel: matchedModel || identity.model,
        sourceField: identity.source,
        normalisedCandidate: normaliseKey(identity.sourceText).slice(0, 160),
        selectedMakes: selectedMakeText,
        selectedModels: selectedModelText,
        matchingRule: "explicit_alias_and_token_match_v1"
      }
    };
  }

  function identifyVehicle(sources, options = {}) {
    const selectedMakes = normaliseMakeFilters(options.makes);
    const selectedModels = normaliseFilterValues(options.models);
    const identity = detectIdentity(sources, selectedMakes, selectedModels);
    const matchedModel = identity.model
      ? selectedModels.find(model => tokenPattern(model)?.test(normaliseKey(identity.model))) || null
      : modelMatch(identity.sourceText, selectedModels);
    return {
      detectedMake: identity.make,
      detectedModel: matchedModel || identity.model,
      source: identity.source,
      diagnostics: {
        detectedMake: identity.make,
        detectedModel: matchedModel || identity.model,
        sourceField: identity.source,
        normalisedCandidate: normaliseKey(identity.sourceText).slice(0, 160),
        matchingRule: "explicit_alias_and_token_detection_v1"
      }
    };
  }

  return { canonicalMake, evaluateFilters, identifyVehicle, normaliseFilterValues, normaliseKey, normaliseMakeFilters };
});
