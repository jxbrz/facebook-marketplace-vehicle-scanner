# First Chrome Web Store release checklist

Do not upload until every package/reviewer prerequisite is checked. Do not publish automatically.

- [ ] Developer account verified under Kelmar Vehicles Ltd.
- [ ] Trader information and contact email verified.
- [ ] Two-step verification enabled on the developer Google Account.
- [ ] Public privacy policy returns HTTP 200: <https://sourcing.kelmarvehiclesltd.co.uk/privacy>.
- [ ] Public support page returns HTTP 200: <https://sourcing.kelmarvehiclesltd.co.uk/support>.
- [ ] Both repositories clean and pushed; CI green.
- [ ] `npm run validate` passes in the extension repository.
- [ ] Web validation (`npm ci`, lint, typecheck, tests, build) passes.
- [ ] Manifest version `23.0.5` has never been uploaded to this Store item.
- [ ] Manifest key retained and first-upload identity decision reviewed.
- [ ] Permissions/host permissions match `WEB_STORE_PERMISSION_JUSTIFICATIONS.md`.
- [ ] No remote executable code, obfuscation, credentials or debug-only files.
- [ ] `npm run package:web-store` succeeds.
- [ ] ZIP file list and SHA-256 recorded; ZIP contains only the runtime allow-list.
- [ ] 128 px icon, small promo tile and at least one accurate 1280×800 screenshot ready.
- [ ] All screenshots sanitised using `WEB_STORE_ASSETS.md`.
- [ ] Store listing text reviewed for accuracy/non-affiliation.
- [ ] Privacy declarations completed conservatively and consistent with public policy.
- [ ] Distribution set to **Private**.
- [ ] Trusted tester Google Accounts configured.
- [ ] Isolated reviewer dashboard/token/account created; no production credentials supplied.
- [ ] Exact reviewer dashboard host included in the submitted manifest and justified, if different from Production.
- [ ] Reviewer instructions completed privately with temporary values.
- [ ] Deferred/staged publishing selected before submission.
- [ ] ZIP uploaded manually and actual Web Store Item ID recorded.
- [ ] Store Item ID compared with unpacked ID `aipljeeiecdcnkbbakphcddacbbgkpmf`.
- [ ] Production CORS updated to two exact origins only after a different Store ID is known.
- [ ] Store installation tested in a separate Chrome profile.
- [ ] Real bounded `1 / 5 / 120` scan passes end to end.
- [ ] Dad migrated only after the separate-profile test succeeds.
- [ ] Temporary reviewer token/user/environment revoked after review.
- [ ] Current unpacked installation retained, disabled rather than uninstalled, until rollback window closes.

Google requires a ZIP with `manifest.json` at its root and a monotonically increasing version for later updates: <https://developer.chrome.com/docs/webstore/prepare>. Review can take longer for a new extension or sensitive/broad permissions: <https://developer.chrome.com/docs/webstore/review-process>.
