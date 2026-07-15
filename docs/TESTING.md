# Testing

## Automated checks

From the repository root:

```powershell
node --check background.js
node --check content.js
node --check popup.js
node --check category-detector.js
node --check mileage-utils.js
node --check scanner-lifecycle.js
node --check vehicle-identity.js
node --check listing-details-extractor.js
node --check payload-normalizer.js
node --test
node scripts/validate-manifest.js
```

`npm run validate` runs the same suite. CI runs it on pushes and pull requests without secrets.

Lifecycle tests cover idle startup, terminal reload, explicit interrupted recovery, sync-only recovery, Start/Resume gating, cleanup wiring, and run-scoped controlled-tab cancellation. Identity tests cover empty filters, aliases, token-aware models, unrelated wording, both-filter semantics, source priority, diagnostics, and old settings/payload compatibility. Mileage tests cover the scoped Facebook UK label correction, unchanged numeric values and source text, miles-based filtering, historical compatibility, and generic kilometre behavior. Existing detector, payload, and rendered-listing regressions remain unchanged.

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

Do not delete a production scan merely to test recovery. Use a disposable local or dedicated test scan.
