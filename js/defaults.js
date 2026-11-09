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
  KAKAO_REST_KEY: '',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhY2NkcWN0aGh0dnZldG1icnlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MzM1MDksImV4cCI6MjEwOTAwOTUwOX0.WUuGsdr-mG0gEqhEFQTS0ew8Kr6uy9l7PZ6pXe5zbRM'
};
