# Recovery

## Durable state

An active hosted run is stored in `chrome.storage.local` under `scannerV19:activeRun`. It includes the remote scan reference, settings snapshot, lifecycle timestamps, finalization state, ledger, fetched results, pending uploads, and filter fingerprint. The key and state schema version remain unchanged in v22.

Final listing results are also cached as `listing:<id>` entries for 30 days. Configuration and the API token use their established top-level keys.

## Extension reload

On content-script restoration:

- final ledger entries stay final;
- queued or scanning entries return to `discovered` because their requests cannot be trusted across reload;
- a run resumes only on the original Marketplace route;
- a run restored elsewhere becomes `stopped` with `extension_closed`;
- a finalized but incomplete remote run retries synchronization automatically.

## Pending upload recovery

Before manual retry, and whenever a missing hosted scan is recreated, pending payloads are rebuilt from every final ledger entry. They therefore pass through current category diagnostics and the current upload-boundary normalizer instead of replaying stale serialized payload objects.

Price and mileage become nullable non-negative integers. Year becomes a nullable integer from 1886 through 2100. Other fields are normalized or rejected according to the documented API contract.

## Missing hosted scan

A `Scan run was not found` response during upload, progress, completion, or manual retry triggers:

1. creation of a replacement hosted scan from the saved scan configuration;
2. replacement of the local remote scan reference;
3. rebuilding pending payloads from the durable ledger;
4. replay of completed outcomes;
5. remote completion after the replay is empty.

The replacement results URL is used for auto-open. Conflicting old and replacement IDs are not merged server-side.

## Clearing state

Local scanner state is safe to clear only when:

- scanning has stopped;
- pending uploads are empty;
- the hosted scan reports successful completion; and
- the dashboard contains the expected outcomes.

The Clear action refuses to proceed while hosted results remain unsynchronised. It does not delete dashboard URL, API token, filters, or the listing cache. Do not uninstall the extension to clear a run, because uninstalling can remove all local extension storage.
