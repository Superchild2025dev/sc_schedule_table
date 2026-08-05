window.SC_VACANCY_CONFIG = Object.freeze({
  dataUrl: "https://asia-northeast3-scswimming-schedule.cloudfunctions.net/regularAvailability",
  firebaseConfig: Object.freeze({
    apiKey: "AIzaSyArHQQfHnVreH8gVamyl1e5IqUDfXUJ5F8",
    authDomain: "scswimming-schedule.firebaseapp.com",
    projectId: "scswimming-schedule",
    storageBucket: "scswimming-schedule.firebasestorage.app",
    messagingSenderId: "45509278949",
    appId: "1:45509278949:web:f16989a9c416f06e25e80c"
  }),
  localFallbackDataUrl: "./data/availability.json",
  refreshMs: 15000,
  branches: {
    gagyeong: {
      name: "가경점",
      phone: "0437152019",
      phoneLabel: "043-715-2019",
      naverTalkUrl: "https://talk.naver.com/profile/wdvor89"
    },
    yongam: {
      name: "용암점",
      phone: "0432882016",
      phoneLabel: "043-288-2016",
      naverTalkUrl: "https://talk.naver.com/profile/w8swi5f"
    }
  }
});
