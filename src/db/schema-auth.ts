/**
 * Better Auth core tables (owned by its Drizzle adapter — see
 * docs/contracts.md). Hand-written against better-auth 1.7.2's canonical
 * field list (dist/db/get-schema.mjs); the auth roundtrip test proves the
 * mapping, so version drift surfaces as a test failure. Lanes read
 * `user.id` and nothing else.
 */
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const user = /*#__PURE__*/ sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("user_email").on(t.email)],
);

export const session = /*#__PURE__*/ sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("session_token").on(t.token)],
);

export const account = /*#__PURE__*/ sqliteTable("account", {
  id: text("id").primaryKey(),
  issuer: text("issuer").notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = /*#__PURE__*/ sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // Better Auth reads a password reset's row by `identifier`
    // (`reset-password:<token>`), and the table had no index for it, so
    // every reset scanned the table (task 126, ACC-4). Not unique: the
    // schema Better Auth documents does not promise it.
    index("verification_identifier").on(t.identifier),
  ],
);

/**
 * Better Auth's rate-limit counters (OPS-4), one row per key (the client
 * address and the path). In D1 rather than in memory so the count is
 * shared by every isolate: an in-memory counter restarts with each one,
 * which on Workers is a limit an attacker never reaches. Shape per
 * better-auth 1.7.2's `rateLimit` model (`@better-auth/core`
 * `get-tables.mjs`); `last_request` is epoch milliseconds.
 */
export const rateLimit = /*#__PURE__*/ sqliteTable(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: integer("last_request").notNull(),
  },
  (t) => [
    uniqueIndex("rate_limit_key").on(t.key),
    // Better Auth deletes rows older than its longest window with a
    // `last_request <` sweep; without this that sweep scans the table.
    index("rate_limit_last_request").on(t.lastRequest),
  ],
);
