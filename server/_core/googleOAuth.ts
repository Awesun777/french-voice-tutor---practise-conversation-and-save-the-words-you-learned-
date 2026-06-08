/**
 * Google OAuth 2.0 routes
 *
 * GET /api/auth/google/login   → redirect to Google consent screen
 * GET /api/auth/google/callback → exchange code, upsert user, issue session cookie
 *
 * The session cookie format is identical to the Manus OAuth flow so the rest of
 * the app (context.ts, sdk.verifySession, protectedProcedure) works unchanged.
 */
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { ENV } from "./env";
import { sdk } from "./sdk";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/documents.readonly",
].join(" ");

function getRedirectUri(req: Request): string {
  // In production, use the canonical public domain directly to avoid any
  // proxy header ambiguity (redirect_uri must exactly match what's registered
  // in Google Cloud Console).
  if (ENV.isProduction) {
    return "https://frenchtutor-8baqdh3x.manus.space/api/auth/google/callback";
  }
  // In development, derive from forwarded headers so the dev preview URL works.
  const forwarded = req.headers["x-forwarded-proto"];
  const proto = forwarded
    ? (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]).trim()
    : req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:3000";
  return `${proto}://${host}/api/auth/google/callback`;
}

export function registerGoogleOAuthRoutes(app: Express) {
  // ── Step 1: Redirect user to Google ─────────────────────────────────────────
  app.get("/api/auth/google/login", (req: Request, res: Response) => {
    const redirectUri = getRedirectUri(req);
    // Encode the return path so we can redirect back after login
    const returnPath = (req.query.returnPath as string) ?? "/";
    const state = Buffer.from(JSON.stringify({ returnPath, redirectUri })).toString("base64url");

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", ENV.googleClientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES);
    url.searchParams.set("access_type", "offline");   // request refresh token
    url.searchParams.set("prompt", "consent");         // always show consent to get refresh token
    url.searchParams.set("state", state);

    res.redirect(302, url.toString());
  });

  // ── Step 2: Handle callback from Google ──────────────────────────────────────
  app.get("/api/auth/google/callback", async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const stateRaw = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      console.error("[GoogleOAuth] User denied consent or error:", error);
      res.redirect(302, "/?error=google_denied");
      return;
    }

    if (!code || !stateRaw) {
      res.status(400).json({ error: "Missing code or state" });
      return;
    }

    let returnPath = "/";
    let redirectUri = getRedirectUri(req);
    try {
      const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
      returnPath = parsed.returnPath ?? "/";
      redirectUri = parsed.redirectUri ?? redirectUri;
    } catch {
      // ignore malformed state
    }

    try {
      // ── Exchange code for tokens ─────────────────────────────────────────────
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: ENV.googleClientId,
          client_secret: ENV.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("[GoogleOAuth] Token exchange failed:", err);
        res.status(500).json({ error: "Token exchange failed" });
        return;
      }

      const tokens = await tokenRes.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
        token_type: string;
        id_token?: string;
      };

      // ── Fetch Google user info ───────────────────────────────────────────────
      const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userInfoRes.ok) {
        console.error("[GoogleOAuth] Userinfo fetch failed");
        res.status(500).json({ error: "Failed to fetch user info" });
        return;
      }

      const googleUser = await userInfoRes.json() as {
        sub: string;       // Google's stable user ID
        email: string;
        name?: string;
        picture?: string;
        email_verified?: boolean;
      };

      if (!googleUser.sub || !googleUser.email) {
        res.status(400).json({ error: "Incomplete user info from Google" });
        return;
      }

      // ── Upsert local user ────────────────────────────────────────────────────
      // Use google sub as the openId so the existing user model works unchanged
      const openId = `google:${googleUser.sub}`;
      await db.upsertUser({
        openId,
        name: googleUser.name ?? null,
        email: googleUser.email,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });

      const user = await db.getUserByOpenId(openId);
      if (!user) {
        res.status(500).json({ error: "Failed to create user" });
        return;
      }

      // ── Store Google tokens ──────────────────────────────────────────────────
      const expiresAt = Date.now() + tokens.expires_in * 1000;
      await db.upsertGoogleAccount({
        userId: user.id,
        googleId: googleUser.sub,
        email: googleUser.email,
        name: googleUser.name ?? null,
        picture: googleUser.picture ?? null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        expiresAt,
      });

      // ── Issue session cookie (same format as Manus OAuth) ────────────────────
      const sessionToken = await sdk.createSessionToken(openId, {
        name: googleUser.name ?? googleUser.email,
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, returnPath);
    } catch (err) {
      console.error("[GoogleOAuth] Callback error:", err);
      res.status(500).json({ error: "Google OAuth callback failed" });
    }
  });
}
