# Architecture

## Runtime boundary

The Chrome extension is the only component with access to Facebook. It discovers visible Marketplace cards, fetches listing pages with the signed-in browser session, extracts metadata, applies filters, detects disclosed insurance categories, enforces scan limits, and queues structured outcomes.

The hosted Next.js application authenticates extension requests, validates structured payloads, stores scans and outcomes in Neon Postgres, reconciles authoritative counts, and serves the private dashboard. It never receives Facebook credentials and never scrapes or fetches Facebook content.

## Extension components

- `manifest.json`: MV3 configuration, fixed key, permissions, background worker, popup, and ordered content scripts.
- `content.js`: scan state machine, DOM discovery, durable ledger, filtering, limits, persistence, recovery, and upload scheduling.
- `background.js`: bounded Facebook fetch queue, conservative structured-detail extraction call, and authenticated dashboard request boundary.
- `listing-details-extractor.js`: pure embedded JSON/JSON-LD listing-object extraction with listing-ID scoping and semantic `og:image` fallback. Only named description/photo/attribute/seller/date fields are considered.
- `category-detector.js`: pure normalization, controlled matching, negation, evidence, and deterministic conflict resolution.
- `payload-normalizer.js`: pure final upload normalization and validation.
- `popup.*`: local configuration and lifecycle controls.
- `styles.css`: the scanner status panel only; no native Facebook result hiding, dimming, badges, or card decoration.

## Identity and persistence

The manifest key derives extension ID `aipljeeiecdcnkbbakphcddacbbgkpmf`. Changing the key changes the extension origin and storage namespace and breaks production CORS.

Compatibility-sensitive local keys include:

- `scannerV19:activeRun`;
- `runtimeProgress`;
- `listing:<facebook-listing-id>` cache entries;
- dashboard URL, API token, scan limit, filter, and category setting keys.

The active-run state's internal `version` remains `19`. Code release versions are independent of that persisted schema number.

## Phase 1 review data

The extension stores structured extraction results in the existing bounded cached result and durable ledger flow. Restored outcomes are rebuilt through the current payload normalizer, so missing v23 fields become null/empty values without requiring local-state clearing. Gallery order follows Facebook's listing-photo order; duplicates and malformed URLs are removed and the existing card image remains the compatible primary fallback.

Facebook CDN URLs are references, not archived assets, and may expire. The server never fetches them. Seller extraction is limited to the display name and Facebook profile URL present on the listing object; the extension never opens or traverses a seller profile. When a named listing object is unavailable or does not match the requested listing ID, uncertain detail fields are omitted.

## Stopping invariants

The scan checks target matches before processed count, then duration. Finalization immediately disables scanning and auto-loading, increments the generation so late requests cannot classify new results, clears timers, and returns queued/scanning ledger entries to discovered state. Already completed outcomes remain final and uploadable.

Remote completion occurs only after the pending upload map is empty. Auto-open occurs only after the completion request succeeds.
