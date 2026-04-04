import { Context, Next } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import { getDB, ObjectId } from "../lib/mongo";
import crypto from "crypto";

interface AuthUser {
  _id: ObjectId;
  github_id: number;
  username: string;
  avatar_url: string;
  access_token: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Sign a session ID with the secret
 */
export function signSession(userId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET not configured");
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(userId);
  return `${userId}.${hmac.digest("hex")}`;
}

/**
 * Verify a signed session ID
 */
export function verifySession(signed: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET not configured");
  }

  const [userId, signature] = signed.split(".");
  if (!userId || !signature) {
    throw new Error("Invalid session format");
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(userId);
  const expectedSignature = hmac.digest("hex");

  if (signature !== expectedSignature) {
    throw new Error("Invalid session signature");
  }

  return userId;
}

const API_KEY_HEADER = "x-gitlore-api-key";

function timingSafeApiKeyEqual(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
  } catch {
    return false;
  }
}

/**
 * Session token from cookie (web) or Authorization Bearer / X-GitLore-Session (e.g. extension).
 * authMiddleware uses this so API routes accept the same session as the web cookie.
 */
export function getSessionToken(c: Context): string | undefined {
  const fromCookie = getCookie(c, "gitlore_session");
  if (fromCookie) return fromCookie;
  const auth = c.req.header("Authorization");
  if (auth?.startsWith("Bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const hdr = c.req.header("X-GitLore-Session");
  if (hdr?.trim()) return hdr.trim();
  return undefined;
}

function clearWebSessionCookieIfPresent(c: Context) {
  if (getCookie(c, "gitlore_session")) {
    deleteCookie(c, "gitlore_session");
  }
}

/**
 * Authentication middleware for protected routes (cookie or Bearer / X-GitLore-Session).
 */
export async function authMiddleware(c: Context, next: Next): Promise<void | Response> {
  try {
    if (c.req.method === "GET" && c.req.path === "/api/enforcement/policy") {
      await next();
      return;
    }

    const rawApiKey = c.req.header(API_KEY_HEADER)?.trim();
    if (rawApiKey) {
      const configuredKey = process.env.SUPERPLANE_API_KEY?.trim();
      if (!configuredKey || !timingSafeApiKeyEqual(rawApiKey, configuredKey)) {
        return c.json({ error: "Invalid API key" }, 401);
      }

      const serviceUsername =
        process.env.SUPERPLANE_SERVICE_USERNAME?.trim() || "gitlore-service";

      const db = getDB();
      const apiUser = await db.collection<AuthUser>("users").findOne({
        username: serviceUsername,
      });

      if (!apiUser) {
        return c.json(
          {
            error: "Unauthorized",
            message: `No user with username "${serviceUsername}". Sign in once with that GitHub account or set SUPERPLANE_SERVICE_USERNAME to an existing user's GitHub login.`,
          },
          401
        );
      }

      const userId = apiUser._id.toString();
      c.set("user", apiUser);
      c.set("userId", userId);
      await next();
      return;
    }

    const session = getCookie(c, "gitlore_session");

    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let userId: string;
    try {
      userId = verifySession(session);
    } catch {
      clearWebSessionCookieIfPresent(c);
      return c.json({ error: "Invalid session" }, 401);
    }

    const db = getDB();
    const user = await db.collection<AuthUser>("users").findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      clearWebSessionCookieIfPresent(c);
      return c.json({ error: "User not found" }, 401);
    }

    // Attach user to context
    c.set("user", user);
    c.set("userId", userId);

    await next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return c.json({ error: "Authentication failed" }, 401);
  }
}

/**
 * Get current user from context
 */
export function getCurrentUser(c: Context): AuthUser | undefined {
  return c.get("user");
}

/**
 * Get current user's GitHub token
 */
export function getUserToken(c: Context): string {
  const user = getCurrentUser(c);
  if (!user?.access_token) {
    throw new Error("No GitHub token available");
  }
  return user.access_token;
}
