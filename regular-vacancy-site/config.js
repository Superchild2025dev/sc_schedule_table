window.SC_VACANCY_CONFIG = Object.freeze({
  dataUrl: "https://asia-northeast3-scswimming-schedule.cloudfunctions.net/regularAvailability",
  localFallbackDataUrl: "./data/availability.json",
  refreshMs: 15000,
  branches: {
    gagyeong: {
      name: "가경점",
      phone: "0437152019",
      phoneLabel: "043-715-2019",
      kakaoUrl: ""
    },
    yongam: {
      name: "용암점",
      phone: "0432882016",
      phoneLabel: "043-288-2016",
      kakaoUrl: ""
    }
  }
});
