import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { getDB, ObjectId } from "../lib/mongo";
import { getUserInfo } from "../lib/github";
import { signSession, verifySession } from "../middleware/auth";
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

interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
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
 * GitHub OAuth callback
 */
authRouter.get("/github/callback", async (c) => {
  try {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const error = c.req.query("error");

    const base = getFrontendBaseUrl();
    const home = base ? `${base}/` : "/";

    if (error) {
      return c.redirect(`${home}?error=${encodeURIComponent(error)}`);
    }

    if (!code) {
      return c.json({ error: "Missing authorization code" }, 400);
    }

    // Exchange code for token
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return c.json(
        {
          error: "GitHub OAuth not configured",
          required: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
        },
        500
      );
    }

    const redirectUri = process.env.GITHUB_CALLBACK_URL;
    if (!redirectUri) {
      return c.json({ error: "GITHUB_CALLBACK_URL is not set" }, 500);
    }

    // GitHub expects form body; redirect_uri must match the authorize request exactly.
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
      console.error("GitHub token exchange failed:", detail);
      return c.redirect(`${home}?error=${encodeURIComponent(`token_exchange:${detail}`)}`);
    }

    // Get user info
    const githubClient = createGithubClient(tokenData.access_token);
    const userInfo = await getUserInfo(githubClient);

    if (!userInfo) {
      return c.json({ error: "Failed to fetch user information" }, 400);
    }

    // Upsert user in MongoDB (driver v6 returns the document when includeResultMetadata is not true)
    const db = getDB();
    const user = await db.collection("users").findOneAndUpdate(
      { github_id: userInfo.login },
      {
        $set: {
          github_id: userInfo.login,
          username: userInfo.login,
          avatar_url: userInfo.avatarUrl,
          access_token: tokenData.access_token,
          updated_at: new Date(),
        },
        $setOnInsert: {
          created_at: new Date(),
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    if (!user?._id) {
      console.error("findOneAndUpdate returned no user document after upsert");
      return c.redirect(`${home}?error=${encodeURIComponent("session:user_upsert_failed")}`);
    }

    // Set session cookie
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
    const session = getCookie(c, "gitlore_session");

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
