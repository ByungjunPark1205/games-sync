const state = {
  adminKey: localStorage.getItem("gamesSyncAdminKey") || "",
  rooms: [],
  roomCode: "",
  users: []
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  loginPanel: $("#adminLoginPanel"),
  dashboard: $("#adminDashboard"),
  createRoomPanel: $("#createRoomPanel"),
  participantsPanel: $("#participantsPanel"),
  loginForm: $("#adminLoginForm"),
  settingsForm: $("#adminSettingsForm"),
  createRoomForm: $("#createRoomForm"),
  adminKey: $("#adminKey"),
  adminLoginError: $("#adminLoginError"),
  roomSelect: $("#roomSelect"),
  adminStorageStatus: $("#adminStorageStatus"),
  adminEventCode: $("#adminEventCode"),
  adminSignalLimit: $("#adminSignalLimit"),
  adminOpenSignalLimit: $("#adminOpenSignalLimit"),
  adminRevokeLimit: $("#adminRevokeLimit"),
  newAdminKey: $("#newAdminKey"),
  newRoomCode: $("#newRoomCode"),
  newRoomSignalLimit: $("#newRoomSignalLimit"),
  newRoomOpenSignalLimit: $("#newRoomOpenSignalLimit"),
  newRoomRevokeLimit: $("#newRoomRevokeLimit"),
  adminRefresh: $("#adminRefresh"),
  adminCount: $("#adminCount"),
  adminUserList: $("#adminUserList"),
  toast: $("#toast")
};

function showToast() {
  elements.toast.classList.add("hidden");
}

function showLoginError(message = "") {
  elements.adminLoginError.textContent = message;
  elements.adminLoginError.classList.toggle("hidden", !message);
}

function headerValue(value) {
  return encodeURIComponent(value);
}

async function adminRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-admin-key": headerValue(state.adminKey),
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "관리자 요청을 처리하지 못했어요.");
  }
  return data;
}

function setDashboardVisible(visible) {
  elements.loginPanel.classList.toggle("hidden", visible);
  elements.dashboard.classList.toggle("hidden", !visible);
  elements.createRoomPanel.classList.toggle("hidden", !visible);
  elements.participantsPanel.classList.toggle("hidden", !visible);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderRooms() {
  elements.roomSelect.innerHTML = state.rooms
    .map((room) => `<option value="${escapeHtml(room.code)}">${escapeHtml(room.code)} · ${room.usersCount}명</option>`)
    .join("");
  elements.roomSelect.value = state.roomCode;
}

function renderUsers() {
  elements.adminCount.textContent = `${state.users.length}명`;
  if (!state.users.length) {
    elements.adminUserList.innerHTML = `<div class="empty-state">현재 룸에는 아직 참가자가 없어요.</div>`;
    return;
  }

  const sortedUsers = [...state.users].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  elements.adminUserList.innerHTML = sortedUsers
    .map(
      (user) => `
        <article class="admin-user-card ${user.status === "pending" ? "pending-user" : ""}" data-user="${user.id}">
          <div>
            <h3>${escapeHtml(user.nickname)}</h3>
            <p class="affiliation-chip">${escapeHtml(user.affiliationLabel)}</p>
            ${user.statusMessage ? `<p class="status-message compact">${escapeHtml(user.statusMessage)}</p>` : ""}
            <p class="approval-status">${user.status === "pending" ? "승인 대기" : "승인됨"}</p>
            <p class="admin-user-meta">SIGNAL ${user.signalRemaining}/${user.signalLimit} · OPEN ${user.openSignalRemaining}/${user.openSignalLimit} · 회수 ${user.revokeRemaining}/${user.revokeLimit} · 받은 SIGNAL ${user.receivedCount}</p>
          </div>
          ${
            user.status === "pending"
              ? `<button class="primary-button approve-button" type="button" data-approve="${user.id}">입장 승인</button>`
              : ""
          }
          <form class="grant-form">
            <label>
              <span>추가 SIGNAL</span>
              <input name="addSignal" type="number" min="0" step="1" value="1" />
            </label>
            <label>
              <span>추가 OPEN</span>
              <input name="addOpenSignal" type="number" min="0" step="1" value="0" />
            </label>
            <label>
              <span>추가 회수권</span>
              <input name="addRevoke" type="number" min="0" step="1" value="0" />
            </label>
            <button class="ghost-button" type="submit">추가</button>
          </form>
        </article>
      `
    )
    .join("");
}

function renderStorage() {
  if (!state.storage) {
    elements.adminStorageStatus.textContent = "";
    return;
  }

  elements.adminStorageStatus.textContent =
    `DB: ${state.storage.databasePath} · 백업: ${state.storage.backupDir} · ` +
    `자동 초기화 ${state.storage.allowDatabaseBootstrap ? "켜짐" : "꺼짐"}`;
}

function applyRoom(room) {
  if (!room) return;
  state.roomCode = room.code;
  elements.adminEventCode.value = room.code;
  elements.adminSignalLimit.value = room.signalLimit;
  elements.adminOpenSignalLimit.value = room.openSignalLimit;
  elements.adminRevokeLimit.value = room.revokeLimit;
}

async function loadDashboard(roomCode = state.roomCode) {
  const query = roomCode ? `?roomCode=${encodeURIComponent(roomCode)}` : "";
  const data = await adminRequest(`/api/admin/status${query}`);
  state.rooms = data.rooms;
  state.storage = data.storage;
  applyRoom(data.room || data.rooms[0]);
  state.users = data.users;
  renderRooms();
  renderUsers();
  renderStorage();
  setDashboardVisible(true);
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  state.adminKey = elements.adminKey.value.trim();
  showLoginError();
  try {
    await loadDashboard();
    localStorage.setItem("gamesSyncAdminKey", state.adminKey);
    showToast("관리자 페이지를 열었어요.");
  } catch (error) {
    showLoginError(error.message);
  }
});

elements.roomSelect.addEventListener("change", async () => {
  try {
    await loadDashboard(elements.roomSelect.value);
  } catch (error) {
    showToast(error.message);
  }
});

elements.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await adminRequest("/api/admin/settings", {
      method: "POST",
      body: JSON.stringify({
        roomCode: state.roomCode,
        eventCode: elements.adminEventCode.value,
        signalLimit: elements.adminSignalLimit.value,
        openSignalLimit: elements.adminOpenSignalLimit.value,
        revokeLimit: elements.adminRevokeLimit.value,
        newAdminKey: elements.newAdminKey.value
      })
    });
    if (data.adminKeyChanged) {
      state.adminKey = elements.newAdminKey.value;
      localStorage.setItem("gamesSyncAdminKey", state.adminKey);
      elements.adminKey.value = state.adminKey;
      elements.newAdminKey.value = "";
    }
    showToast(data.resetSignals ? "입장 코드가 변경되어 현재 룸의 SIGNAL 기록과 회수 기록이 초기화됐어요." : "룸 설정을 저장했어요.");
    await loadDashboard(data.room.code);
  } catch (error) {
    showToast(error.message);
  }
});

elements.createRoomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await adminRequest("/api/admin/rooms", {
      method: "POST",
      body: JSON.stringify({
        code: elements.newRoomCode.value,
        signalLimit: elements.newRoomSignalLimit.value,
        openSignalLimit: elements.newRoomOpenSignalLimit.value,
        revokeLimit: elements.newRoomRevokeLimit.value
      })
    });
    elements.newRoomCode.value = "";
    showToast("새 룸을 만들었어요.");
    await loadDashboard(data.room.code);
  } catch (error) {
    showToast(error.message);
  }
});

elements.adminRefresh.addEventListener("click", async () => {
  try {
    await loadDashboard();
    showToast("새로고침했어요.");
  } catch (error) {
    showToast(error.message);
  }
});

elements.adminUserList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-approve]");
  if (!button) return;
  button.disabled = true;
  try {
    await adminRequest("/api/admin/users/approve", {
      method: "POST",
      body: JSON.stringify({
        roomCode: state.roomCode,
        userId: button.dataset.approve
      })
    });
    showToast("입장을 승인했어요.");
    await loadDashboard();
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
});

elements.adminUserList.addEventListener("submit", async (event) => {
  const form = event.target.closest(".grant-form");
  if (!form) return;
  event.preventDefault();
  const card = event.target.closest("[data-user]");
  try {
    await adminRequest("/api/admin/users/grant", {
      method: "POST",
      body: JSON.stringify({
        roomCode: state.roomCode,
        userId: card.dataset.user,
        addSignal: form.elements.addSignal.value,
        addOpenSignal: form.elements.addOpenSignal.value,
        addRevoke: form.elements.addRevoke.value
      })
    });
    showToast("참가자의 SIGNAL 개수를 추가했어요.");
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  }
});

async function boot() {
  if (state.adminKey) {
    elements.adminKey.value = state.adminKey;
    try {
      await loadDashboard();
    } catch {
      setDashboardVisible(false);
    }
  }
}

boot();
