(function () {
  "use strict";

  var config = window.SC_VACANCY_CONFIG;
  var dayOrder = ["mon", "tue", "wed", "thu", "fri", "sat"];
  var dayNames = {
    mon: "월요일",
    tue: "화요일",
    wed: "수요일",
    thu: "목요일",
    fri: "금요일",
    sat: "토요일"
  };
  var state = {
    branch: "gagyeong",
    day: "mon",
    data: null,
    sampleMode: false,
    error: false,
    realtime: false,
    pollTimer: null
  };

  var sampleData = {
    updatedAt: "2026-07-27T12:00:00+09:00",
    basisDate: "2026-09-01",
    branches: {
      gagyeong: {
        mon: slotSet([14, 15, 17, 18, 20]),
        tue: slotSet([14, 16, 17, 19]),
        wed: slotSet([14, 15, 16, 18, 20]),
        thu: slotSet([15, 16, 18, 19]),
        fri: slotSet([14, 17, 18, 20]),
        sat: slotSet([9, 10, 12, 13])
      },
      yongam: {
        mon: slotSet([14, 16, 17, 19]),
        tue: slotSet([14, 15, 17, 18, 20]),
        wed: slotSet([15, 16, 18, 19]),
        thu: slotSet([14, 16, 17, 20]),
        fri: slotSet([14, 15, 18, 19, 20]),
        sat: slotSet([9, 11, 12, 14])
      }
    }
  };

  function slotSet(availableHours) {
    var weekday = [14, 15, 16, 17, 18, 19, 20];
    var saturday = [9, 10, 11, 12, 13, 14];
    var source = availableHours.some(function (hour) { return hour < 14; }) ? saturday : weekday;
    return source.map(function (hour) {
      return { time: hour, available: availableHours.indexOf(hour) !== -1 };
    });
  }

  function getElement(id) {
    return document.getElementById(id);
  }

  function renderTabs() {
    var branchTabs = getElement("branch-tabs");
    branchTabs.innerHTML = "";
    Object.keys(config.branches).forEach(function (branchId) {
      var branch = config.branches[branchId];
      var button = document.createElement("button");
      button.type = "button";
      button.className = "segment-button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(state.branch === branchId));
      button.textContent = branch.name;
      button.addEventListener("click", function () {
        state.branch = branchId;
        render();
      });
      branchTabs.appendChild(button);
    });

    var dayTabs = getElement("day-tabs");
    dayTabs.innerHTML = "";
    dayOrder.forEach(function (dayId) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "day-button";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(state.day === dayId));
      button.textContent = dayNames[dayId].slice(0, 1);
      button.setAttribute("aria-label", dayNames[dayId]);
      button.addEventListener("click", function () {
        state.day = dayId;
        render();
      });
      dayTabs.appendChild(button);
    });
  }

  function formatHour(hour) {
    if (hour === 12) return "12시";
    if (hour > 12) return String(hour - 12) + "시";
    return String(hour) + "시";
  }

  function currentSlots() {
    var branchData = state.data && state.data.branches && state.data.branches[state.branch];
    return branchData && Array.isArray(branchData[state.day]) ? branchData[state.day] : [];
  }

  function slotLevel(slot) {
    var level = String(slot && slot.availabilityLevel || "");
    if (level === "last" || level === "twoPlus" || level === "none") return level;
    return slot && slot.available ? "twoPlus" : "none";
  }

  function slotStatus(level) {
    if (level === "last") return "마감 임박";
    if (level === "twoPlus") return "등록 가능";
    return "불가";
  }

  function renderSchedule() {
    var branch = config.branches[state.branch];
    getElement("selected-branch").textContent = "슈퍼차일드 " + branch.name;
    getElement("selected-day").textContent = dayNames[state.day];
    var basisMonth = state.data && String(state.data.basisMonth || "");
    var basisNumber = Number(basisMonth.slice(5, 7)) || 9;
    getElement("basis-label").textContent = basisNumber + "월 수업 시작 기준";

    var list = getElement("time-list");
    list.innerHTML = "";
    var slots = currentSlots();
    if (!slots.length) {
      var empty = document.createElement("div");
      empty.className = "schedule-error";
      empty.textContent = state.error ?
        "현황을 불러오지 못했습니다. 잠시 후 다시 확인해주세요." :
        "등록 현황을 준비하고 있습니다.";
      list.appendChild(empty);
      return;
    }
    slots.forEach(function (slot) {
      var level = slotLevel(slot);
      var row = document.createElement("div");
      row.className = "time-row " + (level === "none" ? "full" : "available") + " " + level;
      row.setAttribute("role", "row");

      var time = document.createElement("span");
      time.className = "time-label";
      time.setAttribute("role", "cell");
      time.textContent = formatHour(slot.time);

      var status = document.createElement("span");
      status.className = "status-wrap";
      status.setAttribute("role", "cell");
      status.innerHTML = '<span class="status-mark" aria-hidden="true"></span>' +
        slotStatus(level);

      row.appendChild(time);
      row.appendChild(status);

      row.setAttribute("aria-label", dayNames[state.day] + " " + formatHour(slot.time) +
        " " + slotStatus(level));
      list.appendChild(row);
    });
  }

  function renderContact() {
    var branch = config.branches[state.branch];
    var talkLink = getElement("naver-talk-link");
    var phoneLink = getElement("phone-link");
    getElement("contact-branch").textContent = branch.name;
    getElement("contact-phone").textContent = branch.phoneLabel;
    talkLink.href = branch.naverTalkUrl;
    talkLink.setAttribute("aria-label", branch.name + " 네이버 톡톡 문의");
    phoneLink.href = "tel:" + branch.phone;
    phoneLink.setAttribute("aria-label", branch.name + " " + branch.phoneLabel + " 전화하기");
  }

  function renderSyncState() {
    var wrapper = document.querySelector(".sync-state");
    var label = getElement("sync-label");
    wrapper.classList.toggle("sample", state.sampleMode);
    wrapper.classList.toggle("online", !state.sampleMode && !state.error);
    wrapper.classList.toggle("error", state.error);
    if (state.error) {
      label.textContent = "현황 연결 확인 필요";
      return;
    }
    if (state.sampleMode) {
      label.textContent = "로컬 샘플";
      return;
    }
    label.textContent = (state.realtime ? "실시간 · " : "") + updatedLabel(state.data && state.data.updatedAt);
  }

  function updatedLabel(value) {
    var updated = new Date(value || "");
    if (Number.isNaN(updated.getTime())) return "최근 현황 반영";
    var minutes = Math.max(0, Math.floor((Date.now() - updated.getTime()) / 60000));
    if (minutes < 1) return "방금 반영";
    if (minutes < 60) return minutes + "분 전 반영";
    return "최근 현황 반영";
  }

  function render() {
    renderTabs();
    renderSchedule();
    renderContact();
    renderSyncState();
    if (window.lucide) window.lucide.createIcons();
  }

  async function fetchJSON(url) {
    var separator = url.indexOf("?") === -1 ? "?" : "&";
    var response = await fetch(url + separator + "t=" + Date.now(), {
      cache: "no-store"
    });
    if (!response.ok) throw new Error("availability fetch failed");
    var data = await response.json();
    if (!data || !data.branches) throw new Error("availability payload invalid");
    return data;
  }

  function isLocalPreview() {
    return location.hostname === "127.0.0.1" || location.hostname === "localhost";
  }

  async function loadAvailability() {
    try {
      state.data = await fetchJSON(config.dataUrl);
      state.sampleMode = false;
      state.error = false;
    } catch (error) {
      if (isLocalPreview() && config.localFallbackDataUrl) {
        try {
          state.data = await fetchJSON(config.localFallbackDataUrl);
          state.sampleMode = true;
          state.error = false;
        } catch (sampleError) {
          state.data = sampleData;
          state.sampleMode = true;
          state.error = false;
        }
      } else {
        state.data = {basisMonth: "2026-09", branches: {}};
        state.sampleMode = false;
        state.error = true;
      }
    }
    render();
  }

  function startPolling() {
    if (state.pollTimer) return;
    state.pollTimer = window.setInterval(loadAvailability, config.refreshMs);
  }

  function stopPolling() {
    if (!state.pollTimer) return;
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function mergeRealtimeBranch(branchId, documentData) {
    var data = documentData && typeof documentData === "object" ? documentData : {};
    if (!data.days || typeof data.days !== "object") return;
    if (!state.data || typeof state.data !== "object") state.data = {branches: {}};
    if (!state.data.branches) state.data.branches = {};
    state.data.branches[branchId] = data.days;
    state.data.basisMonth = data.basisMonth || state.data.basisMonth || "2026-09";
    state.data.basisDate = data.basisDate || state.data.basisDate || "";
    if (data.updatedAtIso && String(data.updatedAtIso) > String(state.data.updatedAt || "")) {
      state.data.updatedAt = data.updatedAtIso;
    }
    state.sampleMode = false;
    state.error = false;
    state.realtime = true;
    stopPolling();
    render();
  }

  function startRealtime() {
    if (!window.firebase || !window.firebase.firestore || !config.firebaseConfig) {
      startPolling();
      return;
    }
    try {
      if (!window.firebase.apps.length) window.firebase.initializeApp(config.firebaseConfig);
      var firestore = window.firebase.firestore();
      Object.keys(config.branches).forEach(function (branchId) {
        firestore.collection("publicRegularAvailability").doc(branchId).onSnapshot(function (snapshot) {
          if (snapshot.exists) mergeRealtimeBranch(branchId, snapshot.data());
        }, function () {
          state.realtime = false;
          startPolling();
          renderSyncState();
        });
      });
    } catch (error) {
      state.realtime = false;
      startPolling();
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadAvailability().finally(startRealtime);
  });
})();
