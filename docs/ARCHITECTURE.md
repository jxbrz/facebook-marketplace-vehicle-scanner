# Architecture

## Runtime boundary

The Chrome extension is the only component with access to Facebook. It discovers visible Marketplace cards, fetches listing pages with the signed-in browser session, extracts metadata, applies filters, detects disclosed insurance categories, enforces scan limits, and queues structured outcomes.

The hosted Next.js application authenticates extension requests, validates structured payloads, stores scans and outcomes in Neon Postgres, reconciles authoritative counts, and serves the private dashboard. It never receives Facebook credentials and never scrapes or fetches Facebook content.

## Extension components

- `manifest.json`: MV3 configuration, fixed key, permissions, background worker, popup, and ordered content scripts.
- `content.js`: scan state machine, DOM discovery, durable ledger, filtering, limits, persistence, recovery, and upload scheduling.
- `background.js`: bounded Facebook fetch queue and authenticated dashboard request boundary.
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

## Stopping invariants

The scan checks target matches before processed count, then duration. Finalization immediately disables scanning and auto-loading, increments the generation so late requests cannot classify new results, clears timers, and returns queued/scanning ledger entries to discovered state. Already completed outcomes remain final and uploadable.

Remote completion occurs only after the pending upload map is empty. Auto-open occurs only after the completion request succeeds.
