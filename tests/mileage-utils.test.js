const test = require("node:test");
const assert = require("node:assert/strict");
const {
  FACEBOOK_UK_LABEL_CORRECTION,
  normaliseOperationalMileage,
  sourceMileageInMiles
} = require("../mileage-utils.js");

test("uses miles directly and converts kilometre mileage only for the miles-based filter", () => {
  assert.equal(sourceMileageInMiles({ value: 68600, unit: "km" }, 68000), 42626);
  assert.equal(sourceMileageInMiles({ value: 72000, unit: "mi" }, null), 72000);
});

test("uses the legacy mileage fallback only when source units are unavailable", () => {
  assert.equal(sourceMileageInMiles(null, 68000), 68000);
  assert.equal(sourceMileageInMiles({ value: 68600, unit: "unknown" }, null), null);
});

test("corrects the Facebook UK km label without converting its numeric value", () => {
  const mileage = normaliseOperationalMileage(
    { value: 68600, unit: "km", originalText: "68,600 km" },
    { source: "facebook_marketplace", market: "GB" }
  );
  assert.deepEqual(mileage, {
    value: 68600,
    unit: "mi",
    originalText: "68,600 km",
    unitSource: FACEBOOK_UK_LABEL_CORRECTION
  });
  assert.equal(sourceMileageInMiles(mileage, null), 68600);
});

test("does not relabel kilometre data outside Facebook UK", () => {
  const source = { value: 68600, unit: "km", originalText: "68,600 km" };
  assert.deepEqual(normaliseOperationalMileage(source, {
    source: "vehicle_feed",
    market: "GB"
  }), { ...source, unitSource: null });
  assert.deepEqual(normaliseOperationalMileage(source, {
    source: "facebook_marketplace",
    market: "DE"
  }), { ...source, unitSource: null });
  assert.equal(sourceMileageInMiles(source, null), 42626);
});
