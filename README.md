# Facebook Marketplace Vehicle Scanner

Private Chrome Manifest V3 extension that discovers vehicle listings on Facebook Marketplace, classifies them locally, and uploads structured outcomes to a private hosted dashboard.

The extension remains a plain-JavaScript, unpacked-loadable project. There is no bundler, build step, TypeScript conversion, Facebook credential storage, or server-side Facebook scraping.

## Architecture

```text
Facebook Marketplace tab
  -> content.js: discovery, limits, filtering, durable scan ledger
  -> background.js: authenticated listing fetches and dashboard requests
  -> Vercel extension API: validation and lifecycle persistence
  -> Neon Postgres
  -> private dashboard
```

- `content.js` owns Facebook card discovery, filtering, stopping, the active-run ledger, upload queueing, and recovery.
- `background.js` owns controlled listing-page requests and Bearer-authenticated dashboard requests.
- `listing-details-extractor.js` conservatively reads named listing objects from embedded JSON/JSON-LD and semantic listing images; it does not traverse profiles or scrape unrelated page content.
- `category-detector.js` is a pure shared detector loaded by both extension contexts and by Node tests.
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

- dashboard URL, normally `https://facebook-web-filter.vercel.app`;
- the private extension API token configured on the server;
- scan limits, filters, and category preferences.

The token is saved only in `chrome.storage.local`. Never add it to source, `.env` files committed to Git, logs, screenshots, or release archives. The server must set `ALLOWED_EXTENSION_ORIGIN` to exactly:

```text
chrome-extension://aipljeeiecdcnkbbakphcddacbbgkpmf
```

## Scan lifecycle

1. The extension creates a hosted scan.
2. It discovers Facebook cards and records them in a durable local ledger.
3. Card filters run locally; eligible listings are fetched with the existing Facebook session.
4. Card and page text are checked for controlled S/N/C/D insurance-category wording, while named listing structures supply available full description, listing photos, vehicle attributes, seller display name/profile URL, and visible listing-date wording.
5. Completed outcomes are uploaded in idempotent batches.
6. Scanning stops at the first target, processed, duration, no-more-results, user, navigation, or error condition.
7. Pending completed outcomes upload before the hosted scan completes.
8. The results page opens only after successful remote completion when auto-open is enabled.

The invariant is:

```text
processedCount = matchedCount + rejectedCount + unavailableCount
```

## Recovery

The active run is stored under the existing `scannerV19:activeRun` key with state schema version `19`. Those names intentionally remain unchanged in v23 so saved v19-v22 runs remain readable.

On reload, queued work returns to discovered state, final results stay durable, and unsynchronised payloads are rebuilt from the ledger through the latest normalizer. If the hosted scan no longer exists, the extension creates a replacement scan and replays durable outcomes before completion.

Version 23 adds only optional upload fields. It caps descriptions at 20,000 characters, gallery URLs at 20, and vehicle attributes at 40 bounded string pairs. Malformed optional image/profile URLs and unsafe attribute values are omitted. Facebook CDN URLs may expire; Phase 1 neither downloads nor archives images.

Use **Clear local state** only after remote completion. See [docs/RECOVERY.md](docs/RECOVERY.md).

## Category detection

Detection requires a controlled category term (`cat`, `category`, or a listed misspelling) adjacent to S, N, C, or D in either direction. Separators, Unicode dashes, whitespace, and zero-width artifacts are normalized. Standalone letters and unrelated service, tax, emissions, vehicle, or licence categories do not match.

Explicit `no`, `not`, `never`, and `without` are evaluated in limited local context. A later positive assertion remains decisive. Fetched-page evidence is primary when sources conflict; all positive and negated evidence is retained in limited diagnostic metadata.

This is disclosure detection, not an HPI check.

## Local validation

Node.js 20 or newer is sufficient; there are no package dependencies.

```powershell
npm run validate
```

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
