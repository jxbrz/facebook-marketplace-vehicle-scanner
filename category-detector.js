(function initialiseCategoryDetector(root, factory) {
  const detector = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = detector;
  }

  root.CategoryDetector = detector;
})(typeof globalThis === "object" ? globalThis : this, function createCategoryDetector() {
  "use strict";

  const CATEGORY_LETTERS = new Set(["s", "n", "c", "d"]);
  const CATEGORY_TERMS = new Set([
    "cat",
    "category",
    "catagory",
    "catergory",
    "catogory",
    "categoty",
    "categary",
    "catagary",
    "catagorys",
    "categorys"
  ]);
  const NON_INSURANCE_MODIFIERS = new Set([
    "emission",
    "emissions",
    "licence",
    "license",
    "service",
    "tax",
    "vehicle"
  ]);
  const NEGATION_WORDS = new Set(["no", "not", "never", "without"]);
  const AMBIGUITY_WORDS = new Set(["cannot", "cant", "unclear", "unknown"]);
  const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/u;
  const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;
  const SOURCE_STRENGTH = new Map([
    ["facebook-listing-page", 0],
    ["listing-id-window", 0],
    ["full-response", 1],
    ["full-response-fallback", 1],
    ["facebook-card", 2],
    ["cached-listing-result", 3]
  ]);

  function normaliseCategoryText(value) {
    const original = String(value ?? "");
    const characters = [];
    const originalIndexes = [];

    for (let index = 0; index < original.length; index += 1) {
      const sourceCharacter = original[index];

      if (ZERO_WIDTH.test(sourceCharacter)) {
        continue;
      }

      const compatible = sourceCharacter.normalize("NFKC");

      for (const compatibleCharacter of compatible) {
        const output = LETTER_OR_NUMBER.test(compatibleCharacter)
          ? compatibleCharacter.toLowerCase()
          : " ";

        if (output === " " && characters.at(-1) === " ") {
          continue;
        }

        characters.push(output);
        originalIndexes.push(index);
      }
    }

    while (characters[0] === " ") {
      characters.shift();
      originalIndexes.shift();
    }

    while (characters.at(-1) === " ") {
      characters.pop();
      originalIndexes.pop();
    }

    return {
      original,
      text: characters.join(""),
      originalIndexes
    };
  }

  function tokenise(normalised) {
    return [...normalised.text.matchAll(/[a-z0-9]+/g)].map(match => ({
      value: match[0],
      start: match.index,
      end: match.index + match[0].length
    }));
  }

  function categoryTermAt(tokens, index) {
    if (CATEGORY_TERMS.has(tokens[index]?.value)) {
      return { value: tokens[index].value, length: 1 };
    }

    if (
      tokens[index]?.value === "c" &&
      tokens[index + 1]?.value === "a" &&
      tokens[index + 2]?.value === "t"
    ) {
      return { value: "cat", length: 3 };
    }

    return null;
  }

  function originalRange(normalised, start, end) {
    const first = normalised.originalIndexes[start] ?? 0;
    const last = normalised.originalIndexes[Math.max(start, end - 1)] ?? first;
    return { start: first, end: last + 1 };
  }

  function contextFor(original, start, end) {
    const contextStart = Math.max(0, start - 140);
    const contextEnd = Math.min(original.length, end + 180);
    return original.slice(contextStart, contextEnd).replace(/\s+/g, " ").trim();
  }

  function localPrefix(original, matchStart) {
    const windowStart = Math.max(0, matchStart - 100);
    const window = original.slice(windowStart, matchStart);
    const clauseStart = Math.max(
      window.lastIndexOf("."),
      window.lastIndexOf("!"),
      window.lastIndexOf("?"),
      window.lastIndexOf(";"),
      window.lastIndexOf(","),
      window.lastIndexOf("\n")
    );
    return window.slice(clauseStart + 1);
  }

  function evaluateContext(original, matchStart, tokens, termTokenIndex, letterTokenIndex) {
    const precedingToken = tokens[Math.min(termTokenIndex, letterTokenIndex) - 1]?.value;
    const followingToken = tokens[Math.max(termTokenIndex, letterTokenIndex) + 1]?.value;

    if (
      NON_INSURANCE_MODIFIERS.has(precedingToken) ||
      (precedingToken === "tax" && followingToken === "band")
    ) {
      return { disposition: "excluded", reason: "non_insurance_category_context" };
    }

    const prefixTokens = tokenise(normaliseCategoryText(localPrefix(original, matchStart)))
      .map(token => token.value)
      .slice(-5);
    const notOnly = prefixTokens.at(-2) === "not" && prefixTokens.at(-1) === "only";

    if (!notOnly && prefixTokens.some(token => NEGATION_WORDS.has(token))) {
      return { disposition: "negated", reason: "local_explicit_negation" };
    }

    if (prefixTokens.some(token => AMBIGUITY_WORDS.has(token))) {
      return { disposition: "ambiguous", reason: "local_ambiguous_context" };
    }

    return { disposition: "positive", reason: null };
  }

  function makeEvidence(normalised, candidate, source) {
    const range = originalRange(normalised, candidate.start, candidate.end);
    const context = evaluateContext(
      normalised.original,
      range.start,
      candidate.tokens,
      candidate.termTokenIndex,
      candidate.letterTokenIndex
    );

    return {
      category: candidate.category.toUpperCase(),
      matchedPhrase: normalised.original.slice(range.start, range.end),
      context: contextFor(normalised.original, range.start, range.end),
      normalizedMatch: normalised.text.slice(candidate.start, candidate.end),
      source,
      detectorRule: candidate.rule,
      negationEvaluated: true,
      disposition: context.disposition,
      diagnosticReason: context.reason,
      originalIndex: range.start
    };
  }

  function findCandidates(normalised) {
    const tokens = tokenise(normalised);
    const candidates = [];

    for (let index = 0; index < tokens.length; index += 1) {
      const term = categoryTermAt(tokens, index);

      if (term) {
        const letterIndex = index + term.length;
        const letter = tokens[letterIndex]?.value;

        if (CATEGORY_LETTERS.has(letter)) {
          candidates.push({
            category: letter,
            start: tokens[index].start,
            end: tokens[letterIndex].end,
            tokens,
            termTokenIndex: index,
            letterTokenIndex: letterIndex,
            rule: term.length === 1
              ? "category_term_before_letter"
              : "ocr_spaced_cat_before_letter"
          });
        }
      }

      if (CATEGORY_LETTERS.has(tokens[index].value)) {
        const followingTerm = categoryTermAt(tokens, index + 1);

        if (followingTerm) {
          const termEndIndex = index + followingTerm.length;
          candidates.push({
            category: tokens[index].value,
            start: tokens[index].start,
            end: tokens[termEndIndex].end,
            tokens,
            termTokenIndex: index + 1,
            letterTokenIndex: index,
            rule: followingTerm.length === 1
              ? "letter_before_category_term"
              : "letter_before_ocr_spaced_cat"
          });
        }
      }
    }

    return candidates;
  }

  function resultFromEvidence(evidence, source, normalisedText) {
    const positiveEvidence = evidence.filter(item => item.disposition === "positive");
    const negatedEvidence = evidence.filter(item => item.disposition === "negated");
    const ambiguousEvidence = evidence.filter(item => item.disposition === "ambiguous");
    const excludedEvidence = evidence.filter(item => item.disposition === "excluded");
    const primary = positiveEvidence[0] ?? null;
    const detectedCategories = [...new Set(positiveEvidence.map(item => item.category))];

    return {
      detected: Boolean(primary),
      category: primary?.category ?? null,
      match: primary?.matchedPhrase ?? null,
      context: primary?.context ?? null,
      normalizedMatch: primary?.normalizedMatch ?? null,
      source: primary?.source ?? source,
      detectorRule: primary?.detectorRule ?? null,
      negationEvaluated: true,
      evidence: positiveEvidence,
      negatedEvidence,
      ambiguousEvidence,
      excludedEvidence,
      detectedCategories,
      conflictingCategories: detectedCategories.length > 1,
      normalizedText: normalisedText
    };
  }

  function detectCategory(value, options = {}) {
    const source = options.source || "unknown";
    const normalised = normaliseCategoryText(value);
    const evidence = findCandidates(normalised)
      .map(candidate => makeEvidence(normalised, candidate, source));

    return resultFromEvidence(evidence, source, normalised.text);
  }

  function sourceStrength(source) {
    return SOURCE_STRENGTH.get(source) ?? 10;
  }

  function combineDetections(detections) {
    const available = detections.filter(Boolean);
    const evidence = available.flatMap(detection => detection.evidence || []);
    const otherEvidence = available.flatMap(detection => [
      ...(detection.negatedEvidence || []),
      ...(detection.ambiguousEvidence || []),
      ...(detection.excludedEvidence || [])
    ]);
    evidence.sort((left, right) =>
      sourceStrength(left.source) - sourceStrength(right.source) ||
      left.originalIndex - right.originalIndex ||
      left.category.localeCompare(right.category)
    );

    return resultFromEvidence(
      [...evidence, ...otherEvidence],
      evidence[0]?.source || available[0]?.source || "unknown",
      null
    );
  }

  return {
    CATEGORY_TERMS: [...CATEGORY_TERMS],
    combineDetections,
    detectCategory,
    normaliseCategoryText
  };
});
