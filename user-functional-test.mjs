#!/usr/bin/env node
/**
 * Standalone functional tests for `/users`, `/contacts`, and `/invites`
 * (documented in user-interface.md).
 *
 * Prerequisite: server listening at BASE_URL (default http://127.0.0.1:3000).
 *
 * Usage:
 *   node user-functional-test.mjs
 *   BASE_URL=http://localhost:3001 node user-functional-test.mjs
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createTestResults } from "./test-results.mjs";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const testResults = createTestResults("user-functional-test.mjs", BASE_URL);

const COLOR = process.stdout.isTTY;
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s) => c("32", s);
const red = (s) => c("31", s);
const dim = (s) => c("2", s);

/** @param {string} prefix */
function unique(prefix) {
  const id = randomBytes(5).toString("hex");
  return `${prefix}_${id}`;
}

/**
 * @param {string} prefix
 * @param {number} [maxLen]
 */
function uniqueUsername(prefix, maxLen = 20) {
  const safePrefix = String(prefix).replace(/[^a-zA-Z0-9_]/g, "_");
  const suffix = randomBytes(4).toString("hex");
  const room = Math.max(1, maxLen - 1 - suffix.length);
  const head = safePrefix.slice(0, room);
  return `${head}_${suffix}`.slice(0, maxLen);
}

/**
 * @param {string} method
 * @param {string} path
 * @param {{
 *   headers?: Record<string, string>;
 *   body?: unknown;
 *   rawBody?: string;
 *   contentType?: string;
 *   bearer?: string;
 *   noBody?: boolean;
 * }} [opts]
 */
async function api(method, path, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { ...opts.headers };
  if (opts.bearer) {headers.authorization = `Bearer ${opts.bearer}`;}
  let body;
  if (opts.rawBody !== undefined) {
    body = opts.rawBody;
    if (opts.contentType) {headers["content-type"] = opts.contentType;}
  } else if (opts.noBody) {
    body = undefined;
  } else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const started = Date.now();
  const res = await fetch(url, { method, headers, body });
  const ms = Date.now() - started;
  const text = await res.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { _nonJson: text };
    }
  }
  return { status: res.status, headers: res.headers, json, text, ms };
}

function assertStatus(res, expected, label) {
  assert.equal(
    res.status,
    expected,
    `${label}: expected HTTP ${expected}, got ${res.status}: ${res.text?.slice(0, 200)}`,
  );
}

/** @param {{ status: number, json: unknown, text?: string }} res */
function assertStatusIn(res, allowed, label) {
  assert.ok(
    allowed.includes(res.status),
    `${label}: expected status ∈ [${allowed.join(", ")}], got ${res.status}: ${res.text?.slice(0, 200)}`,
  );
}

/** Paginated list envelope: `nextCursor` is string or null (user-interface.md). */
function extractListNextCursor(json) {
  if (!json || typeof json !== "object") {return null;}
  const j = /** @type {Record<string, unknown>} */ (json);
  if (j.nextCursor === null) {return null;}
  return typeof j.nextCursor === "string" ? j.nextCursor : null;
}

/** @param {unknown} json */
function extractItems(json) {
  if (!json || typeof json !== "object") {return null;}
  const j = /** @type {Record<string, unknown>} */ (json);
  return Array.isArray(j.items) ? j.items : null;
}

/** @param {unknown} json */
function inviteIdFromCreateResponse(json) {
  if (!json || typeof json !== "object") {return undefined;}
  const j = /** @type {Record<string, unknown>} */ (json);
  return typeof j.id === "string" ? j.id : undefined;
}


/**
 * @param {unknown} obj
 * @param {string} label
 */
function assertContactShape(obj, label) {
  assert.ok(obj && typeof obj === "object", `${label}: object body`);
  const c = /** @type {Record<string, unknown>} */ (obj);
  assert.equal(typeof c.userId, "string", `${label}: userId string`);
  assert.ok(
    c.alias === null || typeof c.alias === "string",
    `${label}: alias string|null`,
  );
  assert.ok(c.user && typeof c.user === "object", `${label}: user object`);
  assertPublicUserProfileShape(c.user, `${label}.user`);
  assert.equal(typeof c.createdAt, "string", `${label}: createdAt string`);
}

/**
 * @param {unknown} obj
 * @param {string} label
 */
function assertInviteShape(obj, label) {
  assert.ok(obj && typeof obj === "object", `${label}: object body`);
  const i = /** @type {Record<string, unknown>} */ (obj);
  assert.equal(typeof i.id, "string", `${label}: id string`);
  assert.equal(typeof i.code, "string", `${label}: code string`);
  assert.ok(
    ["pending", "accepted", "declined", "expired"].includes(
      /** @type {string} */ (i.status),
    ),
    `${label}: status enum`,
  );
  assert.equal(typeof i.fromUserId, "string", `${label}: fromUserId string`);
  assert.ok(
    i.toUserId === null || typeof i.toUserId === "string",
    `${label}: toUserId string|null`,
  );
  assert.ok(
    i.email === null || typeof i.email === "string",
    `${label}: email string|null`,
  );
  assert.equal(typeof i.createdAt, "string", `${label}: createdAt string`);
}


/**
 * @typedef {{
 *   email: string;
 *   username: string;
 *   password: string;
 *   accessToken?: string;
 *   refreshToken?: string;
 *   userId?: string;
 * }} FixtureUser
 */

/** @type {FixtureUser | null} */
let primary = null;
/** @type {FixtureUser | null} */
let secondary = null;
/** @type {FixtureUser | null} */
let tertiary = null;

/**
 * @param {unknown} obj
 * @param {string} label
 */
function assertNoAuthSecretsInPublicUser(obj, label) {
  if (!obj || typeof obj !== "object") {return;}
  const forbiddenKeys = new Set([
    "password",
    "passwordHash",
    "refreshToken",
    "accessToken",
    "recoveryCodes",
    "totpSecret",
    "mfaTicket",
    "emailVerificationToken",
    "devResetToken",
  ]);
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") {continue;}
    if (Array.isArray(cur)) {
      for (const x of cur) {stack.push(x);}
      continue;
    }
    for (const k of Object.keys(cur)) {
      assert.ok(
        !forbiddenKeys.has(k),
        `${label}: public payload must not include '${k}'`,
      );
      const v = /** @type {Record<string, unknown>} */ (cur)[k];
      if (v && typeof v === "object") {stack.push(v);}
    }
  }
}

/**
 * @param {unknown} profile
 * @param {string} label
 */
function assertPublicUserProfileShape(profile, label) {
  assert.ok(profile && typeof profile === "object", `${label}: object body`);
  const p = /** @type {Record<string, unknown>} */ (profile);
  assert.equal(typeof p.id, "string", `${label}: id string`);
  assert.equal(typeof p.username, "string", `${label}: username string`);
  assert.ok(
    p.displayName === null || typeof p.displayName === "string",
    `${label}: displayName string|null`,
  );
  assert.ok(
    ["online", "away", "busy", "offline"].includes(
      /** @type {string} */ (p.presence),
    ),
    `${label}: presence enum`,
  );
  assert.ok(
    p.statusMessage === null || typeof p.statusMessage === "string",
    `${label}: statusMessage string|null`,
  );
  assert.ok(
    p.avatarAttachmentId === null || typeof p.avatarAttachmentId === "string",
    `${label}: avatarAttachmentId string|null`,
  );
  assert.ok(!("email" in p), `${label}: public profile must not expose email`);
  assertNoAuthSecretsInPublicUser(profile, label);
}

/**
 * @param {unknown} item
 * @param {string} userId
 */
function contactRowMatchesUserId(item, userId) {
  if (!item || typeof item !== "object") {return false;}
  const o = /** @type {Record<string, unknown>} */ (item);
  return o.userId === userId;
}

/**
 * @param {unknown} item
 * @param {string} inviteId
 */
function inviteRowMatchesId(item, inviteId) {
  if (!item || typeof item !== "object") {return false;}
  const o = /** @type {Record<string, unknown>} */ (item);
  return o.id === inviteId;
}

/**
 * @param {unknown} item
 * @param {string} userId
 */
function inviteIsSentBy(item, userId) {
  if (!item || typeof item !== "object") {return false;}
  const o = /** @type {Record<string, unknown>} */ (item);
  if (o.fromUserId === userId || o.senderUserId === userId) {return true;}
  const inv = o.invite;
  return Boolean(
    inv &&
      typeof inv === "object" &&
      /** @type {{ fromUserId?: string }} */ (inv).fromUserId === userId,
  );
}

/**
 * @param {unknown} item
 * @param {string} userId
 */
function inviteIsReceivedBy(item, userId) {
  if (!item || typeof item !== "object") {return false;}
  const o = /** @type {Record<string, unknown>} */ (item);
  if (o.toUserId === userId || o.recipientUserId === userId) {return true;}
  const inv = o.invite;
  return Boolean(
    inv &&
      typeof inv === "object" &&
      /** @type {{ toUserId?: string }} */ (inv).toUserId === userId,
  );
}

/** @type {Array<{ name: string, fn: () => Promise<void> }>} */
const CASES = [
  // --- Fixtures ---
  {
    name: "fixture: register primary user → 200 + tokens + user.id",
    fn: async () => {
      primary = {
        email: `${unique("uf_primary")}@example.test`,
        username: uniqueUsername("uf_pri"),
        password: "password123",
      };
      const res = await api("POST", "/auth/register", {
        body: {
          email: primary.email,
          username: primary.username,
          password: primary.password,
          deviceId: "ufix-device-primary",
          displayName: "AlphaFixtureDisplay",
        },
      });
      assertStatus(res, 200, "register primary");
      assert.ok(res.json?.accessToken, "accessToken");
      assert.ok(res.json?.refreshToken, "refreshToken");
      assert.ok(res.json?.user?.id, "user.id");
      primary.accessToken = res.json.accessToken;
      primary.refreshToken = res.json.refreshToken;
      primary.userId = res.json.user.id;
    },
  },
  {
    name: "fixture: register secondary user → 200 + tokens + user.id",
    fn: async () => {
      secondary = {
        email: `${unique("uf_secondary")}@example.test`,
        username: uniqueUsername("uf_sec"),
        password: "password123",
      };
      const res = await api("POST", "/auth/register", {
        body: {
          email: secondary.email,
          username: secondary.username,
          password: secondary.password,
          deviceId: "ufix-device-secondary",
          displayName: "BetaFixtureDisplay",
        },
      });
      assertStatus(res, 200, "register secondary");
      secondary.accessToken = res.json.accessToken;
      secondary.refreshToken = res.json.refreshToken;
      secondary.userId = res.json.user.id;
    },
  },
  {
    name: "fixture: register tertiary user → 200 + tokens + user.id",
    fn: async () => {
      tertiary = {
        email: `${unique("uf_tertiary")}@example.test`,
        username: uniqueUsername("uf_ter"),
        password: "password123",
      };
      const res = await api("POST", "/auth/register", {
        body: {
          email: tertiary.email,
          username: tertiary.username,
          password: tertiary.password,
          deviceId: "ufix-device-tertiary",
          displayName: "GammaFixtureDisplay",
        },
      });
      assertStatus(res, 200, "register tertiary");
      tertiary.accessToken = res.json.accessToken;
      tertiary.refreshToken = res.json.refreshToken;
      tertiary.userId = res.json.user.id;
    },
  },

  // --- GET /users/{userId} ---
  {
    name: "GET /users/{userId}: existing secondary → 200 public profile",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const res = await api("GET", `/users/${secondary.userId}`, {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      assertPublicUserProfileShape(res.json, "GET /users secondary");
      assert.equal(
        /** @type {{ id: string }} */ (res.json).id,
        secondary.userId,
      );
    },
  },
  {
    name: "GET /users/{userId}: own profile by id → 200",
    fn: async () => {
      assert.ok(primary?.accessToken && primary.userId);
      const res = await api("GET", `/users/${primary.userId}`, {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      assertPublicUserProfileShape(res.json, "GET /users self");
    },
  },
  {
    name: "GET /users/{userId}: public profile omits sensitive secret fields",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const res = await api("GET", `/users/${secondary.userId}`, {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      assertNoAuthSecretsInPublicUser(res.json, "GET /users secrets");
    },
  },
  {
    name: "GET /users/{userId}: URL-encoded id still routes → 200",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const enc = encodeURIComponent(secondary.userId);
      const res = await api("GET", `/users/${enc}`, {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, "encoded user id");
      assertPublicUserProfileShape(res.json, "encoded GET /users");
    },
  },

  // --- GET /users ---
  {
    name: "GET /users: default → 200 + items[]",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users", { bearer: primary.accessToken });
      assertStatus(res, 200, res.json);
      const items = extractItems(res.json);
      assert.ok(Array.isArray(items), "items array");
    },
  },
  {
    name: "GET /users: query matches secondary username → includes secondary",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.username);
      const q = encodeURIComponent(secondary.username);
      const res = await api("GET", `/users?query=${q}`, {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      const items = extractItems(res.json);
      assert.ok(items, "items");
      const hit = items.some(
        (it) =>
          it &&
          typeof it === "object" &&
          /** @type {{ id?: string }} */ (it).id === secondary.userId,
      );
      assert.ok(hit, "expected secondary in results");
    },
  },
  {
    name: "GET /users: query matches display name fragment (case-insensitive)",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      for (const q of ["BetaFixture", "betafixture"]) {
        const res = await api(
          "GET",
          `/users?query=${encodeURIComponent(q)}`,
          { bearer: primary.accessToken },
        );
        assertStatus(res, 200, res.json);
        const items = extractItems(res.json);
        assert.ok(items, "items");
        const hit = items.some(
          (it) =>
            it &&
            typeof it === "object" &&
            /** @type {{ id?: string }} */ (it).id === secondary.userId,
        );
        assert.ok(
          hit,
          `expected secondary (displayName BetaFixtureDisplay) for query=${q}`,
        );
      }
    },
  },
  {
    name: "GET /users: query with no matches → empty items (or 200 with items)",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api(
        "GET",
        `/users?query=${encodeURIComponent("zzzznomatchzzzzufix")}`,
        { bearer: primary.accessToken },
      );
      assertStatus(res, 200, res.json);
      const items = extractItems(res.json);
      assert.ok(items, "items");
      assert.equal(items.length, 0, "no matches");
    },
  },
  {
    name: "GET /users: present query empty string → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?query=", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /users: query longer than 100 chars → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const long = "a".repeat(101);
      const res = await api(
        "GET",
        `/users?query=${encodeURIComponent(long)}`,
        { bearer: primary.accessToken },
      );
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /users: presence online|away|busy|offline accepted → 200",
    fn: async () => {
      assert.ok(primary?.accessToken);
      for (const p of ["online", "away", "busy", "offline"]) {
        const res = await api(`GET`, `/users?presence=${p}`, {
          bearer: primary.accessToken,
        });
        assertStatus(res, 200, `presence ${p}`);
        assert.ok(Array.isArray(extractItems(res.json)), "items");
      }
    },
  },
  {
    name: "GET /users: invalid presence → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?presence=unknown_state", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /users: limit=1 → 200 and at most one item",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?limit=1", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      const items = extractItems(res.json);
      assert.ok(items, "items");
      assert.ok(items.length <= 1, "limit 1");
    },
  },
  {
    name: "GET /users: limit=50 → 200",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?limit=50", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      assert.ok(Array.isArray(extractItems(res.json)), "items");
    },
  },
  {
    name: "GET /users: limit=0 → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?limit=0", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /users: limit=51 → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?limit=51", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /users: negative limit → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?limit=-2", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /users: non-numeric limit → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?limit=abc", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, "non-numeric limit");
    },
  },
  {
    name: "GET /users: decimal limit → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/users?limit=1.5", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, "decimal limit");
    },
  },
  {
    name: "GET /users: bogus cursor → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api(
        "GET",
        "/users?cursor=%%%bad%%%cursor%%%",
        { bearer: primary.accessToken },
      );
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /users: nextCursor page has no duplicate ids vs first page",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const first = await api("GET", "/users?limit=5", {
        bearer: primary.accessToken,
      });
      assertStatus(first, 200, first.json);
      const cur = extractListNextCursor(first.json);
      if (!cur) {return;}
      const second = await api(
        "GET",
        `/users?limit=5&cursor=${encodeURIComponent(cur)}`,
        { bearer: primary.accessToken },
      );
      assertStatus(second, 200, second.json);
      const a = extractItems(first.json) ?? [];
      const b = extractItems(second.json) ?? [];
      const idsA = new Set(
        a.map((it) =>
          it && typeof it === "object"
            ? String(/** @type {{ id?: unknown }} */ (it).id ?? "")
            : "",
        ),
      );
      for (const it of b) {
        const id =
          it && typeof it === "object"
            ? String(/** @type {{ id?: unknown }} */ (it).id ?? "")
            : "";
        assert.ok(!idsA.has(id), `duplicate id in second page: ${id}`);
      }
    },
  },

  // --- GET /contacts ---
  {
    name: "GET /contacts: default → 200 + items[]",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/contacts", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      assert.ok(Array.isArray(extractItems(res.json)), "items");
    },
  },
  {
    name: "GET /contacts: scoped to auth user (secondary list independent)",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken);
      const a = await api("GET", "/contacts", { bearer: primary.accessToken });
      const b = await api("GET", "/contacts", {
        bearer: secondary.accessToken,
      });
      assertStatus(a, 200, a.json);
      assertStatus(b, 200, b.json);
      assert.ok(Array.isArray(extractItems(a.json)));
      assert.ok(Array.isArray(extractItems(b.json)));
    },
  },
  {
    name: "GET /contacts: presence values accepted → 200",
    fn: async () => {
      assert.ok(primary?.accessToken);
      for (const p of ["online", "away", "busy", "offline"]) {
        const res = await api(`GET`, `/contacts?presence=${p}`, {
          bearer: primary.accessToken,
        });
        assertStatus(res, 200, `contacts presence ${p}`);
      }
    },
  },
  {
    name: "GET /contacts: invalid presence → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/contacts?presence=nope", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /contacts: limit=1 → 200",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/contacts?limit=1", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      const items = extractItems(res.json);
      assert.ok(items && items.length <= 1, "at most one");
    },
  },
  {
    name: "GET /contacts: limit=100 → 200",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/contacts?limit=100", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
    },
  },
  {
    name: "GET /contacts: limit=0 → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/contacts?limit=0", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /contacts: limit=101 → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/contacts?limit=101", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /contacts: bogus cursor → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api(
        "GET",
        "/contacts?cursor=not-valid-base64url!!!",
        { bearer: primary.accessToken },
      );
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /contacts: query filter by username substring → 200",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.username);
      const frag = secondary.username.slice(0, Math.min(6, secondary.username.length));
      const res = await api(
        "GET",
        `/contacts?query=${encodeURIComponent(frag)}`,
        { bearer: primary.accessToken },
      );
      assertStatus(res, 200, res.json);
    },
  },
  {
    name: "GET /contacts: present query empty string → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/contacts?query=", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /contacts: query longer than 100 chars → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const long = "c".repeat(101);
      const res = await api(
        "GET",
        `/contacts?query=${encodeURIComponent(long)}`,
        { bearer: primary.accessToken },
      );
      assertStatus(res, 400, res.json);
    },
  },

  // --- POST /contacts ---
  {
    name: "POST /contacts: add secondary from primary → 200 + Contact shape, appears in list",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const add = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: secondary.userId },
      });
      assertStatus(add, 200, "add contact");
      assertContactShape(add.json, "POST /contacts response");
      assert.equal(
        /** @type {{ userId: string }} */ (add.json).userId,
        secondary.userId,
      );
      const list = await api("GET", "/contacts", {
        bearer: primary.accessToken,
      });
      assertStatus(list, 200, "list contacts");
      const items = extractItems(list.json) ?? [];
      const found = items.find((it) =>
        contactRowMatchesUserId(it, secondary.userId),
      );
      assert.ok(found, "secondary in contacts");
      assertContactShape(found, "listed contact");
    },
  },
  {
    name: "POST /contacts: alias trimmed and echoed → 200",
    fn: async () => {
      assert.ok(primary?.accessToken && tertiary?.userId);
      const add = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: tertiary.userId, alias: "  Buddy  " },
      });
      assertStatus(add, 200, "add with alias");
      assertContactShape(add.json, "alias response");
      assert.equal(
        /** @type {{ alias: string }} */ (add.json).alias,
        "Buddy",
        "alias trimmed and echoed",
      );
    },
  },
  {
    name: "POST /contacts: whitespace-only alias → 400",
    fn: async () => {
      assert.ok(primary?.accessToken && tertiary?.userId);
      const res = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: tertiary.userId, alias: "   " },
      });
      assertStatus(res, 400, "blank alias");
    },
  },
  {
    name: "POST /contacts: add self → 400",
    fn: async () => {
      assert.ok(primary?.accessToken && primary.userId);
      const res = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: primary.userId },
      });
      assertStatus(res, 400, "add self");
    },
  },
  {
    name: "POST /contacts: unknown userId → 404",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: unique("nouser") },
      });
      assertStatus(res, 404, res.json);
    },
  },
  {
    name: "POST /contacts: missing userId → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { alias: "x" },
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "POST /contacts: empty userId → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: "" },
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "POST /contacts: duplicate add is idempotent → 200 both times, alias preserved",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const a = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: secondary.userId, alias: "First" },
      });
      assertStatus(a, 200, "dup add a");
      assertContactShape(a.json, "dup add a body");
      const b = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: secondary.userId, alias: "Second" },
      });
      assertStatus(b, 200, "dup add b");
      assertContactShape(b.json, "dup add b body");
      assert.equal(
        /** @type {{ alias: string }} */ (b.json).alias,
        "First",
        "re-add must not overwrite alias",
      );
    },
  },
  {
    name: "POST /contacts: secondary does not auto-see primary's contacts",
    fn: async () => {
      assert.ok(secondary?.accessToken && primary?.userId);
      const list = await api("GET", "/contacts", {
        bearer: secondary.accessToken,
      });
      assertStatus(list, 200, list.json);
      const items = extractItems(list.json) ?? [];
      const hasPrimary = items.some((it) =>
        contactRowMatchesUserId(it, primary.userId),
      );
      assert.ok(!hasPrimary, "secondary should not inherit primary contacts");
    },
  },

  // --- DELETE /contacts/{userId} ---
  {
    name: "DELETE /contacts/{userId}: remove tertiary → 204",
    fn: async () => {
      assert.ok(primary?.accessToken && tertiary?.userId);
      const res = await api("DELETE", `/contacts/${tertiary.userId}`, {
        bearer: primary.accessToken,
      });
      assertStatus(res, 204, res.json);
    },
  },
  {
    name: "DELETE /contacts/{userId}: tertiary no longer listed",
    fn: async () => {
      assert.ok(primary?.accessToken && tertiary?.userId);
      const list = await api("GET", "/contacts", {
        bearer: primary.accessToken,
      });
      assertStatus(list, 200, list.json);
      const items = extractItems(list.json) ?? [];
      const found = items.some((it) => contactRowMatchesUserId(it, tertiary.userId));
      assert.ok(!found, "tertiary removed");
    },
  },
  {
    name: "DELETE /contacts/{userId}: not in contact list → 404",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("DELETE", `/contacts/${unique("nocontact")}`, {
        bearer: primary.accessToken,
      });
      assertStatus(res, 404, "delete unknown");
    },
  },
  {
    name: "DELETE /contacts/{userId}: second delete → 404",
    fn: async () => {
      assert.ok(primary?.accessToken && tertiary?.userId);
      const d2 = await api("DELETE", `/contacts/${tertiary.userId}`, {
        bearer: primary.accessToken,
      });
      assertStatus(d2, 404, "delete already-removed contact");
    },
  },
  {
    name: "DELETE /contacts/{userId}: URL-encoded userId routes → 204",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const add = await api("POST", "/contacts", {
        bearer: primary.accessToken,
        body: { userId: secondary.userId },
      });
      assertStatus(add, 200, "ensure secondary present");
      const enc = encodeURIComponent(secondary.userId);
      const res = await api("DELETE", `/contacts/${enc}`, {
        bearer: primary.accessToken,
      });
      assertStatus(res, 204, "encoded delete");
    },
  },

  // --- POST /invites ---
  {
    name: "POST /invites: by targetUserId → pending Invite, message trimmed",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const res = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: {
          targetUserId: secondary.userId,
          message: "  hello connect  ",
        },
      });
      assertStatus(res, 200, "create invite");
      assertInviteShape(res.json, "POST /invites response");
      const j = /** @type {Record<string, unknown>} */ (res.json);
      assert.equal(j.status, "pending", "status pending");
      assert.equal(j.fromUserId, primary.userId, "fromUserId is primary");
      assert.equal(j.toUserId, secondary.userId, "toUserId is secondary");
      assert.equal(j.email, null, "email null for user invite");
      assert.equal(j.message, "hello connect", "message trimmed");
    },
  },
  {
    name: "POST /invites: appears in sent (primary) and received (secondary)",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken && tertiary?.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: tertiary.userId, message: "join us" },
      });
      assertStatus(create, 200, "POST /invites create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const sent = await api("GET", "/invites?direction=sent", {
        bearer: primary.accessToken,
      });
      assertStatus(sent, 200, sent.json);
      const sItems = extractItems(sent.json) ?? [];
      assert.ok(
        sItems.some((it) => inviteRowMatchesId(it, inviteId)),
        "in sent list",
      );
      const recv = await api("GET", "/invites?direction=received", {
        bearer: tertiary.accessToken,
      });
      assertStatus(recv, 200, recv.json);
      const rItems = extractItems(recv.json) ?? [];
      assert.ok(
        rItems.some((it) => inviteRowMatchesId(it, inviteId)),
        "in received list",
      );
    },
  },
  {
    name: "POST /invites: by email only → pending Invite",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const email = `${unique("inv_email")}@example.test`;
      const res = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { email, message: "invite by email" },
      });
      assertStatus(res, 200, "create email invite");
      assertInviteShape(res.json, "email invite shape");
      const j = /** @type {Record<string, unknown>} */ (res.json);
      assert.equal(j.email, email, "email echoed");
      assert.equal(j.toUserId, null, "toUserId null for email invite");
    },
  },
  {
    name: "POST /invites: both targetUserId and email → 400",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const res = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: {
          targetUserId: secondary.userId,
          email: `${unique("both")}@example.test`,
        },
      });
      assertStatus(res, 400, "both target and email");
    },
  },
  {
    name: "POST /invites: missing targetUserId and email → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { message: "only message" },
      });
      assertStatus(res, 400, "neither target nor email");
    },
  },
  {
    name: "POST /invites: unknown conversationId → 404",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.userId);
      const res = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: {
          targetUserId: secondary.userId,
          conversationId: unique("noconv"),
        },
      });
      assertStatus(res, 404, "unknown conversation");
    },
  },
  {
    name: "POST /invites: unknown targetUserId → 404",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: unique("nouserid") },
      });
      assertStatus(res, 404, "unknown target");
    },
  },
  {
    name: "POST /invites: self-invite → 400",
    fn: async () => {
      assert.ok(primary?.accessToken && primary.userId);
      const res = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: primary.userId },
      });
      assertStatus(res, 400, "self invite");
    },
  },
  {
    name: "POST /invites: invalid JSON body → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("POST", "/invites", {
        bearer: primary.accessToken,
        rawBody: "{",
        contentType: "application/json",
      });
      assertStatusIn(res, [400, 415], "bad json");
    },
  },

  // --- GET /invites ---
  {
    name: "GET /invites: default → 200 + items[]",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/invites", { bearer: primary.accessToken });
      assertStatus(res, 200, res.json);
      assert.ok(Array.isArray(extractItems(res.json)), "items");
    },
  },
  {
    name: "GET /invites: direction=sent filters to sender",
    fn: async () => {
      assert.ok(primary?.accessToken && primary.userId);
      const res = await api("GET", "/invites?direction=sent", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 200, res.json);
      const items = extractItems(res.json) ?? [];
      for (const it of items) {
        assert.ok(
          inviteIsSentBy(it, primary.userId),
          "each sent invite must be from primary",
        );
      }
    },
  },
  {
    name: "GET /invites: direction=received filters to recipient",
    fn: async () => {
      assert.ok(secondary?.accessToken && secondary.userId);
      const res = await api("GET", "/invites?direction=received", {
        bearer: secondary.accessToken,
      });
      assertStatus(res, 200, res.json);
      const items = extractItems(res.json) ?? [];
      for (const it of items) {
        assert.ok(
          inviteIsReceivedBy(it, secondary.userId),
          "each received invite must be to secondary",
        );
      }
    },
  },
  {
    name: "GET /invites: invalid direction → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/invites?direction=both", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /invites: status pending|accepted|declined|expired → 200",
    fn: async () => {
      assert.ok(primary?.accessToken);
      for (const st of ["pending", "accepted", "declined", "expired"]) {
        const res = await api(`GET`, `/invites?status=${st}`, {
          bearer: primary.accessToken,
        });
        assertStatus(res, 200, `status ${st}`);
      }
    },
  },
  {
    name: "GET /invites: invalid status → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/invites?status=unknown", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /invites: limit=1 and limit=100 bounds",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const a = await api("GET", "/invites?limit=1", {
        bearer: primary.accessToken,
      });
      assertStatus(a, 200, a.json);
      const b = await api("GET", "/invites?limit=100", {
        bearer: primary.accessToken,
      });
      assertStatus(b, 200, b.json);
    },
  },
  {
    name: "GET /invites: limit=0 → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/invites?limit=0", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /invites: limit=101 → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api("GET", "/invites?limit=101", {
        bearer: primary.accessToken,
      });
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /invites: bogus cursor → 400",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api(
        "GET",
        "/invites?cursor=%%%bad%%%",
        { bearer: primary.accessToken },
      );
      assertStatus(res, 400, res.json);
    },
  },
  {
    name: "GET /invites: pagination no duplicate ids across pages",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const first = await api("GET", "/invites?limit=3", {
        bearer: primary.accessToken,
      });
      assertStatus(first, 200, first.json);
      const cur = extractListNextCursor(first.json);
      if (!cur) {return;}
      const second = await api(
        "GET",
        `/invites?limit=3&cursor=${encodeURIComponent(cur)}`,
        { bearer: primary.accessToken },
      );
      assertStatus(second, 200, second.json);
      const a = extractItems(first.json) ?? [];
      const b = extractItems(second.json) ?? [];
      const ids = new Set(
        a.map((it) =>
          it && typeof it === "object"
            ? String(inviteIdFromCreateResponse(it) ?? "")
            : "",
        ),
      );
      for (const it of b) {
        const id = String(inviteIdFromCreateResponse(it) ?? "");
        assert.ok(!ids.has(id), `dup invite id ${id}`);
      }
    },
  },

  // --- POST accept / decline ---
  {
    name: "POST /invites/{id}/accept: recipient accepts → 200 accepted Invite",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken && secondary.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: secondary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const acc = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(acc, 200, "accept");
      assertInviteShape(acc.json, "accept body");
      assert.equal(
        /** @type {{ status: string }} */ (acc.json).status,
        "accepted",
        "status accepted",
      );
      const listed = await api("GET", "/invites?status=accepted", {
        bearer: secondary.accessToken,
      });
      assertStatus(listed, 200, "list accepted");
      const items = extractItems(listed.json) ?? [];
      assert.ok(
        items.some((it) => inviteRowMatchesId(it, inviteId)),
        "accepted listed",
      );
    },
  },
  {
    name: "POST /invites/{id}/accept: sender cannot accept own invite → 403",
    fn: async () => {
      assert.ok(primary?.accessToken && tertiary?.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: tertiary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const acc = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: primary.accessToken,
        body: {},
      });
      assertStatus(acc, 403, "sender accept");
    },
  },
  {
    name: "POST /invites/{id}/accept: unrelated user cannot accept → 403",
    fn: async () => {
      assert.ok(
        primary?.accessToken &&
          secondary?.accessToken &&
          tertiary?.accessToken &&
          tertiary.userId,
      );
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: tertiary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const acc = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(acc, 403, "stranger accept");
    },
  },
  {
    name: "POST /invites/{id}/accept: unknown invite → 404",
    fn: async () => {
      assert.ok(secondary?.accessToken);
      const res = await api(
        "POST",
        `/invites/${unique("noinvite")}/accept`,
        { bearer: secondary.accessToken, body: {} },
      );
      assertStatus(res, 404, "unknown");
    },
  },
  {
    name: "POST /invites/{id}/accept: double accept → 200 then 409",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken && secondary.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: secondary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const a = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(a, 200, "first accept");
      const b = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(b, 409, "second accept conflict");
    },
  },
  {
    name: "POST /invites/{id}/accept: after decline → 409",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken && secondary.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: secondary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const dec = await api("POST", `/invites/${inviteId}/decline`, {
        bearer: secondary.accessToken,
        body: { reason: "no thanks" },
      });
      assertStatus(dec, 200, "decline");
      const acc = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(acc, 409, "accept after decline");
    },
  },

  {
    name: "POST /invites/{id}/decline: recipient declines → 200 declined, reason trimmed",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken && secondary.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: secondary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const dec = await api("POST", `/invites/${inviteId}/decline`, {
        bearer: secondary.accessToken,
        body: { reason: "  busy  " },
      });
      assertStatus(dec, 200, "decline");
      assertInviteShape(dec.json, "decline body");
      assert.equal(
        /** @type {{ status: string }} */ (dec.json).status,
        "declined",
      );
      const listed = await api("GET", "/invites?status=declined", {
        bearer: secondary.accessToken,
      });
      assertStatus(listed, 200, "list declined");
      const items = extractItems(listed.json) ?? [];
      assert.ok(
        items.some((it) => inviteRowMatchesId(it, inviteId)),
        "declined listed",
      );
    },
  },
  {
    name: "POST /invites/{id}/decline: sender cannot decline own invite → 403",
    fn: async () => {
      assert.ok(primary?.accessToken && tertiary?.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: tertiary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const dec = await api("POST", `/invites/${inviteId}/decline`, {
        bearer: primary.accessToken,
        body: {},
      });
      assertStatus(dec, 403, "sender decline");
    },
  },
  {
    name: "POST /invites/{id}/decline: stranger cannot decline → 403",
    fn: async () => {
      assert.ok(
        primary?.accessToken &&
          secondary?.accessToken &&
          tertiary?.userId,
      );
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: tertiary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const dec = await api("POST", `/invites/${inviteId}/decline`, {
        bearer: secondary.accessToken,
        body: { reason: "x" },
      });
      assertStatus(dec, 403, "stranger decline");
    },
  },
  {
    name: "POST /invites/{id}/decline: unknown invite → 404",
    fn: async () => {
      assert.ok(secondary?.accessToken);
      const res = await api(
        "POST",
        `/invites/${unique("noinv")}/decline`,
        { bearer: secondary.accessToken, body: {} },
      );
      assertStatus(res, 404, "unknown");
    },
  },
  {
    name: "POST /invites/{id}/decline: double decline → 200 then 409",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken && secondary.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: secondary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const d1 = await api("POST", `/invites/${inviteId}/decline`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(d1, 200, "decline 1");
      const d2 = await api("POST", `/invites/${inviteId}/decline`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(d2, 409, "decline 2 conflict");
    },
  },
  {
    name: "POST /invites/{id}/decline: after accept → 409",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken && secondary.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: secondary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const acc = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(acc, 200, "accept first");
      const dec = await api("POST", `/invites/${inviteId}/decline`, {
        bearer: secondary.accessToken,
        body: {},
      });
      assertStatus(dec, 409, "decline after accept");
    },
  },

  {
    name: "POST /invites/{id}/accept: bidirectional contacts created on accept",
    fn: async () => {
      assert.ok(
        primary?.accessToken &&
          tertiary?.accessToken &&
          tertiary.userId &&
          primary.userId,
      );
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: tertiary.userId },
      });
      assertStatus(create, 200, "create");
      const inviteId = inviteIdFromCreateResponse(create.json);
      assert.ok(inviteId);
      const acc = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: tertiary.accessToken,
        body: {},
      });
      assertStatus(acc, 200, "accept");
      const aList = await api("GET", "/contacts", {
        bearer: primary.accessToken,
      });
      const bList = await api("GET", "/contacts", {
        bearer: tertiary.accessToken,
      });
      assertStatus(aList, 200, "primary contacts");
      assertStatus(bList, 200, "tertiary contacts");
      const aItems = extractItems(aList.json) ?? [];
      const bItems = extractItems(bList.json) ?? [];
      assert.ok(
        aItems.some((it) => contactRowMatchesUserId(it, tertiary.userId)),
        "primary must see tertiary in contacts after accept",
      );
      assert.ok(
        bItems.some((it) => contactRowMatchesUserId(it, primary.userId)),
        "tertiary must see primary in contacts after accept",
      );
    },
  },

  {
    name: "POST /invites/{id}/accept: invite with conversationId adds recipient to conversation",
    fn: async () => {
      assert.ok(
        primary?.accessToken &&
          primary.userId &&
          secondary?.accessToken &&
          secondary.userId &&
          tertiary?.accessToken &&
          tertiary.userId,
      );
      const convCreate = await api("POST", "/conversations", {
        bearer: primary.accessToken,
        body: { type: "group", memberIds: [secondary.userId] },
      });
      assert.ok(
        convCreate.status === 200 || convCreate.status === 201,
        `create conversation: ${convCreate.status}`,
      );
      const conversationId = /** @type {{ id?: string }} */ (convCreate.json ?? {}).id;
      assert.ok(typeof conversationId === "string" && conversationId.length > 0, "conversationId");
      const inviteCreate = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: tertiary.userId, conversationId },
      });
      assertStatus(inviteCreate, 200, "create invite with conversationId");
      const inviteId = inviteIdFromCreateResponse(inviteCreate.json);
      assert.ok(inviteId, "inviteId");
      const acc = await api("POST", `/invites/${inviteId}/accept`, {
        bearer: tertiary.accessToken,
        body: {},
      });
      assertStatus(acc, 200, "accept");
      assert.equal(
        /** @type {{ status?: string }} */ (acc.json ?? {}).status,
        "accepted",
        "invite status accepted",
      );
      const conv = await api("GET", `/conversations/${conversationId}`, {
        bearer: tertiary.accessToken,
      });
      assertStatus(conv, 200, "recipient reads conversation");
      const memberIds = /** @type {{ memberIds?: unknown }} */ (conv.json ?? {}).memberIds;
      assert.ok(Array.isArray(memberIds), "memberIds array");
      assert.ok(
        /** @type {unknown[]} */ (memberIds).includes(tertiary.userId),
        "recipient must appear in conversation memberIds after accept",
      );
    },
  },

  // --- GET /invites/lookup ---
  {
    name: "GET /invites/lookup: valid code resolves Invite metadata, status unchanged",
    fn: async () => {
      assert.ok(primary?.accessToken && secondary?.accessToken && secondary.userId);
      const create = await api("POST", "/invites", {
        bearer: primary.accessToken,
        body: { targetUserId: secondary.userId },
      });
      assertStatus(create, 200, "create");
      assertInviteShape(create.json, "create body");
      const inviteId = /** @type {{ id: string }} */ (create.json).id;
      const code = /** @type {{ code: string }} */ (create.json).code;
      const lookup = await api(
        "GET",
        `/invites/lookup?code=${encodeURIComponent(code)}`,
        { bearer: secondary.accessToken },
      );
      assertStatus(lookup, 200, "lookup");
      assertInviteShape(lookup.json, "lookup body");
      assert.equal(
        /** @type {{ id: string }} */ (lookup.json).id,
        inviteId,
        "same invite",
      );
      assert.equal(
        /** @type {{ status: string }} */ (lookup.json).status,
        "pending",
        "lookup does not change status",
      );
      assertNoAuthSecretsInPublicUser(lookup.json, "lookup payload");
      const after = await api("GET", `/invites?status=pending`, {
        bearer: secondary.accessToken,
      });
      assertStatus(after, 200, "list pending after lookup");
      const stillPending = (extractItems(after.json) ?? []).some((it) =>
        inviteRowMatchesId(it, inviteId),
      );
      assert.ok(stillPending, "lookup must not accept invite");
    },
  },
  {
    name: "GET /invites/lookup: unknown code → 404",
    fn: async () => {
      assert.ok(primary?.accessToken);
      const res = await api(
        "GET",
        `/invites/lookup?code=${encodeURIComponent(unique("badcode"))}`,
        { bearer: primary.accessToken },
      );
      assertStatus(res, 404, res.json);
    },
  },
  {
    name: "GET /invites/lookup: unauthenticated → 401 even with code",
    fn: async () => {
      const res = await api(
        "GET",
        `/invites/lookup?code=${encodeURIComponent("any-public-lookup-code")}`,
      );
      assertStatus(res, 401, "lookup requires auth");
    },
  },
];

async function main() {
  console.log(`User/contact/invite tests → ${BASE_URL}\n`);

  let passed = 0;
  let failed = 0;

  testResults.installIsolation();

  for (const { name, fn } of CASES) {
    testResults.beginCase(name);
    const caseStart = performance.now();
    const label = dim(`${passed + failed + 1}/${CASES.length}`);
    let runError;
    try {
      await fn();
    } catch (err) {
      runError = err;
    }
    const asyncErrors = testResults.endCase();
    const errors = [runError, ...asyncErrors].filter((e) => e !== undefined);
    const durationMs = Math.round(performance.now() - caseStart);
    if (errors.length === 0) {
      passed += 1;
      console.log(`${green("PASS")} ${label} ${name}`);
      testResults.recordCase({
        name,
        status: "pass",
        durationMs,
      });
    } else {
      failed += 1;
      const msg = errors
        .map((e) => (e instanceof Error ? e.message : String(e)))
        .join("\n");
      console.log(`${red("FAIL")} ${label} ${name}`);
      console.log(`       ${dim(msg)}`);
      testResults.recordCase({
        name,
        status: "fail",
        error: msg,
        durationMs,
      });
    }
  }

  console.log("");
  console.log(
    `Done: ${green(`${passed} passed`)}, ${failed ? red(`${failed} failed`) : dim("0 failed")} (${CASES.length} cases)`,
  );


  const exitCode = failed > 0 ? 1 : 0;
  await testResults.finalize({ passed, failed, exitCode });
  if (exitCode === 1) { process.exit(1); }
}

main().catch(async (err) => {
  console.error("Fatal:", err);
  try {
    await testResults.finalize({
      passed: 0,
      failed: 0,
      fatal: err,
      exitCode: 2,
    });
  } catch {
    // ignore write errors
  }
  process.exit(2);
});
