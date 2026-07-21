# Recovery

## Durable state

An active hosted run is stored in `chrome.storage.local` under `scannerV19:activeRun`. Schema 20 includes the remote scan reference, settings snapshot, lifecycle timestamps, compact ledger, pending uploads, retry metadata, storage health, and filter fingerprint. It does not store full successful results.

Already-final historical listings are never silently reclassified. Start a new scan over the affected Marketplace search to deliberately reprocess current adverts with the v23.0.3 final-evidence classifier.

Legacy `listing:<id>` full-result caches are removed by the idempotent startup migration. Configuration and the API token retain their established top-level keys and are never included in automatic pruning.

## Extension reload

On content-script restoration:

- final ledger entries stay final;
- queued or scanning entries return to `discovered` because their requests cannot be trusted across reload;
- a previously running/creating/stopping run becomes `interrupted` and never resumes automatically;
- Resume requires an explicit popup click on the original route;
- an explicit Pause uses the same run-scoped cancellation, remains non-terminal, and resumes with a fresh run token;
- Discard removes only the interrupted active-run/runtime-progress records and preserves settings and API token;
- finalized pending/syncing work may upload automatically, but cannot discover, scroll, extract, or create replacement remote scans;
- failed/error state waits for explicit Retry sync.

## Pending upload recovery

Pending payloads are ID-deduplicated and retained only until the dashboard confirms success. Manual retry reuses only these genuinely pending payloads; successful payloads are not reconstructed from the compact ledger.

Recovery storage has a 4 MiB soft limit. If pending failures reach it, the compact state is saved first and discovery pauses explicitly; successful background uploads may still reduce the queue. A quota failure prunes obsolete completed caches and retries once. A second failure pauses in degraded mode without clearing settings, authentication, or the last successfully persisted pending state.

Price and mileage become nullable non-negative integers. Year becomes a nullable integer from 1886 through 2100. Other fields are normalized or rejected according to the documented API contract.

## Missing hosted scan

A `Scan run was not found` response may create a replacement only while every completed payload is still pending locally:

1. creation of a replacement hosted scan from the saved scan configuration;
2. replacement of the local remote scan reference;
3. replay of the retained pending outcomes;
5. remote completion after the replay is empty.

Once any confirmed upload has been pruned, replacement is refused because reconstructing a complete deleted hosted scan would require retaining the very successful payloads schema 20 removes. The user must start a new scan instead.

Passive startup synchronization never creates a replacement hosted scan. It records the error and waits for explicit Retry sync.

## Clearing state

Local scanner state is safe to clear only when:

- scanning has stopped;
- pending uploads are empty;
- the hosted scan reports successful completion; and
- the dashboard contains the expected outcomes.

The Clear action refuses to proceed while hosted results remain unsynchronised. It removes scanner recovery/progress and legacy listing caches, but does not delete dashboard URL, API token, filters, or unrelated keys. Do not uninstall the extension to clear a run, because uninstalling can remove all local extension storage.
