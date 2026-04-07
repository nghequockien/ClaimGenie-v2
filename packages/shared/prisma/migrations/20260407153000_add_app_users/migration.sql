-- CreateTable AppUser
CREATE TABLE IF NOT EXISTS "app_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "last_login_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_email_key" ON "app_users"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "app_users_role_idx" ON "app_users"("role");
