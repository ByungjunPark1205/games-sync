import { DurableObject } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import application from "../application.cjs";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CHUNK_SIZE = 128 * 1024;

function jsonError(status, error) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

async function readRequestBody(request) {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}

export class GameStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS encrypted_store (part INTEGER PRIMARY KEY, payload TEXT NOT NULL)");
    this.application = application.createApplication({
      env,
      storage: {
        read: async () => {
          const parts = sql.exec("SELECT payload FROM encrypted_store ORDER BY part").toArray();
          return parts.length ? parts.map((part) => part.payload).join("") : null;
        },
        write: async (payload) => {
          // Keep banner-heavy stores below SQLite's per-value limit. Replace all
          // chunks atomically, so a failed write cannot leave a partial database.
          ctx.storage.transactionSync(() => {
            sql.exec("DELETE FROM encrypted_store");
            for (let offset = 0, part = 0; offset < payload.length; offset += CHUNK_SIZE, part++) {
              sql.exec("INSERT INTO encrypted_store (part, payload) VALUES (?, ?)", part, payload.slice(offset, offset + CHUNK_SIZE));
            }
          });
        }
      }
    });
  }

  async fetch(request) {
    // Read uploads before entering the lock; a slow client must not block the room.
    const body = await readRequestBody(request);
    if (body === null) return jsonError(413, "요청 본문이 너무 큽니다.");

    // Each request reads and rewrites the encrypted store. Serialize the whole
    // operation, including async crypto and notifications, to prevent lost updates.
    return this.ctx.blockConcurrencyWhile(async () => {
      const url = new URL(request.url);
      const req = {
        method: request.method,
        url: url.pathname + url.search,
        headers: {
          ...Object.fromEntries(request.headers),
          host: url.host,
          "x-forwarded-host": url.host,
          "x-forwarded-proto": url.protocol.slice(0, -1)
        },
        async *[Symbol.asyncIterator]() { if (body.length) yield body; }
      };
      let response;
      let status = 200;
      let headers = {};
      const res = {
        writeHead(code, values = {}) { status = code; headers = values; },
        end(value) { response = new Response(value, { status, headers }); }
      };
      await this.application.handleRequest(req, res);
      return response || jsonError(500, "서버 응답을 생성하지 못했습니다.");
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!env.ADMIN_KEY || env.ADMIN_KEY === "games-admin" || !env.DATA_ENCRYPTION_KEY) {
        return jsonError(503, "관리자가 ADMIN_KEY와 DATA_ENCRYPTION_KEY를 설정해야 합니다.");
      }
      return env.GAME_STORE.get(env.GAME_STORE.idFromName("games-sync")).fetch(request);
    }

    const pages = {
      "/": "/index.html",
      "/index.html": "/index.html",
      "/admin": "/admin.html",
      "/admin/": "/admin.html",
      "/admin.html": "/admin.html"
    };
    if (!pages[url.pathname]) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const assetUrl = new URL(url);
    assetUrl.pathname = pages[url.pathname];
    const asset = await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }));
    if (!asset.ok) return asset;
    const html = (await asset.text()).replaceAll("__APP_ORIGIN__", url.origin);
    return new Response(request.method === "HEAD" ? null : html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" }
    });
  }
};
