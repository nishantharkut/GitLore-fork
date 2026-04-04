import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { getDB, ObjectId } from "../lib/mongo";
import { getUserInfo } from "../lib/github";
import { signSession, verifySession, getSessionToken } from "../middleware/auth";
import { createGithubClient } from "../lib/github";

export const authRouter = new Hono();

/** Where to send the browser after OAuth (frontend origin). */
function getFrontendBaseUrl(): string {
  const explicit = process.env.FRONTEND_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const callback = process.env.GITHUB_CALLBACK_URL;
  if (callback) {
    try {
      return new URL(callback).origin;
    } catch {
      /* ignore */
    }
  }
  return "";
}

interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

/**
 * Normalize redirect URI for allowlist comparison (no hash; strip trailing slash).
 */
function normalizeOAuthRedirectUri(uri: string): string {
  try {
    const u = new URL(uri);
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return "";
  }
}

/**
 * Exact extension OAuth callback URLs allowed for server-side code exchange (env allowlist).
 * Without GITHUB_EXTENSION_REDIRECT_URIS, extension backend routes reject all redirect URIs.
 */
function getAllowedExtensionRedirectUris(): Set<string> {
  const raw = process.env.GITHUB_EXTENSION_REDIRECT_URIS || "";
  return new Set(
    raw
      .split(",")
      .map((s) => normalizeOAuthRedirectUri(s.trim()))
      .filter(Boolean)
  );
}

/**
 * Chrome extension OAuth redirect: must be https://*.chromiumapp.org and explicitly allowlisted.
 */
function isExtensionChromeRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== "https:" || !u.hostname.endsWith(".chromiumapp.org")) {
      return false;
    }
    const allowed = getAllowedExtensionRedirectUris();
    if (allowed.size === 0) return false;
    return allowed.has(normalizeOAuthRedirectUri(uri));
  } catch {
    return false;
  }
}

/**
 * Exchange GitHub OAuth code for an access token (same env as web callback).
 */
async function exchangeGithubOAuthCode(
  code: string,
  redirectUri: string
): Promise<{ access_token: string } | { error: string }> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { error: "GitHub OAuth not configured (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET)" };
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const tokenData = (await tokenResponse.json()) as GitHubTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!tokenData.access_token) {
    const detail = tokenData.error_description || tokenData.error || "no access_token in response";
    return { error: detail };
  }

  return { access_token: tokenData.access_token };
}

/**
 * Upsert user document (same logic as web OAuth callback).
 */
async function upsertUserFromGithubAccessToken(accessToken: string) {
  const githubClient = createGithubClient(accessToken);
  const userInfo = await getUserInfo(githubClient);

  if (!userInfo) {
    throw new Error("Failed to fetch user information");
  }

  const db = getDB();
  const user = await db.collection("users").findOneAndUpdate(
    { github_id: userInfo.login },
    {
      $set: {
        github_id: userInfo.login,
        username: userInfo.login,
        avatar_url: userInfo.avatarUrl,
        access_token: accessToken,
        updated_at: new Date(),
      },
      $setOnInsert: {
        created_at: new Date(),
      },
    },
    { upsert: true, returnDocument: "after" }
  );

  if (!user?._id) {
    throw new Error("User upsert failed");
  }

  return { user, userInfo };
}

/**
 * Start GitHub OAuth flow
 */
authRouter.get("/github", (c) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = process.env.GITHUB_CALLBACK_URL;

  if (!clientId || !redirectUri) {
    return c.json(
      {
        error: "GitHub OAuth not configured",
        required: ["GITHUB_CLIENT_ID", "GITHUB_CALLBACK_URL"],
      },
      500
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo read:user",
    allow_signup: "true",
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * Chrome extension: start OAuth — redirects to GitHub using the same GITHUB_CLIENT_ID as the web app.
 * Register this redirect URI in the same GitHub OAuth App: https://&lt;EXTENSION_ID&gt;.chromiumapp.org/
 *
 * Query: redirect_uri (required), state (required, CSRF — echoed by GitHub)
 */
authRouter.get("/github/extension/start", (c) => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const redirectUri = c.req.query("redirect_uri");
  const state = c.req.query("state");

  if (!clientId) {
    return c.json({ error: "GITHUB_CLIENT_ID is not set" }, 500);
  }
  if (!redirectUri || !state) {
    return c.json({ error: "Missing redirect_uri or state" }, 400);
  }
  if (!isExtensionChromeRedirectUri(redirectUri)) {
    return c.json(
      {
        error:
          "Invalid redirect_uri: must be an allowlisted https://<extension-id>.chromiumapp.org URL (set GITHUB_EXTENSION_REDIRECT_URIS on the server).",
      },
      400
    );
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo read:user",
    state,
    allow_signup: "true",
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * Exchange a GitHub OAuth user access token (e.g. extension device flow) for a GitLore session.
 * POST /auth/github/exchange-token  { "github_access_token": "gho_..." }
 * Returns the same signed session string as the web cookie (use Authorization: Bearer or X-GitLore-Session on /api/*).
 */
authRouter.post("/github/exchange-token", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const accessToken =
      typeof body.github_access_token === "string"
        ? body.github_access_token.trim()
        : "";
    if (!accessToken) {
      return c.json({ error: "Missing github_access_token" }, 400);
    }

    const { user, userInfo } = await upsertUserFromGithubAccessToken(accessToken);
    const sessionToken = signSession(user._id.toString());

    return c.json({
      session: sessionToken,
      user: {
        login: userInfo.login,
        name: userInfo.name ?? null,
        avatar_url: userInfo.avatarUrl,
      },
    });
  } catch (error) {
    console.error("github/exchange-token error:", error);
    return c.json(
      { error: error instanceof Error ? error.message : "Exchange failed" },
      500
    );
  }
});

/**
 * Chrome extension: exchange code for tokens + same signed session as the web cookie.
 */
authRouter.post("/github/extension/token", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const code = typeof body.code === "string" ? body.code : "";
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";

    if (!code || !redirectUri) {
      return c.json({ error: "Missing code or redirect_uri" }, 400);
    }
    if (!isExtensionChromeRedirectUri(redirectUri)) {
      return c.json(
        {
          error:
            "Invalid redirect_uri: must match an entry in GITHUB_EXTENSION_REDIRECT_URIS (exact callback allowlist).",
        },
        400
      );
    }

    const exchanged = await exchangeGithubOAuthCode(code, redirectUri);
    if ("error" in exchanged) {
      console.error("Extension token exchange failed:", exchanged.error);
      return c.json({ error: exchanged.error }, 400);
    }

    const { user, userInfo } = await upsertUserFromGithubAccessToken(exchanged.access_token);
    const sessionToken = signSession(user._id.toString());

    return c.json({
      github_access_token: exchanged.access_token,
      session: sessionToken,
      user: {
        login: userInfo.login,
        name: userInfo.name ?? null,
        avatar_url: userInfo.avatarUrl,
      },
    });
  } catch (error) {
    console.error("Extension OAuth token error:", error);
    return c.json(
      { error: error instanceof Error ? error.message : "Authentication failed" },
      500
    );
  }
});

/**
 * GitHub OAuth callback
 */
authRouter.get("/github/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const error = c.req.query("error");

    const base = getFrontendBaseUrl();
    const home = base ? `${base}/` : "/";

    if (error) {
      return c.redirect(`${home}?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return c.json({ error: "Missing authorization code" }, 400);
    }

    const redirectUri = process.env.GITHUB_CALLBACK_URL;
    if (!redirectUri) {
      return c.json({ error: "GITHUB_CALLBACK_URL is not set" }, 500);
    }

    const exchanged = await exchangeGithubOAuthCode(code, redirectUri);
    if ("error" in exchanged) {
      const detail = exchanged.error;
      console.error("GitHub token exchange failed:", detail);
      return c.redirect(`${home}?error=${encodeURIComponent(`token_exchange:${detail}`)}`);
    }

    const { user } = await upsertUserFromGithubAccessToken(exchanged.access_token);

    const sessionId = signSession(user._id.toString());
    setCookie(c, "gitlore_session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    const afterLogin = base ? `${base}/app` : "/app";
    return c.redirect(afterLogin);
  } catch (error) {
    console.error("OAuth callback error:", error);
    const base = getFrontendBaseUrl();
    const home = base ? `${base}/` : "/";
    const msg = error instanceof Error ? error.message : "Authentication failed";
    return c.redirect(`${home}?error=${encodeURIComponent(msg)}`);
  }
});

/**
 * Get current user info
 */
authRouter.get("/me", async (c) => {
  try {
    const session = getSessionToken(c);

    if (!session) {
      return c.json({ error: "Not authenticated" }, 401);
    }

    let userId: string;
    try {
      userId = verifySession(session);
    } catch (error) {
      return c.json({ error: "Invalid session" }, 401);
    }

    const db = getDB();
    const user = await db.collection("users").findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      return c.json({ error: "User not found" }, 401);
    }

    return c.json({
      username: user.username,
      avatar_url: user.avatar_url,
      github_id: user.github_id,
    });
  } catch (error) {
    console.error("Get user info error:", error);
    return c.json({ error: "Failed to get user info" }, 500);
  }
});

/**
 * Logout
 */
authRouter.post("/logout", (c) => {
  deleteCookie(c, "gitlore_session");
  return c.json({ ok: true });
});
