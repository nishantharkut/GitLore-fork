/**
 * Optional defaults for **published** Chrome Web Store builds.
 *
 * After you publish once, Chrome assigns a **fixed** extension ID. Register this callback
 * on your GitHub OAuth App **once** (maintainer only):
 *   https://<STORE_EXTENSION_ID>.chromiumapp.org/
 *
 * Then set `BUNDLED_GITHUB_OAUTH_CLIENT_ID` to that app’s public Client ID.
 * End users who install from the store won’t need to paste a Client ID or callback.
 *
 * Leave both empty for **unpacked / dev** — each load can get a new ID, so you must
 * register the callback in GitHub manually (GitHub has no API to do that without a secret).
 */
export const BUNDLED_GITHUB_OAUTH_CLIENT_ID = "";
