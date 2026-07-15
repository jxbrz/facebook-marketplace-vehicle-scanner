# Changelog

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
