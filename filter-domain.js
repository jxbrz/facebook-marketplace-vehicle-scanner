(function initialiseFilterDomain(root, factory) {
  const catalogue = typeof module === "object" && module.exports ? require("./vehicle-catalogue.js") : root.VehicleCatalogue;
  const api = factory(catalogue);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FilterDomain = api;
})(typeof globalThis === "object" ? globalThis : this, function createFilterDomain(VehicleCatalogue) {
  "use strict";

  const FILTER_SCHEMA_VERSION = 2;
  const UNKNOWN_POLICIES = ["inspect_then_reject", "include_with_warning", "exclude", "ignore_filter_for_unknown"];
  const CATEGORY_STATUSES = ["clean", "cat_s", "cat_n", "cat_c", "cat_d", "other", "unknown"];
  const CATEGORY_MODES = ["any", "clean_only", "category_only", "selected"];
  const SPECIFICATION_OPTIONS = {
    transmissions: ["manual", "automatic", "semiautomatic", "other", "unknown"],
    fuelTypes: ["petrol", "diesel", "hybrid", "plug-in hybrid", "electric", "lpg", "other", "unknown"],
    colours: ["black", "white", "grey", "silver", "blue", "red", "green", "yellow", "orange", "brown", "beige", "gold", "purple", "bronze", "other", "unknown"],
    bodyTypes: ["hatchback", "saloon", "estate", "suv", "coupe", "convertible", "mpv", "van", "pickup", "other", "unknown"]
  };
  const DEFAULT_UNKNOWN_POLICIES = {
    price: "inspect_then_reject", mileage: "inspect_then_reject", year: "inspect_then_reject",
    makeModel: "inspect_then_reject", categoryStatus: "inspect_then_reject",
    transmission: "include_with_warning", fuelType: "include_with_warning",
    colour: "include_with_warning", bodyType: "include_with_warning"
  };

  function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const rounded = Math.round(number);
    return rounded >= minimum && rounded <= maximum ? rounded : null;
  }

  function list(value, normaliser = item => String(item || "").trim().toLowerCase()) {
    const values = Array.isArray(value) ? value : String(value || "").split(/[,\r\n]+/);
    const output = [];
    const seen = new Set();
    for (const item of values) {
      const normalised = normaliser(item);
      const key = VehicleCatalogue.key(normalised);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(normalised);
      if (output.length >= 50) break;
    }
    return output;
  }

  function selection(value, allowed) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const include = list(source.include || value).filter(item => allowed.includes(item));
    const exclude = list(source.exclude).filter(item => allowed.includes(item) && !include.includes(item));
    return { mode: include.length || exclude.length ? "selected" : "any", include, exclude };
  }

  function selectionState(selectionConfig, value) {
    if (selectionConfig.include.includes(value)) return "include";
    if (selectionConfig.exclude.includes(value)) return "exclude";
    return "ignore";
  }

  function setSelectionState(selectionConfig, value, state) {
    const include = selectionConfig.include.filter(item => item !== value);
    const exclude = selectionConfig.exclude.filter(item => item !== value);
    if (state === "include") include.push(value);
    if (state === "exclude") exclude.push(value);
    return { mode: include.length || exclude.length ? "selected" : "any", include, exclude };
  }

  function optionLabel(value) {
    if (value === "clean_only" || value === "clean only") return "Exclude category vehicles";
    if (value === "selected") return "Selected categories";
    if (value === "semiautomatic") return "Semi-automatic";
    if (value === "suv" || value === "lpg") return value.toUpperCase();
    return String(value).replace(/^./, character => character.toUpperCase());
  }

  function selectionSummary(selectionConfig) {
    const parts = [];
    if (selectionConfig.include.length) parts.push(`Include ${selectionConfig.include.map(optionLabel).join(", ")}`);
    if (selectionConfig.exclude.length) parts.push(`Exclude ${selectionConfig.exclude.map(optionLabel).join(", ")}`);
    return parts.join(" · ") || "Any";
  }

  function policy(value, fallback) {
    return UNKNOWN_POLICIES.includes(value) ? value : fallback;
  }

  function normaliseFilterConfig(value = {}) {
    const source = value && typeof value === "object" ? value : {};
    const vehicle = source.vehicle || {};
    const priceMileage = source.priceMileage || {};
    const specification = source.specification || {};
    const category = source.category || {};
    const textFilter = source.text || {};
    const unknown = source.unknownPolicies || {};
    const scan = source.scan || {};
    const makes = VehicleCatalogue.normaliseMakes(vehicle.makes ?? source.acceptedMakes);
    const rawModels = VehicleCatalogue.normaliseModels(vehicle.models ?? source.acceptedModels, makes);
    const models = rawModels.filter(model => VehicleCatalogue.isModelCompatible(model, makes));
    const legacyCategories = list(source.excludedCategories || source.excludeCategories, item => String(item || "").toUpperCase());
    const suppliedMode = category.mode;
    const suppliedModeIsValid = CATEGORY_MODES.includes(suppliedMode);
    const categoryMode = CATEGORY_MODES.includes(suppliedMode)
      ? suppliedMode
      : legacyCategories.some(item => ["S", "N", "C", "D"].includes(item)) ? "selected" : "any";
    const statuses = list(category.statuses).filter(item => CATEGORY_STATUSES.includes(item));
    const legacyExcludedStatuses = new Set(
      legacyCategories
        .filter(item => ["S", "N", "C", "D"].includes(item))
        .map(item => `cat_${item.toLowerCase()}`)
    );
    const categoryStatuses = suppliedModeIsValid
      ? statuses
      : CATEGORY_STATUSES.filter(status => !legacyExcludedStatuses.has(status));
    const transmissions = selection(specification.transmissions ?? source.transmissions, SPECIFICATION_OPTIONS.transmissions);
    const fuelTypes = selection(specification.fuelTypes ?? source.fuelTypes, SPECIFICATION_OPTIONS.fuelTypes);
    const colours = selection(specification.colours ?? source.colours, SPECIFICATION_OPTIONS.colours);
    const bodyTypes = selection(specification.bodyTypes ?? source.bodyTypes, SPECIFICATION_OPTIONS.bodyTypes);
    const requiredKeywords = list(textFilter.requiredKeywords ?? source.requiredKeywords, item => String(item || "").trim().toLowerCase());
    const hasAdvancedRestrictions = [fuelTypes, colours, bodyTypes]
      .some(item => item.include.length > 0 || item.exclude.length > 0) ||
      requiredKeywords.length > 0 ||
      ["fuelType", "colour", "bodyType"].some(field =>
        unknown[field] !== undefined && policy(unknown[field], DEFAULT_UNKNOWN_POLICIES[field]) !== DEFAULT_UNKNOWN_POLICIES[field]
      );
    return {
      filterSchemaVersion: FILTER_SCHEMA_VERSION,
      catalogueVersion: VehicleCatalogue.CATALOGUE_VERSION,
      advancedFiltersEnabled: typeof source.advancedFiltersEnabled === "boolean"
        ? source.advancedFiltersEnabled
        : hasAdvancedRestrictions,
      includeUnavailableOptional: source.includeUnavailableOptional !== false,
      vehicle: {
        makes,
        models,
        minYear: integer(vehicle.minYear ?? source.minYear, 1886, 2100),
        maxYear: integer(vehicle.maxYear ?? source.maxYear, 1886, 2100)
      },
      priceMileage: {
        minPrice: integer(priceMileage.minPrice ?? source.minPrice),
        maxPrice: integer(priceMileage.maxPrice ?? source.maxPrice),
        minMileage: integer(priceMileage.minMileage ?? source.minMileage, 0, 1_000_000),
        maxMileage: integer(priceMileage.maxMileage ?? source.maxMileage, 0, 1_000_000)
      },
      specification: {
        transmissions,
        fuelTypes,
        colours,
        bodyTypes
      },
      category: {
        mode: categoryMode,
        statuses: categoryMode === "selected" ? categoryStatuses : [],
        includeRepairedVehicles: Boolean(category.includeRepairedVehicles)
      },
      text: {
        requiredKeywords,
        excludedKeywords: list(textFilter.excludedKeywords ?? source.excludedKeywords, item => String(item || "").trim().toLowerCase())
      },
      unknownPolicies: {
        price: policy(unknown.price, DEFAULT_UNKNOWN_POLICIES.price),
        mileage: policy(unknown.mileage ?? (source.unknownMileagePolicy === "hide" ? "inspect_then_reject" : null), DEFAULT_UNKNOWN_POLICIES.mileage),
        year: policy(unknown.year, DEFAULT_UNKNOWN_POLICIES.year),
        makeModel: policy(unknown.makeModel, DEFAULT_UNKNOWN_POLICIES.makeModel),
        categoryStatus: policy(unknown.categoryStatus, DEFAULT_UNKNOWN_POLICIES.categoryStatus),
        transmission: policy(unknown.transmission, DEFAULT_UNKNOWN_POLICIES.transmission),
        fuelType: policy(unknown.fuelType, DEFAULT_UNKNOWN_POLICIES.fuelType),
        colour: policy(unknown.colour, DEFAULT_UNKNOWN_POLICIES.colour),
        bodyType: policy(unknown.bodyType, DEFAULT_UNKNOWN_POLICIES.bodyType)
      },
      scan: {
        targetMatches: integer(scan.targetMatches ?? source.targetMatches, 1, 250) ?? 20,
        maximumProcessed: integer(scan.maximumProcessed ?? source.maximumProcessed, 1, 500) ?? 150,
        maximumDurationSeconds: integer(scan.maximumDurationSeconds ?? source.maximumDurationSeconds, 30, 3600) ?? 300,
        autoLoadEnabled: source.autoLoadEnabled ?? scan.autoLoadEnabled ?? true,
        autoOpenResults: source.autoOpenResults ?? scan.autoOpenResults ?? true
      }
    };
  }

  function validateFilterConfig(value) {
    const config = normaliseFilterConfig(value);
    const errors = [];
    const pairs = [
      ["Minimum year", config.vehicle.minYear, "Maximum year", config.vehicle.maxYear],
      ["Minimum price", config.priceMileage.minPrice, "Maximum price", config.priceMileage.maxPrice],
      ["Minimum mileage", config.priceMileage.minMileage, "Maximum mileage", config.priceMileage.maxMileage]
    ];
    for (const [minimumLabel, minimum, maximumLabel, maximum] of pairs) {
      if (minimum !== null && maximum !== null && minimum > maximum) errors.push(`${minimumLabel} cannot exceed ${maximumLabel.toLowerCase()}.`);
    }
    if (config.scan.maximumProcessed < config.scan.targetMatches) errors.push("Maximum listings inspected must be at least target matches.");
    if (config.category.mode === "selected" && !config.category.statuses.length) errors.push("Select at least one category status.");
    return { valid: errors.length === 0, errors, config };
  }

  const LABELS = {
    price: "Price", mileage: "Mileage", year: "Year", make: "Make", model: "Model",
    transmission: "Transmission", fuelType: "Fuel type", colour: "Colour", bodyType: "Body type", categoryStatus: "Category status"
  };

  function formatNumber(value) {
    return Number(value).toLocaleString("en-GB");
  }

  function evaluateFilters(facts, inputConfig, options = {}) {
    const config = normaliseFilterConfig(inputConfig);
    const phase = options.phase === "prefilter" ? "prefilter" : "final";
    const rejectionReasons = [];
    const rejectionEvidence = [];
    const unresolvedReasons = [];
    const warnings = [];
    const missingRequiredFields = [];
    const evaluatedValues = {};

    function reject(code, field, reason) {
      rejectionReasons.push(reason);
      rejectionEvidence.push({
        code,
        field,
        source: String(facts.sources?.[field] || "unknown"),
        confidence: String(facts.confidence?.[field] || "unknown"),
        valueKnown: facts[field] !== null && facts[field] !== undefined && facts[field] !== "unknown"
      });
    }

    function identityEvidenceReliable(field) {
      if (phase === "final") return true;
      const source = String(facts.sources?.[field] || "");
      const confidence = String(facts.confidence?.[field] || "unknown");
      return confidence === "high" && /structured_fields|vehicle_attributes|search_card_reliable/.test(source);
    }

    function unknown(field, policyName, active) {
      if (!active) return;
      const label = LABELS[field];
      missingRequiredFields.push(field);
      if (phase === "prefilter") {
        unresolvedReasons.push(`${label} unavailable on the card; detail inspection required`);
        return;
      }
      const selectedPolicy = !config.advancedFiltersEnabled && ["transmission", "fuelType", "colour", "bodyType"].includes(policyName)
        ? config.includeUnavailableOptional ? "include_with_warning" : "exclude"
        : config.unknownPolicies[policyName];
      if (selectedPolicy === "include_with_warning") warnings.push(`${label} unavailable after detail inspection`);
      if (selectedPolicy === "ignore_filter_for_unknown") warnings.push(`${label} unavailable; filter ignored by saved-search policy`);
      if (selectedPolicy === "inspect_then_reject" || selectedPolicy === "exclude") {
        reject(`${field}_unavailable`, field, `${label} unavailable after detail inspection`);
      }
    }

    function numeric(field, policyName, minimum, maximum, suffix = "") {
      const value = facts[field];
      const active = minimum !== null || maximum !== null;
      evaluatedValues[field] = value;
      if (value === null || value === undefined) return unknown(field, policyName, active);
      if (minimum !== null && value < minimum) reject(`${field}_below_minimum`, field, `${LABELS[field]} ${formatNumber(value)}${suffix} is below minimum ${formatNumber(minimum)}${suffix}`);
      if (maximum !== null && value > maximum) reject(`${field}_above_maximum`, field, `${LABELS[field]} ${formatNumber(value)}${suffix} exceeds maximum ${formatNumber(maximum)}${suffix}`);
    }

    numeric("price", "price", config.priceMileage.minPrice, config.priceMileage.maxPrice, " GBP");
    numeric("mileage", "mileage", config.priceMileage.minMileage, config.priceMileage.maxMileage, " miles");
    numeric("year", "year", config.vehicle.minYear, config.vehicle.maxYear);

    const makesActive = config.vehicle.makes.length > 0;
    const modelsActive = config.vehicle.models.length > 0;
    evaluatedValues.make = facts.make;
    evaluatedValues.model = facts.model;
    if (!facts.make) unknown("make", "makeModel", makesActive);
    else if (makesActive && !config.vehicle.makes.some(make =>
      VehicleCatalogue.key(make) === VehicleCatalogue.key(facts.make) ||
      VehicleCatalogue.key(make) === VehicleCatalogue.key(VehicleCatalogue.OTHER_MAKE) && !VehicleCatalogue.isKnownMake(facts.make)
    )) {
      if (identityEvidenceReliable("make")) reject("make_not_selected", "make", `Make ${facts.make} is not selected`);
      else unresolvedReasons.push(`Make evidence is uncertain on the card; detail inspection required`);
    }
    if (!facts.model) unknown("model", "makeModel", modelsActive);
    else if (modelsActive && !config.vehicle.models.some(model => VehicleCatalogue.key(model) === VehicleCatalogue.key(facts.model))) {
      if (identityEvidenceReliable("model")) reject("model_not_selected", "model", `Model ${facts.model} is not selected`);
      else unresolvedReasons.push(`Model evidence is uncertain on the card; detail inspection required`);
    }

    function selected(field, policyName, selectionConfig) {
      const value = facts[field];
      const active = selectionConfig.include.length > 0 || selectionConfig.exclude.length > 0;
      evaluatedValues[field] = value;
      if (value === "unknown" || value === null || value === undefined) {
        if (phase === "prefilter") return unknown(field, policyName, active);
        if (selectionConfig.exclude.includes("unknown")) return void reject(`${field}_unknown_excluded`, field, `${LABELS[field]} is unknown and excluded`);
        if (selectionConfig.include.includes("unknown")) return;
        return unknown(field, policyName, active);
      }
      if (selectionConfig.include.length && !selectionConfig.include.includes(value)) reject(`${field}_not_selected`, field, `${LABELS[field]} ${value} is not selected`);
      if (selectionConfig.exclude.includes(value)) reject(`${field}_excluded`, field, `${LABELS[field]} ${value} is excluded`);
    }
    selected("transmission", "transmission", config.specification.transmissions);
    if (config.advancedFiltersEnabled) {
      selected("fuelType", "fuelType", config.specification.fuelTypes);
      selected("colour", "colour", config.specification.colours);
      selected("bodyType", "bodyType", config.specification.bodyTypes);
    }

    const category = facts.categoryStatus || "unknown";
    const categoryEvidenceState = facts.categoryEvidenceState ||
      (category === "clean"
        ? "confirmed_clean"
        : ["cat_s", "cat_n", "cat_c", "cat_d", "other"].includes(category)
          ? "confirmed_category"
          : "no_category_evidence");
    const categoryAssessment = category === "clean"
      ? "confirmedClean"
      : ["cat_s", "cat_n", "cat_c", "cat_d", "other"].includes(category)
        ? "confirmedCategory"
        : categoryEvidenceState === "explicitly_unknown"
          ? "explicitlyUnknown"
          : phase === "final"
            ? "presumedCleanNoCategoryEvidence"
            : "unassessed";
    evaluatedValues.categoryStatus = category;
    evaluatedValues.categoryAssessment = categoryAssessment;
    evaluatedValues.repairedVehicle = Boolean(facts.repairedVehicle);
    const categoryActive = config.category.mode !== "any";
    const presumedCleanForFilter =
      config.category.mode === "clean_only" &&
      categoryAssessment === "presumedCleanNoCategoryEvidence";
    if (category === "unknown" && !presumedCleanForFilter) {
      unknown(
        "categoryStatus",
        "categoryStatus",
        categoryActive &&
          (phase === "prefilter" || !(config.category.mode === "selected" && config.category.statuses.includes("unknown")))
      );
    }
    if (presumedCleanForFilter) {
      warnings.push("No category wording found after detail inspection; presumed clean for filtering only, not HPI verified");
    }
    if (config.category.mode === "clean_only" && category !== "clean" && category !== "unknown") reject("category_not_clean", "categoryStatus", `Category status ${category.replace("cat_", "Cat ").toUpperCase()} is not clean`);
    if (config.category.mode === "category_only" && category !== "unknown" && !["cat_s", "cat_n", "cat_c", "cat_d", "other"].includes(category)) reject("category_not_confirmed", "categoryStatus", `Category status ${category} is not a confirmed category vehicle`);
    if (config.category.mode === "selected" && category !== "unknown" && !config.category.statuses.includes(category)) reject("category_not_selected", "categoryStatus", `Category status ${category.replace("cat_", "Cat ")} is not selected`);
    if (facts.repairedVehicle && !config.category.includeRepairedVehicles) reject("repaired_vehicle_excluded", "categoryStatus", "Advert is described as repaired, but repaired vehicles are not included");

    const corpus = String(facts.textCorpus || "").toLowerCase();
    if (config.advancedFiltersEnabled) for (const keyword of config.text.requiredKeywords) {
      if (corpus.includes(keyword)) continue;
      if (phase === "prefilter") unresolvedReasons.push(`Required keyword “${keyword}” not confirmed on the card; detail inspection required`);
      else reject("required_keyword_missing", "textCorpus", `Required keyword “${keyword}” was not found`);
    }
    for (const keyword of config.text.excludedKeywords) if (corpus.includes(keyword)) reject("excluded_keyword_present", "textCorpus", `Excluded keyword “${keyword}” found`);

    const unique = values => [...new Set(values)];
    const rejected = unique(rejectionReasons);
    const rejectedReasonSet = new Set(rejected);
    const rejectedEvidence = rejectionEvidence.filter((item, index) =>
      rejectedReasonSet.has(rejectionReasons[index]) &&
      rejectionEvidence.findIndex(candidate => candidate.code === item.code && candidate.field === item.field) === index
    );
    const unresolved = unique(unresolvedReasons);
    const decision = rejected.length ? "reject" : unresolved.length ? "unresolved" : "match";
    return {
      decision,
      detailRequired: decision === "unresolved",
      provenReject: decision === "reject",
      evidenceQuality: decision === "reject" ? "proven" : unresolved.length ? "incomplete" : "complete",
      rejectionReasons: rejected,
      rejectionReasonCodes: unique(rejectedEvidence.map(item => item.code)),
      rejectionEvidence: rejectedEvidence,
      unresolvedReasons: unresolved,
      warnings: unique(warnings),
      evaluatedValues,
      categoryAssessment,
      missingRequiredFields: unique(missingRequiredFields),
      diagnostics: {
        filterSchemaVersion: config.filterSchemaVersion,
        catalogueVersion: config.catalogueVersion,
        phase,
        unknownPolicies: config.unknownPolicies,
        categoryEvidence: facts.categoryEvidence || null,
        categoryEvidenceState
      }
    };
  }

  function filterFingerprint(value) {
    return JSON.stringify(normaliseFilterConfig(value));
  }

  function filterSummary(value) {
    const config = normaliseFilterConfig(value);
    const range = (minimum, maximum, prefix = "", suffix = "") => minimum === null && maximum === null
      ? "Any"
      : `${minimum === null ? "Any" : prefix + formatNumber(minimum) + suffix} – ${maximum === null ? "Any" : prefix + formatNumber(maximum) + suffix}`;
    const makes = config.vehicle.makes.length ? config.vehicle.makes.join(", ") : "Any make";
    const models = config.vehicle.models.length ? config.vehicle.models.join(", ") : "Any model";
    const category = config.category.mode === "clean_only"
      ? "Exclude category vehicles"
      : config.category.mode === "selected"
      ? config.category.statuses.map(optionLabel).join(", ") || "No statuses"
      : config.category.mode.replaceAll("_", " ").replace(/^./, character => character.toUpperCase());
    return [
      { label: "Vehicle", value: `${makes} · ${models} · ${range(config.vehicle.minYear, config.vehicle.maxYear)}` },
      { label: "Price / mileage", value: `${range(config.priceMileage.minPrice, config.priceMileage.maxPrice, "£")} · ${range(config.priceMileage.minMileage, config.priceMileage.maxMileage, "", " mi")}` },
      { label: "Transmission", value: selectionSummary(config.specification.transmissions) },
      { label: "Fuel", value: selectionSummary(config.specification.fuelTypes) },
      { label: "Colour", value: selectionSummary(config.specification.colours) },
      { label: "Body", value: selectionSummary(config.specification.bodyTypes) },
      { label: "Category", value: category },
      { label: "Advanced", value: config.advancedFiltersEnabled ? "Active" : "Off" },
      { label: "Scan", value: `${config.scan.targetMatches} matches · ${config.scan.maximumProcessed} max · ${Math.round(config.scan.maximumDurationSeconds / 60)} min` }
    ];
  }

  return {
    CATEGORY_MODES, CATEGORY_STATUSES, DEFAULT_UNKNOWN_POLICIES, FILTER_SCHEMA_VERSION, SPECIFICATION_OPTIONS, UNKNOWN_POLICIES,
    evaluateFilters, filterFingerprint, filterSummary, normaliseFilterConfig, optionLabel, selectionState,
    selectionSummary, setSelectionState, validateFilterConfig
  };
});
