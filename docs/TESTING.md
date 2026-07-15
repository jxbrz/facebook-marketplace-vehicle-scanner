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
node --check vehicle-identity.js
node --check listing-details-extractor.js
node --check payload-normalizer.js
node --test
node scripts/validate-manifest.js
```

`npm run validate` runs the same suite. CI runs it on pushes and pull requests without secrets.

Lifecycle tests cover idle startup, terminal reload, explicit interrupted recovery, sync-only recovery, Start/Resume gating, cleanup wiring, and run-scoped controlled-tab cancellation. Final-category tests cover rendered descriptions, structured attributes, provisional-to-final replacement, counters, target completion, payload status, negation, mixed evidence, and timeout fallback. Identity and mileage suites retain their existing compatibility coverage.

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

Do not delete a production scan merely to test recovery. Use a disposable local or dedicated test scan.
