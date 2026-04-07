# SSO Configuration

This project supports SSO with these identity providers:

- Google
- LinkedIn

It also supports local email/password login, but this file focuses on IdP setup for SSO.

## Overview

Authentication is handled by the gateway.

Gateway auth endpoints:

- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `GET /api/auth/linkedin`
- `GET /api/auth/linkedin/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`

After successful SSO login:

- the user is created or updated in the `app_users` table
- a session cookie is issued by the gateway
- the user is redirected to `UI_URL + /dashboard`

## Required Environment Variables

Common auth settings:

- `ADMIN_EMAILS`
- `SESSION_SECRET`
- `UI_URL`
- `CORS_ORIGIN`

Google settings:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

LinkedIn settings:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_REDIRECT_URI`

## Development Example

```env
CORS_ORIGIN=http://localhost:5173
ADMIN_EMAILS=admin@yourcompany.com
SESSION_SECRET=change-me-dev-session-secret
UI_URL=http://localhost:5173

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback

LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=http://localhost:4000/api/auth/linkedin/callback
```

## Production Example

```env
CORS_ORIGIN=https://yourdomain.com
ADMIN_EMAILS=admin@yourdomain.com
SESSION_SECRET=change-me-prod-session-secret
UI_URL=https://yourdomain.com

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your-api-domain.com/api/auth/google/callback

LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
LINKEDIN_REDIRECT_URI=https://your-api-domain.com/api/auth/linkedin/callback
```

## Google IdP Setup

Create an OAuth app in Google Cloud Console.

Configure:

- Authorized redirect URI:
  - `http://localhost:4000/api/auth/google/callback` for local dev
  - `https://your-api-domain.com/api/auth/google/callback` for production
- OAuth scopes used by the app:
  - `openid`
  - `email`
  - `profile`

Values to copy into env:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

## LinkedIn IdP Setup

Create an OAuth app in LinkedIn Developer Portal.

Configure:

- Authorized redirect URI:
  - `http://localhost:4000/api/auth/linkedin/callback` for local dev
  - `https://your-api-domain.com/api/auth/linkedin/callback` for production
- OpenID scopes used by the app:
  - `openid`
  - `profile`
  - `email`

Values to copy into env:

- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`

## Admin Authorization

Admin access is not managed inside Google or LinkedIn groups. It is configured by email in env.

- `ADMIN_EMAILS` is a comma-separated list of admin email addresses
- if a signed-in user's email matches `ADMIN_EMAILS`, the gateway assigns role `ADMIN`
- otherwise the role is `USER`

Example:

```env
ADMIN_EMAILS=admin1@yourcompany.com,admin2@yourcompany.com
```

The Settings page (`/config`) requires `ADMIN` role.

## User Provisioning Behavior

On first successful SSO login:

- a record is inserted into `app_users`
- provider is stored as `google` or `linkedin`
- provider subject/user id is stored
- role is derived from `ADMIN_EMAILS`

On later logins:

- the user record is updated
- last login time is refreshed
- role is recalculated from `ADMIN_EMAILS`

## Session Behavior

The gateway uses session cookies:

- cookie name: `claimgenie.sid`
- `httpOnly=true`
- `sameSite=lax`
- session lifetime: 7 days

## CORS Notes

For development, the gateway allows configured origins and local origins such as:

- `http://localhost:*`
- `http://127.0.0.1:*`

For production, set `CORS_ORIGIN` explicitly to your frontend domain.

## Setup Checklist

1. Create Google OAuth app and set redirect URI.
2. Create LinkedIn OAuth app and set redirect URI.
3. Fill in the auth env vars.
4. Set `ADMIN_EMAILS` for users who can access Settings.
5. Restart the gateway.
6. Test:
   - Google sign-in
   - LinkedIn sign-in
   - `/api/auth/me`
   - admin access to `/config`
