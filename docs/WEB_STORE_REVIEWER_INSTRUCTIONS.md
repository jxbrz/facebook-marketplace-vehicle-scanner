# Chrome Web Store reviewer instructions

Do not commit or paste real credentials into this file. Replace the placeholders only in the private Developer Dashboard reviewer-instructions field.

## Safe review environment required before submission

The current dashboard is shared dealership data and does not provide per-user isolation. A normal temporary dashboard account would see existing scans. The safest reviewer setup is therefore a temporary isolated dashboard deployment/database containing no production history, with:

- exact HTTPS review dashboard origin included in the submitted manifest host permissions;
- temporary extension API token;
- temporary dashboard user/password;
- the same v23.0.4 server code and schema;
- credentials revoked and environment removed after review.

Do not give a reviewer production database access or the long-lived production API token. Creating this isolated environment and adding its exact host is a manual pre-submission blocker; do not use wildcard host permission. If an isolated environment cannot be provided, obtain human approval before using any production credentials.

Facebook may challenge unfamiliar logins. Prefer a reviewer-owned Facebook account with Marketplace access. Do not create or supply fake Facebook credentials. Explain that Facebook authentication is external and the extension never receives the password.

## Ready-to-paste reviewer steps

1. Use current desktop Google Chrome in a fresh profile.
2. Install the private **Kelmar Vehicle Scanner** item.
3. Sign in to Facebook using your own authorised account and open this supplied UK Marketplace vehicle-search URL: `[REVIEW_MARKETPLACE_SEARCH_URL]`.
4. Open the extension and enter:
   - Dashboard URL: `[REVIEW_DASHBOARD_URL]`
   - Extension API token: `[TEMPORARY_REVIEW_API_TOKEN]`
5. Set Target matches to `1`, Maximum processed to `5`, and Maximum duration to `2` minutes. Leave make/model filters empty unless the supplied search instructions specify test values.
6. Click **Start scan**. Merely opening/reloading Facebook does not start scanning.
7. Expected behaviour: the search page may auto-scroll; at most one inactive Facebook listing tab is opened at a time for missing details and closes automatically; the panel stops at the first configured limit.
8. Click **Open results** or allow configured auto-open. Sign in to the isolated dashboard with:
   - Email: `[TEMPORARY_REVIEW_DASHBOARD_EMAIL]`
   - Password: `[TEMPORARY_REVIEW_DASHBOARD_PASSWORD]`
9. Confirm the scan contains bounded matched/rejected/unavailable outcomes and original Facebook links. Shortlist one matched advert, change it to Contacted, add a non-sensitive test note, and confirm it appears in Saved Vehicles.
10. Privacy/support pages are public at `[REVIEW_DASHBOARD_URL]/privacy` and `[REVIEW_DASHBOARD_URL]/support`.

## Data-use verification

- Inspect `chrome.storage.local` only if required: settings/token and recovery data are local.
- Network requests to the dashboard use HTTPS and an Authorization Bearer header.
- Request bodies contain structured Marketplace advert data, not Facebook passwords or cookies.
- No remote scripts are loaded; all logic is in the submitted ZIP.
- Press Stop to verify observers/auto-scroll/queues stop and controlled tabs close.

## Revocation

After review, revoke the temporary extension token and dashboard user, remove the isolated database/deployment, remove its exact manifest host in the next release, and retain the review record without credentials.
