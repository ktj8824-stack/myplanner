/* =========================================
   MyPlanner — 공개 기본값 (깃허브에 올라가도 되는 값만)
   - 경로·검색 서버 함수 주소와 Supabase 공개(anon) 키입니다.
   - 실제 API 키(티맵·ODsay·카카오)는 여기 없고 서버 함수의 비밀값에만 있습니다.
   - js/config.js나 설정 > 개발자 설정 값이 있으면 그쪽이 우선합니다.
   ========================================= */
window.APP_DEFAULTS = {
  ROUTE_PROXY_URL: 'https://iaccdqcthhtvvetmbryr.supabase.co/functions/v1/myplanner-route',
  // 카카오 '네이티브 앱 키' (마이플래너 전용 카카오 앱 · 앱 안에 들어가는 공개 값, REST 키 아님)
  KAKAO_NATIVE_APP_KEY: '76014afcf1968e5e75b1976ada2896de',
  // 웹 카카오 로그인용 'REST API 키' (같은 마이플래너 카카오 앱 · 로그인 주소에 들어가는 공개 값). 비밀 키(Client Secret)는 서버에만
  KAKAO_LOGIN_REST_KEY: '',
  // 출시 기념 무료: 이 날까지 모든 기능 무료(광고는 나옴), 결제는 받지 않음
  PROMO_UNTIL: '2027-03-31T23:59:59+09:00',
  // 이용권(플러스·프리미엄) 결제 — 토스 '클라이언트 키'(공개 값). 지금은 토스 문서 공개 테스트 키 (실제 돈 안 나감). 비밀 키는 서버에만
  TOSS_CLIENT_KEY: 'test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm',
  // 앱 구독(애플·구글) — RevenueCat 공개 API 키 (appl_… / goog_…). 비밀 키는 서버에만
  REVENUECAT_IOS_KEY: '',
  REVENUECAT_ANDROID_KEY: '',
  // 광고 — 구글 애드몹 '광고 단위 ID'(공개 값). 비어 있으면 구글 테스트 광고(Test Ad)로 나옴
  ADMOB_BANNER_IOS: '',
  ADMOB_BANNER_ANDROID: '',
  // 웹 광고 — 카카오 애드핏 광고 단위 ID (DAN-…). 비어 있으면 웹에는 광고 없음
  ADFIT_UNIT_ID: '',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhY2NkcWN0aGh0dnZldG1icnlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MzM1MDksImV4cCI6MjEwOTAwOTUwOX0.WUuGsdr-mG0gEqhEFQTS0ew8Kr6uy9l7PZ6pXe5zbRM'
};
