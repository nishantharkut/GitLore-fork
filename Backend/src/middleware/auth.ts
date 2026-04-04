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

/**
 * Authentication middleware for protected routes
 */
export async function authMiddleware(c: Context, next: Next): Promise<void | Response> {
  try {
    if (c.req.method === "GET" && c.req.path === "/api/enforcement/policy") {
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
    } catch (error) {
      deleteCookie(c, "gitlore_session");
      return c.json({ error: "Invalid session" }, 401);
    }

    const db = getDB();
    const user = await db.collection<AuthUser>("users").findOne({
      _id: new ObjectId(userId),
    });

    if (!user) {
      deleteCookie(c, "gitlore_session");
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
