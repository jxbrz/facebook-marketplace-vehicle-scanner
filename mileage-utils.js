(function initialiseMileageUtils(root, factory) {
  const utils = factory();
  if (typeof module === "object" && module.exports) module.exports = utils;
  root.MileageUtils = utils;
})(typeof globalThis === "object" ? globalThis : this, function createMileageUtils() {
  "use strict";

  const FACEBOOK_UK_LABEL_CORRECTION = "facebook_uk_label_correction";

  function toNullableNonNegativeInteger(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  }

  function normaliseOperationalMileage(mileageDetail, context = {}) {
    const value = toNullableNonNegativeInteger(mileageDetail?.value);
    const unit = ["mi", "km"].includes(mileageDetail?.unit) ? mileageDetail.unit : null;
    if (value === null || unit === null) return null;

    const originalText = typeof mileageDetail.originalText === "string"
      ? mileageDetail.originalText
      : null;
    const isFacebookUk = context.source === "facebook_marketplace" && context.market === "GB";
    if (isFacebookUk && unit === "km") {
      return {
        value,
        unit: "mi",
        originalText,
        unitSource: FACEBOOK_UK_LABEL_CORRECTION
      };
    }

    return {
      value,
      unit,
      originalText,
      unitSource: mileageDetail.unitSource === FACEBOOK_UK_LABEL_CORRECTION
        ? FACEBOOK_UK_LABEL_CORRECTION
        : null
    };
  }

  function sourceMileageInMiles(mileageDetail, fallbackMileage) {
    const value = toNullableNonNegativeInteger(mileageDetail?.value);
    if (value !== null && mileageDetail?.unit === "mi") return value;
    if (value !== null && mileageDetail?.unit === "km") return Math.round(value / 1.609344);
    return toNullableNonNegativeInteger(fallbackMileage);
  }

  return {
    FACEBOOK_UK_LABEL_CORRECTION,
    normaliseOperationalMileage,
    sourceMileageInMiles
  };
});
