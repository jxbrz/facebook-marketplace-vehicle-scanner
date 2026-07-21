const test = require("node:test");
const assert = require("node:assert/strict");
const {
  canonicalMake,
  evaluateFilters,
  normaliseMakeFilters,
  normaliseFilterValues
} = require("../vehicle-identity.js");

function evaluate(filters, cardTitle, final = true, extra = {}) {
  return evaluateFilters(filters, { cardTitle, ...extra }, { final });
}

test("empty make and model filters preserve current behaviour", () => {
  assert.equal(evaluate({}, "Anything at all").accepted, true);
  assert.deepEqual(normaliseFilterValues(undefined), []);
});

test("normalises duplicates and controlled Volkswagen aliases in both directions", () => {
  assert.deepEqual(normaliseFilterValues(" Volkswagen, volkswagen\n VW , Audi "), ["Volkswagen", "VW", "Audi"]);
  assert.deepEqual(normaliseMakeFilters(" Volkswagen, volkswagen\n VW , Audi "), ["Volkswagen", "Audi"]);
  assert.equal(canonicalMake("VW"), "Volkswagen");
  assert.equal(canonicalMake("Volkswagen"), "Volkswagen");
  assert.equal(evaluate({ acceptedMakes: ["Volkswagen"] }, "VW Polo Match").accepted, true);
  assert.equal(evaluate({ acceptedMakes: ["VW"] }, "Volkswagen Polo").accepted, true);
});

test("matches controlled vehicle-title model examples", () => {
  const models = { acceptedModels: ["Polo"] };
  assert.equal(evaluate({ acceptedMakes: ["Volkswagen"], ...models }, "Volkswagen Polo").accepted, true);
  assert.equal(evaluate(models, "VW Polo Match").accepted, true);
  assert.equal(evaluate(models, "Polo 1.0 TSI").accepted, true);
});

test("rejects different makes, different models, and incidental model wording", () => {
  const polo = { acceptedModels: ["Polo"] };
  const golf = evaluate(polo, "Volkswagen Golf with Polo wheels");
  assert.equal(golf.accepted, false);
  assert.equal(golf.rejectionCode, "model_not_allowed");
  assert.equal(evaluate({ acceptedMakes: ["Volkswagen"] }, "Audi A3").rejectionCode, "make_not_allowed");
  assert.equal(evaluate(polo, "Polo shirt").rejectionCode, "model_not_allowed");
});

test("both make and model filters must pass", () => {
  const filters = { acceptedMakes: ["Volkswagen"], acceptedModels: ["Polo"] };
  assert.equal(evaluate(filters, "Volkswagen Polo SE").accepted, true);
  assert.equal(evaluate(filters, "Volkswagen Golf").rejectionCode, "model_not_allowed");
  assert.equal(evaluate(filters, "Audi Polo concept").rejectionCode, "make_not_allowed");
});

test("structured identity outranks title and seller-description text is ignored", () => {
  const result = evaluateFilters(
    { acceptedMakes: ["Volkswagen"], acceptedModels: ["Polo"] },
    {
      structuredMake: "Volkswagen",
      structuredModel: "Golf",
      listingTitle: "Volkswagen Polo",
      sellerDescription: "Polo available too"
    },
    { final: true }
  );
  assert.equal(result.rejectionCode, "model_not_allowed");
  assert.equal(result.detectedModel, "Golf");
  assert.equal(result.source, "structured_fields");
});

test("partial structured identity is completed from the next trustworthy source", () => {
  const result = evaluateFilters(
    { acceptedMakes: ["Volkswagen"], acceptedModels: ["Polo"] },
    { structuredMake: "VW", listingTitle: "2018 Volkswagen Polo SE" },
    { final: true }
  );
  assert.equal(result.accepted, true);
  assert.equal(result.detectedMake, "Volkswagen");
  assert.equal(result.detectedModel, "Polo");
  assert.equal(result.source, "structured_fields+listing_title");
});

test("explicit makes outside the alias table use conservative title tokens", () => {
  assert.equal(evaluate({ acceptedMakes: ["Porsche"] }, "2019 Porsche 911 Carrera").accepted, true);
  assert.equal(evaluate({ acceptedMakes: ["Porsche"] }, "2019 Audi A3 with Porsche wheels").rejectionCode, "make_not_allowed");
});

test("rejection diagnostics remain bounded and deterministic", () => {
  const result = evaluate({ acceptedMakes: ["Volkswagen"], acceptedModels: ["Polo"] }, "Audi A3");
  assert.equal(result.rejectionCode, "make_not_allowed");
  assert.equal(result.diagnostics.detectedMake, "Audi");
  assert.deepEqual(result.diagnostics.selectedMakes, ["Volkswagen"]);
  assert.deepEqual(result.diagnostics.selectedModels, ["Polo"]);
  assert.equal(result.diagnostics.matchingRule, "explicit_alias_and_token_match_v1");
  assert.ok(result.diagnostics.normalisedCandidate.length <= 160);
});

test("identity detection is separate from the canonical filter decision", () => {
  const result = VehicleIdentity.identifyVehicle({
    listingTitle: "2019 Volkswagen Polo 1.0 TSI"
  }, {
    makes: ["Volkswagen"],
    models: ["Polo"]
  });

  assert.equal(result.detectedMake, "Volkswagen");
  assert.equal(result.detectedModel, "Polo");
  assert.equal("accepted" in result, false);
  assert.equal("rejectionCode" in result, false);
});
