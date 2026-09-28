import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const config = JSON.parse(await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const adminKey = randomBytes(24).toString("hex");
const encryptionKey = randomBytes(32).toString("hex");

test("Cloudflare runtime: routes, authentication, matching, concurrency and persistence", async (t) => {
  const persist = await mkdtemp(path.join(tmpdir(), "games-sync-test-"));
  const options = {
    name: config.name,
    modules: true,
    scriptPath: "dist/worker.js",
    compatibilityDate: config.compatibility_date,
    compatibilityFlags: config.compatibility_flags,
    durableObjects: { GAME_STORE: { className: "GameStore", useSQLite: true } },
    resourcePersistencePath: persist,
    bindings: { ADMIN_KEY: adminKey, DATA_ENCRYPTION_KEY: encryptionKey, ALLOW_DATABASE_BOOTSTRAP: "false" },
    assets: {
      directory: "public", binding: "ASSETS", run_worker_first: config.assets.run_worker_first,
      routerConfig: { has_user_worker: true }, assetConfig: { html_handling: "none" }
    }
  };
  let mf = new Miniflare(convertV4MiniflareOptions(options));
  t.after(async () => { await mf.dispose(); });
  const request = (route, init) => mf.dispatchFetch(`https://games-sync.test${route}`, init);
  async function api(route, { body, userId, admin = false, ...init } = {}) {
    const response = await request(route, {
      ...init,
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-event-code": "SYNC2026", ...(userId && { "x-user-id": userId }), ...(admin && { "x-admin-key": adminKey }) },
      ...(body !== undefined && { body: JSON.stringify(body) })
    });
    return { status: response.status, data: await response.json() };
  }

  await t.test("HTML origins, admin routes and static assets", async () => {
    for (const route of ["/", "/index.html", "/admin", "/admin/", "/admin.html"]) {
      const response = await request(route);
      assert.equal(response.status, 200, route);
      const html = await response.text();
      assert.ok(html.includes("<html"));
      assert.ok(!html.includes("__APP_ORIGIN__"));
      if (route === "/") assert.ok(html.includes("https://games-sync.test"));
    }
    for (const route of ["/app.js", "/styles.css", "/fonts/NanumSquareNeo-Variable.ttf", "/images/og-sync.png"]) {
      const response = await request(route);
      assert.equal(response.status, 200, route);
      await response.arrayBuffer();
    }
    assert.equal((await request("/missing.js")).status, 404);
    const head = await request("/admin", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });

  await t.test("only configured admin can initialize empty storage", async () => {
    assert.equal((await api("/api/check-code", { body: { code: "SYNC2026" } })).status, 503);
    assert.equal((await api("/api/admin/status")).status, 503);
    const initialized = await api("/api/admin/status", { admin: true });
    assert.equal(initialized.status, 200);
    assert.equal(initialized.data.storage.provider, "cloudflare-durable-object");
    assert.equal(initialized.data.users.length, 0);
    assert.equal((await api("/api/admin/status")).status, 401);
    assert.equal((await api("/api/check-code", { body: { code: "SYNC2026" } })).status, 200);
    assert.equal((await api("/api/check-code", { body: { code: "wrong" } })).status, 403);
  });

  let alice;
  let bob;
  await t.test("concurrent registrations keep every participant and password", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => api("/api/session", {
      body: { nickname: `참가자${i}`, contact: `test-contact-${i}`, password: "testing-only-password", tags: { groups: ["Games"] } }
    })));
    for (const result of results) {
      assert.equal(result.status, 200, JSON.stringify(result.data));
      assert.equal(result.data.pending, true);
    }
    [alice, bob] = results.map((result) => result.data.user);
    const status = await api("/api/admin/status", { admin: true });
    assert.equal(status.data.users.length, 8);
    assert.equal((await api("/api/session", { body: { nickname: "참가자0", contact: "test-contact-0", password: "wrong" } })).status, 401);
    assert.equal((await api("/api/likes", { userId: alice.id, body: { targetId: bob.id, type: "signal" } })).status, 403);
  });

  await t.test("approval and simultaneous mutual SIGNAL create SYNC", async () => {
    for (const user of [alice, bob]) {
      assert.equal((await api("/api/admin/users/approve", { admin: true, body: { roomCode: "SYNC2026", userId: user.id } })).status, 200);
    }
    const results = await Promise.all([
      api("/api/likes", { userId: alice.id, body: { targetId: bob.id, type: "signal" } }),
      api("/api/likes", { userId: bob.id, body: { targetId: alice.id, type: "signal" } })
    ]);
    for (const result of results) assert.equal(result.status, 200);
    const people = await api("/api/people", { userId: alice.id });
    assert.equal(people.data.matches.length, 1);
    assert.equal((await api("/api/likes", { userId: alice.id, body: { targetId: bob.id, type: "signal" } })).status, 409);
  });

  await t.test("malformed and oversized bodies have client error responses", async () => {
    for (const body of ["{", "null", "[]"]) {
      assert.equal((await request("/api/check-code", { method: "POST", body })).status, 400);
    }
    assert.equal((await request("/api/check-code", { method: "POST", body: "a".repeat(2 * 1024 * 1024 + 1) })).status, 413);
  });

  await t.test("encrypted records and SYNC survive runtime restart", async () => {
    await mf.dispose();
    const files = await readdir(persist, { recursive: true, withFileTypes: true });
    const databaseFiles = files.filter((entry) => entry.isFile() && /sqlite/.test(entry.name));
    assert.ok(databaseFiles.length > 0);
    for (const entry of databaseFiles) {
      const bytes = await readFile(path.join(entry.parentPath, entry.name));
      assert.ok(!bytes.includes(Buffer.from("test-contact-0")), "contact must be encrypted on disk");
    }
    mf = new Miniflare(convertV4MiniflareOptions(options));
    assert.equal((await api("/api/admin/status", { admin: true })).data.users.length, 8);
    assert.equal((await api("/api/people", { userId: alice.id })).data.matches.length, 1);
    const login = await api("/api/session", { body: { nickname: "참가자0", contact: "test-contact-0", password: "testing-only-password" } });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.id, alice.id);
  });

  await t.test("missing secrets fail closed", async () => {
    await mf.dispose();
    mf = new Miniflare(convertV4MiniflareOptions({ ...options, bindings: {} }));
    assert.equal((await api("/api/admin/status", { admin: true })).status, 503);
  });
});
