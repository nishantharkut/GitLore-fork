/** Full page navigation so OAuth is not handled as a client route. */
export function startGithubOAuth(): void {
  try {
    sessionStorage.setItem("gitlore-oauth-pending", "1");
  } catch {
    /* ignore */
  }
  const path = "/auth/github";
  const url =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  window.location.assign(url);
}
