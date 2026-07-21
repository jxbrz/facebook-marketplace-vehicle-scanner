(function initialiseVehicleCatalogue(root, factory) {
  const catalogue = factory();
  if (typeof module === "object" && module.exports) module.exports = catalogue;
  root.VehicleCatalogue = catalogue;
})(typeof globalThis === "object" ? globalThis : this, function createVehicleCatalogue() {
  "use strict";

  const CATALOGUE_VERSION = "uk-core-2026-07-v1";
  const OTHER_MAKE = "Other / manual";
  const CATALOGUE = [
    { make: "Volkswagen", aliases: ["VW"], models: ["Polo", "Golf", "Up!", "T-Cross", "T-Roc", "Tiguan", "Touran", "Passat", "Arteon", "Caddy", "Transporter"] },
    { make: "Audi", models: ["A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q4 e-tron", "Q5", "Q7", "Q8", "TT"] },
    { make: "SEAT", models: ["Mii", "Ibiza", "Leon", "Arona", "Ateca", "Tarraco", "Alhambra"] },
    { make: "Skoda", aliases: ["Škoda"], models: ["Citigo", "Fabia", "Scala", "Rapid", "Octavia", "Superb", "Kamiq", "Karoq", "Kodiaq", "Yeti"] },
    { make: "BMW", models: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "6 Series", "7 Series", "X1", "X2", "X3", "X4", "X5", "X6", "Z4", "i3", "i4", "iX"] },
    { make: "Mercedes-Benz", aliases: ["Mercedes", "Merc"], models: ["A-Class", "B-Class", "C-Class", "E-Class", "S-Class", "CLA", "CLS", "GLA", "GLB", "GLC", "GLE", "Vito", "Sprinter"] },
    { make: "Ford", models: ["Ka", "Fiesta", "Focus", "Mondeo", "Puma", "EcoSport", "Kuga", "S-Max", "Galaxy", "Mustang", "Ranger", "Transit"] },
    { make: "Vauxhall", aliases: ["Opel"], models: ["Adam", "Corsa", "Astra", "Insignia", "Mokka", "Crossland", "Grandland", "Zafira", "Combo", "Vivaro"] },
    { make: "Toyota", models: ["Aygo", "Yaris", "Corolla", "Auris", "Avensis", "C-HR", "RAV4", "Prius", "Camry", "Hilux", "Land Cruiser"] },
    { make: "Honda", models: ["Jazz", "Civic", "Accord", "HR-V", "CR-V", "e", "S2000"] },
    { make: "Nissan", models: ["Micra", "Note", "Juke", "Qashqai", "X-Trail", "Leaf", "Ariya", "Navara", "370Z"] },
    { make: "Peugeot", models: ["107", "108", "206", "207", "208", "307", "308", "407", "508", "2008", "3008", "5008", "Partner"] },
    { make: "Citroën", aliases: ["Citroen"], models: ["C1", "C2", "C3", "C4", "C5", "C3 Aircross", "C4 Cactus", "Berlingo", "Dispatch"] },
    { make: "Renault", models: ["Twingo", "Clio", "Megane", "Captur", "Kadjar", "Arkana", "Scenic", "Zoe", "Kangoo", "Trafic"] },
    { make: "Hyundai", models: ["i10", "i20", "i30", "i40", "Kona", "Bayon", "Tucson", "Santa Fe", "Ioniq", "Ioniq 5"] },
    { make: "Kia", models: ["Picanto", "Rio", "Ceed", "ProCeed", "Stonic", "Niro", "Soul", "Sportage", "Sorento", "EV6"] },
    { make: "Volvo", models: ["C30", "S40", "S60", "S80", "S90", "V40", "V50", "V60", "V70", "V90", "XC40", "XC60", "XC90"] },
    { make: "MINI", aliases: ["Mini"], models: ["Hatch", "Clubman", "Countryman", "Convertible", "Coupe", "Roadster", "Paceman"] },
    { make: "Mazda", models: ["Mazda2", "Mazda3", "Mazda6", "CX-3", "CX-30", "CX-5", "CX-60", "MX-5", "RX-8"] },
    { make: "Land Rover", aliases: ["Range Rover"], models: ["Defender", "Discovery", "Discovery Sport", "Freelander", "Range Rover", "Range Rover Sport", "Range Rover Evoque", "Range Rover Velar"] },
    { make: "Fiat", models: ["500", "500L", "500X", "Panda", "Punto", "Tipo", "Doblo", "Ducato"] },
    { make: "Suzuki", models: ["Alto", "Celerio", "Swift", "Ignis", "Baleno", "Vitara", "S-Cross", "Jimny"] },
    { make: "Dacia", models: ["Sandero", "Logan", "Duster", "Jogger"] },
    { make: "Jaguar", models: ["XE", "XF", "XJ", "X-Type", "F-Type", "E-Pace", "F-Pace", "I-Pace"] },
    { make: OTHER_MAKE, models: [], manual: true }
  ];

  function display(value) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, 100);
  }

  function key(value) {
    return display(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  const makeByKey = new Map();
  for (const item of CATALOGUE) {
    for (const value of [item.make, ...(item.aliases || [])]) makeByKey.set(key(value), item);
  }

  function entryForMake(value) {
    return makeByKey.get(key(value)) || null;
  }

  function isKnownMake(value) {
    const entry = entryForMake(value);
    return Boolean(entry && !entry.manual);
  }

  function canonicalMake(value) {
    return entryForMake(value)?.make || display(value) || null;
  }

  function canonicalModel(value, make = null) {
    const candidate = display(value);
    if (!candidate) return null;
    const candidates = make ? [entryForMake(make)].filter(Boolean) : CATALOGUE;
    for (const item of candidates) {
      const found = item.models.find(model => key(model) === key(candidate));
      if (found) return found;
    }
    return candidate;
  }

  function unique(values, normaliser) {
    const output = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : String(values || "").split(/[,\r\n]+/)) {
      const item = normaliser(value);
      const itemKey = key(item);
      if (!itemKey || seen.has(itemKey)) continue;
      seen.add(itemKey);
      output.push(item);
      if (output.length >= 50) break;
    }
    return output;
  }

  function normaliseMakes(values) {
    return unique(values, canonicalMake);
  }

  function normaliseModels(values, makes = []) {
    const selectedMakes = normaliseMakes(makes);
    return unique(values, value => canonicalModel(value, selectedMakes.length === 1 ? selectedMakes[0] : null));
  }

  function modelsForMakes(makes) {
    const selected = normaliseMakes(makes);
    if (!selected.length) return [];
    return selected.flatMap(make => entryForMake(make)?.models.map(model => ({ make, model })) || []);
  }

  function isModelCompatible(model, makes) {
    const selected = normaliseMakes(makes);
    if (!selected.length) return true;
    const modelKey = key(model);
    return modelsForMakes(selected).some(item => key(item.model) === modelKey);
  }

  function detectIdentity(input = {}) {
    const structuredMake = canonicalMake(input.make || input.structuredMake);
    const structuredModel = canonicalModel(input.model || input.structuredModel, structuredMake);
    if (structuredMake || structuredModel) {
      return { make: structuredMake, model: structuredModel, source: "structured_fields", confidence: "high" };
    }
    const text = key([input.title, input.text].filter(Boolean).join(" "));
    if (!text) return { make: null, model: null, source: null, confidence: "unknown" };
    const makeEntry = CATALOGUE.find(item => !item.manual && [item.make, ...(item.aliases || [])]
      .some(value => new RegExp(`(?:^| )${key(value).replace(/ /g, "\\s+")}(?: |$)`).test(text)));
    if (!makeEntry) return { make: null, model: null, source: null, confidence: "unknown" };
    const models = [...makeEntry.models].sort((left, right) => key(right).length - key(left).length);
    const model = models.find(value => new RegExp(`(?:^| )${key(value).replace(/ /g, "\\s+")}(?: |$)`).test(text)) || null;
    return { make: makeEntry.make, model, source: "listing_title", confidence: model ? "high" : "moderate" };
  }

  return {
    CATALOGUE,
    CATALOGUE_VERSION,
    OTHER_MAKE,
    canonicalMake,
    canonicalModel,
    detectIdentity,
    isModelCompatible,
    isKnownMake,
    key,
    modelsForMakes,
    normaliseMakes,
    normaliseModels
  };
});
