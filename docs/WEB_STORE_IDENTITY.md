# Chrome Web Store identity and migration

## Known identity

- Current unpacked ID: `aipljeeiecdcnkbbakphcddacbbgkpmf`
- Current origin: `chrome-extension://aipljeeiecdcnkbbakphcddacbbgkpmf`
- The checked-in manifest `key` deterministically preserves that ID for unpacked installations. Do not regenerate, reformat or remove it from internal/unpacked releases.

Google documents `key` as a development identity mechanism and instructs publishers to upload an item, use **Package → View public key**, add that Web Store public key to the manifest, and compare the unpacked ID with the Developer Dashboard Item ID. Therefore the first upload must be treated as identity discovery, not proof that the current key forces the Store ID: <https://developer.chrome.com/docs/extensions/reference/manifest/key>.

Keep the current key in the first private upload. Immediately record the Developer Dashboard Item ID and compare it with the unpacked ID. Do not change Production CORS or migrate either user until this comparison is complete.

## If the IDs match

1. Install the private item in a separate Chrome profile.
2. Confirm the Store installation ID is exactly `aipljeeiecdcnkbbakphcddacbbgkpmf`.
3. Run a 1 target / 5 processed / 120 second test scan.
4. Confirm the existing exact Production CORS origin succeeds.
5. Keep the manifest key unchanged in subsequent packages.

## If the Store assigns a different ID

The Store installation is a different extension origin and has a separate `chrome.storage.local` namespace. It will not inherit the unpacked dashboard URL, API token, settings, caches or active-run state.

1. Record `chrome-extension://<actual-store-item-id>` in the release checklist.
2. Update Production `ALLOWED_EXTENSION_ORIGIN` to the two exact comma-separated origins:

   ```text
   chrome-extension://aipljeeiecdcnkbbakphcddacbbgkpmf,chrome-extension://<actual-store-item-id>
   ```

3. Never use `*`, a partial ID, a regex or a generic `chrome-extension://` rule.
4. Redeploy and verify OPTIONS requests from both origins before migrating users.
5. Install the private Store item in a separate Chrome profile. Enter the dashboard URL and API token again; never copy the full Chrome profile or extension storage files.
6. Complete the small scan test and verify temporary tabs, upload, completion and dashboard results.

## Stanley and dad migration

For each person separately:

1. Finish or stop the unpacked scan and confirm pending uploads are zero.
2. Record non-secret settings and keep the API token available from its authorised source.
3. Leave the unpacked extension installed and idle.
4. Install the private Store item in a separate Chrome profile first.
5. Re-enter settings/token, run the 1/5/120 test and confirm results.
6. Only then disable—not uninstall—the unpacked item in the normal profile.
7. Keep dual-origin CORS during the agreed migration window.

Do not run both installations against the same Marketplace tab at the same time.

## Rollback

If the Store build fails, disable it, re-enable the unchanged unpacked installation and retain the original exact CORS origin. Do not uninstall an extension with an active or unsynchronised run. Remove the Store origin from CORS only after both users have either completed migration or rolled back and no Store installation is syncing.
