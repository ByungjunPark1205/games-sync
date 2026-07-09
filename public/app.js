const SIGNAL = "signal";
const OPEN_SIGNAL = "open";

const state = {
  code: sessionStorage.getItem("gamesSyncCode") || "",
  user: null,
  room: null,
  people: [],
  matches: [],
  rankings: [],
  circles: { active: null, myCircle: null },
  stats: null,
  section: "home",
  selectedPersonId: null
};

let approvalTimer = null;
let contactFitFrame = null;

const $ = (selector) => document.querySelector(selector);

const elements = {
  gateView: $("#gateView"),
  loginView: $("#loginView"),
  pendingView: $("#pendingView"),
  homeView: $("#homeView"),
  profileView: $("#profileView"),
  homeContent: $("#homeContent"),
  notificationsView: $("#notificationsView"),
  rankingView: $("#rankingView"),
  circleView: $("#circleView"),
  gateForm: $("#gateForm"),
  loginForm: $("#loginForm"),
  backToCodeButton: $("#backToCodeButton"),
  pendingBackToCodeButton: $("#pendingBackToCodeButton"),
  pendingRefreshButton: $("#pendingRefreshButton"),
  roomBackToCodeButton: $("#roomBackToCodeButton"),
  eventCode: $("#eventCode"),
  gateError: $("#gateError"),
  nickname: $("#nickname"),
  statusMessage: $("#statusMessage"),
  tagInputs: Array.from(document.querySelectorAll("input[name='groupTags'], input[name='seekingTags']")),
  profileTagInputs: Array.from(document.querySelectorAll("input[name='profileGroupTags'], input[name='profileSeekingTags']")),
  contact: $("#contact"),
  password: $("#password"),
  statsPanel: $("#statsPanel"),
  peopleList: $("#peopleList"),
  notificationList: $("#notificationList"),
  rankingList: $("#rankingList"),
  myCirclePanel: $("#myCirclePanel"),
  circleList: $("#circleList"),
  profileNickname: $("#profileNickname"),
  profileAffiliation: $("#profileAffiliation"),
  profileStatusMessage: $("#profileStatusMessage"),
  profileContact: $("#profileContact"),
  profileCode: $("#profileCode"),
  profileEditForm: $("#profileEditForm"),
  profileEditStatusMessage: $("#profileEditStatusMessage"),
  profileEditContact: $("#profileEditContact"),
  profileEditStatus: $("#profileEditStatus"),
  personDetailSheet: $("#personDetailSheet"),
  personDetailContent: $("#personDetailContent"),
  personDetailClose: $("#personDetailClose"),
  signalGuide: $("#signalGuide"),
  signalGuideClose: $("#signalGuideClose"),
  refreshButton: $("#refreshButton"),
  profileRefreshButton: $("#profileRefreshButton"),
  notificationRefreshButton: $("#notificationRefreshButton"),
  rankingRefreshButton: $("#rankingRefreshButton"),
  circleRefreshButton: $("#circleRefreshButton"),
  profileNav: $("#profileNav"),
  homeNav: $("#homeNav"),
  rankingNav: $("#rankingNav"),
  circleNav: $("#circleNav"),
  alertsNav: $("#alertsNav"),
  toast: $("#toast")
};

function showToast() {
  elements.toast.classList.add("hidden");
}

function showGateError(message = "") {
  elements.gateError.textContent = message;
  elements.gateError.classList.toggle("hidden", !message);
}

function showProfileEditStatus(message = "", isError = false) {
  elements.profileEditStatus.textContent = message;
  elements.profileEditStatus.classList.toggle("hidden", !message);
  elements.profileEditStatus.classList.toggle("success-text", Boolean(message && !isError));
}

function userStorageKey(code = state.code) {
  return `gamesSyncUser:${code}`;
}

function loadSavedUserForCode(code) {
  return JSON.parse(localStorage.getItem(userStorageKey(code)) || "null");
}

function saveCurrentUser() {
  if (state.code && state.user) {
    localStorage.setItem(userStorageKey(), JSON.stringify(state.user));
  }
}

function emptyTags() {
  return { roles: [], groups: [], seeking: [] };
}

function getSelectedTags() {
  return getTagsFromInputs(elements.tagInputs);
}

function getProfileSelectedTags() {
  return getTagsFromInputs(elements.profileTagInputs, {
    groupName: "profileGroupTags",
    seekingName: "profileSeekingTags"
  });
}

function getTagsFromInputs(inputs, names = { groupName: "groupTags", seekingName: "seekingTags" }) {
  return inputs.reduce((tags, input) => {
    if (!input.checked) return tags;
    if (input.name === names.groupName) tags.groups.push(input.value);
    if (input.name === names.seekingName) tags.seeking.push(input.value);
    return tags;
  }, emptyTags());
}

function setSelectedTags(tags = emptyTags()) {
  setTagsToInputs(elements.tagInputs, tags);
}

function setProfileSelectedTags(tags = emptyTags()) {
  setTagsToInputs(elements.profileTagInputs, tags, {
    groupName: "profileGroupTags",
    seekingName: "profileSeekingTags"
  });
}

function setTagsToInputs(inputs, tags = emptyTags(), names = { groupName: "groupTags", seekingName: "seekingTags" }) {
  inputs.forEach((input) => {
    const key = input.name === names.groupName ? "groups" : "seeking";
    input.checked = Array.isArray(tags[key]) && tags[key].includes(input.value);
  });
}

function tagsText(tags = emptyTags()) {
  const labels = [...(tags.groups || []), ...(tags.seeking || [])];
  return labels.length ? labels.join(" · ") : "태그 미선택";
}

function fillLoginFormFromUser(user = {}) {
  elements.nickname.value = user.nickname || "";
  elements.statusMessage.value = user.statusMessage || "";
  elements.contact.value = user.contact || "";
  const savedTags = user.tags || emptyTags();
  if ((!savedTags.groups || !savedTags.groups.length) && user.affiliation) {
    savedTags.groups = [user.affiliation];
  }
  setSelectedTags(savedTags);
}

function fallbackToLogin(message = "저장된 접속 정보가 만료됐어요. 비밀번호로 다시 입장해주세요.") {
  const savedUser = state.user || loadSavedUserForCode(state.code) || {};
  state.user = null;
  state.people = [];
  state.matches = [];
  state.rankings = [];
  state.circles = { active: null, myCircle: null };
  state.stats = null;
  state.selectedPersonId = null;
  elements.personDetailSheet.classList.add("hidden");
  fillLoginFormFromUser(savedUser);
  setView("login");
  showToast(message);
}

function signalGuideKey() {
  return `gamesSyncSignalGuide:${state.code}:${state.user?.id || "guest"}`;
}

function maybeShowSignalGuide() {
  if (!state.code || !state.user?.id || state.user.status === "pending") return;
  if (localStorage.getItem(signalGuideKey()) === "seen") return;
  elements.signalGuide.classList.remove("hidden");
}

function closeSignalGuide() {
  if (state.code && state.user?.id) {
    localStorage.setItem(signalGuideKey(), "seen");
  }
  elements.signalGuide.classList.add("hidden");
}

function headerValue(value) {
  return encodeURIComponent(value);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(state.code ? { "x-event-code": headerValue(state.code) } : {}),
      ...(state.user?.id ? { "x-user-id": state.user.id } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || data.message || "요청을 처리하지 못했어요.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function setView(viewName) {
  elements.gateView.classList.toggle("hidden", viewName !== "gate");
  elements.loginView.classList.toggle("hidden", viewName !== "login");
  elements.pendingView.classList.toggle("hidden", viewName !== "pending");
  elements.homeView.classList.toggle("hidden", viewName !== "home");
  if (viewName !== "pending") {
    window.clearInterval(approvalTimer);
    approvalTimer = null;
  }
}

async function checkApprovalStatus({ silent = false } = {}) {
  if (!state.code || !state.user?.id) return;
  try {
    await loadPeople();
    state.user.status = "approved";
    saveCurrentUser();
    setView("home");
    setSection("home");
    maybeShowSignalGuide();
    showToast("승인이 완료됐어요. SIGNAL을 시작할 수 있어요.");
  } catch (error) {
    if (error.status === 403) {
      setView("pending");
      return;
    }
    if (!silent) showToast(error.message);
  }
}

function showPendingApproval() {
  setView("pending");
  window.clearInterval(approvalTimer);
  approvalTimer = window.setInterval(() => {
    checkApprovalStatus({ silent: true });
  }, 5000);
}

function returnToGate() {
  sessionStorage.removeItem("gamesSyncCode");
  state.code = "";
  state.user = null;
  state.room = null;
  state.people = [];
  state.matches = [];
  state.rankings = [];
  state.circles = { active: null, myCircle: null };
  state.stats = null;
  state.selectedPersonId = null;
  elements.personDetailSheet.classList.add("hidden");
  elements.eventCode.value = "";
  showGateError();
  setView("gate");
}

function setSection(section) {
  state.section = section;
  const profileActive = section === "profile";
  const alertsActive = section === "alerts";
  const homeActive = section === "home";
  const rankingActive = section === "ranking";
  const circleActive = section === "circle";

  elements.profileView.classList.toggle("hidden", !profileActive);
  elements.homeContent.classList.toggle("hidden", !homeActive);
  elements.notificationsView.classList.toggle("hidden", !alertsActive);
  elements.rankingView.classList.toggle("hidden", !rankingActive);
  elements.circleView.classList.toggle("hidden", !circleActive);
  elements.profileNav.classList.toggle("active", profileActive);
  elements.homeNav.classList.toggle("active", homeActive);
  elements.rankingNav.classList.toggle("active", rankingActive);
  elements.circleNav.classList.toggle("active", circleActive);
  elements.alertsNav.classList.toggle("active", alertsActive);

  if (profileActive) renderProfile();
  if (alertsActive) renderNotifications();
  if (rankingActive) renderRankings();
  if (circleActive) renderCircles();
}

function renderProfile() {
  const user = state.user || {};
  elements.profileNickname.textContent = user.nickname || "-";
  elements.profileAffiliation.textContent = tagsText(user.tags);
  elements.profileStatusMessage.textContent = user.statusMessage || "상태메시지 미입력";
  elements.profileContact.textContent = user.contact ? `연락처: ${user.contact}` : "연락처: -";
  elements.profileCode.textContent = state.code || "-";
  elements.profileEditStatusMessage.value = user.statusMessage || "";
  elements.profileEditContact.value = user.contact || "";
  setProfileSelectedTags(user.tags || emptyTags());
}

function renderStats() {
  const stats = state.stats || {
    receivedCount: 0,
    signalLimit: 10,
    openSignalLimit: 1,
    revokeLimit: 3,
    signalRemaining: 10,
    openSignalRemaining: 1,
    revokeRemaining: 3,
    receivedSignals: [],
    openSignals: []
  };

  elements.statsPanel.innerHTML = `
    <article class="stat-card">
      <span>받은 SIGNAL</span>
      <strong>${stats.receivedCount}</strong>
    </article>
    <article class="stat-card">
      <span>남은 SIGNAL</span>
      <strong>${stats.signalRemaining}/${stats.signalLimit}</strong>
    </article>
    <article class="stat-card">
      <span>OPEN SIGNAL</span>
      <strong>${stats.openSignalRemaining}/${stats.openSignalLimit}</strong>
    </article>
    <article class="stat-card">
      <span>SIGNAL 회수권</span>
      <strong>${stats.revokeRemaining}/${stats.revokeLimit}</strong>
    </article>
  `;
}

function primaryGroup(person) {
  return person.tags?.groups?.[0] || "소속 미선택";
}

function openSignalFrom(personId) {
  return (state.stats?.openSignals || []).find((person) => person.id === personId) || null;
}

function matchFor(personId) {
  return state.matches.find((match) => match.id === personId) || null;
}

function groupedPeople() {
  const groups = new Map();
  [...state.people]
    .sort((a, b) => a.nickname.localeCompare(b.nickname, "ko"))
    .forEach((person) => {
      const label = primaryGroup(person);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(person);
    });

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "ko"));
}

function personChipClass(person) {
  if (matchFor(person.id)) return "synced";
  if (openSignalFrom(person.id)) return "open-received";
  return "";
}

function renderPeople() {
  if (!state.people.length) {
    elements.peopleList.innerHTML = `<div class="empty-state">아직 표시할 참가자가 없어요. 친구들이 들어오면 여기에 나타납니다.</div>`;
    return;
  }

  elements.peopleList.innerHTML = `
    <div class="people-summary">
      <strong>총 ${state.people.length}명</strong>
      <span>소속태그별로 모아봤어요.</span>
    </div>
    ${groupedPeople()
      .map(
        ([label, people]) => `
          <section class="people-group">
            <div class="people-group-head">
              <h3>${escapeHtml(label)}</h3>
              <span>${people.length}명</span>
            </div>
            <div class="name-grid">
              ${people
                .map(
                  (person) => `
                    <button class="person-name-chip ${personChipClass(person)}" type="button" data-person-detail="${person.id}">
                      <span>${escapeHtml(person.nickname)}</span>
                    </button>
                  `
                )
                .join("")}
            </div>
          </section>
        `
      )
      .join("")}
  `;
}

function personById(personId) {
  return state.people.find((person) => person.id === personId) || null;
}

function tagPills(title, values = []) {
  return `
    <div class="detail-tags-row">
      <span>${escapeHtml(title)}</span>
      <div>
        ${
          values.length
            ? values.map((value) => `<b>${escapeHtml(value)}</b>`).join("")
            : `<em>미선택</em>`
        }
      </div>
    </div>
  `;
}

function renderDetailActions(person) {
  const stats = state.stats || {};
  const match = matchFor(person.id);
  if (match) {
    return `<div class="sync-state detail-sync-state" aria-label="SYNC 완료">SYNC</div>`;
  }

  return `
    <div class="detail-actions">
      <button class="like-button ${person.signalSent ? "liked" : ""}" type="button" data-like="${person.id}" data-type="${SIGNAL}" ${person.signalSent || stats.signalRemaining <= 0 ? "disabled" : ""}>
        SIGNAL
      </button>
      ${
        person.signalSent
          ? `<button class="like-button revoke" type="button" data-revoke="${person.id}" ${stats.revokeRemaining <= 0 ? "disabled" : ""}>SIGNAL 회수</button>`
          : ""
      }
      <button class="like-button open ${person.openSignalSent ? "open-sent" : ""}" type="button" data-like="${person.id}" data-type="${OPEN_SIGNAL}" ${person.openSignalSent || stats.openSignalRemaining <= 0 ? "disabled" : ""}>
        OPEN SIGNAL
      </button>
    </div>
  `;
}

function renderPersonDetail() {
  const person = personById(state.selectedPersonId);
  if (!person) {
    closePersonDetail();
    return;
  }

  const match = matchFor(person.id);
  const openReceived = openSignalFrom(person.id);
  const statusClass = match ? "synced" : openReceived ? "open-received" : "";

  elements.personDetailContent.innerHTML = `
    <div class="person-detail-head ${statusClass}">
      <p class="eyebrow">${match ? "SYNC" : openReceived ? "OPEN SIGNAL" : "Profile"}</p>
      <h2 id="person-detail-title">${escapeHtml(person.nickname)}</h2>
      <p>${escapeHtml(primaryGroup(person))}</p>
    </div>
    <div class="detail-tags">
      ${tagPills("소속태그", person.tags?.groups || [])}
      ${tagPills("찾는관계", person.tags?.seeking || [])}
    </div>
    <div class="detail-message">
      <span>상태메시지</span>
      <p>${person.statusMessage ? escapeHtml(person.statusMessage) : "상태메시지 미입력"}</p>
    </div>
    ${
      match
        ? `<div class="detail-contact-block">${renderNotificationContact(match.contact)}</div>`
        : openReceived
          ? `<div class="detail-contact-block timeline-open">
              ${renderNotificationContact(openReceived.contact)}
              ${openReceived.note ? `<div class="timeline-message"><strong>내용:</strong><span>${escapeHtml(openReceived.note)}</span></div>` : ""}
            </div>`
          : ""
    }
    ${renderDetailActions(person)}
  `;
  scheduleContactFit();
}

function openPersonDetail(personId) {
  state.selectedPersonId = personId;
  renderPersonDetail();
  elements.personDetailSheet.classList.remove("hidden");
}

function closePersonDetail() {
  state.selectedPersonId = null;
  elements.personDetailSheet.classList.add("hidden");
}

function notificationItems() {
  const signalItems = (state.stats?.receivedSignals || []).map((signal) => ({
    type: "signal",
    title: "새로운 SIGNAL을 받았어요.",
    time: signal.sentAt,
    order: signal.order ?? 0,
    priority: 1,
    contact: "",
    message: ""
  }));

  const openItems = (state.stats?.openSignals || []).map((person) => ({
    type: "open",
    title: `${person.nickname}님이 OPEN SIGNAL을 보냈어요.`,
    time: person.sentAt,
    order: person.order ?? 0,
    priority: 2,
    contact: person.contact,
    message: person.note || ""
  }));

  const syncItems = state.matches.map((match) => ({
    type: "sync",
    title: `${match.nickname}님과 SYNC됐어요.`,
    time: match.matchedAt,
    order: match.order ?? 0,
    priority: 3,
    contact: match.contact,
    message: ""
  }));

  return [...signalItems, ...openItems, ...syncItems].sort((a, b) => {
    const aTime = new Date(a.time).getTime();
    const bTime = new Date(b.time).getTime();
    if (aTime !== bTime) return bTime - aTime;
    if (a.order !== b.order) return b.order - a.order;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.title.localeCompare(b.title);
  });
}

function renderNotificationContact(contact) {
  return `
    <div class="notification-contact-callout" aria-label="알림 연락처 안내">
      <p class="contact-line sync-contact">
        <span class="contact-arrow contact-arrow-left" aria-hidden="true"></span>
        <span class="contact-value">${escapeHtml(contact)}</span>
        <span class="contact-arrow contact-arrow-right" aria-hidden="true"></span>
      </p>
      <p class="sync-help">여기로 연락해보세요!</p>
    </div>
  `;
}

function renderNotifications() {
  const items = notificationItems();
  if (!items.length) {
    elements.notificationList.innerHTML = `<div class="empty-state">아직 알림이 없어요. SIGNAL, OPEN SIGNAL, SYNC가 생기면 시간순으로 표시됩니다.</div>`;
    return;
  }

  elements.notificationList.innerHTML = items
    .map(
      (item) => `
        <article class="timeline-item ${item.type === "sync" ? "timeline-sync" : item.type === "open" ? "timeline-open" : "timeline-signal"}">
          <div class="timeline-dot" aria-hidden="true"></div>
          <div>
            <time>${formatTime(item.time)}</time>
            <h3>${escapeHtml(item.title)}</h3>
            ${item.contact ? renderNotificationContact(item.contact) : ""}
            ${item.message ? `<div class="timeline-message"><strong>내용:</strong><span>${escapeHtml(item.message)}</span></div>` : ""}
          </div>
        </article>
      `
    )
    .join("");
  scheduleContactFit();
}

function fitContactValues() {
  document.querySelectorAll(".contact-value").forEach((value) => {
    value.style.fontSize = "";
    value.style.transform = "";

    const parent = value.closest(".sync-contact");
    const availableWidth = value.clientWidth;
    if (!parent || availableWidth <= 0) return;

    const baseSize = Number.parseFloat(window.getComputedStyle(parent).fontSize) || 18;
    value.style.fontSize = `${baseSize}px`;

    const textWidth = value.scrollWidth;
    if (textWidth <= availableWidth) return;

    const nextSize = Math.max(10, Math.floor(baseSize * ((availableWidth - 2) / textWidth) * 100) / 100);
    value.style.fontSize = `${nextSize}px`;

    if (value.scrollWidth > availableWidth) {
      const scale = Math.max(0.76, (availableWidth - 2) / value.scrollWidth);
      value.style.transform = `scaleX(${scale})`;
    }
  });
}

function scheduleContactFit() {
  window.cancelAnimationFrame(contactFitFrame);
  contactFitFrame = window.requestAnimationFrame(fitContactValues);
}

function renderRankings() {
  const rankings = state.rankings || [];
  if (!rankings.length) {
    elements.rankingList.innerHTML = `<div class="empty-state">아직 SIGNAL 순위가 없어요. SIGNAL을 받으면 1위부터 3위까지 표시됩니다.</div>`;
    return;
  }

  elements.rankingList.innerHTML = rankings
    .map(
      (person) => `
        <article class="ranking-card rank-${person.rank}">
          <div class="rank-badge">${person.rank}</div>
          <div>
            <h3>${escapeHtml(person.nickname)}</h3>
            <p class="affiliation-chip">${escapeHtml(tagsText(person.tags))}</p>
            ${person.statusMessage ? `<p class="status-message compact">${escapeHtml(person.statusMessage)}</p>` : ""}
          </div>
          <strong>${person.receivedCount}</strong>
        </article>
      `
    )
    .join("");
}

function renderCircleCard(circle, { featured = false } = {}) {
  if (!circle) return "";
  return `
    <article class="circle-card ${featured ? "my-circle-card" : ""}">
      <div class="circle-card-head">
        <span>${escapeHtml(circle.name)}</span>
        <strong>${circle.members.length}명</strong>
      </div>
      <div class="circle-name-grid">
        ${circle.members
          .map(
            (member) => `
              <span class="circle-name-chip ${member.id === state.user?.id ? "is-me" : ""}"><span>${escapeHtml(member.nickname)}</span></span>
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function renderCircles() {
  const circles = state.circles || { active: null, myCircle: null };
  const groups = circles.active?.groups || [];

  if (!circles.active) {
    elements.myCirclePanel.innerHTML = `
      <div class="empty-state">아직 공개된 Circle이 없어요. 관리자가 Circle을 확정하면 여기에 표시됩니다.</div>
    `;
    elements.circleList.innerHTML = "";
    return;
  }

  elements.myCirclePanel.innerHTML = `
    <h3>내 Circle</h3>
    ${circles.myCircle ? renderCircleCard(circles.myCircle, { featured: true }) : `<div class="empty-state">이번 Circle에 아직 포함되지 않았어요.</div>`}
  `;
  elements.circleList.innerHTML = groups.map((group) => renderCircleCard(group)).join("");
}

function render() {
  renderProfile();
  renderStats();
  renderPeople();
  renderNotifications();
  renderRankings();
  renderCircles();
  if (state.selectedPersonId) renderPersonDetail();
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadPeople() {
  if (!state.code || !state.user?.id) return;
  const data = await request("/api/people");
  state.user = { ...(state.user || {}), ...data.user };
  state.room = data.room;
  state.people = data.people;
  state.matches = data.matches;
  state.rankings = data.rankings || [];
  state.circles = data.circles || { active: null, myCircle: null };
  state.stats = data.stats;
  saveCurrentUser();
  render();
}

elements.eventCode.addEventListener("input", () => showGateError());
elements.backToCodeButton.addEventListener("click", returnToGate);
elements.pendingBackToCodeButton.addEventListener("click", returnToGate);
elements.pendingRefreshButton.addEventListener("click", () => checkApprovalStatus());
elements.roomBackToCodeButton.addEventListener("click", returnToGate);
elements.signalGuideClose.addEventListener("click", closeSignalGuide);

elements.gateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = elements.eventCode.value.trim();
  showGateError();
  try {
    const data = await request("/api/check-code", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    state.code = code;
    state.room = data.room;
    const savedUser = loadSavedUserForCode(code);
    state.user = null;
    sessionStorage.setItem("gamesSyncCode", code);
    fillLoginFormFromUser(savedUser || {});
    setView("login");
    setSection("home");
  } catch (error) {
    showGateError(error.message);
  }
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const data = await request("/api/session", {
      method: "POST",
      body: JSON.stringify({
        nickname: elements.nickname.value,
        statusMessage: elements.statusMessage.value,
        tags: getSelectedTags(),
        contact: elements.contact.value,
        password: elements.password.value
      })
    });
    state.user = {
      ...data.user,
      statusMessage: elements.statusMessage.value,
      tags: getSelectedTags()
    };
    state.room = data.room;
    state.matches = data.matches;
    state.rankings = data.rankings || [];
    state.circles = data.circles || { active: null, myCircle: null };
    state.stats = data.stats;
    saveCurrentUser();
    if (data.pending || state.user.status === "pending") {
      showPendingApproval();
      return;
    }
    setView("home");
    setSection("home");
    await loadPeople();
    maybeShowSignalGuide();
  } catch (error) {
    showToast(error.message);
  }
});

async function handleSignalAction(event) {
  const revokeButton = event.target.closest("[data-revoke]");
  if (revokeButton) {
    revokeButton.disabled = true;
    try {
      const data = await request("/api/likes/revoke", {
        method: "POST",
        body: JSON.stringify({ targetId: revokeButton.dataset.revoke })
      });
      state.matches = data.matches;
      state.stats = data.stats;
      state.circles = data.circles || state.circles;
      await loadPeople();
    } catch (error) {
      revokeButton.disabled = false;
      showToast(error.message);
    }
    return;
  }

  const button = event.target.closest("[data-like]");
  if (!button) return false;
  const targetId = button.dataset.like;
  const type = button.dataset.type;
  const note =
    type === OPEN_SIGNAL
      ? window.prompt("OPEN SIGNAL과 함께 보낼 쪽지를 입력해주세요. 비워둬도 보낼 수 있어요.", "")
      : "";
  if (note === null) return;

  button.disabled = true;
  try {
    const data = await request("/api/likes", {
      method: "POST",
      body: JSON.stringify({ targetId, type, note })
    });
    state.matches = data.matches;
    state.stats = data.stats;
    state.circles = data.circles || state.circles;
    await loadPeople();
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
  return true;
}

elements.peopleList.addEventListener("click", async (event) => {
  const detailButton = event.target.closest("[data-person-detail]");
  if (!detailButton) return;
  openPersonDetail(detailButton.dataset.personDetail);
});

elements.personDetailClose.addEventListener("click", closePersonDetail);
elements.personDetailSheet.addEventListener("click", async (event) => {
  if (event.target === elements.personDetailSheet) {
    closePersonDetail();
    return;
  }
  await handleSignalAction(event);
});

elements.profileNav.addEventListener("click", () => {
  setSection("profile");
});

elements.homeNav.addEventListener("click", () => {
  setSection("home");
});

elements.profileEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showProfileEditStatus();
  try {
    const data = await request("/api/profile", {
      method: "POST",
      body: JSON.stringify({
        statusMessage: elements.profileEditStatusMessage.value,
        contact: elements.profileEditContact.value,
        tags: getProfileSelectedTags()
      })
    });
    state.user = data.user;
    state.room = data.room;
    state.matches = data.matches;
    state.rankings = data.rankings || [];
    state.circles = data.circles || { active: null, myCircle: null };
    state.stats = data.stats;
    saveCurrentUser();
    render();
    showProfileEditStatus("저장됐어요.");
  } catch (error) {
    showProfileEditStatus(error.message, true);
  }
});

elements.rankingNav.addEventListener("click", async () => {
  setSection("ranking");
  await refreshCurrentState();
});

elements.circleNav.addEventListener("click", async () => {
  setSection("circle");
  await refreshCurrentState();
});

elements.alertsNav.addEventListener("click", async () => {
  setSection("alerts");
  await refreshCurrentState();
});

async function refreshCurrentState() {
  try {
    await loadPeople();
  } catch (error) {
    showToast(error.message);
  }
}

elements.refreshButton.addEventListener("click", refreshCurrentState);
elements.profileRefreshButton.addEventListener("click", refreshCurrentState);
elements.notificationRefreshButton.addEventListener("click", refreshCurrentState);
elements.rankingRefreshButton.addEventListener("click", refreshCurrentState);
elements.circleRefreshButton.addEventListener("click", refreshCurrentState);
window.addEventListener("resize", scheduleContactFit);

async function boot() {
  let savedUser = null;
  if (state.code) {
    elements.eventCode.value = state.code;
    savedUser = loadSavedUserForCode(state.code);
  }
  if (savedUser) {
    fillLoginFormFromUser(savedUser);
  }

  if (!state.code) {
    setView("gate");
    return;
  }

  state.user = null;
  setView("login");
}

boot();
