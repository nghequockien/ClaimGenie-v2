import express from "express";
import "express-session";
import crypto from "crypto";
import { promisify } from "util";
import type { PrismaClient } from "@prisma/client";

export type AuthRole = "ADMIN" | "USER";
export type AuthProvider = "google" | "linkedin" | "local";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  provider: AuthProvider;
};

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    oauthState?: string;
    oauthProvider?: AuthProvider;
  }
}

type AppUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  provider: string;
  provider_user_id: string;
  password_hash?: string | null;
  role: AuthRole;
};

type OAuthProfile = {
  provider: Extract<AuthProvider, "google" | "linkedin">;
  email: string;
  name: string;
  providerUserId: string;
};

type LoggerLike = {
  info: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
};

export type AuthModuleOptions = {
  prisma: PrismaClient;
  logger: LoggerLike;
  port: number;
  uiUrl: string;
  adminEmails: Set<string>;
};

const scryptAsync = promisify(crypto.scrypt);

export function createAuthModule(options: AuthModuleOptions) {
  const { prisma, logger, port, uiUrl, adminEmails } = options;

  async function ensureAuthTables() {
    const provider = (process.env.DATABASE_PROVIDER || "sqlite").toLowerCase();

    if (provider === "postgresql") {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS app_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          full_name TEXT,
          provider TEXT NOT NULL,
          provider_user_id TEXT NOT NULL,
          password_hash TEXT,
          role TEXT NOT NULL DEFAULT 'USER',
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMP
        );
      `);
      await prisma.$executeRawUnsafe(
        "ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT;",
      );
      await prisma.$executeRawUnsafe(
        "CREATE INDEX IF NOT EXISTS app_users_role_idx ON app_users(role);",
      );
      return;
    }

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS app_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        password_hash TEXT,
        role TEXT NOT NULL DEFAULT 'USER',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      );
    `);
    await prisma.$executeRawUnsafe(
      "CREATE INDEX IF NOT EXISTS app_users_role_idx ON app_users(role);",
    );

    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "PRAGMA table_info('app_users');",
    );
    if (!columns.some((column) => column.name === "password_hash")) {
      await prisma.$executeRawUnsafe(
        "ALTER TABLE app_users ADD COLUMN password_hash TEXT;",
      );
    }
  }

  function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  async function hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString("hex")}`;
  }

  async function verifyPassword(password: string, storedHash: string) {
    const [salt, expectedHash] = storedHash.split(":");
    if (!salt || !expectedHash) return false;
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    const expected = Buffer.from(expectedHash, "hex");
    return (
      expected.length === derivedKey.length &&
      crypto.timingSafeEqual(expected, derivedKey)
    );
  }

  async function upsertOauthUser(args: {
    email: string;
    name: string;
    provider: AuthProvider;
    providerUserId: string;
  }): Promise<SessionUser> {
    const email = args.email.toLowerCase();
    const role: AuthRole = adminEmails.has(email) ? "ADMIN" : "USER";

    const existing = await prisma.$queryRaw<AppUserRow[]>`
      SELECT id, email, full_name, provider, provider_user_id, password_hash, role
      FROM app_users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (existing.length > 0) {
      await prisma.$executeRaw`
        UPDATE app_users
        SET
          full_name = ${args.name},
          provider = ${args.provider},
          provider_user_id = ${args.providerUserId},
          password_hash = password_hash,
          role = ${role},
          updated_at = CURRENT_TIMESTAMP,
          last_login_at = CURRENT_TIMESTAMP
        WHERE email = ${email}
      `;

      return {
        id: existing[0].id,
        email,
        name: args.name,
        role,
        provider: args.provider,
      };
    }

    const id = crypto.randomUUID();
    await prisma.$executeRaw`
      INSERT INTO app_users (
        id,
        email,
        full_name,
        provider,
        provider_user_id,
        role,
        created_at,
        updated_at,
        last_login_at
      ) VALUES (
        ${id},
        ${email},
        ${args.name},
        ${args.provider},
        ${args.providerUserId},
        ${role},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;

    return {
      id,
      email,
      name: args.name,
      role,
      provider: args.provider,
    };
  }

  async function signupLocalUser(args: {
    email: string;
    password: string;
    name: string;
  }): Promise<SessionUser> {
    const email = normalizeEmail(args.email);
    const role: AuthRole = adminEmails.has(email) ? "ADMIN" : "USER";
    const existing = await prisma.$queryRaw<AppUserRow[]>`
      SELECT id, email, full_name, provider, provider_user_id, password_hash, role
      FROM app_users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (existing.length > 0) {
      throw new Error("An account with this email already exists");
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(args.password);
    await prisma.$executeRaw`
      INSERT INTO app_users (
        id,
        email,
        full_name,
        provider,
        provider_user_id,
        password_hash,
        role,
        created_at,
        updated_at,
        last_login_at
      ) VALUES (
        ${id},
        ${email},
        ${args.name},
        ${"local"},
        ${email},
        ${passwordHash},
        ${role},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;

    return { id, email, name: args.name, role, provider: "local" };
  }

  async function loginLocalUser(args: {
    email: string;
    password: string;
  }): Promise<SessionUser> {
    const email = normalizeEmail(args.email);
    const existing = await prisma.$queryRaw<AppUserRow[]>`
      SELECT id, email, full_name, provider, provider_user_id, password_hash, role
      FROM app_users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (existing.length === 0) {
      throw new Error("Invalid email or password");
    }

    const user = existing[0];
    if (!user.password_hash) {
      throw new Error("This account must sign in with SSO");
    }

    const valid = await verifyPassword(args.password, user.password_hash);
    if (!valid) {
      throw new Error("Invalid email or password");
    }

    const role: AuthRole = adminEmails.has(email)
      ? "ADMIN"
      : (user.role ?? "USER");
    await prisma.$executeRaw`
      UPDATE app_users
      SET role = ${role}, updated_at = CURRENT_TIMESTAMP, last_login_at = CURRENT_TIMESTAMP
      WHERE id = ${user.id}
    `;

    return {
      id: user.id,
      email,
      name: user.full_name || email,
      role,
      provider: "local",
    };
  }

  async function getAppUserById(id: string) {
    const rows = await prisma.$queryRaw<AppUserRow[]>`
      SELECT id, email, full_name, provider, provider_user_id, password_hash, role
      FROM app_users
      WHERE id = ${id}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function updateUserProfile(args: {
    userId: string;
    name: string;
    currentPassword?: string;
    newPassword?: string;
  }) {
    const user = await getAppUserById(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const trimmedName = args.name.trim();
    if (!trimmedName) {
      throw new Error("Name is required");
    }

    let passwordHash = user.password_hash || null;
    if (args.newPassword) {
      if (args.newPassword.length < 8) {
        throw new Error("New password must be at least 8 characters");
      }

      if (passwordHash) {
        if (!args.currentPassword) {
          throw new Error("Current password is required");
        }

        const valid = await verifyPassword(args.currentPassword, passwordHash);
        if (!valid) {
          throw new Error("Current password is incorrect");
        }
      }

      passwordHash = await hashPassword(args.newPassword);
    }

    await prisma.$executeRaw`
      UPDATE app_users
      SET
        full_name = ${trimmedName},
        password_hash = ${passwordHash},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${args.userId}
    `;

    const role: AuthRole = adminEmails.has(user.email.toLowerCase())
      ? "ADMIN"
      : (user.role ?? "USER");

    return {
      id: user.id,
      email: user.email,
      name: trimmedName,
      role,
      provider: user.provider as AuthProvider,
    } satisfies SessionUser;
  }

  function requireAdmin(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) {
    const user = req.session?.user;

    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (user.role !== "ADMIN") {
      return res.status(403).json({ error: "Admin permission required" });
    }

    next();
  }

  function buildAuthRedirect(provider: AuthProvider, state: string) {
    if (provider === "google") {
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        redirect_uri:
          process.env.GOOGLE_REDIRECT_URI ||
          `http://localhost:${port}/api/auth/google/callback`,
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.LINKEDIN_CLIENT_ID || "",
      redirect_uri:
        process.env.LINKEDIN_REDIRECT_URI ||
        `http://localhost:${port}/api/auth/linkedin/callback`,
      scope: "openid profile email",
      state,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  async function exchangeOAuthCode(args: {
    provider: AuthProvider;
    code: string;
  }): Promise<OAuthProfile> {
    if (args.provider === "google") {
      const body = new URLSearchParams({
        code: args.code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri:
          process.env.GOOGLE_REDIRECT_URI ||
          `http://localhost:${port}/api/auth/google/callback`,
        grant_type: "authorization_code",
      });

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!tokenRes.ok) {
        throw new Error(`Google token exchange failed: ${tokenRes.status}`);
      }

      const tokenData = (await tokenRes.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        throw new Error("Google access token missing");
      }

      const profileRes = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        },
      );
      if (!profileRes.ok) {
        throw new Error(`Google userinfo failed: ${profileRes.status}`);
      }

      const profile = (await profileRes.json()) as {
        sub?: string;
        email?: string;
        name?: string;
      };
      if (!profile.email || !profile.sub) {
        throw new Error("Google profile missing email/sub");
      }

      return {
        provider: "google" as const,
        email: profile.email,
        name: profile.name || profile.email,
        providerUserId: profile.sub,
      };
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      client_id: process.env.LINKEDIN_CLIENT_ID || "",
      client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
      redirect_uri:
        process.env.LINKEDIN_REDIRECT_URI ||
        `http://localhost:${port}/api/auth/linkedin/callback`,
    });

    const tokenRes = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
    );
    if (!tokenRes.ok) {
      throw new Error(`LinkedIn token exchange failed: ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      throw new Error("LinkedIn access token missing");
    }

    const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!profileRes.ok) {
      throw new Error(`LinkedIn userinfo failed: ${profileRes.status}`);
    }

    const profile = (await profileRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
    };
    const fullName =
      profile.name ||
      `${profile.given_name || ""} ${profile.family_name || ""}`.trim();
    if (!profile.email || !profile.sub) {
      throw new Error("LinkedIn profile missing email/sub");
    }

    return {
      provider: "linkedin" as const,
      email: profile.email,
      name: fullName || profile.email,
      providerUserId: profile.sub,
    };
  }

  function registerRoutes(app: express.Express) {
    app.get("/api/auth/me", (req, res) => {
      if (!req.session?.user) {
        return res.json({ authenticated: false, user: null });
      }
      res.json({ authenticated: true, user: req.session.user });
    });

    app.put("/api/auth/profile", async (req, res) => {
      try {
        if (!req.session?.user) {
          return res.status(401).json({ error: "Authentication required" });
        }

        const updatedUser = await updateUserProfile({
          userId: req.session.user.id,
          name: String(req.body?.name || ""),
          currentPassword: req.body?.currentPassword
            ? String(req.body.currentPassword)
            : undefined,
          newPassword: req.body?.newPassword
            ? String(req.body.newPassword)
            : undefined,
        });

        req.session.user = updatedUser;
        res.json({ authenticated: true, user: updatedUser });
      } catch (err) {
        const message = (err as Error).message;
        const status =
          message === "Authentication required"
            ? 401
            : message === "Current password is incorrect"
              ? 400
              : 400;
        res.status(status).json({ error: message });
      }
    });

    app.post("/api/auth/signup", async (req, res) => {
      try {
        const name = String(req.body?.name || "").trim();
        const email = String(req.body?.email || "").trim();
        const password = String(req.body?.password || "");

        if (!name || !email || !password) {
          return res
            .status(400)
            .json({ error: "Name, email, and password are required" });
        }

        if (password.length < 8) {
          return res
            .status(400)
            .json({ error: "Password must be at least 8 characters" });
        }

        const user = await signupLocalUser({ name, email, password });
        req.session.user = user;
        res.status(201).json({ authenticated: true, user });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    });

    app.post("/api/auth/login", async (req, res) => {
      try {
        const email = String(req.body?.email || "").trim();
        const password = String(req.body?.password || "");

        if (!email || !password) {
          return res
            .status(400)
            .json({ error: "Email and password are required" });
        }

        const user = await loginLocalUser({ email, password });
        req.session.user = user;
        res.json({ authenticated: true, user });
      } catch (err) {
        res.status(401).json({ error: (err as Error).message });
      }
    });

    app.get("/api/auth/google", (req, res) => {
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
        return res.status(500).json({ error: "Google SSO is not configured" });
      }
      const state = crypto.randomUUID();
      req.session.oauthState = state;
      req.session.oauthProvider = "google";
      res.redirect(buildAuthRedirect("google", state));
    });

    app.get("/api/auth/linkedin", (req, res) => {
      if (
        !process.env.LINKEDIN_CLIENT_ID ||
        !process.env.LINKEDIN_CLIENT_SECRET
      ) {
        return res
          .status(500)
          .json({ error: "LinkedIn SSO is not configured" });
      }
      const state = crypto.randomUUID();
      req.session.oauthState = state;
      req.session.oauthProvider = "linkedin";
      res.redirect(buildAuthRedirect("linkedin", state));
    });

    app.get("/api/auth/google/callback", async (req, res) => {
      try {
        if (
          !req.query.code ||
          !req.query.state ||
          req.session.oauthProvider !== "google" ||
          req.session.oauthState !== req.query.state
        ) {
          return res.redirect(`${uiUrl}/login?error=oauth_state_invalid`);
        }

        const profile = await exchangeOAuthCode({
          provider: "google",
          code: String(req.query.code),
        });
        const user = await upsertOauthUser(profile);
        req.session.user = user;
        req.session.oauthProvider = undefined;
        req.session.oauthState = undefined;
        res.redirect(`${uiUrl}/dashboard`);
      } catch (err) {
        logger.error("Google OAuth callback failed", {
          error: (err as Error).message,
        });
        res.redirect(`${uiUrl}/login?error=google_auth_failed`);
      }
    });

    app.get("/api/auth/linkedin/callback", async (req, res) => {
      try {
        if (
          !req.query.code ||
          !req.query.state ||
          req.session.oauthProvider !== "linkedin" ||
          req.session.oauthState !== req.query.state
        ) {
          return res.redirect(`${uiUrl}/login?error=oauth_state_invalid`);
        }

        const profile = await exchangeOAuthCode({
          provider: "linkedin",
          code: String(req.query.code),
        });
        const user = await upsertOauthUser(profile);
        req.session.user = user;
        req.session.oauthProvider = undefined;
        req.session.oauthState = undefined;
        res.redirect(`${uiUrl}/dashboard`);
      } catch (err) {
        logger.error("LinkedIn OAuth callback failed", {
          error: (err as Error).message,
        });
        res.redirect(`${uiUrl}/login?error=linkedin_auth_failed`);
      }
    });

    app.post("/api/auth/logout", (req, res) => {
      req.session.destroy((err) => {
        if (err) {
          logger.warn("Logout session destroy failed", { error: err.message });
          return res.status(500).json({ error: "Failed to logout" });
        }
        res.clearCookie("claimgenie.sid");
        res.json({ success: true });
      });
    });
  }

  return {
    ensureAuthTables,
    requireAdmin,
    registerRoutes,
  };
}
