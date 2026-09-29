import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("Apps Script: existing settings, separate markers, batching and retries", () => {
  const source = readFileSync("integrations/google-apps-script/sync-signup-alerts.gs", "utf8");
  let now = Date.now(), status = 200, pending = [], quota = 100, failSend = false, locked = false;
  const properties = { SIGNUP_ALERT_TOKEN: "a".repeat(64), ALERT_TO: "owner@example.com", "notified:old-hogamping-user": "1", LAST_ALERT_AT: String(now) };
  const mails = [], triggers = [];
  const props = {
    getProperty: (key) => properties[key] ?? null,
    getProperties: () => ({ ...properties }),
    deleteProperty: (key) => { delete properties[key]; },
    setProperties: (values) => Object.assign(properties, values)
  };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    PropertiesService: { getScriptProperties: () => props },
    UrlFetchApp: { fetch: (url, options) => {
      assert.equal(url, "https://games-sync.emile941205.workers.dev/api/notifications/signups");
      assert.equal(options.headers.Authorization, "Bearer " + (properties.SYNC_SIGNUP_ALERT_TOKEN || properties.SIGNUP_ALERT_TOKEN));
      assert.equal(options.followRedirects, false);
      return { getResponseCode: () => status, getContentText: () => JSON.stringify({ pending }) };
    } },
    LockService: { getScriptLock: () => ({ tryLock: () => { locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    MailApp: { getRemainingDailyQuota: () => quota, sendEmail: (mail) => { if (failSend) throw Error("send failed"); mails.push(JSON.parse(JSON.stringify(mail))); quota--; } },
    Utilities: { formatDate: () => "09/29 17:00" },
    ScriptApp: { getProjectTriggers: () => triggers, newTrigger: (name) => ({ timeBased: () => ({ everyMinutes: (minutes) => {
      assert.equal(minutes, 15); return { create: () => triggers.push({ getHandlerFunction: () => name }) };
    } }) }) },
    console: { log() {} }
  });
  vm.runInContext(source, context);
  const advance = () => { now += 15 * 60000; };
  const signup = (id, roomCode = "SYNC2026") => ({ id, roomCode, nickname: `회원${id}`, createdAt: now });
  status = 401;
  assert.throws(() => context.installSyncSignupAlerts(), /401/);
  assert.equal(triggers.length, 0);
  status = 200; pending = [signup("one"), signup("two", "OTHER-ROOM")];
  context.installSyncSignupAlerts();
  assert.equal(triggers.length, 1);
  assert.equal(triggers[0].getHandlerFunction(), "pollSyncSignupAlerts");
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, "[SYNC] 룸 입장 승인 요청 2건");
  assert.equal(mails[0].to, "owner@example.com");
  assert.ok(mails[0].body.includes("[SYNC2026] 회원one"));
  assert.ok(mails[0].body.includes("[OTHER-ROOM] 회원two"));
  assert.ok(mails[0].body.endsWith("https://games-sync.emile941205.workers.dev/admin"));
  assert.ok(!mails[0].body.includes(properties.SIGNUP_ALERT_TOKEN));
  assert.equal(properties["notified:old-hogamping-user"], "1");
  assert.equal(properties.LAST_ALERT_AT, String(now));
  context.installSyncSignupAlerts();
  advance(); context.pollSyncSignupAlerts();
  assert.equal(triggers.length, 1);
  assert.equal(mails.length, 1);
  pending.push(signup("three")); quota = 0; context.pollSyncSignupAlerts();
  assert.equal(properties["sync:notified:three"], undefined);
  quota = 100; failSend = true;
  assert.throws(() => context.pollSyncSignupAlerts(), /send failed/);
  assert.equal(locked, false);
  assert.equal(properties["sync:notified:three"], undefined);
  failSend = false; context.pollSyncSignupAlerts();
  assert.equal(mails.length, 2);
  pending.push(signup("four")); context.pollSyncSignupAlerts();
  assert.equal(mails.length, 2);
  advance(); status = 503;
  assert.throws(() => context.pollSyncSignupAlerts(), /503/);
  assert.equal(properties["sync:notified:one"], "1");
  status = 200; pending = [{ id: "bad", nickname: "bad", roomCode: "ROOM", createdAt: "invalid" }];
  assert.throws(() => context.pollSyncSignupAlerts(), /응답 형식/);
  assert.equal(properties["sync:notified:one"], "1");
  pending = []; context.pollSyncSignupAlerts();
  assert.equal(properties["sync:notified:one"], undefined);
  assert.equal(properties["notified:old-hogamping-user"], "1");
  properties.SYNC_SIGNUP_ALERT_TOKEN = "b".repeat(64);
  context.testSyncSignupAlerts();
  assert.equal(mails.at(-1).subject, "[SYNC] 승인 알림 연결 테스트");
});
