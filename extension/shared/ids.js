/**
 * UUID generation — IDs are client-side so writes are idempotent across
 * offline buffer drains. The backend's `upsertByKey_` keys on these.
 */
function newUuid() {
  // crypto.randomUUID exists in MV3 service workers and modern content scripts.
  return crypto.randomUUID();
}

if (typeof self !== 'undefined') self.newUuid = newUuid;
