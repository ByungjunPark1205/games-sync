const SIGNAL = "signal";
const OPEN_SIGNAL = "open";

const state = {
  code: sessionStorage.getItem("gamesSyncCode") || "",
  user: null,
  room: null,
  people: [],
  matches: [],
  stats: null,
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
  roomBackToCodeButton: $("#roomBackToCodeButton"),
  eventCode: $("#eventCode"),
  nickname: $("#nickname"),
  affiliation: $("#affiliation"),
  affiliationDetailWrap: $("#affiliationDetailWrap"),
  affiliationDetail: $("#affiliationDetail"),
  contact: $("#contact"),
  password: $("#password"),
  statsPanel: $("#statsPanel"),
  peopleList: $("#peopleList"),
  notificationList: $("#notificationList"),
  profileNickname: $("#profileNickname"),
  profileAffiliation: $("#profileAffiliation"),
  profileContact: $("#profileContact"),
  profileCode: $("#profileCode"),
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

function fillLoginFormFromUser(user = {}) {
  elements.nickname.value = user.nickname || "";
  elements.contact.value = user.contact || "";
  elements.affiliation.value = user.affiliation || "";
  elements.affiliationDetail.value = user.affiliationDetail || (!user.affiliation ? user.affiliationLabel || "" : "");
  updateAffiliationInput();
}

function fallbackToLogin(message = "저장된 접속 정보가 만료됐어요. 비밀번호로 다시 입장해주세요.") {
  const savedUser = state.user || loadSavedUserForCode(state.code) || {};
  state.user = null;
  state.people = [];
  state.matches = [];
  state.stats = null;
  fillLoginFormFromUser(savedUser);
  setView("login");
  showToast(message);
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

function renderPeople() {
  if (!state.people.length) {
    elements.peopleList.innerHTML = `<div class="empty-state">아직 표시할 참가자가 없어요. 친구들이 들어오면 여기에 나타납니다.</div>`;
    return;
  }

  const stats = state.stats || {};
  const matchById = new Map(state.matches.map((match) => [match.id, match]));
  const sortedPeople = [...state.people].sort((a, b) => {
    const aMatch = matchById.get(a.id);
    const bMatch = matchById.get(b.id);
    if (aMatch && bMatch) return new Date(bMatch.matchedAt) - new Date(aMatch.matchedAt);
    return Number(Boolean(bMatch)) - Number(Boolean(aMatch));
  });

  elements.peopleList.innerHTML = sortedPeople
    .map((person) => {
      const match = matchById.get(person.id);
      const isSynced = Boolean(match);
      return `
        <article class="person-card ${isSynced ? "match-card" : ""}">
          <div>
            <h3>${escapeHtml(person.nickname)}</h3>
            <p class="affiliation-chip">${escapeHtml(person.affiliationLabel || "소속 미입력")}</p>
            ${
              isSynced
                ? `<div class="sync-contact-callout" aria-label="SYNC 연락처 안내">
                    <p class="contact-line sync-contact">연락처: ${escapeHtml(match.contact)}</p>
                    <p class="sync-help">여기로 연락해보세요!</p>
                  </div>`
                : `<p>마음이 가면 SIGNAL을 보내세요.</p>`
            }
          </div>
          <div class="signal-actions">
            ${
              isSynced
                ? `<div class="sync-state" aria-label="SYNC 완료">SYNC</div>`
                : `
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
                `
            }
          </div>
        </article>
      `;
    })
    .join("");
}

function notificationItems() {
  const signalItems = (state.stats?.receivedSignals || []).map((signal) => ({
    type: "signal",
    title: "새로운 SIGNAL을 받았어요.",
    time: signal.sentAt,
    body: "누군가 마음을 보냈어요.",
    note: ""
  }));

  const openItems = (state.stats?.openSignals || []).map((person) => ({
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

  return [...signalItems, ...openItems, ...syncItems].sort((a, b) => new Date(b.time) - new Date(a.time));
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
  renderPeople();
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
  state.user = { ...(state.user || {}), ...data.user };
  state.room = data.room;
  state.people = data.people;
  state.matches = data.matches;
  state.stats = data.stats;
  saveCurrentUser();
  render();
}

elements.affiliation.addEventListener("change", updateAffiliationInput);
elements.backToCodeButton.addEventListener("click", returnToGate);
elements.roomBackToCodeButton.addEventListener("click", returnToGate);

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
      try {
        await loadPeople();
      } catch {
        fallbackToLogin();
      }
    } else {
      fillLoginFormFromUser(state.user || {});
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
    state.user = {
      ...data.user,
      affiliation: elements.affiliation.value,
      affiliationDetail: elements.affiliationDetail.value
    };
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
      showToast("SIGNAL을 회수했어요.");
      await loadPeople();
    } catch (error) {
      revokeButton.disabled = false;
      showToast(error.message);
    }
    return;
  }

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
    fillLoginFormFromUser(state.user);
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
  } catch {
    fallbackToLogin();
  }
}

boot();
