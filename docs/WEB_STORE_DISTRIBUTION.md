# Private distribution plan

Official distribution guidance: <https://developer.chrome.com/docs/webstore/cws-dashboard-distribution/>. Private, unlisted and public items all receive the same policy review.

## Initial settings

- Visibility: **Private**.
- Publishing: select **Defer publish** / staged publishing so approval does not automatically release the item.
- Regions: United Kingdom only if the current Dashboard permits a region selection for private items; otherwise trusted testers are the effective restriction.
- Trusted testers: company developer Google Account, Stanley’s Google Account and dad’s Google Account where appropriate.

Each trusted-tester email must be associated with a Google Account. Trusted tester configuration belongs to the developer account and can apply across items. Do not set Public or Unlisted for this first submission.

If a separate parallel beta item is created, name it **Kelmar Vehicle Scanner BETA** and begin its description with **THIS EXTENSION IS FOR BETA TESTING**. A single first private item does not need a duplicate beta listing merely to be private.

## Controlled rollout

1. Developer account and trader verification complete.
2. Add trusted testers but do not migrate either current unpacked installation.
3. Submit for review with deferred publishing.
4. On approval, discover/record the Store ID and prepare exact dual-origin CORS if required.
5. Publish privately to trusted testers only.
6. Test in a separate Chrome profile, then migrate Stanley and dad one at a time using `WEB_STORE_IDENTITY.md`.
