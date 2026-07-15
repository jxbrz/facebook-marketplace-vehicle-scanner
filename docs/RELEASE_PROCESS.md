# Release process

1. Verify a clean working tree with `git status`.
2. Run extension syntax checks with `npm run check`.
3. Run detector and payload tests with `npm test`.
4. Confirm `manifest.json` version is the intended release.
5. Confirm the manifest key and derived ID are unchanged with `npm run validate:manifest`.
6. Confirm permissions and host permissions are unchanged unless a reviewed requirement justifies them.
7. Copy or tag the release only after all checks pass.
8. Reload the unpacked extension without uninstalling it.
9. Run the small end-to-end test in `TESTING.md`.
10. Verify progress, results, ordering, and actions in the Vercel dashboard.
11. Tag the Git release, for example `git tag -a v23.0.0 -m "v23.0.0"`.
12. Create a clean ZIP if needed with `scripts/package.ps1`, then inspect its file list before publishing.

Never rotate the manifest key as part of release packaging. Never include `.env` files, Chrome profiles, screenshots, tokens, or repository metadata in an archive.

For v23, deploy the additive dashboard migration and API before distributing or reloading the expanded extension. Reload the unpacked extension in place without uninstalling it, then reload the active Marketplace tab. No storage clearing or active-run schema migration is required.
