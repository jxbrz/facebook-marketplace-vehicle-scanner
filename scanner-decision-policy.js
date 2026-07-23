(function initialiseScannerDecisionPolicy(root, factory) {
  const policy = factory();
  if (typeof module === "object" && module.exports) module.exports = policy;
  root.ScannerDecisionPolicy = policy;
})(typeof globalThis === "object" ? globalThis : this, function createScannerDecisionPolicy() {
  "use strict";

  const EVALUATOR_LIFECYCLE_VERSION = 2;
  const CARD_FINALIZATION_CODES = new Set([
    "price_below_minimum",
    "price_above_maximum",
    "year_below_minimum",
    "year_above_maximum",
    "make_not_selected",
    "model_not_selected",
    "category_not_clean",
    "category_not_confirmed",
    "category_not_selected",
    "excluded_keyword_present"
  ]);

  function evidenceIsReliable(item) {
    if (!item || !CARD_FINALIZATION_CODES.has(item.code) || item.valueKnown !== true) return false;
    const source = String(item.source || "");
    const confidence = String(item.confidence || "unknown");
    if (/^(?:price|year)_/.test(item.code)) {
      return source === "search_card" && ["moderate", "high"].includes(confidence);
    }
    if (/^(?:make|model)_/.test(item.code)) {
      return confidence === "high" && /structured_fields|vehicle_attributes|search_card_reliable/.test(source);
    }
    if (/^category_/.test(item.code)) {
      return confidence === "high" && source === "search_card";
    }
    if (item.code === "excluded_keyword_present") {
      return source === "search_card";
    }
    return false;
  }

  function cardFinalizationDecision(evaluation = {}) {
    const reasonCodes = Array.isArray(evaluation.rejectionReasonCodes)
      ? [...new Set(evaluation.rejectionReasonCodes)]
      : [];
    const evidence = Array.isArray(evaluation.rejectionEvidence)
      ? evaluation.rejectionEvidence
      : [];
    const rejectionReasons = Array.isArray(evaluation.rejectionReasons)
      ? evaluation.rejectionReasons
      : [];
    const byCode = new Map(evidence.map(item => [item?.code, item]));
    const reliable =
      evaluation.decision === "reject" &&
      evaluation.provenReject === true &&
      evaluation.detailRequired === false &&
      rejectionReasons.length > 0 &&
      reasonCodes.length === rejectionReasons.length &&
      reasonCodes.every(code => CARD_FINALIZATION_CODES.has(code) && evidenceIsReliable(byCode.get(code)));

    return {
      mayFinalize: reliable,
      action: reliable ? "finalize_reject" : "inspect_detail",
      reasonCodes
    };
  }

  return {
    CARD_FINALIZATION_CODES,
    EVALUATOR_LIFECYCLE_VERSION,
    cardFinalizationDecision,
    evidenceIsReliable
  };
});
