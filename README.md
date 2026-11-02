# 마이플래너 (MyPlanner)

도착해야 하는 시간만 넣으면, 이동수단에 맞춰 **거꾸로 계산해서 기상·출발 시간을 알려 주고 알람으로 깨워 주는** 전 국민용 플래너입니다.
직장인·자영업자·주부·학생 누구나 쓸 수 있도록 만들었고, 버디플래너(골프)·매니저플래너(엔터 매니저)의 역산 타임라인 구조를 이어받았습니다.

## 주요 기능
- **6가지 이동수단**: 버스·지하철, 자가용, 택시, 도보, 기차, 비행기
- **실제 경로 가져오기**
  - 버스·지하철 → ODsay (노선번호·환승·정류장 수·요금, 경로 후보 여러 개 중 선택)
  - 자가용·택시 → 티맵 (도착 시각 기준 예측 교통)
  - 도보 → 티맵 보행자 경로
  - 기차·비행기 → 예매한 열차/항공편 시각 입력 + 역·공항까지 가는 경로 자동 조회 (승강장 15분, 국내선 40분, 국제선 150분 전 도착)
- **역산 계산**: 약속 시간 − 여유 − 이동(+대기/주차) − 준비 = 기상 시간
- **알림 4종**: 전날 밤 9시 미리 안내 · 기상 알람 · 출발 10분 전 · 출발 알람 (안드로이드 로컬 알림, 앱이 꺼져 있어도 울림)
- **실시간 재계산**: 출발 전 "실시간 경로로 다시 계산"을 누르면 교통 변화를 반영해 알람을 당기거나 미룸
- 카카오맵·티맵·카카오T 바로 열기, 월간 캘린더, 키 없이도 동작하는 추정 모드

## 폴더 구조
```
index.html          화면 틀
css/app.css         스타일
js/planner.js       ★ 역산 엔진 (화면과 무관한 순수 계산)
js/routes.js        장소 검색 · ODsay · 티맵 · 길안내 링크
js/alarm.js         기상·출발 알람 (Capacitor 로컬 알림 / 웹 알림)
js/core.js          공통 도구(U) · 저장소(State)
js/home.js          홈 · 캘린더
js/register.js      일정 등록·수정
js/timeline.js      타임라인 · 설정
js/app.js           라우터 · 장소 검색 시트 · 첫 화면
js/config.example.js  API 키 예시 → config.js로 복사
test/planner.test.js  역산 계산 확인 (node test/planner.test.js)
```

## API 키
`js/config.example.js`를 `js/config.js`로 복사해 키를 넣으세요. (config.js는 깃허브에 올라가지 않음)

| 키 | 발급처 | 용도 |
|---|---|---|
| `ODSAY_API_KEY` | lab.odsay.com | 버스·지하철 경로 |
| `TMAP_APP_KEY` | openapi.sk.com (버디플래너 키 재사용 가능) | 자가용·택시·도보, 장소 검색 |
| `KAKAO_REST_KEY` | developers.kakao.com | 장소 검색 (티맵 키 없을 때) |

- ODsay 콘솔에서 앱 플랫폼으로 등록할 때, Capacitor 앱의 웹뷰 주소 `https://localhost`를 URI로 함께 등록해 두세요.
- 키가 없어도 앱은 거리 기반 추정치로 동작하고, 화면에 "추정" 표시가 나옵니다. 앱 안의 **설정 > 개발자 설정**에서 키를 임시로 넣어 테스트할 수도 있습니다.

## 실행 · 빌드
```bash
# 웹으로 확인
npx serve .            # 또는 python -m http.server

# 안드로이드 앱
npm install
npx cap add android    # 처음 한 번
npm run android        # www 빌드 → 동기화 → 안드로이드 스튜디오 열기
```
안드로이드 12 이상에서 정확한 시각에 알람이 울리려면 `android/app/src/main/AndroidManifest.xml`에 다음 권한을 추가하세요.
```xml
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## 다음 단계 (예정)
- 화면을 덮는 전체 화면 기상 알람 (버디플래너의 NativeApp 알람 코드 이식)
- 아침 기상 직후 자동 실시간 재계산 → 늦어지면 바로 알림
- 반복 일정 (매일 출근 등), 카카오/구글 로그인 + Supabase 동기화, PRO 구독
- 코레일·SRT·항공 시간표 공공데이터 연동
- CEO 플래너 (같은 엔진에 비서 공유·다중 일정 동선 추가)
