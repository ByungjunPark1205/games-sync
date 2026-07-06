const state = {
  adminKey: localStorage.getItem("gamesSyncAdminKey") || "",
  rooms: [],
  roomCode: "",
  users: [],
  circles: { draft: null, active: null },
  fixedGroups: []
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  loginPanel: $("#adminLoginPanel"),
  dashboard: $("#adminDashboard"),
  createRoomPanel: $("#createRoomPanel"),
  circleAdminPanel: $("#circleAdminPanel"),
  participantsPanel: $("#participantsPanel"),
  loginForm: $("#adminLoginForm"),
  settingsForm: $("#adminSettingsForm"),
  createRoomForm: $("#createRoomForm"),
  circleForm: $("#circleForm"),
  adminKey: $("#adminKey"),
  adminLoginError: $("#adminLoginError"),
  roomSelect: $("#roomSelect"),
  adminStorageStatus: $("#adminStorageStatus"),
  deleteRoomButton: $("#deleteRoomButton"),
  adminEventCode: $("#adminEventCode"),
  adminSignalLimit: $("#adminSignalLimit"),
  adminOpenSignalLimit: $("#adminOpenSignalLimit"),
  adminRevokeLimit: $("#adminRevokeLimit"),
  newAdminKey: $("#newAdminKey"),
  newRoomCode: $("#newRoomCode"),
  newRoomSignalLimit: $("#newRoomSignalLimit"),
  newRoomOpenSignalLimit: $("#newRoomOpenSignalLimit"),
  newRoomRevokeLimit: $("#newRoomRevokeLimit"),
  circleSize: $("#circleSize"),
  circleStatus: $("#circleStatus"),
  fixedMemberList: $("#fixedMemberList"),
  fixedGroupList: $("#fixedGroupList"),
  addFixedGroupButton: $("#addFixedGroupButton"),
  circleDraftPreview: $("#circleDraftPreview"),
  circleActivePreview: $("#circleActivePreview"),
  confirmCircleButton: $("#confirmCircleButton"),
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
  elements.circleAdminPanel.classList.toggle("hidden", !visible);
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
              ? `<div class="admin-actions">
                  <button class="primary-button approve-button" type="button" data-approve="${user.id}">입장 승인</button>
                  <button class="danger-button reject-button" type="button" data-reject="${user.id}">거절</button>
                </div>`
              : `<div class="admin-actions single-action">
                  <button class="danger-button kick-button" type="button" data-remove-user="${user.id}">퇴출</button>
                </div>`
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

function approvedUsers() {
  return state.users.filter((user) => user.status === "approved");
}

function userName(userId) {
  return state.users.find((user) => user.id === userId)?.nickname || "알 수 없음";
}

function renderFixedMemberList() {
  const users = approvedUsers();
  if (!users.length) {
    elements.fixedMemberList.innerHTML = `<div class="empty-state">승인된 참가자가 있어야 Circle을 만들 수 있어요.</div>`;
    return;
  }

  const fixedUserIds = new Set(state.fixedGroups.flat());
  elements.fixedMemberList.innerHTML = users
    .map(
      (user) => `
        <label class="fixed-member-option ${fixedUserIds.has(user.id) ? "disabled-option" : ""}">
          <input type="checkbox" value="${escapeHtml(user.id)}" ${fixedUserIds.has(user.id) ? "disabled" : ""} />
          <span>
            <strong>${escapeHtml(user.nickname)}</strong>
            <small>${escapeHtml(user.affiliationLabel || "")}</small>
          </span>
        </label>
      `
    )
    .join("");
}

function renderFixedGroups() {
  if (!state.fixedGroups.length) {
    elements.fixedGroupList.innerHTML = `<div class="empty-state compact-empty">아직 고정 묶음이 없어요.</div>`;
    return;
  }

  elements.fixedGroupList.innerHTML = state.fixedGroups
    .map(
      (group, index) => `
        <div class="fixed-group-chip">
          <span>${group.map(userName).map(escapeHtml).join(" · ")}</span>
          <button type="button" data-remove-fixed="${index}" aria-label="고정 묶음 삭제">삭제</button>
        </div>
      `
    )
    .join("");
}

function renderCirclePlan(plan, emptyMessage) {
  if (!plan || !plan.groups?.length) {
    return `<div class="empty-state">${emptyMessage}</div>`;
  }

  return plan.groups
    .map(
      (group) => `
        <article class="admin-circle-card">
          <div class="circle-card-head">
            <span>${escapeHtml(group.name)}</span>
            <strong>${group.members.length}명</strong>
          </div>
          <div class="admin-circle-members">
            ${group.members
              .map(
                (member) => `
                  <div>
                    <strong>${escapeHtml(member.nickname)}</strong>
                    <span>${escapeHtml(member.affiliationLabel || "")}</span>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      `
    )
    .join("");
}

function renderCircleAdmin() {
  const active = state.circles?.active;
  const draft = state.circles?.draft;
  elements.circleStatus.textContent = active ? "공개중" : "미공개";
  elements.confirmCircleButton.disabled = !draft;
  elements.circleDraftPreview.innerHTML = renderCirclePlan(draft, "아직 Circle 미리보기가 없어요.");
  elements.circleActivePreview.innerHTML = renderCirclePlan(active, "아직 공개된 Circle이 없어요.");
  renderFixedMemberList();
  renderFixedGroups();
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
  state.circles = data.circles || { draft: null, active: null };
  state.fixedGroups = state.circles.draft?.fixedGroups || [];
  renderRooms();
  renderUsers();
  renderCircleAdmin();
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

elements.deleteRoomButton.addEventListener("click", async () => {
  if (!state.roomCode) return;
  const confirmed = window.confirm(`${state.roomCode} 룸을 삭제할까요? 이 룸의 참가자와 SIGNAL, Circle 데이터가 함께 삭제됩니다.`);
  if (!confirmed) return;
  elements.deleteRoomButton.disabled = true;
  try {
    const data = await adminRequest("/api/admin/rooms/delete", {
      method: "POST",
      body: JSON.stringify({
        roomCode: state.roomCode
      })
    });
    await loadDashboard(data.room.code);
  } catch (error) {
    showToast(error.message);
  } finally {
    elements.deleteRoomButton.disabled = false;
  }
});

elements.addFixedGroupButton.addEventListener("click", () => {
  const selectedIds = Array.from(elements.fixedMemberList.querySelectorAll("input:checked")).map(
    (input) => input.value
  );
  if (selectedIds.length < 2) {
    elements.circleStatus.textContent = "2명 이상 선택";
    return;
  }
  state.fixedGroups.push(selectedIds);
  elements.circleStatus.textContent = "고정 묶음 추가됨";
  renderCircleAdmin();
});

elements.fixedGroupList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-fixed]");
  if (!button) return;
  state.fixedGroups.splice(Number(button.dataset.removeFixed), 1);
  elements.circleStatus.textContent = "고정 묶음 삭제됨";
  renderCircleAdmin();
});

elements.circleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await adminRequest("/api/admin/circles/draft", {
      method: "POST",
      body: JSON.stringify({
        roomCode: state.roomCode,
        size: elements.circleSize.value,
        fixedGroups: state.fixedGroups
      })
    });
    state.circles = data.circles;
    state.fixedGroups = state.circles.draft?.fixedGroups || state.fixedGroups;
    elements.circleStatus.textContent = "미리보기 생성";
    renderCircleAdmin();
  } catch (error) {
    elements.circleStatus.textContent = error.message;
  }
});

elements.confirmCircleButton.addEventListener("click", async () => {
  elements.confirmCircleButton.disabled = true;
  try {
    const data = await adminRequest("/api/admin/circles/confirm", {
      method: "POST",
      body: JSON.stringify({
        roomCode: state.roomCode
      })
    });
    state.circles = data.circles;
    state.fixedGroups = [];
    elements.circleStatus.textContent = "공개중";
    renderCircleAdmin();
  } catch (error) {
    elements.circleStatus.textContent = error.message;
    elements.confirmCircleButton.disabled = false;
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
  const removeButton = event.target.closest("[data-remove-user]");
  if (removeButton) {
    const card = removeButton.closest("[data-user]");
    const user = state.users.find((entry) => entry.id === card?.dataset.user);
    const confirmed = window.confirm(`${user?.nickname || "해당 참가자"}님을 이 룸에서 퇴출할까요? SIGNAL과 Circle 기록에서도 제거됩니다.`);
    if (!confirmed) return;
    removeButton.disabled = true;
    try {
      await adminRequest("/api/admin/users/remove", {
        method: "POST",
        body: JSON.stringify({
          roomCode: state.roomCode,
          userId: removeButton.dataset.removeUser
        })
      });
      await loadDashboard();
    } catch (error) {
      removeButton.disabled = false;
      showToast(error.message);
    }
    return;
  }

  const rejectButton = event.target.closest("[data-reject]");
  if (rejectButton) {
    const card = rejectButton.closest("[data-user]");
    const user = state.users.find((entry) => entry.id === card?.dataset.user);
    const confirmed = window.confirm(`${user?.nickname || "해당 참가자"}님의 입장을 거절할까요?`);
    if (!confirmed) return;
    rejectButton.disabled = true;
    try {
      await adminRequest("/api/admin/users/reject", {
        method: "POST",
        body: JSON.stringify({
          roomCode: state.roomCode,
          userId: rejectButton.dataset.reject
        })
      });
      await loadDashboard();
    } catch (error) {
      rejectButton.disabled = false;
      showToast(error.message);
    }
    return;
  }

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
