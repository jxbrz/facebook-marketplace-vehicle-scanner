# Chrome Web Store permission justifications

Single purpose: **Helps authorised vehicle traders scan Facebook Marketplace vehicle listings using configurable filters and securely send the resulting vehicle information to their private sourcing dashboard.**

Scanning begins only after the user clicks **Start scan**. Opening or refreshing Facebook remains idle. Completion, Stop, navigation and configured limits stop discovery and auto-scroll, disconnect observers, cancel queued inspection work and close controlled tabs. Interrupted runs require an explicit Resume or Discard choice.

Google requires the narrowest permissions needed for the current purpose: <https://developer.chrome.com/docs/webstore/cws-dashboard-privacy> and <https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions>.

## API permissions

### `storage`

- Feature: saves the production dashboard URL/API token, scan settings and filters, lifecycle recovery state, durable outcomes awaiting upload, runtime progress and a bounded 30-day listing cache.
- Data enabled: only extension-owned local data; it does not grant Facebook cookie access.
- Why narrower is insufficient: service workers and Facebook content scripts need a shared durable store that survives popup closure and browser restart. In-memory state cannot provide safe interrupted-run confirmation or durable sync recovery.

### `tabs`

- Feature: identifies the active Marketplace tab from the popup; creates, navigates and closes one inactive controlled listing tab when static Facebook HTML lacks trustworthy advert details; opens completed dashboard results when configured.
- Data enabled: active/controlled tab identifiers and URLs needed for this workflow. It is not used to enumerate or retain unrelated browsing.
- Why `activeTab` alone is insufficient: the controlled listing extraction and cleanup continue through the background service worker after the initial popup action and must manage a newly created inactive tab. The extension does not request `scripting`; extraction code is declaratively packaged as a Marketplace item content script.
- Temporary tabs: created only during an explicitly running scan, serialized one at a time, marked before navigation and closed in `finally`, on Stop and on completion/cancellation.

## Host permissions

### `https://www.facebook.com/*` and `https://facebook.com/*`

- Feature: discover Marketplace cards, request the selected listing pages using the existing signed-in browser session and run the two narrowly matched content scripts.
- Data enabled: Marketplace search/listing content described in the privacy policy.
- Why narrower is insufficient: Facebook can use both host variants and listing fetches/content-script routes occur below `/marketplace`; the extension does not request arbitrary HTTP or non-Facebook hosts.
- Timing: listing discovery/fetch/extraction occurs only in `running` after explicit Start or explicit Resume.

### `https://sourcing.kelmarvehiclesltd.co.uk/*`

- Feature: create/update/complete hosted scans and open the authenticated private result pages.
- Data enabled: transmits structured scan settings, progress and bounded vehicle results over HTTPS with the locally stored Bearer token.
- Why narrower is insufficient: Chrome host permissions are origin/path match grants; the extension calls several `/api/extension/scans...` routes and opens `/scans/...` results on this one production origin.

### `https://facebook-web-filter.vercel.app/*`

- Feature: staged migration compatibility for existing installations that may still have the exact legacy production URL stored when v23.0.5 first starts.
- Runtime behavior: popup initialization and the background request boundary rewrite that exact origin to `https://sourcing.kelmarvehiclesltd.co.uk` and persist it before authenticated request construction. No v23.0.5 API request intentionally targets this permission.
- Why retained for this release: keeping the previously reviewed exact-origin grant avoids coupling the urgent runtime fix to permission removal while dealership installations complete and verify the in-place storage migration. It is not a wildcard or a redirect fallback.
- Removal plan: remove this host in a later reviewed release after both dealership installations confirm the canonical value is stored and no rollback/dual-host migration path remains.

## Content-script scope

- Search lifecycle scripts: Facebook `/marketplace` routes only.
- Rendered detail extractor: Facebook `/marketplace/item/*` routes only.
- No scripts run on the dashboard, unrelated Facebook pages or arbitrary websites.

## Permissions not requested

No `cookies`, `webRequest`, `history`, `downloads`, `geolocation`, `notifications`, `scripting`, `<all_urls>`, clipboard or native-messaging permission is requested. The v23.0.4 change removes the former broad `https://*/*` and localhost host grants.
