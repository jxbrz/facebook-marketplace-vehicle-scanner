# Extension API contract

Base URL: the dashboard URL configured in `chrome.storage.local`.

Every non-preflight request sends:

```http
Authorization: Bearer <private token>
Content-Type: application/json
Origin: chrome-extension://aipljeeiecdcnkbbakphcddacbbgkpmf
```

The server compares the Bearer token timing-safely, accepts only the exact configured origin, caps bodies at 256 KB, and returns JSON error envelopes. The extension includes nested validation details in its local sync error without logging the token.

## Endpoints

### `POST /api/extension/scans`

Creates a running scan. Required limits are positive bounded integers. The response includes `scanId`, `status`, and `resultsUrl`.

The existing JSON `filters` object may include optional normalized `acceptedMakes` and `acceptedModels` arrays. Empty/missing arrays preserve existing behavior. No new endpoint or database column is required.

### `POST /api/extension/scans/:scanId/listings`

Upserts completed outcomes on `(scan_run_id, external_listing_id)`. The server accepts 1-50 listings; the extension normally sends batches of 10 and never more than 25 at its request boundary. Replaying a batch is idempotent and updates existing rows. Duplicate identities in one request use last-result-wins semantics.

Listing fields:

- required: `externalListingId`, absolute HTTP(S) `sourceUrl`, `status`;
- optional/nullable: title, integer price, three-letter currency, year 1886-2100, legacy integer mileage, location, seller/fuel/transmission/body style, HTTP(S) image URL, description excerpt;
- optional mileage provenance: paired integer `mileageValue` and `mileageUnit` (`mi` or `km`), bounded `mileageOriginalText` (120 characters), and optional `mileageUnitSource`; fresh Facebook Marketplace UK values displayed with a `km` label use the unchanged number, operational unit `mi`, legacy miles field, and source `facebook_uk_label_correction`;
- optional v23 review fields: full description (20,000 characters), up to 20 unique HTTP(S) image URLs (4,000 characters each), up to 40 vehicle-attribute string pairs (80-character keys and 500-character values), seller name (240 characters), HTTP(S) seller profile URL (4,000 characters), and visible listing-date text (240 characters);
- classification: rejection code/reason, category detected flag/type, extraction source;
- diagnostics: bounded `rawMetadata` object;
- timing: offset-aware ISO `discoveredAt` and `processedAt`.

Listing status is exactly `matched`, `rejected`, or `unavailable`. The existing generic rejection code `category` remains unchanged for dashboard compatibility; `categoryType` carries S/N/C/D.

The v23 fields are optional, so old v19-v23.0.0 payloads and restored runs remain valid. The extension omits malformed optional image/profile URLs and non-serialisable or credential-shaped attributes before upload; the server independently validates and rejects malformed or excessive values. Description trimming preserves internal line breaks. The 256 KB request limit is unchanged.

Version 23.0.2 records detected advert make/model through the existing bounded `vehicleAttributes` and `rawMetadata.vehicleIdentity` fields rather than adding top-level API fields. Older payloads remain unchanged.

Version 23.0.3 adds bounded category sequencing diagnostics inside `rawMetadata`: preliminary/final category summaries, final evidence source, rendered-reclassification flag, and provisional/final status. Positive final evidence is uploaded only with `status=rejected`, `rejectionCode=category`, and `categoryType` S/N/C/D.

The UK label correction is never inferred at payload-normalization time. Historical records without provenance retain their stored units, and non-Facebook or non-GB kilometre sources are not relabelled.

### `PATCH /api/extension/scans/:scanId/progress`

Updates discovery and classification counts between batches. Listing-derived counts become authoritative once stored outcomes exist.

### `POST /api/extension/scans/:scanId/complete`

Marks a scan terminal after uploads finish. Scan status is one of `completed`, `stopped`, `limit_reached`, `timed_out`, or `failed`. Stop reason is nullable or one of `target_reached`, `processed_limit_reached`, `duration_limit_reached`, `no_more_results`, `user_stopped`, `extension_closed`, or `error`.

### `GET /api/extension/scans/:scanId`

Returns hosted lifecycle state for recovery. A missing ID returns `404 scan_not_found`; the extension may create a replacement scan and replay its durable ledger.

## Accounting identity

```text
processedCount = matchedCount + rejectedCount + unavailableCount
discoveredCount >= processedCount
```

Retries must reuse the same external listing identity. A remote scan is completed only after every pending final outcome has been accepted. Validation errors are bugs or stale-payload incompatibilities to correct at the upload boundary; server validation must not be weakened.
