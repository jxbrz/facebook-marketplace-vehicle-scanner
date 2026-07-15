# Changelog

## 23.0.2 - 2026-07-15

- Changed startup to strict idle-first behavior: persisted running work becomes `interrupted` and requires explicit Resume or Discard instead of auto-resuming discovery or scrolling.
- Limited discovery, observers, timers, auto-scroll, extraction queues, and controlled detail tabs to the explicit running state, with run-scoped cancellation and bounded lifecycle diagnostics.
- Kept terminal scans terminal; startup sync recovery may upload durable final outcomes but cannot create replacement scans or restart Facebook activity.
- Added optional accepted make/model filters with explicit aliases, token-aware conservative matching, deterministic rejection diagnostics, and settings snapshots.
- Stored detected advert identity through the existing bounded vehicle attributes and raw metadata without changing the dashboard API contract.

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
