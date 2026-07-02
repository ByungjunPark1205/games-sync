const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_KEY = process.env.ADMIN_KEY || "games-admin";
const STORE_PATH = process.env.STORE_PATH || path.join(__dirname, "data", "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const SIGNAL = "signal";
const OPEN_SIGNAL = "open";
const AFFILIATIONS = new Set(["Games", "동물원", "수녀원"]);

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
  openSignalLimit: 1
};

const DEFAULT_STORE = {
  settings: {
    adminKeyHash: null
  },
  rooms: [createRoom("SYNC2026")],
  updatedAt: new Date().toISOString()
};

function createRoom(code, values = {}) {
  return {
    id: values.id || crypto.randomUUID(),
    code,
    settings: {
      signalLimit: positiveInt(values.settings?.signalLimit, DEFAULT_ROOM_SETTINGS.signalLimit),
      openSignalLimit: positiveInt(
        values.settings?.openSignalLimit,
        DEFAULT_ROOM_SETTINGS.openSignalLimit
      )
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

function affiliationLabel(user) {
  if (AFFILIATIONS.has(user.affiliation)) return user.affiliation;
  if (user.affiliationDetail) return user.affiliationDetail;
  return "소속 미입력";
}

function normalizeUser(user) {
  user.extraSignalLimit = positiveInt(user.extraSignalLimit, 0);
  user.extraOpenSignalLimit = positiveInt(user.extraOpenSignalLimit, 0);
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
    )
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

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return normalizeStore(JSON.parse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const store = normalizeStore(DEFAULT_STORE);
    await writeStore(store);
    return store;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(normalizeStore(store), null, 2), "utf8");
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
    affiliationLabel: affiliationLabel(user),
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
    usersCount: room.users.length,
    likesCount: room.likes.length,
    updatedAt: room.updatedAt
  };
}

function adminUser(room, user) {
  const stats = statsPayload(room, user.id);
  return {
    ...publicUser(user),
    contact: user.contact,
    extraSignalLimit: user.extraSignalLimit,
    extraOpenSignalLimit: user.extraOpenSignalLimit,
    receivedCount: stats.receivedCount,
    signalLimit: stats.signalLimit,
    openSignalLimit: stats.openSignalLimit,
    signalRemaining: stats.signalRemaining,
    openSignalRemaining: stats.openSignalRemaining
  };
}

function hasSignalBetween(room, from, to) {
  return room.likes.some((like) => like.from === from && like.to === to);
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

function statsPayload(room, userId) {
  const user = room.users.find((entry) => entry.id === userId) || {};
  const signalLimit = effectiveSignalLimit(room, user);
  const openSignalLimit = effectiveOpenSignalLimit(room, user);
  const sentSignalCount = room.likes.filter(
    (like) => like.from === userId && like.type === SIGNAL
  ).length;
  const sentOpenSignalCount = room.likes.filter(
    (like) => like.from === userId && like.type === OPEN_SIGNAL
  ).length;
  const receivedCount = new Set(
    room.likes.filter((like) => like.to === userId).map((like) => like.from)
  ).size;
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
    signalRemaining: Math.max(0, signalLimit - sentSignalCount),
    openSignalRemaining: Math.max(0, openSignalLimit - sentOpenSignalCount),
    receivedSignals,
    openSignals
  };
}

function parseAffiliation(body) {
  const affiliation = cleanText(body.affiliation, 24);
  const affiliationDetail = cleanText(body.affiliationDetail, 80);
  if (AFFILIATIONS.has(affiliation)) {
    return { affiliation, affiliationDetail: "" };
  }
  if (!affiliationDetail) {
    return null;
  }
  return { affiliation: "", affiliationDetail };
}

function findRoom(store, code) {
  return store.rooms.find((room) => room.code === code);
}

async function requireRoom(req, res) {
  const store = await readStore();
  const code = cleanHeaderText(req.headers["x-event-code"], 80);
  const room = findRoom(store, code);
  if (!room) {
    sendError(res, 403, "입장 코드가 올바르지 않습니다.");
    return null;
  }
  return { store, room };
}

async function requireAdmin(req, res) {
  const store = await readStore();
  const key = cleanHeaderText(req.headers["x-admin-key"], 120);
  const isSavedKey = store.settings.adminKeyHash && verifyPassword(key, store.settings.adminKeyHash);
  const isBootstrapKey = !store.settings.adminKeyHash && key === ADMIN_KEY;
  if (!isSavedKey && !isBootstrapKey) {
    sendError(res, 401, "관리자 코드가 올바르지 않습니다.");
    return null;
  }
  return store;
}

function roomFromAdminRequest(store, code) {
  return findRoom(store, cleanText(code, 80));
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
      openSignalLimit: body.openSignalLimit
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
  if (newAdminKey) {
    store.settings.adminKeyHash = hashPassword(newAdminKey);
  }
  if (codeChanged) {
    room.likes = [];
    room.users.forEach((user) => {
      user.extraSignalLimit = 0;
      user.extraOpenSignalLimit = 0;
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
  room.updatedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  sendJson(res, 200, { ok: true, user: adminUser(room, user) });
}

async function handleSession(req, res, store, room) {
  const body = await readBody(req);
  const nickname = cleanText(body.nickname, 32).replace(/\s+/g, " ");
  const contact = cleanText(body.contact, 80);
  const password = cleanText(body.password, 120);
  const normalized = normalizeNickname(nickname);
  const affiliation = parseAffiliation(body);

  if (!nickname || !contact || password.length < 4) {
    sendError(res, 400, "닉네임, 연락처, 4자 이상의 비밀번호를 입력해주세요.");
    return;
  }
  if (!affiliation) {
    sendError(res, 400, "소속을 선택하거나 어떤 소속의 누구 지인인지 적어주세요.");
    return;
  }

  let user = room.users.find((entry) => entry.normalizedNickname === normalized);
  if (user) {
    if (!verifyPassword(password, user.passwordHash)) {
      sendError(res, 401, "이미 사용 중인 닉네임입니다. 비밀번호를 확인해주세요.");
      return;
    }
    user.contact = contact;
    user.affiliation = affiliation.affiliation;
    user.affiliationDetail = affiliation.affiliationDetail;
    user.lastSeenAt = new Date().toISOString();
  } else {
    user = {
      id: crypto.randomUUID(),
      nickname,
      normalizedNickname: normalized,
      contact,
      affiliation: affiliation.affiliation,
      affiliationDetail: affiliation.affiliationDetail,
      extraSignalLimit: 0,
      extraOpenSignalLimit: 0,
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    room.users.push(user);
  }

  room.updatedAt = new Date().toISOString();
  store.updatedAt = new Date().toISOString();
  await writeStore(store);
  sendJson(res, 200, {
    user: privateUser(user),
    room: roomSummary(room),
    stats: statsPayload(room, user.id),
    matches: matchPayload(room, user.id)
  });
}

function peoplePayload(room, user) {
  const matches = matchPayload(room, user.id);
  const people = room.users
    .filter((entry) => entry.id !== user.id)
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
    matches
  };
}

async function handlePeople(req, res, room) {
  const userId = cleanText(req.headers["x-user-id"], 80);
  const user = room.users.find((entry) => entry.id === userId);
  if (!user) {
    sendError(res, 401, "다시 로그인해주세요.");
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
    sendError(res, 500, "서버 오류가 발생했습니다.");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Games Sync is running at http://localhost:${PORT}`);
  console.log(`Admin key: ${ADMIN_KEY}`);
});
