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

### `POST /api/extension/scans/:scanId/listings`

Upserts completed outcomes on `(scan_run_id, external_listing_id)`. The server accepts 1-50 listings; the extension normally sends batches of 10 and never more than 25 at its request boundary. Replaying a batch is idempotent and updates existing rows. Duplicate identities in one request use last-result-wins semantics.

Listing fields:

- required: `externalListingId`, absolute HTTP(S) `sourceUrl`, `status`;
- optional/nullable: title, integer price, three-letter currency, year 1886-2100, integer mileage, location, seller/fuel/transmission/body style, HTTP(S) image URL, description excerpt;
- classification: rejection code/reason, category detected flag/type, extraction source;
- diagnostics: bounded `rawMetadata` object;
- timing: offset-aware ISO `discoveredAt` and `processedAt`.

Listing status is exactly `matched`, `rejected`, or `unavailable`. The existing generic rejection code `category` remains unchanged for dashboard compatibility; `categoryType` carries S/N/C/D.

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
