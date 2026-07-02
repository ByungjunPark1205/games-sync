const SIGNAL = "signal";
const OPEN_SIGNAL = "open";

const state = {
  code: sessionStorage.getItem("gamesSyncCode") || "",
  user: null,
  room: null,
  people: [],
  matches: [],
  stats: null,
  view: "people",
  section: "home"
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  gateView: $("#gateView"),
  loginView: $("#loginView"),
  homeView: $("#homeView"),
  profileView: $("#profileView"),
  homeContent: $("#homeContent"),
  notificationsView: $("#notificationsView"),
  gateForm: $("#gateForm"),
  loginForm: $("#loginForm"),
  backToCodeButton: $("#backToCodeButton"),
  eventCode: $("#eventCode"),
  nickname: $("#nickname"),
  affiliation: $("#affiliation"),
  affiliationDetailWrap: $("#affiliationDetailWrap"),
  affiliationDetail: $("#affiliationDetail"),
  contact: $("#contact"),
  password: $("#password"),
  statsPanel: $("#statsPanel"),
  peopleList: $("#peopleList"),
  matchesList: $("#matchesList"),
  notificationList: $("#notificationList"),
  profileNickname: $("#profileNickname"),
  profileAffiliation: $("#profileAffiliation"),
  profileContact: $("#profileContact"),
  profileCode: $("#profileCode"),
  peopleTab: $("#peopleTab"),
  matchesTab: $("#matchesTab"),
  refreshButton: $("#refreshButton"),
  profileRefreshButton: $("#profileRefreshButton"),
  notificationRefreshButton: $("#notificationRefreshButton"),
  profileNav: $("#profileNav"),
  homeNav: $("#homeNav"),
  alertsNav: $("#alertsNav"),
  toast: $("#toast")
};

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3200);
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
    throw new Error(data.error || data.message || "요청을 처리하지 못했어요.");
  }
  return data;
}

function setView(viewName) {
  elements.gateView.classList.toggle("hidden", viewName !== "gate");
  elements.loginView.classList.toggle("hidden", viewName !== "login");
  elements.homeView.classList.toggle("hidden", viewName !== "home");
}

function returnToGate() {
  sessionStorage.removeItem("gamesSyncCode");
  state.code = "";
  state.user = null;
  state.room = null;
  state.people = [];
  state.matches = [];
  state.stats = null;
  elements.eventCode.value = "";
  setView("gate");
  showToast("입장 코드를 다시 입력할 수 있어요.");
}

function updateAffiliationInput() {
  const needsDetail = !elements.affiliation.value;
  elements.affiliationDetailWrap.classList.toggle("hidden", !needsDetail);
  elements.affiliationDetail.required = needsDetail;
}

function setSection(section) {
  state.section = section;
  const profileActive = section === "profile";
  const alertsActive = section === "alerts";
  const homeActive = section === "home";

  elements.profileView.classList.toggle("hidden", !profileActive);
  elements.homeContent.classList.toggle("hidden", !homeActive);
  elements.notificationsView.classList.toggle("hidden", !alertsActive);
  elements.profileNav.classList.toggle("active", profileActive);
  elements.homeNav.classList.toggle("active", homeActive);
  elements.alertsNav.classList.toggle("active", alertsActive);

  if (profileActive) renderProfile();
  if (alertsActive) renderNotifications();
}

function renderTabs() {
  const matchesActive = state.view === "matches";
  elements.peopleTab.classList.toggle("active", !matchesActive);
  elements.matchesTab.classList.toggle("active", matchesActive);
  elements.peopleTab.setAttribute("aria-selected", String(!matchesActive));
  elements.matchesTab.setAttribute("aria-selected", String(matchesActive));
  elements.peopleList.classList.toggle("hidden", matchesActive);
  elements.matchesList.classList.toggle("hidden", !matchesActive);
}

function renderProfile() {
  const user = state.user || {};
  elements.profileNickname.textContent = user.nickname || "-";
  elements.profileAffiliation.textContent = user.affiliationLabel || "소속 미입력";
  elements.profileContact.textContent = user.contact ? `연락처: ${user.contact}` : "연락처: -";
  elements.profileCode.textContent = state.code || "-";
}

function renderStats() {
  const stats = state.stats || {
    receivedCount: 0,
    sentSignalCount: 0,
    sentOpenSignalCount: 0,
    signalLimit: 10,
    openSignalLimit: 1,
    signalRemaining: 10,
    openSignalRemaining: 1,
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
  `;
}

function renderPeople() {
  if (!state.people.length) {
    elements.peopleList.innerHTML = `<div class="empty-state">아직 표시할 참가자가 없어요. 친구들이 들어오면 여기에 나타납니다.</div>`;
    return;
  }

  const stats = state.stats || {};
  elements.peopleList.innerHTML = state.people
    .map(
      (person) => `
        <article class="person-card">
          <div>
            <h3>${escapeHtml(person.nickname)}</h3>
            <p class="affiliation-chip">${escapeHtml(person.affiliationLabel || "소속 미입력")}</p>
            <p>마음이 가면 SIGNAL을 보내세요.</p>
          </div>
          <div class="signal-actions">
            <button class="like-button ${person.signalSent ? "liked" : ""}" type="button" data-like="${person.id}" data-type="${SIGNAL}" ${person.signalSent || stats.signalRemaining <= 0 ? "disabled" : ""}>
              SIGNAL
            </button>
            <button class="like-button open ${person.openSignalSent ? "open-sent" : ""}" type="button" data-like="${person.id}" data-type="${OPEN_SIGNAL}" ${person.openSignalSent || stats.openSignalRemaining <= 0 ? "disabled" : ""}>
              OPEN SIGNAL
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderMatches() {
  if (!state.matches.length) {
    elements.matchesList.innerHTML = `<div class="empty-state">아직 SYNC된 사람이 없어요. SYNC되면 이곳에 연락처가 표시됩니다.</div>`;
    return;
  }

  elements.matchesList.innerHTML = state.matches
    .map(
      (match) => `
        <article class="person-card match-card">
          <div>
            <h3>${escapeHtml(match.nickname)}</h3>
            <p class="affiliation-chip">${escapeHtml(match.affiliationLabel || "소속 미입력")}</p>
            <p class="contact-line">연락처: ${escapeHtml(match.contact)}</p>
          </div>
          <button class="like-button synced" type="button" disabled>SYNC</button>
        </article>
      `
    )
    .join("");
}

function notificationItems() {
  const openSignals = state.stats?.openSignals || [];
  const openItems = openSignals.map((person) => ({
    type: "open",
    title: `${person.nickname}님이 OPEN SIGNAL을 보냈어요.`,
    time: person.sentAt,
    body: `연락처: ${person.contact}`,
    note: person.note || ""
  }));

  const syncItems = state.matches.map((match) => ({
    type: "sync",
    title: `${match.nickname}님과 SYNC됐어요.`,
    time: match.matchedAt,
    body: `연락처: ${match.contact}`,
    note: "두 사람의 SIGNAL이 SYNC됐어요."
  }));

  return [...openItems, ...syncItems].sort((a, b) => new Date(b.time) - new Date(a.time));
}

function renderNotifications() {
  const items = notificationItems();
  if (!items.length) {
    elements.notificationList.innerHTML = `<div class="empty-state">아직 알림이 없어요. OPEN SIGNAL이나 SYNC가 생기면 시간순으로 표시됩니다.</div>`;
    return;
  }

  elements.notificationList.innerHTML = items
    .map(
      (item) => `
        <article class="timeline-item ${item.type === "sync" ? "timeline-sync" : "timeline-open"}">
          <div class="timeline-dot" aria-hidden="true"></div>
          <div>
            <time>${formatTime(item.time)}</time>
            <h3>${escapeHtml(item.title)}</h3>
            <p class="contact-line">${escapeHtml(item.body)}</p>
            ${item.note ? `<p class="signal-note">${escapeHtml(item.note)}</p>` : ""}
          </div>
        </article>
      `
    )
    .join("");
}

function render() {
  renderProfile();
  renderStats();
  renderTabs();
  renderPeople();
  renderMatches();
  renderNotifications();
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
  state.user = data.user;
  state.room = data.room;
  state.people = data.people;
  state.matches = data.matches;
  state.stats = data.stats;
  saveCurrentUser();
  render();
}

elements.affiliation.addEventListener("change", updateAffiliationInput);
elements.backToCodeButton.addEventListener("click", returnToGate);

elements.gateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = elements.eventCode.value.trim();
  try {
    const data = await request("/api/check-code", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    state.code = code;
    state.room = data.room;
    state.user = loadSavedUserForCode(code);
    sessionStorage.setItem("gamesSyncCode", code);
    showToast(data.message);
    setView(state.user?.id ? "home" : "login");
    setSection("home");
    if (state.user?.id) {
      await loadPeople();
    }
  } catch (error) {
    showToast(error.message);
  }
});

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!elements.affiliation.value && !elements.affiliationDetail.value.trim()) {
    showToast("소속을 선택하거나 어떤 소속의 누구 지인인지 적어주세요.");
    elements.affiliationDetail.focus();
    return;
  }

  try {
    const data = await request("/api/session", {
      method: "POST",
      body: JSON.stringify({
        nickname: elements.nickname.value,
        affiliation: elements.affiliation.value,
        affiliationDetail: elements.affiliationDetail.value,
        contact: elements.contact.value,
        password: elements.password.value
      })
    });
    state.user = data.user;
    state.room = data.room;
    state.matches = data.matches;
    state.stats = data.stats;
    saveCurrentUser();
    showToast(`${state.user.nickname}님, Games Sync에 입장했어요.`);
    setView("home");
    setSection("home");
    await loadPeople();
  } catch (error) {
    showToast(error.message);
  }
});

elements.peopleList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-like]");
  if (!button) return;
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
    showToast(
      data.synced
        ? "두 사람의 SIGNAL이 SYNC됐어요."
        : type === OPEN_SIGNAL
          ? "OPEN SIGNAL을 보냈어요."
          : "SIGNAL을 보냈어요."
    );
    await loadPeople();
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
});

elements.peopleTab.addEventListener("click", () => {
  state.view = "people";
  renderTabs();
});

elements.matchesTab.addEventListener("click", () => {
  state.view = "matches";
  renderTabs();
});

elements.profileNav.addEventListener("click", () => {
  setSection("profile");
});

elements.homeNav.addEventListener("click", () => {
  setSection("home");
});

elements.alertsNav.addEventListener("click", () => {
  setSection("alerts");
});

async function refreshCurrentState() {
  try {
    await loadPeople();
    showToast("새로고침했어요.");
  } catch (error) {
    showToast(error.message);
  }
}

elements.refreshButton.addEventListener("click", refreshCurrentState);
elements.profileRefreshButton.addEventListener("click", refreshCurrentState);
elements.notificationRefreshButton.addEventListener("click", refreshCurrentState);

async function boot() {
  updateAffiliationInput();
  if (state.code) {
    elements.eventCode.value = state.code;
    state.user = loadSavedUserForCode(state.code);
  }
  if (state.user) {
    elements.nickname.value = state.user.nickname || "";
  }

  if (!state.code) {
    setView("gate");
    return;
  }

  if (!state.user?.id) {
    setView("login");
    return;
  }

  setView("home");
  setSection("home");
  try {
    await loadPeople();
  } catch (error) {
    localStorage.removeItem(userStorageKey());
    state.user = null;
    setView("login");
    showToast("재입장을 위해 비밀번호를 입력해주세요.");
  }
}

boot();
