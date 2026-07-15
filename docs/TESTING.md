# Testing

## Automated checks

From the repository root:

```powershell
node --check background.js
node --check content.js
node --check popup.js
node --check category-detector.js
node --check payload-normalizer.js
node --test
node scripts/validate-manifest.js
```

`npm run validate` runs the same suite. CI runs it on pushes and pull requests without secrets.

Detector tests cover forward/reverse terms, controlled misspellings, punctuation and Unicode normalization, explicit local negation, later positive assertions, non-insurance categories, source priority, and conflicting evidence. Payload tests cover restored decimal normalization plus required URL/status/category/metadata validation.

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
7. Shortlisting, reviewing, dismissing, and notes do not reorder unrelated cards.
8. A listing containing `S category` is rejected as category S.
9. A listing containing only `Not Cat S` is not rejected for category disclosure.
10. Reloading the extension preserves configuration and compatible active state.
11. With a deliberately removed test scan, retry recreates the remote scan and replays the durable ledger.

Do not delete a production scan merely to test recovery. Use a disposable local or dedicated test scan.
