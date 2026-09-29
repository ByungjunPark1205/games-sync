// Add as Sync.gs in the existing private approval-email Apps Script project.
// Reuses ALERT_TO and SIGNUP_ALERT_TOKEN; an optional SYNC_SIGNUP_ALERT_TOKEN
// overrides the token if SYNC uses a different credential. No web-app deployment.
const SYNC_ALERT_URL = 'https://games-sync.emile941205.workers.dev';
const SYNC_ALERT_INTERVAL = 15 * 60 * 1000;

function syncAlertConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('SYNC_SIGNUP_ALERT_TOKEN') || properties.getProperty('SIGNUP_ALERT_TOKEN');
  const recipient = properties.getProperty('ALERT_TO');
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new Error('SYNC의 SIGNUP_ALERT_TOKEN과 같은 값을 스크립트 속성에 설정해주세요.');
  if (!recipient || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(recipient)) throw new Error('ALERT_TO에 받을 이메일 하나를 설정해주세요.');
  return { properties, token, recipient };
}

function fetchSyncPending_(token) {
  const response = UrlFetchApp.fetch(SYNC_ALERT_URL + '/api/notifications/signups', {
    headers: { Authorization: 'Bearer ' + token },
    followRedirects: false,
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error('SYNC 승인 알림 연결 실패: HTTP ' + response.getResponseCode());
  const data = JSON.parse(response.getContentText());
  if (!Array.isArray(data.pending) || data.pending.some(function (item) {
    return typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) ||
      typeof item.roomCode !== 'string' || typeof item.nickname !== 'string' || !Number.isFinite(item.createdAt);
  })) throw new Error('SYNC 승인 알림 응답 형식을 확인해주세요.');
  return data.pending;
}

function installSyncSignupAlerts() {
  const config = syncAlertConfig_();
  fetchSyncPending_(config.token);
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'pollSyncSignupAlerts';
  });
  if (!exists) ScriptApp.newTrigger('pollSyncSignupAlerts').timeBased().everyMinutes(15).create();
  pollSyncSignupAlerts();
  console.log('SYNC 승인 알림 연결 완료. 15분 간격으로 확인합니다.');
}

function pollSyncSignupAlerts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const config = syncAlertConfig_();
    const pending = fetchSyncPending_(config.token);
    const saved = config.properties.getProperties();
    const prefix = 'sync:notified:';
    const currentIds = new Set(pending.map(function (item) { return item.id; }));
    Object.keys(saved).filter(function (key) { return key.indexOf(prefix) === 0 && !currentIds.has(key.slice(prefix.length)); })
      .forEach(function (key) { config.properties.deleteProperty(key); });
    const fresh = pending.filter(function (item) { return !saved[prefix + item.id]; }).slice(0, 500);
    if (!fresh.length) return;
    const now = Date.now();
    if (now - Number(saved.SYNC_LAST_ALERT_AT || 0) < SYNC_ALERT_INTERVAL) return;
    if (MailApp.getRemainingDailyQuota() < 1) {
      console.log('오늘 메일 한도를 사용했습니다. 다음 실행에서 다시 확인합니다.');
      return;
    }
    const lines = fresh.map(function (item) {
      return '- [' + item.roomCode + '] ' + item.nickname + ' (' + Utilities.formatDate(new Date(item.createdAt), 'Asia/Seoul', 'MM/dd HH:mm') + ')';
    });
    MailApp.sendEmail({
      to: config.recipient,
      name: 'SYNC 승인 알림',
      subject: '[SYNC] 룸 입장 승인 요청 ' + fresh.length + '건',
      body: '새 룸 입장 신청이 있습니다.\n\n' + lines.join('\n') + '\n\n관리자 페이지에서 승인해주세요.\n' + SYNC_ALERT_URL + '/admin',
    });
    const updates = { SYNC_LAST_ALERT_AT: String(now) };
    fresh.forEach(function (item) { updates[prefix + item.id] = '1'; });
    config.properties.setProperties(updates, false);
    console.log('SYNC 승인 알림 발송 완료: ' + fresh.length + '건');
  } finally {
    lock.releaseLock();
  }
}

function testSyncSignupAlerts() {
  const config = syncAlertConfig_();
  fetchSyncPending_(config.token);
  if (MailApp.getRemainingDailyQuota() < 1) throw new Error('오늘 메일 발송 한도를 사용했습니다.');
  MailApp.sendEmail({
    to: config.recipient,
    name: 'SYNC 승인 알림',
    subject: '[SYNC] 승인 알림 연결 테스트',
    body: 'SYNC 승인 알림 연결이 정상입니다. 새 룸 입장 요청은 15분 간격으로 확인해 모아서 알려드립니다.\n\n관리자 페이지\n' + SYNC_ALERT_URL + '/admin',
  });
  console.log('SYNC 테스트 메일 발송 완료. 설정한 수신함에서 확인해주세요.');
}
