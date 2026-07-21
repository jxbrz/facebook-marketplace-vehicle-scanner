# Architecture

## Runtime boundary

The Chrome extension is the only component with access to Facebook. It discovers visible Marketplace cards, fetches listing pages with the signed-in browser session, extracts metadata, applies filters, detects disclosed insurance categories, enforces scan limits, and queues structured outcomes.

The hosted Next.js application authenticates extension requests, validates structured payloads, stores scans and outcomes in Neon Postgres, reconciles authoritative counts, and serves the private dashboard. It never receives Facebook credentials and never scrapes or fetches Facebook content.

## Extension components

- `manifest.json`: MV3 configuration, fixed key, permissions, background worker, popup, and ordered content scripts.
- `content.js`: scan state machine, DOM discovery, durable ledger, filtering, limits, persistence, recovery, and upload scheduling.
- `background.js`: bounded Facebook fetch and rendered-tab queues with timeout/cleanup, and authenticated dashboard request boundary.
- `scanner-runtime.js`: pure canonical-ID, recycled-card, scroll-target, end-detection, and bounded-queue primitives.
- `scanner-diagnostics.js`: opt-in bounded timing aggregation for development diagnosis.
- `scanner-storage.js`: compact schema migration, UTF-8 measurement, payload/image sanitation, and quota recovery primitives.
- `listing-details-extractor.js`: bounded listing-ID/canonical-URL embedded traversal, semantic rendered-section extraction, and reusable media ranking. `og:image` is the final image fallback.
- `category-detector.js`: pure normalization, controlled matching, negation, evidence, and deterministic conflict resolution.
- `listing-category-pipeline.js`: final trusted-evidence aggregation, provisional/final diagnostics, and final outcome counters.
- `scanner-lifecycle.js`: pure persisted-state classification and explicit transition rules.
- `vehicle-catalogue.js`: serialisable UK make/model catalogue, aliases, dependency checks, and conservative title detection.
- `vehicle-identity.js`: identity detection and compatibility helpers; it does not decide whether a listing matches.
- `listing-facts.js`: canonical facts normalizer shared by card, static-detail, and rendered-detail paths.
- `filter-domain.js`: schema-v2 normalization, validation, fingerprinting, unknown policies, and the sole `match | reject | unresolved` evaluator.
- `payload-normalizer.js`: pure final upload normalization and validation.
- `popup.*`: local configuration and lifecycle controls.
- `styles.css`: the scanner status panel only; no native Facebook result hiding, dimming, badges, or card decoration.

## Identity and persistence

The manifest key derives extension ID `aipljeeiecdcnkbbakphcddacbbgkpmf`. Changing the key changes the extension origin and storage namespace and breaks production CORS.

Compatibility-sensitive local keys include:

- `scannerV19:activeRun`;
- `runtimeProgress`;
- legacy `listing:<facebook-listing-id>` cache entries, removed by schema-20 migration;
- dashboard URL, API token, scan limit, filter, and category setting keys.

The background worker is the single authenticated API boundary. It maps only the exact legacy Vercel production origin to `https://sourcing.kelmarvehiclesltd.co.uk`, persists that migration, constructs every `/api/extension/scans...` request from the canonical value, and rejects redirects. Popup initialization applies the same storage migration so the displayed configuration matches the runtime boundary.

The active-run state's internal `version` is `20`; the established key name remains unchanged for in-place migration compatibility. Code release versions are independent of that persisted schema number.

## Phase 1 review data

Detailed extraction results are memory-only. A single sanitised upload payload is persisted only while dashboard confirmation is pending; after confirmation, descriptions and gallery URLs are removed and a compact completed-ID marker remains. Gallery order follows Facebook's listing-photo order, exact duplicates and malformed/non-HTTPS URLs are removed, and the existing card image remains the compatible primary fallback.

Facebook CDN URLs are references, not archived assets, and may expire. The server never fetches them. Seller extraction is limited to the display name and Facebook profile URL present on the listing object; the extension never opens or traverses a seller profile. When a named listing object is unavailable or does not match the requested listing ID, uncertain detail fields are omitted.

Static service-worker fetches can contain only Facebook's initial HTML and omit Relay-hydrated detail. The background worker creates at most two inactive blank tabs with a conservative start gap, marks each as controlled before navigating it to the item, waits for the existing authenticated page to render, requests only the semantic listing snapshot, and closes each tab in all outcomes. This prevents one slow rendered listing from blocking every worker while retaining final seller-description/category evidence. The scanner content script checks the tab marker and skips initialization only there; ordinary visible item navigation retains the existing stop/recovery behavior. Permissions, storage keys, and the visible search tab are unchanged.

Discovery/scrolling and detail processing are separate coordinated loops. Visible and recycled-card identities enter a canonical-ID ledger. Canonical card facts are evaluated first, but only proven rejections become final; unknown required facts enter the 3-worker/12-committed-item detail queue. Static and rendered evidence rebuild the same facts object before the one final evaluator runs. Auto-scroll re-detects the closest card-bearing scroll target on every attempt and never waits for that queue to drain. Uploads remain an independent single-flight, ID-keyed batch flow.

Each active run snapshots its complete schema-v2 filter configuration and fingerprint. A new or changed search therefore affects new work without rewriting historical scan rows. Rejections and unresolved outcomes retain one bounded reason in the ledger, while the popup derives capped aggregate counts; completed full listing payloads are still not retained after upload.

## Stopping invariants

The scan checks target matches before processed count, then duration. Finalization immediately disables scanning and auto-loading, increments the generation so late requests cannot classify new results, clears timers, and returns queued/scanning ledger entries to discovered state. Already completed outcomes remain final and uploadable.

Remote completion occurs only after the pending upload map is empty. Auto-open occurs only after the completion request succeeds.

Discovery execution is idle-first. The MutationObserver is disconnected by default and connects only for explicit `running`. Completion clears discovery/debounce/deadline/elapsed/scroll timers, resolves scan waits, disconnects the observer, increments the generation, cancels queued inspections by run token, and closes matching controlled tabs. Upload/persistence work is separate and cannot activate discovery.
