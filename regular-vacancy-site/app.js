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
    selectedTime: "",
    data: null,
    sampleMode: false,
    error: false
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
        state.selectedTime = "";
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
        state.selectedTime = "";
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
      var row = document.createElement(slot.available ? "button" : "div");
      if (slot.available) row.type = "button";
      row.className = "time-row " + (slot.available ? "available" : "full");
      row.setAttribute("role", "row");
      if (slot.available && String(slot.time) === state.selectedTime) {
        row.classList.add("selected");
        row.setAttribute("aria-pressed", "true");
      }

      var time = document.createElement("span");
      time.className = "time-label";
      time.setAttribute("role", "cell");
      time.textContent = formatHour(slot.time);

      var status = document.createElement("span");
      status.className = "status-wrap";
      status.setAttribute("role", "cell");
      status.innerHTML = '<span class="status-mark" aria-hidden="true"></span>' +
        (slot.available ? "자리 있음" : "자리 없음");

      row.appendChild(time);
      row.appendChild(status);

      if (slot.available) {
        row.setAttribute("aria-label", dayNames[state.day] + " " + formatHour(slot.time) + " 자리 있음");
        row.addEventListener("click", function () {
          state.selectedTime = String(slot.time);
          render();
        });
      }
      list.appendChild(row);
    });
  }

  function renderContact() {
    var branch = config.branches[state.branch];
    var phoneLink = getElement("phone-link");
    var kakaoLink = getElement("kakao-link");
    var selectedLabel = state.selectedTime ?
      dayNames[state.day] + " " + formatHour(Number(state.selectedTime)) :
      "";

    getElement("contact-branch").textContent = branch.name;
    getElement("contact-phone").textContent = branch.phoneLabel;
    phoneLink.href = "tel:" + branch.phone;
    phoneLink.setAttribute("aria-label", branch.name + " " + branch.phoneLabel + " 전화 문의");

    if (selectedLabel) {
      getElement("selection-copy").innerHTML = "<strong>" + selectedLabel + "</strong> 정규반을 상담합니다.";
    } else {
      getElement("selection-copy").textContent = "자리가 있는 시간을 선택해주세요.";
    }

    if (branch.kakaoUrl) {
      kakaoLink.href = branch.kakaoUrl;
      kakaoLink.classList.remove("is-disabled");
      kakaoLink.removeAttribute("aria-disabled");
    } else {
      kakaoLink.href = "#";
      kakaoLink.classList.add("is-disabled");
      kakaoLink.setAttribute("aria-disabled", "true");
      kakaoLink.onclick = function (event) {
        event.preventDefault();
        showToast("카카오톡 상담 링크는 추후 연결됩니다.");
      };
    }
  }

  function showToast(message) {
    var toast = getElement("toast");
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      toast.hidden = true;
    }, 2400);
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
    label.textContent = updatedLabel(state.data && state.data.updatedAt);
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

  document.addEventListener("DOMContentLoaded", function () {
    loadAvailability();
    window.setInterval(loadAvailability, config.refreshMs);
  });
})();
