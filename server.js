const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_KEY = process.env.ADMIN_KEY || "games-admin";
const DATABASE_PATH =
  process.env.DATABASE_PATH || process.env.STORE_PATH || path.join(__dirname, "data", "games-sync.localdb");
const LEGACY_STORE_PATH = process.env.LEGACY_STORE_PATH || "";
const DATA_KEY_PATH = process.env.DATA_KEY_PATH || path.join(path.dirname(DATABASE_PATH), "encryption.key");
const HAS_CONFIGURED_DATA_KEY = Boolean(process.env.DATA_ENCRYPTION_KEY || process.env.DB_ENCRYPTION_KEY);
const HAS_EXPLICIT_DATABASE_PATH = Boolean(process.env.DATABASE_PATH || process.env.STORE_PATH);
const IS_RENDER = process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);
const ALLOW_DATABASE_BOOTSTRAP =
  process.env.ALLOW_DATABASE_BOOTSTRAP === "true" || (!IS_RENDER && !HAS_EXPLICIT_DATABASE_PATH);
const DATABASE_BACKUP_DIR =
  process.env.DATABASE_BACKUP_DIR || path.join(path.dirname(DATABASE_PATH), "backups");
const MAX_DATABASE_BACKUPS = positiveInt(process.env.MAX_DATABASE_BACKUPS, 30);
const UPSTASH_REDIS_REST_URL = cleanText(process.env.UPSTASH_REDIS_REST_URL, 300).replace(/\/+$/, "");
const UPSTASH_REDIS_REST_TOKEN = cleanText(process.env.UPSTASH_REDIS_REST_TOKEN, 500);
const UPSTASH_STORE_KEY = cleanText(process.env.UPSTASH_STORE_KEY || "games-sync:store", 160);
const USE_UPSTASH_STORE = Boolean(UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATABASE_ALGORITHM = "aes-256-gcm";

const SIGNAL = "signal";
const OPEN_SIGNAL = "open";
const USER_STATUS_PENDING = "pending";
const USER_STATUS_APPROVED = "approved";
const AFFILIATIONS = new Set(["Games", "동물원", "수녀원", "지인소개"]);
const TAG_OPTIONS = {
  roles: [],
  groups: ["Games", "동물원", "수녀원", "지인소개"],
  seeking: ["연애만", "친분만", "아무나환영"]
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon"
};

const DEFAULT_ROOM_SETTINGS = {
  signalLimit: 10,
  openSignalLimit: 1,
  revokeLimit: 3
};

const DEFAULT_STORE = {
  settings: {
    adminKeyHash: null
  },
  rooms: [createRoom("SYNC2026")],
  updatedAt: new Date().toISOString()
};

class DatabaseMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = "DatabaseMissingError";
    this.code = "DATABASE_MISSING";
  }
}

function createRoom(code, values = {}) {
  return {
    id: values.id || crypto.randomUUID(),
    code,
    settings: {
      signalLimit: positiveInt(values.settings?.signalLimit, DEFAULT_ROOM_SETTINGS.signalLimit),
      openSignalLimit: positiveInt(
        values.settings?.openSignalLimit,
        DEFAULT_ROOM_SETTINGS.openSignalLimit
      ),
      revokeLimit: positiveInt(values.settings?.revokeLimit, DEFAULT_ROOM_SETTINGS.revokeLimit)
    },
    users: Array.isArray(values.users) ? values.users : [],
    likes: Array.isArray(values.likes) ? values.likes : [],
    createdAt: values.createdAt || new Date().toISOString(),
    updatedAt: values.updatedAt || new Date().toISOString()
  };
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanHeaderText(value, maxLength) {
  const text = String(value || "");
  try {
    return cleanText(decodeURIComponent(text), maxLength);
  } catch {
    return cleanText(text, maxLength);
  }
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function normalizeNickname(value) {
  return cleanText(value, 32).replace(/\s+/g, " ").toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const key = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${key}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = String(storedHash || "").split(":");
  if (!salt || !key) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(key, "hex");
  return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function normalizeTagList(values, allowedValues) {
  const allowed = new Set(allowedValues);
  return Array.isArray(values)
    ? [...new Set(values.map((value) => cleanText(value, 24)).filter((value) => allowed.has(value)))]
    : [];
}

function normalizeTags(tags = {}, user = {}) {
  const next = {
    roles: normalizeTagList(tags.roles, TAG_OPTIONS.roles),
    groups: normalizeTagList(tags.groups, TAG_OPTIONS.groups),
    seeking: normalizeTagList(tags.seeking, TAG_OPTIONS.seeking)
  };

  if (!next.groups.length && AFFILIATIONS.has(user.affiliation)) {
    next.groups = [user.affiliation];
  }

  return next;
}

function tagLabel(user) {
  const tags = normalizeTags(user.tags, user);
  const labels = [...tags.groups, ...tags.seeking];
  return labels.length ? labels.join(" · ") : "태그 미선택";
}

function affiliationLabel(user) {
  if (user.tags) return tagLabel(user);
  if (AFFILIATIONS.has(user.affiliation)) return user.affiliation;
  if (user.affiliationDetail) return user.affiliationDetail;
  return "소속 미입력";
}

function normalizeUser(user) {
  user.extraSignalLimit = positiveInt(user.extraSignalLimit, 0);
  user.extraOpenSignalLimit = positiveInt(user.extraOpenSignalLimit, 0);
  user.extraRevokeLimit = positiveInt(user.extraRevokeLimit, 0);
  user.revokesUsed = positiveInt(user.revokesUsed, 0);
  user.status = user.status === USER_STATUS_PENDING ? USER_STATUS_PENDING : USER_STATUS_APPROVED;
  user.tags = normalizeTags(user.tags, user);
  user.statusMessage = cleanText(user.statusMessage, 120);
  user.affiliation = AFFILIATIONS.has(user.affiliation) ? user.affiliation : "";
  user.affiliationDetail = cleanText(user.affiliationDetail, 80);
  return user;
}

function normalizeLikes(likes) {
  return Array.isArray(likes)
    ? likes
        .filter((like) => like && like.from && like.to)
        .map((like) => ({
          from: like.from,
          to: like.to,
          type: like.type === OPEN_SIGNAL ? OPEN_SIGNAL : SIGNAL,
          note: cleanText(like.note, 240),
          createdAt: like.createdAt || new Date().toISOString()
        }))
    : [];
}

function normalizeRoom(room) {
  const code = cleanText(room.code || room.eventCode, 80);
  const next = createRoom(code || "SYNC2026", room);
  next.settings = {
    signalLimit: positiveInt(room.settings?.signalLimit, DEFAULT_ROOM_SETTINGS.signalLimit),
    openSignalLimit: positiveInt(
      room.settings?.openSignalLimit,
      DEFAULT_ROOM_SETTINGS.openSignalLimit
    ),
    revokeLimit: positiveInt(room.settings?.revokeLimit, DEFAULT_ROOM_SETTINGS.revokeLimit)
  };
  next.users = Array.isArray(room.users) ? room.users.map(normalizeUser) : [];
  next.likes = normalizeLikes(room.likes);
  return next;
}

function normalizeStore(store) {
  const next = store && typeof store === "object" ? store : {};
  const adminKeyHash = next.settings?.adminKeyHash || null;

  if (!Array.isArray(next.rooms)) {
    next.rooms = [
      normalizeRoom({
        code: cleanText(next.eventCode || "SYNC2026", 80),
        settings: {
          signalLimit: next.settings?.signalLimit,
          openSignalLimit: next.settings?.openSignalLimit
        },
        users: next.users,
        likes: next.likes,
        updatedAt: next.updatedAt
      })
    ];
  } else {
    next.rooms = next.rooms.map(normalizeRoom).filter((room) => room.code);
  }

  if (!next.rooms.length) {
    next.rooms.push(createRoom("SYNC2026"));
  }

  next.settings = { adminKeyHash };
  next.updatedAt = next.updatedAt || new Date().toISOString();
  delete next.eventCode;
  delete next.users;
  delete next.likes;
  return next;
}

let cachedDataKey = null;

function decodeConfiguredKey(value) {
  const text = String(value || "").trim();
  if (!text) return null;

  if (/^[a-f0-9]{64}$/i.test(text)) {
    return Buffer.from(text, "hex");
  }

  try {
    const base64Key = Buffer.from(text, "base64");
    if (base64Key.length === 32) return base64Key;
  } catch {
    // Fall through to passphrase hashing.
  }

  return crypto.createHash("sha256").update(text).digest();
}

async function dataKey() {
  if (cachedDataKey) return cachedDataKey;

  const configuredKey = decodeConfiguredKey(process.env.DATA_ENCRYPTION_KEY || process.env.DB_ENCRYPTION_KEY);
  if (configuredKey) {
    cachedDataKey = configuredKey;
    return cachedDataKey;
  }

  if (USE_UPSTASH_STORE && IS_RENDER) {
    throw new Error("DATA_ENCRYPTION_KEY is required when using Upstash Redis on Render.");
  }

  try {
    const savedKey = await fs.readFile(DATA_KEY_PATH, "utf8");
    cachedDataKey = decodeConfiguredKey(savedKey);
    if (cachedDataKey) return cachedDataKey;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  cachedDataKey = crypto.randomBytes(32);
  await fs.mkdir(path.dirname(DATA_KEY_PATH), { recursive: true });
  await fs.writeFile(DATA_KEY_PATH, cachedDataKey.toString("hex"), {
    encoding: "utf8",
    mode: 0o600
  });
  return cachedDataKey;
}

function isEncryptedDatabase(payload) {
  return (
    payload &&
    payload.encrypted === true &&
    payload.algorithm === DATABASE_ALGORITHM &&
    payload.iv &&
    payload.tag &&
    payload.ciphertext
  );
}

async function encryptStorePayload(store) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(DATABASE_ALGORITHM, await dataKey(), iv);
  const plaintext = JSON.stringify(normalizeStore(store));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    encrypted: true,
    algorithm: DATABASE_ALGORITHM,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updatedAt: new Date().toISOString()
  };
}

async function decryptStorePayload(payload) {
  try {
    const decipher = crypto.createDecipheriv(
      DATABASE_ALGORITHM,
      await dataKey(),
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
    return normalizeStore(JSON.parse(plaintext));
  } catch (error) {
    throw new Error("Encrypted database could not be opened. Check DATA_ENCRYPTION_KEY.");
  }
}

async function readStorePayload(raw) {
  const payload = JSON.parse(raw);
  if (isEncryptedDatabase(payload)) {
    return { store: await decryptStorePayload(payload), encrypted: true };
  }
  return { store: normalizeStore(payload), encrypted: false };
}

async function readStoreFile(filePath) {
  return readStorePayload(await fs.readFile(filePath, "utf8"));
}

async function upstashCommand(command) {
  const response = await fetch(UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `Upstash request failed with HTTP ${response.status}`);
  }
  return data.result;
}

async function readStoreFromUpstash() {
  const raw = await upstashCommand(["GET", UPSTASH_STORE_KEY]);
  if (raw === null || raw === undefined) {
    const error = new Error("Upstash store key is missing.");
    error.code = "ENOENT";
    throw error;
  }
  return readStorePayload(raw);
}

async function writeStoreToUpstash(store) {
  const encryptedPayload = await encryptStorePayload(store);
  await upstashCommand(["SET", UPSTASH_STORE_KEY, JSON.stringify(encryptedPayload)]);
}

function backupStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function encryptedDatabaseExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return isEncryptedDatabase(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    return false;
  }
}

async function backupCurrentDatabase() {
  if (!(await encryptedDatabaseExists(DATABASE_PATH))) return;

  await fs.mkdir(DATABASE_BACKUP_DIR, { recursive: true });
  const backupPath = path.join(DATABASE_BACKUP_DIR, `games-sync-${backupStamp()}.localdb`);
  await fs.copyFile(DATABASE_PATH, backupPath);
  await pruneDatabaseBackups();
}

async function databaseBackupPaths() {
  try {
    const entries = await fs.readdir(DATABASE_BACKUP_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".localdb"))
        .map(async (entry) => {
          const filePath = path.join(DATABASE_BACKUP_DIR, entry.name);
          const stats = await fs.stat(filePath);
          return { filePath, mtimeMs: stats.mtimeMs };
        })
    );
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).map((entry) => entry.filePath);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function pruneDatabaseBackups() {
  const backups = await databaseBackupPaths();
  await Promise.all(backups.slice(MAX_DATABASE_BACKUPS).map((backupPath) => fs.rm(backupPath)));
}

async function readLatestDatabaseBackup() {
  for (const backupPath of await databaseBackupPaths()) {
    try {
      return await readStoreFile(backupPath);
    } catch (error) {
      console.error(`Could not read database backup ${backupPath}:`, error.message);
    }
  }
  return null;
}

function storeScore(store) {
  return store.rooms.reduce(
    (score, room) => score + 1 + room.users.length * 10 + room.likes.length,
    0
  );
}

function legacyStorePaths() {
  return [
    LEGACY_STORE_PATH,
    process.env.STORE_PATH,
    path.join(path.dirname(DATABASE_PATH), "store.json"),
    path.join(__dirname, "data", "store.json")
  ]
    .filter(Boolean)
    .map((entry) => path.resolve(entry))
    .filter((entry, index, entries) => entry !== path.resolve(DATABASE_PATH) && entries.indexOf(entry) === index);
}

async function richerLegacyStore(currentStore) {
  const currentScore = storeScore(currentStore);

  for (const legacyPath of legacyStorePaths()) {
    try {
      const result = await readStoreFile(legacyPath);
      if (storeScore(result.store) > currentScore) {
        return result.store;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return null;
}

async function readStore(options = {}) {
  const allowBootstrap = options.allowBootstrap === true || ALLOW_DATABASE_BOOTSTRAP;

  if (USE_UPSTASH_STORE) {
    try {
      const result = await readStoreFromUpstash();
      if (!result.encrypted) {
        await writeStore(result.store);
      }
      return result.store;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  try {
    const result = await readStoreFile(DATABASE_PATH);
    if (!result.encrypted) {
      await writeStore(result.store);
    }
    const legacyStore = await richerLegacyStore(result.store);
    if (legacyStore) {
      await writeStore(legacyStore);
      return legacyStore;
    }
    return result.store;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const backup = await readLatestDatabaseBackup();
  if (backup) {
    await writeStore(backup.store, { backup: false });
    return backup.store;
  }

  for (const legacyPath of legacyStorePaths()) {
    try {
      const result = await readStoreFile(legacyPath);
      await writeStore(result.store);
      return result.store;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  if (!allowBootstrap) {
    const missingTarget = USE_UPSTASH_STORE
      ? `Upstash Redis key ${UPSTASH_STORE_KEY}`
      : `database file at ${DATABASE_PATH}`;
    throw new DatabaseMissingError(
      `${missingTarget} is missing. Refusing to create a fresh empty database. ` +
        "Restore a backup, use the Render ADMIN_KEY, or set ALLOW_DATABASE_BOOTSTRAP=true once for first setup."
    );
  }

  const store = normalizeStore(DEFAULT_STORE);
  await writeStore(store);
  return store;
}

async function writeStore(store, options = {}) {
  if (USE_UPSTASH_STORE) {
    await writeStoreToUpstash(store);
    return;
  }

  await fs.mkdir(path.dirname(DATABASE_PATH), { recursive: true });
  if (options.backup !== false) {
    await backupCurrentDatabase();
  }
  const encryptedPayload = await encryptStorePayload(store);
  const tempPath = `${DATABASE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(encryptedPayload, null, 2), "utf8");
  await fs.rename(tempPath, DATABASE_PATH);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function requestOrigin(req) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || req.headers.host || `localhost:${PORT}`;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto =
    forwardedProto ||
    (String(host).startsWith("localhost") || String(host).startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

function renderHtml(html, req) {
  return html.replaceAll("__APP_ORIGIN__", requestOrigin(req));
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw new Error("요청 본문이 너무 큽니다.");
    }
  }
  if (!body) return {};
  return JSON.parse(body);
}

function publicUser(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    statusMessage: cleanText(user.statusMessage, 120),
    affiliationLabel: affiliationLabel(user),
    tags: normalizeTags(user.tags, user),
    status: user.status,
    createdAt: user.createdAt
  };
}

function privateUser(user) {
  return {
    ...publicUser(user),
    contact: user.contact
  };
}

function roomSummary(room) {
  return {
    id: room.id,
    code: room.code,
    signalLimit: room.settings.signalLimit,
    openSignalLimit: room.settings.openSignalLimit,
    revokeLimit: room.settings.revokeLimit,
    usersCount: room.users.length,
    likesCount: room.likes.length,
    updatedAt: room.updatedAt
  };
}

function receivedSignalCount(room, userId) {
  return new Set(
    room.likes
      .filter((like) => like.to === userId && like.type === SIGNAL)
      .map((like) => like.from)
  ).size;
}

function rankingPayload(room) {
  return room.users
    .filter(isApprovedUser)
    .map((user) => ({
      ...publicUser(user),
      receivedCount: receivedSignalCount(room, user.id)
    }))
    .filter((user) => user.receivedCount > 0)
    .sort((a, b) => b.receivedCount - a.receivedCount || a.nickname.localeCompare(b.nickname))
    .slice(0, 3)
    .map((user, index) => ({
      ...user,
      rank: index + 1
    }));
}

function adminUser(room, user) {
  const stats = statsPayload(room, user.id);
  return {
    ...publicUser(user),
    extraSignalLimit: user.extraSignalLimit,
    extraOpenSignalLimit: user.extraOpenSignalLimit,
    extraRevokeLimit: user.extraRevokeLimit,
    revokesUsed: user.revokesUsed,
    receivedCount: stats.receivedCount,
    signalLimit: stats.signalLimit,
    openSignalLimit: stats.openSignalLimit,
    revokeLimit: stats.revokeLimit,
    signalRemaining: stats.signalRemaining,
    openSignalRemaining: stats.openSignalRemaining,
    revokeRemaining: stats.revokeRemaining
  };
}

function isApprovedUser(user) {
  return user && user.status === USER_STATUS_APPROVED;
}

function hasSignalBetween(room, from, to) {
  return room.likes.some((like) => like.from === from && like.to === to);
}

function isMatchedPair(room, userId, targetId) {
  return hasSignalBetween(room, userId, targetId) && hasSignalBetween(room, targetId, userId);
}

function hasSignalType(room, from, to, type) {
  return room.likes.some((like) => like.from === from && like.to === to && like.type === type);
}

function matchTime(room, userId, matchedUserId) {
  const timestamps = room.likes
    .filter(
      (like) =>
        (like.from === userId && like.to === matchedUserId) ||
        (like.from === matchedUserId && like.to === userId)
    )
    .map((like) => new Date(like.createdAt).getTime())
    .filter((time) => Number.isFinite(time));

  if (!timestamps.length) return new Date().toISOString();
  return new Date(Math.max(...timestamps)).toISOString();
}

function matchPayload(room, userId) {
  const sentTo = new Set(room.likes.filter((like) => like.from === userId).map((like) => like.to));
  const matchedUserIds = new Set();
  return room.likes
    .filter((like) => like.to === userId && sentTo.has(like.from))
    .map((like) => room.users.find((user) => user.id === like.from))
    .filter(Boolean)
    .filter((user) => {
      if (matchedUserIds.has(user.id)) return false;
      matchedUserIds.add(user.id);
      return true;
    })
    .map((user) => ({
      id: user.id,
      nickname: user.nickname,
      statusMessage: cleanText(user.statusMessage, 120),
      affiliationLabel: affiliationLabel(user),
      contact: user.contact,
      matchedAt: matchTime(room, userId, user.id)
    }));
}

function effectiveSignalLimit(room, user) {
  return room.settings.signalLimit + positiveInt(user.extraSignalLimit, 0);
}

function effectiveOpenSignalLimit(room, user) {
  return room.settings.openSignalLimit + positiveInt(user.extraOpenSignalLimit, 0);
}

function effectiveRevokeLimit(room, user) {
  return room.settings.revokeLimit + positiveInt(user.extraRevokeLimit, 0);
}

function statsPayload(room, userId) {
  const user = room.users.find((entry) => entry.id === userId) || {};
  const signalLimit = effectiveSignalLimit(room, user);
  const openSignalLimit = effectiveOpenSignalLimit(room, user);
  const revokeLimit = effectiveRevokeLimit(room, user);
  const revokesUsed = positiveInt(user.revokesUsed, 0);
  const sentSignalCount = room.likes.filter(
    (like) => like.from === userId && like.type === SIGNAL
  ).length;
  const sentOpenSignalCount = room.likes.filter(
    (like) => like.from === userId && like.type === OPEN_SIGNAL
  ).length;
  const receivedCount = receivedSignalCount(room, userId);
  const receivedSignals = room.likes
    .filter((like) => like.to === userId && like.type === SIGNAL)
    .map((like) => ({
      sentAt: like.createdAt
    }));
  const openSignals = room.likes
    .filter((like) => like.to === userId && like.type === OPEN_SIGNAL)
    .map((like) => {
      const sender = room.users.find((entry) => entry.id === like.from);
      if (!sender) return null;
      return {
        ...publicUser(sender),
        contact: sender.contact,
        note: like.note,
        sentAt: like.createdAt
      };
    })
    .filter(Boolean);

  return {
    receivedCount,
    sentSignalCount,
    sentOpenSignalCount,
    signalLimit,
    openSignalLimit,
    revokeLimit,
    revokesUsed,
    signalRemaining: Math.max(0, signalLimit - sentSignalCount),
    openSignalRemaining: Math.max(0, openSignalLimit - sentOpenSignalCount),
    revokeRemaining: Math.max(0, revokeLimit - revokesUsed),
    receivedSignals,
    openSignals
  };
}

function parseTags(body) {
  return normalizeTags(body.tags || {});
}

function findRoom(store, code) {
  return store.rooms.find((room) => room.code === code);
}

async function requireRoom(req, res) {
  let store;
  try {
    store = await readStore();
  } catch (error) {
    if (error instanceof DatabaseMissingError) {
      sendError(res, 503, "데이터 저장소가 아직 준비되지 않았습니다. 관리자에게 문의해주세요.");
      return null;
    }
    throw error;
  }
  const code = cleanHeaderText(req.headers["x-event-code"], 80);
  const room = findRoom(store, code);
  if (!room) {
    sendError(res, 403, "입장 코드가 올바르지 않습니다.");
    return null;
  }
  return { store, room };
}

async function requireAdmin(req, res) {
  const key = cleanHeaderText(req.headers["x-admin-key"], 120);
  const isEnvironmentKey = ADMIN_KEY && key === ADMIN_KEY;
  let store;
  try {
    store = await readStore({ allowBootstrap: isEnvironmentKey });
  } catch (error) {
    if (error instanceof DatabaseMissingError) {
      sendError(res, 503, "데이터 저장소가 아직 준비되지 않았습니다. Render의 ADMIN_KEY로 다시 접속해주세요.");
      return null;
    }
    throw error;
  }
  const isSavedKey = store.settings.adminKeyHash && verifyPassword(key, store.settings.adminKeyHash);
  if (!isSavedKey && !isEnvironmentKey) {
    sendError(res, 401, "관리자 코드가 올바르지 않습니다.");
    return null;
  }
  return store;
}

function roomFromAdminRequest(store, code) {
  return findRoom(store, cleanText(code, 80));
}

function storagePayload() {
  return {
    provider: USE_UPSTASH_STORE ? "upstash" : "file",
    databasePath: USE_UPSTASH_STORE ? `upstash:${UPSTASH_STORE_KEY}` : DATABASE_PATH,
    dataKeyPath: HAS_CONFIGURED_DATA_KEY ? "environment secret" : DATA_KEY_PATH,
    backupDir: USE_UPSTASH_STORE ? "upstash managed storage" : DATABASE_BACKUP_DIR,
    allowDatabaseBootstrap: ALLOW_DATABASE_BOOTSTRAP,
    isRender: IS_RENDER
  };
}

async function handleAdminStatus(req, res, url) {
  const store = await requireAdmin(req, res);
  if (!store) return;
  const code = cleanText(url.searchParams.get("roomCode"), 80);
  const room = code ? roomFromAdminRequest(store, code) : store.rooms[0];
  sendJson(res, 200, {
    rooms: store.rooms.map(roomSummary),
    room: room ? roomSummary(room) : null,
    users: room ? room.users.map((user) => adminUser(room, user)) : [],
    storage: storagePayload(),
    updatedAt: store.updatedAt
  });
}

async function handleCreateRoom(req, res) {
  const store = await requireAdmin(req, res);
  if (!store) return;
  const body = await readBody(req);
  const code = cleanText(body.code, 80);
  if (code.length < 4) {
    sendError(res, 400, "입장 코드는 4자 이상으로 설정해주세요.");
    return;
  }
  if (findRoom(store, code)) {
    sendError(res, 409, "이미 존재하는 입장 코드입니다.");
    return;
  }

  const room = createRoom(code, {
    settings: {
      signalLimit: body.signalLimit,
      openSignalLimit: body.openSignalLimit,
      revokeLimit: body.revokeLimit
    }
  });
  store.rooms.push(room);
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  sendJson(res, 200, { ok: true, room: roomSummary(room), rooms: store.rooms.map(roomSummary) });
}

async function handleAdminSettings(req, res) {
  const store = await requireAdmin(req, res);
  if (!store) return;
  const body = await readBody(req);
  const room = roomFromAdminRequest(store, body.roomCode);
  const nextCode = cleanText(body.eventCode, 80);
  const signalLimit = positiveInt(body.signalLimit, DEFAULT_ROOM_SETTINGS.signalLimit);
  const openSignalLimit = positiveInt(body.openSignalLimit, DEFAULT_ROOM_SETTINGS.openSignalLimit);
  const revokeLimit = positiveInt(body.revokeLimit, DEFAULT_ROOM_SETTINGS.revokeLimit);
  const newAdminKey = cleanText(body.newAdminKey, 120);

  if (!room) {
    sendError(res, 404, "룸을 찾을 수 없습니다.");
    return;
  }
  if (nextCode.length < 4) {
    sendError(res, 400, "입장 코드는 4자 이상으로 설정해주세요.");
    return;
  }
  if (store.rooms.some((entry) => entry.code === nextCode && entry.id !== room.id)) {
    sendError(res, 409, "이미 다른 룸에서 사용하는 입장 코드입니다.");
    return;
  }
  if (body.newAdminKey !== undefined && newAdminKey.length > 0 && newAdminKey.length < 4) {
    sendError(res, 400, "관리자 코드는 4자 이상으로 설정해주세요.");
    return;
  }

  const codeChanged = room.code !== nextCode;
  room.code = nextCode;
  room.settings.signalLimit = signalLimit;
  room.settings.openSignalLimit = openSignalLimit;
  room.settings.revokeLimit = revokeLimit;
  if (newAdminKey) {
    store.settings.adminKeyHash = hashPassword(newAdminKey);
  }
  if (codeChanged) {
    room.likes = [];
    room.users.forEach((user) => {
      user.extraSignalLimit = 0;
      user.extraOpenSignalLimit = 0;
      user.extraRevokeLimit = 0;
      user.revokesUsed = 0;
    });
  }
  room.updatedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  sendJson(res, 200, {
    ok: true,
    room: roomSummary(room),
    rooms: store.rooms.map(roomSummary),
    resetSignals: codeChanged,
    adminKeyChanged: Boolean(newAdminKey)
  });
}

async function handleGrant(req, res) {
  const store = await requireAdmin(req, res);
  if (!store) return;
  const body = await readBody(req);
  const room = roomFromAdminRequest(store, body.roomCode);
  const userId = cleanText(body.userId, 80);
  const addSignal = positiveInt(body.addSignal, 0);
  const addOpenSignal = positiveInt(body.addOpenSignal, 0);
  const addRevoke = positiveInt(body.addRevoke, 0);

  if (!room) {
    sendError(res, 404, "룸을 찾을 수 없습니다.");
    return;
  }
  const user = room.users.find((entry) => entry.id === userId);
  if (!user) {
    sendError(res, 404, "참가자를 찾을 수 없습니다.");
    return;
  }

  user.extraSignalLimit += addSignal;
  user.extraOpenSignalLimit += addOpenSignal;
  user.extraRevokeLimit += addRevoke;
  room.updatedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  sendJson(res, 200, { ok: true, user: adminUser(room, user) });
}

async function handleApproveUser(req, res) {
  const store = await requireAdmin(req, res);
  if (!store) return;
  const body = await readBody(req);
  const room = roomFromAdminRequest(store, body.roomCode);
  const userId = cleanText(body.userId, 80);

  if (!room) {
    sendError(res, 404, "룸을 찾을 수 없습니다.");
    return;
  }

  const user = room.users.find((entry) => entry.id === userId);
  if (!user) {
    sendError(res, 404, "참가자를 찾을 수 없습니다.");
    return;
  }

  user.status = USER_STATUS_APPROVED;
  user.approvedAt = new Date().toISOString();
  room.updatedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  sendJson(res, 200, { ok: true, user: adminUser(room, user) });
}

async function handleSession(req, res, store, room) {
  const body = await readBody(req);
  const nickname = cleanText(body.nickname, 32).replace(/\s+/g, " ");
  const statusMessage = cleanText(body.statusMessage, 120);
  const contact = cleanText(body.contact, 80);
  const password = cleanText(body.password, 120);
  const normalized = normalizeNickname(nickname);
  const tags = parseTags(body);

  if (!nickname || !contact || password.length < 4) {
    sendError(res, 400, "닉네임, 연락처, 4자 이상의 비밀번호를 입력해주세요.");
    return;
  }

  let user = room.users.find((entry) => entry.normalizedNickname === normalized);
  if (user) {
    if (!verifyPassword(password, user.passwordHash)) {
      sendError(res, 401, "이미 사용 중인 닉네임입니다. 비밀번호를 확인해주세요.");
      return;
    }
    user.contact = contact;
    user.statusMessage = statusMessage;
    user.tags = tags;
    user.affiliation = tags.groups[0] || "";
    user.affiliationDetail = "";
    user.lastSeenAt = new Date().toISOString();
  } else {
    user = {
      id: crypto.randomUUID(),
      nickname,
      normalizedNickname: normalized,
      contact,
      statusMessage,
      tags,
      affiliation: tags.groups[0] || "",
      affiliationDetail: "",
      extraSignalLimit: 0,
      extraOpenSignalLimit: 0,
      extraRevokeLimit: 0,
      revokesUsed: 0,
      status: USER_STATUS_PENDING,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    room.users.push(user);
  }

  room.updatedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  if (!isApprovedUser(user)) {
    sendJson(res, 200, {
      pending: true,
      user: privateUser(user),
      room: roomSummary(room),
      stats: null,
      matches: [],
      rankings: rankingPayload(room)
    });
    return;
  }

  sendJson(res, 200, {
    user: privateUser(user),
    room: roomSummary(room),
    stats: statsPayload(room, user.id),
    matches: matchPayload(room, user.id),
    rankings: rankingPayload(room)
  });
}

function peoplePayload(room, user) {
  const matches = matchPayload(room, user.id);
  const people = room.users
    .filter((entry) => entry.id !== user.id && isApprovedUser(entry))
    .map((entry) => {
      const signalSent = hasSignalType(room, user.id, entry.id, SIGNAL);
      const openSignalSent = hasSignalType(room, user.id, entry.id, OPEN_SIGNAL);
      return {
        ...publicUser(entry),
        signalSent,
        openSignalSent,
        signaled: signalSent || openSignalSent,
        synced: matches.some((match) => match.id === entry.id)
      };
    });

  return {
    user: privateUser(user),
    room: roomSummary(room),
    people,
    stats: statsPayload(room, user.id),
    matches,
    rankings: rankingPayload(room)
  };
}

async function handlePeople(req, res, room) {
  const userId = cleanText(req.headers["x-user-id"], 80);
  const user = room.users.find((entry) => entry.id === userId);
  if (!user) {
    sendError(res, 401, "다시 로그인해주세요.");
    return;
  }
  if (!isApprovedUser(user)) {
    sendError(res, 403, "관리자 승인을 받는중입니다.");
    return;
  }

  sendJson(res, 200, peoplePayload(room, user));
}

async function handleLikes(req, res, store, room) {
  const userId = cleanText(req.headers["x-user-id"], 80);
  const body = await readBody(req);
  const targetId = cleanText(body.targetId, 80);
  const type = body.type === OPEN_SIGNAL ? OPEN_SIGNAL : SIGNAL;
  const note = cleanText(body.note, 240);
  const user = room.users.find((entry) => entry.id === userId);
  const target = room.users.find((entry) => entry.id === targetId);

  if (!user || !target || user.id === target.id) {
    sendError(res, 400, "SIGNAL을 보낼 수 없습니다.");
    return;
  }
  if (!isApprovedUser(user)) {
    sendError(res, 403, "관리자 승인을 받는중입니다.");
    return;
  }
  if (!isApprovedUser(target)) {
    sendError(res, 400, "아직 승인되지 않은 참가자에게는 SIGNAL을 보낼 수 없습니다.");
    return;
  }
  if (hasSignalType(room, user.id, target.id, type)) {
    sendError(
      res,
      409,
      type === OPEN_SIGNAL
        ? "이미 이 닉네임에게 OPEN SIGNAL을 보냈습니다."
        : "이미 이 닉네임에게 SIGNAL을 보냈습니다."
    );
    return;
  }

  const stats = statsPayload(room, user.id);
  if (type === SIGNAL && stats.signalRemaining <= 0) {
    sendError(res, 400, "보낼 수 있는 SIGNAL을 모두 사용했습니다.");
    return;
  }
  if (type === OPEN_SIGNAL && stats.openSignalRemaining <= 0) {
    sendError(res, 400, "보낼 수 있는 OPEN SIGNAL을 모두 사용했습니다.");
    return;
  }

  room.likes.push({
    from: user.id,
    to: target.id,
    type,
    note: type === OPEN_SIGNAL ? note : "",
    createdAt: new Date().toISOString()
  });
  room.updatedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  await writeStore(store);

  sendJson(res, 200, {
    ok: true,
    type,
    synced: hasSignalBetween(room, target.id, user.id),
    target: publicUser(target),
    room: roomSummary(room),
    stats: statsPayload(room, user.id),
    matches: matchPayload(room, user.id)
  });
}

async function handleRevokeLike(req, res, store, room) {
  const userId = cleanText(req.headers["x-user-id"], 80);
  const body = await readBody(req);
  const targetId = cleanText(body.targetId, 80);
  const user = room.users.find((entry) => entry.id === userId);
  const target = room.users.find((entry) => entry.id === targetId);

  if (!user || !target || user.id === target.id) {
    sendError(res, 400, "SIGNAL을 회수할 수 없습니다.");
    return;
  }
  if (!isApprovedUser(user)) {
    sendError(res, 403, "관리자 승인을 받는중입니다.");
    return;
  }

  if (isMatchedPair(room, user.id, target.id)) {
    sendError(res, 400, "SYNC된 상대에게 보낸 SIGNAL은 회수할 수 없습니다.");
    return;
  }

  const stats = statsPayload(room, user.id);
  if (stats.revokeRemaining <= 0) {
    sendError(res, 400, "사용 가능한 SIGNAL 회수권이 없습니다.");
    return;
  }

  const likeIndex = room.likes.findIndex(
    (like) => like.from === user.id && like.to === target.id && like.type === SIGNAL
  );
  if (likeIndex === -1) {
    sendError(res, 404, "회수할 SIGNAL을 찾을 수 없습니다.");
    return;
  }

  room.likes.splice(likeIndex, 1);
  user.revokesUsed = positiveInt(user.revokesUsed, 0) + 1;
  room.updatedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  await writeStore(store);

  sendJson(res, 200, {
    ok: true,
    target: publicUser(target),
    room: roomSummary(room),
    stats: statsPayload(room, user.id),
    matches: matchPayload(room, user.id)
  });
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/check-code") {
    const body = await readBody(req);
    const code = cleanText(body.code, 80);
    const store = await readStore();
    const room = findRoom(store, code);
    sendJson(res, room ? 200 : 403, {
      ok: Boolean(room),
      room: room ? roomSummary(room) : null,
      message: room ? "입장 코드가 확인되었습니다." : "입장 코드가 올바르지 않습니다."
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/status") {
    await handleAdminStatus(req, res, url);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/rooms") {
    await handleCreateRoom(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/settings") {
    await handleAdminSettings(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/users/grant") {
    await handleGrant(req, res);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/users/approve") {
    await handleApproveUser(req, res);
    return;
  }

  const context = await requireRoom(req, res);
  if (!context) return;
  const { store, room } = context;

  if (req.method === "POST" && url.pathname === "/api/session") {
    await handleSession(req, res, store, room);
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/people") {
    await handlePeople(req, res, room);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/likes") {
    await handleLikes(req, res, store, room);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/likes/revoke") {
    await handleRevokeLike(req, res, store, room);
    return;
  }

  sendError(res, 404, "API를 찾을 수 없습니다.");
}

async function serveStatic(req, res, url) {
  const requestedPath =
    url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname;
  const filePath = path.resolve(path.join(PUBLIC_DIR, requestedPath));
  const publicRoot = path.resolve(PUBLIC_DIR);

  if (!filePath.startsWith(publicRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(ext === ".html" ? renderHtml(data.toString("utf8"), req) : data);
  } catch (error) {
    if (error.code === "ENOENT") {
      const data = await fs.readFile(path.join(PUBLIC_DIR, "index.html"), "utf8");
      res.writeHead(200, {
        "content-type": MIME_TYPES[".html"],
        "cache-control": "no-cache"
      });
      res.end(renderHtml(data, req));
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (error instanceof DatabaseMissingError) {
      sendError(res, 503, "데이터 저장소가 아직 준비되지 않았습니다. 관리자에게 문의해주세요.");
      return;
    }
    sendError(res, 500, "서버 오류가 발생했습니다.");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Games Sync is running at http://localhost:${PORT}`);
  console.log(`Admin key: ${ADMIN_KEY}`);
});
