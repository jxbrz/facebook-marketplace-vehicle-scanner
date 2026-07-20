# Testing

## Automated checks

From the repository root:

```powershell
node --check background.js
node --check content.js
node --check popup.js
node --check category-detector.js
node --check listing-category-pipeline.js
node --check mileage-utils.js
node --check scanner-lifecycle.js
node --check scanner-diagnostics.js
node --check scanner-runtime.js
node --check vehicle-identity.js
node --check listing-details-extractor.js
node --check payload-normalizer.js
node --test
node scripts/validate-manifest.js
```

`npm run validate` runs the same suite. CI runs it on pushes and pull requests without secrets.

Lifecycle tests cover idle startup, terminal reload, Pause/Resume, explicit interrupted recovery, sync-only recovery, Start/Resume gating, cleanup wiring, and run-scoped controlled-tab cancellation. Runtime tests cover canonical identity, recycled cards, scroll targets/replacement, repeated end confirmation, bounded concurrency, slow-worker isolation, retry caps, and cancellation. Final-category tests cover rendered descriptions, structured attributes, provisional-to-final replacement, counters, target completion, payload status, negation, mixed evidence, and timeout fallback. Identity and mileage suites retain their existing compatibility coverage.

Remote-boundary tests also cover exact legacy-origin migration, direct canonical request construction, redirect rejection, Bearer-header preservation, storage rewrite, and unchanged custom dashboard origins.

## Small end-to-end manual test

Use a non-sensitive Marketplace search and configure:

- target matches: 3;
- maximum processed: 15;
- maximum duration: 120 seconds;
- auto-load: enabled;
- open results automatically: enabled.

Expected flow:

1. The extension creates a remote scan.
2. Listings are discovered and classified locally.
3. Completed outcomes upload in batches and dashboard progress changes.
4. The first target or safety limit stops discovery and auto-loading.
5. Pending uploads finish before remote completion.
6. The results page opens only after successful completion.
7. Open **View vehicle** and verify title, price, source-aware mileage unit, location, multiline description, multiple high-quality listing photos, structured attributes, safe Facebook link, notes, and shortlist/review/dismiss actions.
8. Verify an older scan opens with its primary image/excerpt fallbacks and no empty seller or attribute sections.
9. Shortlisting, reviewing, dismissing, and notes do not reorder unrelated cards.
10. A listing containing `S category` is rejected as category S.
11. A listing containing only `Not Cat S` is not rejected for category disclosure.
12. Reloading the extension preserves configuration and compatible active state.
13. With a deliberately removed test scan, retry recreates the remote scan and replays the durable ledger.
14. Contacting the seller still happens only on the original Facebook listing.
15. During an incomplete static-detail fetch, confirm any inactive item tab closes after extraction and does not stop or reset the scan.
16. Reload with an active scan and verify **Interrupted scan found** appears without discovery; test Resume and Discard separately.
17. After completion, wait 30 seconds, refresh, and reopen Marketplace; verify no scrolling, processing, controlled tabs, or remote scan creation.
18. For a UK Facebook listing showing `68,600 km`, verify the dashboard displays `68,600 miles`, retains `68,600 km` as the source text, and records the label-correction provenance.
19. Scan listings whose seller descriptions contain `Cat S`, `Cat N Many Years Ago`, and `S category`; verify each is rejected, carries category evidence, and never advances the match target.
20. Start a new scan over any adverts affected by older classification. Confirm the old hosted rows remain unchanged while the new scan records corrected outcomes.
21. With an installation upgraded from the legacy dashboard value, run a one-listing scan from the service-worker DevTools Network panel. Confirm the first request is directly to `https://sourcing.kelmarvehiclesltd.co.uk`, no request hits `https://facebook-web-filter.vercel.app`, no 307 occurs, and scan upload/dashboard appearance succeed without `Request origin is not allowed`.

## Performance regression retest

For development timing only, set `scannerDebugDiagnostics` to `true` in the extension's local storage before starting a fresh scan. The flag defaults to false. Timing summaries appear at most once every 10 seconds in the Marketplace tab console and in `runtimeProgress.performanceDiagnostics`; they contain IDs/counts/timings only, never tokens or listing descriptions.

1. Load the unpacked extension from this repository in `chrome://extensions` and press **Reload** after each code change.
2. Open a fresh Facebook Marketplace vehicle search, not an individual item page.
3. Use **Clear local state** only after any prior hosted scan has synchronised, or start a normal new scan without deleting production data.
4. Configure a small safe run (target 3, processed cap 15, duration 120 seconds) with auto-load enabled.
5. Start scanning and confirm visible-card discovery and queue counters change within a few seconds.
6. Confirm scrolling starts while queued/scanning counts are still non-zero; it must not wait for all detail tabs or uploads.
7. Confirm the effective scroll target and before/after position/height change in the diagnostic summary.
8. Confirm new cards are detected across several scroll batches and `cardsPerScroll` is non-zero on a search with more results.
9. Confirm queue activity never exceeds 3 processing workers or 12 committed detail inspections.
10. Confirm obvious year, mileage, price, keyword, make, and model rejects do not create detail tabs.
11. Confirm a repeated/canonical URL variant increments duplicate skips but never queues or uploads the same listing twice.
12. Confirm matches and rejections appear progressively on the dashboard while scrolling continues.
13. Confirm a slow or failed listing releases its worker slot; retryable detail failures retry once only.
14. Click **Pause** and confirm scrolling, the observer, timers, queued work, in-flight fetches, and controlled detail tabs stop.
15. Click **Resume scan** and confirm work continues with a fresh run token and no duplicate final outcomes.
16. Click **Stop** and confirm the scan becomes terminal only after pending uploads synchronise.
17. On a long search, confirm one empty growth check does not finish the run; end-of-results requires four bottom confirmations (or ten non-bottom stalls) and no pending discovered work.
18. Confirm matched dashboard records retain descriptions, photos, attributes, CAT exclusions, mileage provenance, and make/model filtering.
19. Confirm Facebook remains responsive and no unbounded tab, queue, ledger, or memory growth occurs.
20. Inspect both consoles for uncaught errors and verify diagnostics contain no token, description, or seller text.

Do not delete a production scan merely to test recovery. Use a disposable local or dedicated test scan.
