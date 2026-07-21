# Facebook Marketplace Vehicle Scanner

Private Chrome Manifest V3 extension that discovers vehicle listings on Facebook Marketplace, classifies them locally, and uploads structured outcomes to the Kelmar Vehicles Ltd sourcing dashboard.

The extension remains a plain-JavaScript, unpacked-loadable project. There is no bundler, build step, TypeScript conversion, Facebook credential storage, or server-side Facebook scraping.

## Architecture

```text
Facebook Marketplace tab
  -> content.js: discovery, limits, filtering, durable scan ledger
  -> background.js: authenticated listing fetches and bounded rendered-detail fallback
  -> canonical production API: validation and lifecycle persistence
  -> Neon Postgres
  -> private dashboard
```

- `content.js` coordinates continuous Facebook card discovery/scrolling, cheap filtering, the bounded detail queue, the active-run ledger, progressive uploads, stopping, and recovery.
- `scanner-runtime.js` provides canonical listing identity, recycled-card recovery, scroll-target/end detection, and bounded queueing; `scanner-diagnostics.js` provides opt-in aggregate development timings.
- `scanner-lifecycle.js` defines idle/running/paused/interrupted/syncing/terminal rules; only `running` permits Facebook work.
- `vehicle-catalogue.js` and `vehicle-identity.js` provide maintained UK make/model data and identity detection without making filter decisions.
- `listing-facts.js` turns card, static-detail, and rendered-detail evidence into one canonical facts shape; `filter-domain.js` is the sole `match | reject | unresolved` authority.
- `background.js` owns controlled listing-page requests, one-at-a-time inactive detail-tab fallback, and Bearer-authenticated dashboard requests.
- `listing-details-extractor.js` first reads bounded listing-ID/canonical-URL scoped embedded data, then extracts semantic rendered sections and listing-owned carousel images when static HTML is incomplete.
- `category-detector.js` is a pure shared detector loaded by both extension contexts and by Node tests.
- `listing-category-pipeline.js` performs the final trusted-evidence category gate, bounded diagnostics, and final-outcome counting.
- `payload-normalizer.js` is the final upload-boundary normalizer and is also covered by Node tests.
- The hosted application is authoritative for stored listings, lifecycle state, dashboard actions, and scan history. It never accesses Facebook.

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

## Load unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository root.
4. Confirm the displayed extension ID is `aipljeeiecdcnkbbakphcddacbbgkpmf`.

After changing code, use **Reload** on the extension card and reload the active Facebook Marketplace tab so its content script is refreshed.

### Moving from the existing `PRODUCT` folder

Do not uninstall the currently loaded extension while it contains an active or unsynchronised scan: uninstalling can clear `chrome.storage.local`. The migration copy does not alter `PRODUCT`.

Safest transition:

1. Finish or stop the current scan and confirm the dashboard is fully synchronised.
2. Record the configured dashboard URL and keep the API token available from its secure source.
3. Validate this repository.
4. Switch the unpacked source only during a maintenance window.
5. Confirm the fixed extension ID and configuration before starting a scan.

The fixed manifest key preserves identity across in-place releases. It must never be regenerated, reformatted, or replaced.

## Dashboard configuration

Open the popup and enter:

- dashboard URL, normally `https://sourcing.kelmarvehiclesltd.co.uk`;
- the private extension API token configured on the server;
- scan limits, filters, and category preferences.

The token is saved only in `chrome.storage.local`. Never add it to source, `.env` files committed to Git, logs, screenshots, or release archives. The server must set `ALLOWED_EXTENSION_ORIGIN` to exactly:

```text
chrome-extension://aipljeeiecdcnkbbakphcddacbbgkpmf
```

Version 23.0.5 migrates the exact legacy `https://facebook-web-filter.vercel.app` value to the canonical production origin before any authenticated request or results-page navigation and saves the canonical value back to local storage. Other explicitly configured dashboard origins remain unchanged. Authenticated API requests reject redirects rather than forwarding the Bearer request through a hostname redirect.

## Scan lifecycle

Opening or reloading Facebook never starts or resumes a scan. Settings load while the scanner remains idle. A fresh remote scan and Facebook discovery begin only after **Start new hosted scan** is clicked. **Pause** cancels run-scoped discovery/detail activity without completing the scan and requires an explicit Resume. A previously active persisted run appears as **Interrupted scan found** and requires an explicit **Resume scan** or **Discard scan** choice.

1. The extension creates a hosted scan.
2. It discovers Facebook cards and records them in a durable local ledger.
3. The canonical evaluator may cheaply reject a proven card failure; missing required facts stay unresolved and trigger detail inspection.
4. Card, static-detail, and rendered-detail evidence all feed the same canonical facts normalizer. The final canonical evaluation applies the versioned saved search, including numeric ranges, dependent make/model selection, specifications, category semantics, keywords, and explicit unknown policies.
5. Completed outcomes are uploaded in idempotent batches.
6. Scanning stops at the first target, processed, duration, no-more-results, user, navigation, or error condition.
7. Pending completed outcomes upload before the hosted scan completes.
8. The results page opens only after successful remote completion when auto-open is enabled.

The invariant is:

```text
processedCount = matchedCount + rejectedCount + unavailableCount
```

## Recovery

The active run remains under `scannerV19:activeRun`, but compact state schema `20` stores only lifecycle markers, minimum resume metadata, and payloads that are still waiting for dashboard confirmation. Schema 19 is migrated on startup without changing settings or authentication.

On reload, queued work returns to discovered state but never restarts automatically. Interrupted work waits for Resume or Discard. Terminal unsynchronised payloads may upload without DOM discovery, auto-scroll, extraction, or controlled tabs. Missing hosted scans are recreated only from an explicit Retry sync/start flow, never merely because Facebook opened.

Version 23 adds only optional upload fields. Version 23.0.1 carries optional source mileage value/unit/original text. In the explicitly scoped Facebook Marketplace UK workflow, a source `km` label is a known Facebook display quirk: v23.0.2 preserves the original text, leaves the number unchanged, normalizes the operational unit to miles, and records `facebook_uk_label_correction`. Generic kilometre data and older records without that provenance remain kilometre-valued. Payloads cap descriptions at 20,000 characters, gallery URLs at 20, and vehicle attributes at 40 bounded string pairs. Malformed optional image/profile URLs and unsafe attribute values are omitted. Facebook CDN URLs may expire; Phase 1 neither downloads nor archives images.

Version 23.0.2 adds optional accepted make/model arrays to existing JSON scan-filter metadata. Detected advert identity uses bounded vehicle attributes and diagnostics, so no database or API migration is required. Vauxhall and Opel remain distinct; Land Rover and Range Rover are not interchangeable.

The pending 23.1 feature replaces those independent legacy settings with `filterSchemaVersion: 2`. The popup can load an active shared search from the dashboard, keeps a local editable draft in `chrome.storage.local`, and snapshots the complete normalized configuration into each scan. Legacy settings are normalized on read; they are not destructively rewritten in the database.

Use **Clear local state** only after remote completion. See [docs/RECOVERY.md](docs/RECOVERY.md).

## Category detection

Detection requires a controlled category term (`cat`, `category`, or a listed misspelling) adjacent to S, N, C, or D in either direction. Separators, Unicode dashes, whitespace, and zero-width artifacts are normalized. Standalone letters and unrelated service, tax, emissions, vehicle, or licence categories do not match.

Explicit `no`, `not`, `never`, and `without` are evaluated in limited local context. A later positive assertion remains decisive. Fetched-page evidence is primary when sources conflict; all positive and negated evidence is retained in limited diagnostic metadata.

Version 23.0.3 treats card classification as preliminary only. After controlled rendered extraction completes or falls back, the detector runs over trusted static/rendered descriptions, structured title and vehicle attributes, and card evidence. Any final positive S/N/C/D result is rejected before ledger persistence or upload. To reprocess previously misclassified adverts, start a new scan over the same Marketplace search; existing hosted rows remain visible until deliberately cleaned up.

The legacy `excludeCategories` settings key remains readable for schema compatibility. Schema v2 maps the legacy exclusion set to `clean_only` and supports `any`, `clean_only`, `category_only`, or an explicit set of clean/Cat S/Cat N/Cat C/Cat D/other/unknown statuses. Missing evidence remains unknown rather than being assumed clean.

This is disclosure detection, not an HPI check.

## Local validation

Node.js 20 or newer is sufficient; there are no package dependencies.

```powershell
npm run validate
```

Chrome Web Store submission material, identity migration safeguards, permission/privacy declarations and reviewer guidance are in `docs/WEB_STORE_*.md` and `docs/CHROME_WEB_STORE_LISTING.md`. Build the strict runtime-only submission archive with `npm run package:web-store`; this does not upload or publish it.

This runs syntax checks, detector and payload tests, manifest validation, permission checks, version checks, and fixed-ID derivation. Individual commands are described in [docs/TESTING.md](docs/TESTING.md).

## Release process

Follow [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md). A clean ZIP can be produced on Windows with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package.ps1
```

Generated archives are ignored by Git. Never package an active Chrome profile or local secrets.

## Security boundary

- The extension does not store Facebook credentials; listing requests use the signed-in browser session.
- The server does not sign into Facebook, fetch Facebook pages, or reclassify raw content.
- Dashboard requests use a private Bearer token over the configured HTTP(S) origin.
- Errors may include server validation paths but never include the Bearer token.
- The exact extension origin, timing-safe server token comparison, request-size limit, Zod validation, dashboard authentication, and private scan data remain server responsibilities.
