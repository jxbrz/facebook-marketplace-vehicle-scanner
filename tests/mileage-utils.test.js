const test = require("node:test");
const assert = require("node:assert/strict");
const { sourceMileageInMiles } = require("../mileage-utils.js");

test("uses miles directly and converts kilometre mileage only for the miles-based filter", () => {
  assert.equal(sourceMileageInMiles({ value: 68600, unit: "km" }, 68000), 42626);
  assert.equal(sourceMileageInMiles({ value: 72000, unit: "mi" }, null), 72000);
});

test("uses the legacy mileage fallback only when source units are unavailable", () => {
  assert.equal(sourceMileageInMiles(null, 68000), 68000);
  assert.equal(sourceMileageInMiles({ value: 68600, unit: "unknown" }, null), null);
});
