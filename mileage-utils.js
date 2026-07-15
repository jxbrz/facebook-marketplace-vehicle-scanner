(function initialiseMileageUtils(root, factory) {
  const utils = factory();
  if (typeof module === "object" && module.exports) module.exports = utils;
  root.MileageUtils = utils;
})(typeof globalThis === "object" ? globalThis : this, function createMileageUtils() {
  "use strict";

  function toNullableNonNegativeInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  }

  function sourceMileageInMiles(mileageDetail, fallbackMileage) {
    const value = toNullableNonNegativeInteger(mileageDetail?.value);
    if (value !== null && mileageDetail?.unit === "mi") return value;
    if (value !== null && mileageDetail?.unit === "km") return Math.round(value / 1.609344);
    return toNullableNonNegativeInteger(fallbackMileage);
  }

  return { sourceMileageInMiles };
});
