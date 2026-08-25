(function initialiseListingCategoryPipeline(root, factory) {
  const detector = typeof module === "object" && module.exports
    ? require("./category-detector.js")
    : root.CategoryDetector;
  const pipeline = factory(detector);
  if (typeof module === "object" && module.exports) module.exports = pipeline;
  root.ListingCategoryPipeline = pipeline;
})(typeof globalThis === "object" ? globalThis : this, function createListingCategoryPipeline(CategoryDetector) {
  "use strict";

  function vehicleAttributeEvidence(attributes) {
    return Object.entries(attributes || {})
      .slice(0, 40)
      .map(([label, value]) => `${String(label).slice(0, 80)}: ${String(value).slice(0, 500)}`)
      .join("\n");
  }

  function classifyFinalCategory(metadata = {}, result = null) {
    const preliminary = CategoryDetector.detectTrustedEvidence([
      { text: metadata.title, source: "facebook-card-title" },
      { text: metadata.cardText, source: "facebook-card" }
    ]);
    const finalExtracted = CategoryDetector.detectTrustedEvidence([
      { text: result?.fullDescription, source: "facebook-final-description" },
      { text: result?.listingTitle, source: "facebook-structured-title" },
      { text: vehicleAttributeEvidence(result?.vehicleAttributes), source: "facebook-structured-attributes" }
    ]);
    const suppliedDetection = Array.isArray(result?.evidence) ? result : null;
    const finalResult = CategoryDetector.combineDetections([
      suppliedDetection,
      finalExtracted,
      preliminary
    ]);
    const priorDiagnostics = result?.categoryClassificationDiagnostics || {};
    const renderedPositive = finalResult.evidence?.some(item =>
      ["facebook-rendered-description", "facebook-rendered-attributes"].includes(item.source)
    );
    const renderedExtraction = /rendered/i.test(result?.listingDetailExtractionSource || result?.extractionSource || "");

    return {
      ...(result || {}),
      ...finalResult,
      evidenceExcerpt: finalResult.detected
        ? finalResult.context
        : result?.evidenceExcerpt || null,
      categoryClassificationDiagnostics: {
        preliminaryCategoryResult: CategoryDetector.summariseCategoryResult(preliminary),
        finalCategoryResult: CategoryDetector.summariseCategoryResult(finalResult),
        finalCategoryEvidenceSource: finalResult.source || null,
        reclassifiedAfterRenderedExtraction: Boolean(
          priorDiagnostics.reclassifiedAfterRenderedExtraction ||
          (!preliminary.detected && finalResult.detected && (renderedPositive || renderedExtraction))
        ),
        provisionalStatus: preliminary.detected ? "rejected" : "matched",
        finalStatus: finalResult.detected ? "rejected" : "matched"
      }
    };
  }

  function countFinalOutcomes(entries, targetMatches) {
    const counts = { processed: 0, matched: 0, rejected: 0, unavailable: 0 };
    for (const entry of entries || []) {
      if (entry?.status === "matched") counts.matched += 1;
      if (entry?.status === "rejected") counts.rejected += 1;
      if (entry?.status === "unavailable") counts.unavailable += 1;
    }
    counts.processed = counts.matched + counts.rejected + counts.unavailable;
    return {
      ...counts,
      targetReached: counts.matched >= Number(targetMatches || 0)
    };
  }

  function categoryOutcome(classification) {
    if (!classification?.detected || !["S", "N", "C", "D"].includes(classification.category)) {
      return { rejected: false, status: "matched", reason: null, code: null };
    }
    return {
      rejected: true,
      status: "rejected",
      reason: `CAT ${classification.category} detected`,
      code: "category"
    };
  }

  function categoryUploadFields(classification) {
    const category = classification?.category ?? null;
    const finalCategoryResult = classification?.categoryClassificationDiagnostics?.finalCategoryResult;
    const isKnownGenericCategory = (
      classification?.detected === true &&
      category === "OTHER" &&
      classification?.detectorRule === "generic_insurance_write_off" &&
      finalCategoryResult?.detected === true &&
      finalCategoryResult?.category === "OTHER" &&
      finalCategoryResult?.detectorRule === "generic_insurance_write_off"
    );
    const categoryType = isKnownGenericCategory ? null : category;
    return {
      categoryDetected: classification?.detected === true,
      categoryType
    };
  }

  return { categoryOutcome, categoryUploadFields, classifyFinalCategory, countFinalOutcomes, vehicleAttributeEvidence };
});
