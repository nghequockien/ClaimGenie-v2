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
  debug: (message: string, details?: unknown) => void;
  info: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
};

type AgentName =
  | "CLAIMS_RECEIVER"
  | "OCR_PROCESSOR"
  | "ICD_CONVERTER"
  | "CUSTOMER_VERIFICATION"
  | "FRAUD_DETECTION"
  | "PAYMENT_GENERATOR";

const AGENT_NAMES: AgentName[] = [
  "CLAIMS_RECEIVER",
  "OCR_PROCESSOR",
  "ICD_CONVERTER",
  "CUSTOMER_VERIFICATION",
  "FRAUD_DETECTION",
  "PAYMENT_GENERATOR",
];

type A2AOAuthClientConfig = {
  clientId: string;
  clientSecret: string;
  agent: AgentName;
  allowedScopes: string[];
  defaultAudience: string;
};

type OAuthTokenRequest = {
  grant_type?: string;
  scope?: string;
  audience?: string;
  client_id?: string;
  client_secret?: string;
};

type OAuthSigningMaterial = {
  kid: string;
  publicJwk: Record<string, unknown>;
  privateKey: unknown;
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

  function normalizeAgentName(value: string | undefined): AgentName | null {
    if (!value) return null;
    const normalized = value.trim().toUpperCase().replace(/-/g, "_");
    return AGENT_NAMES.includes(normalized as AgentName)
      ? (normalized as AgentName)
      : null;
  }

  function normalizeScopeToken(value: string) {
    return value.trim().replace(/\s+/g, " ");
  }

  function parseScopes(scope: string | undefined): string[] {
    if (!scope) return [];
    return scope
      .split(" ")
      .map((item) => normalizeScopeToken(item))
      .filter(Boolean);
  }

  function parseCsv(value: string | undefined): string[] {
    if (!value) return [];
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function resolveAgentEnv(
    prefix: string,
    agent: AgentName,
  ): string | undefined {
    return (
      process.env[`${prefix}_${agent}`] || process.env[prefix] || undefined
    );
  }

  function buildA2AOAuthClients(): Map<string, A2AOAuthClientConfig> {
    const clients = new Map<string, A2AOAuthClientConfig>();

    const rawJson = process.env.A2A_OAUTH_CLIENTS_JSON;
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson) as Array<{
          clientId?: string;
          clientSecret?: string;
          agent?: string;
          scopes?: string[];
          audience?: string;
        }>;

        parsed.forEach((item) => {
          const clientId = item.clientId?.trim();
          const clientSecret = item.clientSecret?.trim();
          const agent = normalizeAgentName(item.agent);
          if (!clientId || !clientSecret || !agent) return;

          const configuredScopes = Array.isArray(item.scopes)
            ? item.scopes.map((scope) => scope.trim()).filter(Boolean)
            : [];

          clients.set(clientId, {
            clientId,
            clientSecret,
            agent,
            allowedScopes:
              configuredScopes.length > 0
                ? configuredScopes
                : [`a2a.invoke.${agent.toLowerCase()}`],
            defaultAudience: item.audience?.trim() || agent,
          });
        });
      } catch {
        logger.warn("A2A_OAUTH_CLIENTS_JSON is invalid JSON and was ignored");
      }
    }

    AGENT_NAMES.forEach((agent) => {
      const clientId = process.env[`A2A_CLIENT_ID_${agent}`]?.trim();
      const clientSecret =
        process.env[`A2A_CLIENT_SECRET_${agent}`]?.trim() ||
        process.env[`A2A_OAUTH_CLIENT_SECRET_${agent}`]?.trim();

      if (!clientId || !clientSecret) return;

      const defaultScope = resolveAgentEnv("A2A_REQUIRED_SCOPE", agent);
      const scopeFromEnv = resolveAgentEnv("A2A_OAUTH_SCOPE", agent);
      const allowedScopes =
        parseScopes(scopeFromEnv).length > 0
          ? parseScopes(scopeFromEnv)
          : defaultScope
            ? [defaultScope]
            : [`a2a.invoke.${agent.toLowerCase()}`];

      clients.set(clientId, {
        clientId,
        clientSecret,
        agent,
        allowedScopes,
        defaultAudience: resolveAgentEnv("A2A_OAUTH_AUDIENCE", agent) || agent,
      });
    });

    logger.debug("A2A OAuth clients ready", { count: clients.size });
    return clients;
  }

  function parseBasicAuth(
    authorizationHeader: string | undefined,
  ): { clientId: string; clientSecret: string } | null {
    if (!authorizationHeader) return null;
    const [scheme, encoded] = authorizationHeader.split(" ");
    if (scheme?.toLowerCase() !== "basic" || !encoded) return null;

    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator <= 0) return null;
      const clientId = decoded.slice(0, separator);
      const clientSecret = decoded.slice(separator + 1);
      if (!clientId || !clientSecret) return null;
      return { clientId, clientSecret };
    } catch {
      return null;
    }
  }

  function issuerUrl(): string {
    const configured = process.env.A2A_TOKEN_ISSUER?.trim();
    if (configured) return configured;
    return `http://localhost:${port}`;
  }

  function jwksUri(): string {
    const configured = process.env.A2A_JWKS_URI?.trim();
    if (configured) return configured;
    return `${issuerUrl().replace(/\/$/, "")}/.well-known/jwks.json`;
  }

  let signingMaterialPromise: Promise<OAuthSigningMaterial> | null = null;

  async function getSigningMaterial(): Promise<OAuthSigningMaterial> {
    if (signingMaterialPromise) return signingMaterialPromise;

    signingMaterialPromise = (async () => {
      const jose = await import("jose");
      const privateKeyPem = process.env.A2A_JWT_PRIVATE_KEY?.trim();
      const publicKeyPem = process.env.A2A_JWT_PUBLIC_KEY?.trim();

      if (privateKeyPem && publicKeyPem) {
        const privateKey = await jose.importPKCS8(privateKeyPem, "RS256");
        const publicKey = await jose.importSPKI(publicKeyPem, "RS256");
        const publicJwk = await jose.exportJWK(publicKey);
        const thumbprint = await jose.calculateJwkThumbprint(
          publicJwk,
          "sha256",
        );

        return {
          kid: thumbprint,
          publicJwk: {
            ...publicJwk,
            kid: thumbprint,
            use: "sig",
            alg: "RS256",
          },
          privateKey,
        };
      }

      logger.warn(
        "A2A_JWT_PRIVATE_KEY/A2A_JWT_PUBLIC_KEY not configured; generating ephemeral OAuth signing key",
      );
      const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
      const publicJwk = await jose.exportJWK(publicKey);
      const thumbprint = await jose.calculateJwkThumbprint(publicJwk, "sha256");

      return {
        kid: thumbprint,
        publicJwk: { ...publicJwk, kid: thumbprint, use: "sig", alg: "RS256" },
        privateKey,
      };
    })();

    return signingMaterialPromise;
  }

  async function issueClientCredentialsToken(args: {
    client: A2AOAuthClientConfig;
    requestedScope?: string;
    requestedAudience?: string;
  }) {
    const jose = await import("jose");
    const signingMaterial = await getSigningMaterial();
    const now = Math.floor(Date.now() / 1000);
    const expiresInSec = Number(
      process.env.A2A_OAUTH_ACCESS_TOKEN_TTL_SEC || 300,
    );
    const requestedScopes = parseScopes(args.requestedScope);
    const effectiveScopes =
      requestedScopes.length > 0
        ? requestedScopes.filter((scope) =>
            args.client.allowedScopes.includes(scope),
          )
        : args.client.allowedScopes;

    if (effectiveScopes.length === 0) {
      throw new Error("invalid_scope");
    }

    const audience =
      args.requestedAudience?.trim() || args.client.defaultAudience;

    logger.debug("Issuing client_credentials token", {
      clientId: args.client.clientId,
      agent: args.client.agent,
      effectiveScopes,
      audience,
      expiresInSec,
    });

    const accessToken = await new jose.SignJWT({
      scope: effectiveScopes.join(" "),
      client_id: args.client.clientId,
      azp: args.client.clientId,
    })
      .setProtectedHeader({
        alg: "RS256",
        typ: "JWT",
        kid: signingMaterial.kid,
      })
      .setIssuer(issuerUrl())
      .setSubject(args.client.clientId)
      .setAudience(audience)
      .setIssuedAt(now)
      .setNotBefore(now)
      .setExpirationTime(now + Math.max(60, expiresInSec))
      .setJti(crypto.randomUUID())
      .sign(signingMaterial.privateKey as any);

    return {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.max(60, expiresInSec),
      scope: effectiveScopes.join(" "),
    };
  }

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

    logger.debug("OAuth user upsert", { provider: args.provider, email, role });
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
    logger.debug("Local signup attempt", { email, role });
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
    logger.debug("Local login attempt", { email });
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
    app.get("/.well-known/jwks.json", async (_req, res) => {
      try {
        const signingMaterial = await getSigningMaterial();
        res.json({ keys: [signingMaterial.publicJwk] });
      } catch (error) {
        logger.error("Failed to load JWKS", {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: "jwks_unavailable" });
      }
    });

    app.get("/.well-known/oauth-authorization-server", (_req, res) => {
      const issuer = issuerUrl().replace(/\/$/, "");
      res.json({
        issuer,
        jwks_uri: jwksUri(),
        token_endpoint: `${issuer}/oauth2/token`,
        token_endpoint_auth_methods_supported: [
          "client_secret_post",
          "client_secret_basic",
        ],
        grant_types_supported: ["client_credentials"],
      });
    });

    app.post(
      "/oauth2/token",
      express.urlencoded({ extended: false }),
      async (req, res) => {
        try {
          const body = req.body as OAuthTokenRequest;
          if (body.grant_type !== "client_credentials") {
            return res.status(400).json({ error: "unsupported_grant_type" });
          }

          const basic = parseBasicAuth(req.headers.authorization);
          const clientId =
            basic?.clientId ||
            (body.client_id ? String(body.client_id).trim() : "");
          const clientSecret =
            basic?.clientSecret ||
            (body.client_secret ? String(body.client_secret).trim() : "");

          if (!clientId || !clientSecret) {
            return res.status(401).json({ error: "invalid_client" });
          }

          logger.debug("OAuth /token request", {
            grantType: body.grant_type,
            clientId: clientId || "(missing)",
            requestedScope: body.scope || "(none)",
            requestedAudience: body.audience || "(none)",
            authMethod: basic ? "basic" : "post",
          });

          const clients = buildA2AOAuthClients();
          const client = clients.get(clientId);
          if (!client || client.clientSecret !== clientSecret) {
            return res.status(401).json({ error: "invalid_client" });
          }

          const token = await issueClientCredentialsToken({
            client,
            requestedScope: body.scope,
            requestedAudience: body.audience,
          });

          return res.status(200).json(token);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (message === "invalid_scope") {
            return res.status(400).json({ error: "invalid_scope" });
          }

          logger.error("OAuth client credentials token issuance failed", {
            error: message,
          });
          return res.status(500).json({ error: "server_error" });
        }
      },
    );

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
