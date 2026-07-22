# Changelog

## 23.2.1 - 2026-07-22

- Added a persistent minimise/restore control to the on-page scanner overlay without interrupting scanner lifecycle, uploads, queues, or filter state.
- Kept live scanner state and match counts visible in a compact Kelmar-branded pill.

## 23.2.0 - 2026-07-21

- Added a responsive full-tab settings workspace and reduced the popup to saved-search selection, filter summary, scan progress, warnings, and lifecycle controls.
- Replaced specification multi-selects with explicit per-value Ignore, Include, and Exclude controls, including Other and Unknown choices.
- Kept dashboard searches read-only in the extension and stored local drafts separately without changing schema-v2 scan snapshots or dashboard rows.

## Unreleased (recommended 23.0.7)

- Migrated recovery state to compact schema 20 while retaining the established `scannerV19:activeRun` key and preserving pending failed uploads, settings, and authentication.
- Removed full successful results, descriptions, and gallery arrays immediately after confirmed dashboard upload; retired unbounded 30-day per-listing caches.
- Added redacted UTF-8 storage measurement, bounded completed markers, safe quota prune/retry/degraded handling, storage-health UI, and migration/quota/image regression coverage.

- Separated continuous discovery/auto-scroll from bounded detail processing so slow rendered listings and dashboard uploads cannot hold the page stationary.
- Added canonical-ID lifecycle queueing, one bounded transient retry, recycled-DOM recovery, closer scroll-target selection, mutation/height growth detection, and repeated end-of-results confirmation.
- Increased only the rendered-detail stage from one to two conservatively spaced workers, retained three total listing workers and the 12-item committed-work cap, and bounded automatic upload retries.
- Added explicit Pause/Resume cleanup, development-only aggregate timing diagnostics, and scrolling/queue/deduplication regression coverage without changing permissions, authentication, API payloads, or production data.

## 23.0.5 - 2026-07-15

- Migrated the exact legacy Vercel dashboard origin stored by existing installations to `https://sourcing.kelmarvehiclesltd.co.uk` before any authenticated API request or results-page navigation.
- Made the canonical production origin the new-install default and rejected API redirects so Bearer-authenticated requests cannot depend on a hostname redirect.
- Retained the exact legacy host permission for this staged migration release while preserving the manifest key, extension identity, scanner lifecycle, storage schema, and API authentication format.

## 23.0.4

- Prepared the first Chrome Web Store package without changing scanner behavior, storage keys, API payloads, or the fixed unpacked key.
- Replaced the broad all-HTTPS host grant with exact Facebook and production dashboard hosts.
- Added local extension icons, a narrow store-facing name/description, support homepage, strict package audit, and submission documentation.

## 23.0.3 - 2026-07-15

- Re-ran insurance-category classification over final trusted evidence after controlled rendered extraction and merge, including final descriptions, structured titles, vehicle attributes, and card evidence.
- Prevented provisional card acceptance from becoming durable before the final category gate; final rejected outcomes now drive counters, target completion, persistence, and uploads.
- Added bounded preliminary/final category diagnostics and preserved rendered evidence without storing page HTML.
- Attempted controlled rendered extraction for every listing ID, with safe static/card fallback after timeout or failure.
- Documented deliberate rescan as the safe reprocessing path; existing historical rows are not mutated automatically.

## 23.0.2 - 2026-07-15

- Changed startup to strict idle-first behavior: persisted running work becomes `interrupted` and requires explicit Resume or Discard instead of auto-resuming discovery or scrolling.
- Limited discovery, observers, timers, auto-scroll, extraction queues, and controlled detail tabs to the explicit running state, with run-scoped cancellation and bounded lifecycle diagnostics.
- Kept terminal scans terminal; startup sync recovery may upload durable final outcomes but cannot create replacement scans or restart Facebook activity.
- Added optional accepted make/model filters with explicit aliases, token-aware conservative matching, deterministic rejection diagnostics, and settings snapshots.
- Stored detected advert identity through the existing bounded vehicle attributes and raw metadata without changing the dashboard API contract.
- Corrected Facebook Marketplace UK mileage labelled `km` to operational miles without changing the numeric value, while preserving the source text and recording `facebook_uk_label_correction` provenance.

## 23.0.1 - 2026-07-15

- Added bounded listing-scoped ancestor traversal and semantic rendered-DOM fallback for descriptions and vehicle facts when Facebook's initial HTML is incomplete.
- Added serialized inactive item-tab extraction with timeout and guaranteed cleanup, without changing scanner lifecycle, storage, permissions, key, or identity.
- Preserved kilometre/mile provenance through optional payload fields so kilometre listings are not displayed as miles.
- Ranked listing-owned embedded and rendered image candidates by media identity, order, dimensions, source quality, and thumbnail status while excluding unrelated content.
- Added a sanitized regression fixture for listing `1328662229386516` covering multiline description, 68,600 km, automatic/gasoline/colours, gallery ordering, quality preference, and exclusions.

## 23.0.0 - 2026-07-15

- Added conservative embedded-JSON extraction for full advert descriptions, listing photos, structured vehicle attributes, seller display details, and visible listing-date wording.
- Added bounded v23 payload fields with description line-break preservation, gallery deduplication, HTTP(S) URL validation, deterministic JSON-safe attributes, and backward-compatible defaults.
- Added fixture tests that keep avatars, recommendations, advertisements, and non-Facebook image hosts out of captured galleries.
- Added support for the dashboard's authenticated individual vehicle-review route while preserving the primary image, excerpt, scanner lifecycle, storage keys, permissions, manifest key, and fixed extension ID.
- Documented that Facebook image URLs can expire and are not archived in Phase 1.

## 22.0.0 - 2026-07-15

- Added controlled two-direction insurance category detection for S/N/C/D wording, common misspellings, Unicode separators, and local negation.
- Added card-text and fetched-page evidence merging with deterministic primary evidence and conflict diagnostics.
- Hardened all listing fields at the final upload boundary and retained nested server validation details.
- Added automatic missing-remote-scan recreation for upload, progress, and completion paths.
- Added Node tests, manifest/identity validation, CI, and production/recovery/release documentation.
- Preserved the manifest key, extension ID, permissions, storage keys, and active-run schema.

## 21.0.1

- Normalized decimal or string price, mileage, and year values before upload so older queued payloads satisfy integer validation.

## 21.0.0

- Added missing-remote-scan recovery.
- Rebuilt pending payloads from the durable ledger before retry so unsynchronised results survive remote recreation.
- Propagated forced upload failures to the recovery path.

## 20.0.0

- Added a fixed manifest key and stable extension ID.
- Preserved the `chrome.storage.local` namespace and exact production extension origin across in-place releases.

## 19.0.0

- Replaced Facebook card hiding and decoration with the hosted-dashboard architecture.
- Added controlled scan limits, local durable state, batched idempotent uploads, and hosted scan lifecycle management.
