# 마이플래너 출시 준비 가이드

## 한눈에 보는 할 일 (2026-11-04 정리)

**A. 폰으로 지금 할 수 있는 일**
☐ 1. GitHub Pages 켜기 → 아이폰에서 앱 확인 (아래 1번)
☐ 2. 카카오 디벨로퍼스에서 REST API 키 확인 → Supabase Secrets에 `MYPLANNER_KAKAO_REST_KEY` (장소 검색)
☐ 3. 티맵 키 → `MYPLANNER_TMAP_APP_KEY` (자동차·도보 시간, 아침 실시간 재계산)
☐ 4. ODsay 키(웹 URI `https://ktj8824-stack.github.io` 등록) → `MYPLANNER_ODSAY_API_KEY`, `MYPLANNER_ODSAY_REFERER` (버스·지하철)
☐ 5. Supabase → Authentication → URL Configuration → Redirect URLs에 `https://ktj8824-stack.github.io/myplanner/`
✅ 6. 가족 공유·로그인·AI 사용량 테이블 적용 완료 (2026-11-04)
☐ 7. AI 비서: Claude API 키 → `MYPLANNER_ANTHROPIC_API_KEY` (+ 시험용 `MYPLANNER_AI_ALLOW_ALL`=`true`)
☐ 8. privacy.html·terms.html의 [운영자명]·[문의 이메일] 정하기
☐ 9. 로드 플래너(매니저 플래너)에 노출된 카카오·티맵 키 재발급

**B. 노트북으로 할 일**
☐ 1. 개발 도구 설치: Node.js, Android Studio, Git
☐ 2. `git clone` → `npm install` → `npx cap add android` → `npm run android`
☐ 3. 카카오 앱에 안드로이드 플랫폼(패키지 `kr.myplanner.app` + 키 해시) 추가, OpenID Connect 켜기
☐ 4. 폰에 설치해 확인: 잠금 화면 알람 · 재부팅 후 알람 · 앱 끈 채 실시간 재계산 · 위젯 · 문자 공유
☐ 5. 서명 키 만들기 → 출시용 AAB 빌드

**C. 출시할 때**
☐ 1. 구글 플레이 개발자 계정 (1회 25달러)
☐ 2. 앱 콘텐츠 신고: 전체 화면 알람·정확한 알람·데이터 보안 (아래 3번)
☐ 3. 스토어 등록정보·스크린샷 (아래 4번, 예시 일정으로 찍기)
☐ 4. `MYPLANNER_AI_ALLOW_ALL` 삭제 (AI 답변 신고 기능은 ✅ 추가됨 — 신고는 Supabase > Table Editor > mp_ai_reports에서 확인)
☐ 5. 날씨: 상업용 출시 전 Open-Meteo 유료 또는 기상청 API로 교체(Claude에게 요청)

---

폰으로 할 수 있는 일부터 순서대로 정리했습니다. ☐ 칸은 직접 할 일입니다.

---

## 1. 웹 버전 켜기 — GitHub Pages (폰 브라우저 1분)

☐ github.com/ktj8824-stack/myplanner 접속 → **Settings** (폰은 화면 위 ··· 메뉴 안)
☐ 왼쪽 메뉴 **Pages** → Source: **Deploy from a branch** → Branch: **main**, 폴더 **/(root)** → **Save**
☐ 1~2분 뒤 주소가 생깁니다: **https://ktj8824-stack.github.io/myplanner/**

- 이 주소로 폰에서 바로 써 볼 수 있습니다. (웹에서는 앱을 열어 둔 동안만 알람이 울리고, 키가 없으면 거리로 추정한 시간이 나옵니다)
- 개인정보처리방침 주소도 함께 생깁니다 → 플레이 콘솔에 넣을 주소:
  **https://ktj8824-stack.github.io/myplanner/privacy.html**

---

## 2. API 키 숨기기 — Supabase 경로 함수 ✅ 배포 완료

Supabase 무료 플랜의 프로젝트 2개가 이미 차 있어서, **버디플래너 프로젝트에 함수를 함께** 올렸습니다.
(이름이 달라 버디플래너 기능과 섞이지 않고, 나중에 별도 프로젝트로 옮길 수 있습니다. 무료 호출 한도는 두 앱이 나눠 씁니다.)

- 함수 이름: `myplanner-route` (JWT 검증 켜짐)
- 주소: `https://iaccdqcthhtvvetmbryr.supabase.co/functions/v1/myplanner-route`
- 공개 키: 버디플래너 프로젝트의 **legacy anon 키** (`eyJ`로 시작). `sb_publishable_` 키는 이 함수에서 거절됩니다.

### 남은 일: 키 넣기 (폰 브라우저)
☐ supabase.com → **buddyplanner** 프로젝트 → **Edge Functions → Secrets** → 아래 값 추가
  (장소 검색만 먼저 살리려면 카카오 키 하나면 됩니다)
  | 이름 | 값 |
  |---|---|
  | `MYPLANNER_KAKAO_REST_KEY` | 카카오 디벨로퍼스 > 내 애플리케이션 > 앱 키 > REST API 키 (장소 검색, 무료) |
  | `MYPLANNER_TMAP_APP_KEY` | 티맵 앱키 (버디플래너 키 재사용 가능) |
  | `MYPLANNER_ODSAY_API_KEY` | ODsay 키 |
  | `MYPLANNER_ODSAY_REFERER` | `https://ktj8824-stack.github.io` |
☐ ODsay LAB에서 키를 **웹(URI)** 플랫폼으로 만들고 URI에 `https://ktj8824-stack.github.io` 등록

> 키는 대화창에 붙여 넣지 말고 Supabase 화면에 직접 넣으세요.
> 버디플래너에 이미 `TMAP_APP_KEY`라는 비밀값이 있으면 함수가 그것을 대신 씁니다.

### 확인 방법
서버 주소와 공개 키는 `js/defaults.js`에 이미 들어 있어 웹·앱 모두 따로 설정할 것이 없습니다.
→ 일정 추가에서 장소를 검색해 실제 결과가 나오면 성공. "장소 검색 서버가 준비 중"이 나오면 키가 아직 안 들어간 것입니다.

함수가 막아 주는 것: 한국 밖 좌표, 정해진 5가지 외의 요청, 사용자(IP)당 1분 60회 초과. 같은 요청은 1분간 재사용해 호출 비용을 줄입니다.

> 참고: ODsay 웹 키가 서버 호출을 거절하면 ODsay LAB에서 **서버** 플랫폼 키 사용 가능 여부를 확인하세요. 티맵은 이런 제한이 없습니다.

---

## 2-1. 로그인 · 가족 공유 켜기 (앱 코드는 완성, 서버 설정만 남음)

로그인(카카오)·여러 기기 동기화·가족 공유는 버디플래너 Supabase 프로젝트에 **mp_ 로 시작하는 새 테이블**을 써요. 버디플래너 테이블은 건드리지 않아요.

☐ **데이터베이스 테이블 만들기** — Claude에게 "가족 공유 테이블 적용해"라고 하면 승인 창이 떠요 → 승인
  (또는 Supabase → buddyplanner → SQL Editor에 `supabase/migrations/001_myplanner_sync_family.sql`을 붙여넣고 Run)
☐ **웹 로그인 후 돌아올 주소 등록** — Supabase → Authentication → URL Configuration → Redirect URLs에
  `https://ktj8824-stack.github.io/myplanner/` 추가
☐ (앱 빌드할 때) 카카오 디벨로퍼스 → 버디플래너가 쓰는 카카오 앱에 안드로이드 플랫폼 추가
  (패키지 `kr.myplanner.app` + 키 해시), **OpenID Connect 켜기**, `npm i @team-lepisode/capacitor-kakao-login` (버디플래너와 같은 플러그인)

알아 둘 점
- 카카오 계정은 버디플래너와 **같은 계정**으로 묶여요 (같은 사람이면 같은 사용자). 데이터는 분리돼요.
- 버디플래너에서 회원 탈퇴하면 계정이 지워져 마이플래너 서버 데이터도 함께 지워져요.
- 가족 폰은 **마이플래너를 열 때** 공유받은 일정을 받아요. 앱을 안 열어도 바로 받게 하려면 푸시 알림(FCM)이 필요해요 — 다음 단계.
- 로그인 없이도 **📤 카톡으로 보내기**(링크)는 지금 바로 동작해요. 받은 사람이 링크를 누르면 자기 폰 알람에 추가돼요.

---

## 2-2. AI 비서 켜기 (PRO 핵심 기능)

서버 함수 `myplanner-ai`는 배포돼 있어요. 아래만 하면 바로 써요.
☐ 위 2-1의 **테이블 적용**에 AI 사용량 테이블(mp_ai_usage)도 들어 있어요 — 같이 승인
☐ Claude API 키: 버디플래너용 `ANTHROPIC_API_KEY`가 이미 있으면 그대로 써요. 따로 관리하려면 Secrets에 `MYPLANNER_ANTHROPIC_API_KEY` 추가
☐ 출시 전 시험: Secrets에 `MYPLANNER_AI_ALLOW_ALL` = `true` (모두 PRO 취급) → **출시 전 꼭 삭제**
☐ 한도 조정(선택): `MYPLANNER_AI_FREE_DAILY`(기본 5), `MYPLANNER_AI_PRO_DAILY`(기본 60)
☐ PRO 결제 연결(나중): RevenueCat에 마이플래너 앱 추가 → `MYPLANNER_REVENUECAT_SECRET_KEY`, 권한 이름 `pro`

구글 플레이 '생성형 AI' 정책: ✅ AI 답변마다 '답변 신고' 버튼 (mp_ai_reports, 운영자만 열람)

**AI 말 알아듣기 평가 (선택, 노트북):** 프롬프트를 고친 뒤 `ANTHROPIC_API_KEY=키 npm run eval:ai` → 40~60대 말 30문장 통과 수 확인 (test/ai-eval/cases.json)

---

## 2-3. 이용권 결제 · 광고 포인트 — 배포 순서 (2026-11-12)

순서를 바꾸면 결제·적립이 막혀요.

1. **DB 먼저**: `supabase/migrations/005_myplanner_points_raffle.sql` 적용 → 이 SQL이 결제 표의 `plan` 제약을 `pro·plus·premium`으로 풀어 줘요.
   이걸 하기 전에 새 결제 함수를 올리면 플러스 결제가 '저장소 오류'로 막혀요. ✅ 적용 완료
2. **결제 함수**: `supabase/functions/payments` → `myplanner-payments` (verify_jwt=true). ✅ v6 (가상계좌 차단 포함)
3. **광고 포인트 서버 확인(SSV)**: `supabase/functions/admob-ssv` → `myplanner-admob-ssv` (**verify_jwt=false** — 구글이 직접 부름). ✅ v1
4. **애드몹 콘솔**: 보상형 광고 단위 → 서버 측 확인 → 콜백 URL에
   `https://iaccdqcthhtvvetmbryr.supabase.co/functions/v1/myplanner-admob-ssv` 입력 → '확인'.
5. **적립 방식 전환**: `update mp_settings set value='ssv' where key='ad_reward_mode';` ✅ 2026-11-12 전환
   (되돌리면 앱이 직접 적립 → 광고 없이 함수만 불러도 포인트가 쌓일 수 있어요. 애드몹 테스트 때만 잠깐 'client')

## 3. 구글 플레이 콘솔 — 권한 신고 (출시할 때)

플레이 콘솔 → 앱 → **앱 콘텐츠(Monitor and improve > App content)**

### 3-1. 전체 화면 인텐트 (USE_FULL_SCREEN_INTENT)
Android 14부터 **알람·통화 앱만 자동 허용**되고, 신고가 필요합니다.
- 선택: **알람 기능이 핵심 기능임** (Setting an alarm)
- 설명 예시:
  > 마이플래너는 이용자가 정한 도착 시간에서 거꾸로 계산한 기상·출발 시각에 사용자를 깨우는 알람 앱입니다.
  > 기상 알람과 출발 알람이 울릴 때 잠금 화면 위에 전체 화면 알람을 표시하여 사용자가 알람을 끄거나 5분 뒤로 미룰 수 있게 합니다.
  > 전체 화면 표시는 이 두 알람에만 사용합니다.
- 승인되지 않아도 앱은 동작합니다: 설정 > 알람 점검에서 사용자가 직접 허용하도록 안내합니다.

### 3-2. 정확한 알람 (USE_EXACT_ALARM)
알람시계·캘린더 앱은 설치할 때 바로 허용됩니다. 신고 화면이 나오면:
- 핵심 기능: **알람시계 / 캘린더** — "사용자가 등록한 일정에 맞춰 정해진 시각에 기상·출발 알람을 울리는 알람·일정 앱"
- **거절되면**: `scripts/install-native-alarm.js`에서 `USE_EXACT_ALARM` 줄을 지우고 다시 빌드 → 사용자가 '알람 및 리마인더'를 직접 허용하는 방식(앱이 안내)으로 동작합니다.

### 3-3. 데이터 보안(Data safety) 설문 — 권장 답변
일정은 폰에만 저장되지만, 경로 계산을 위해 **좌표·검색어가 폰 밖(티맵·ODsay, 중계 서버)으로 전송**되므로 "수집"으로 답합니다.

| 항목 | 답변 |
|---|---|
| 데이터 수집·공유 여부 | 수집함 |
| 위치 > 정밀한 위치 | 수집 ✔ / 공유 ✘ (서비스 제공업체 처리) / **일시적으로만 처리** ✔ / 선택 사항 / 목적: 앱 기능 |
| 앱 활동 > 앱 내 검색 기록 | 수집 ✔ / 공유 ✘ / 일시적 처리 ✔ / 목적: 앱 기능 |
| 개인 정보 > 이름 · 사용자 ID | (로그인 시) 수집 ✔ / 공유 ✘ / 선택 사항 / 목적: 계정 관리·앱 기능 |
| 앱 활동 > 기타 사용자 생성 콘텐츠(일정) | (로그인 시) 수집 ✔ / 이용자가 고른 가족에게만 표시 / 선택 사항 / 목적: 앱 기능 |
| 그 외(연락처·사진·결제 등) | 수집 안 함 |
| 전송 중 암호화 | 예 (HTTPS) |
| 삭제 요청 방법 | 앱 설정 > 계정 > 서버 데이터 삭제 (로그인 안 하면 앱 삭제) |

> 로그인·가족 공유는 반영했어요. PRO 결제를 추가하면 이 설문과 개인정보처리방침을 다시 고쳐야 합니다.

### 3-4. 그 밖의 앱 콘텐츠
- 개인정보처리방침 URL: 위 1번의 privacy.html 주소
- 광고 포함: 아니요 (현재)
- 대상 연령: 만 18세 이상 또는 전체 — 아동 대상 아님
- 콘텐츠 등급 설문: 폭력·성적 내용 없음 → 전체이용가 예상

☐ privacy.html·terms.html의 **[운영자명 또는 상호]**, **[문의 이메일]** 두 곳을 채워 주세요.

---

## 4. 스토어 등록정보 초안

**앱 이름** (30자 이내)
> 마이플래너 - 출발 시간 알람

**짧은 설명** (80자 이내)
> 도착 시간만 넣으면 언제 일어나고 언제 나갈지 거꾸로 계산해서 깨워 드려요

**자세한 설명**
> 약속에 늦지 않게, 마이플래너가 거꾸로 계산해 드립니다.
>
> "9시까지 강남역" — 도착 시간과 이동수단만 정하면
> 몇 시에 일어나서 몇 시에 나가야 하는지 계산하고, 그 시간에 깨워 드려요.
>
> ■ 어떻게 가든 계산해요
> · 버스·지하철: 노선 번호, 환승, 정류장 수, 요금까지
> · 자가용·택시: 도착 시각 기준 교통 예측
> · 기차·비행기: 예매한 시각만 넣으면 역·공항까지 가는 길과 수속 시간까지
> · 도보
>
> ■ 아침에 길이 막히면 먼저 알려 드려요
> 기상 20분 전, 출발 30분 전에 실시간 교통을 다시 확인해서
> 막히면 알람을 당기고 "15분 일찍 출발하세요"라고 알려 드려요.
>
> ■ 확실하게 깨워 드려요
> · 잠금 화면 위로 뜨는 전체 화면 알람, 끌 때까지 울려요
> · 전날 밤 미리 안내, 출발 10분 전 알림
> · 휴대폰을 다시 켜도 알람이 그대로
>
> ■ 매일 출근도 한 번만 등록
> · 매일 · 평일 · 요일 반복, 공휴일엔 알아서 쉬어요
> · 하루만 시간 바꾸기, 하루만 건너뛰기
>
> ■ 바로 길안내
> 카카오맵 · 티맵 · 카카오T로 바로 연결
>
> 회원가입 없이 바로 쓰고, 일정은 내 휴대폰에만 저장돼요.

**카테고리**: 생산성 (또는 지도/내비게이션)
**태그 예시**: 알람, 일정, 출근, 길찾기, 플래너

**스크린샷 추천 순서** (휴대폰 세로 화면 4~6장)
1. 홈 — "내일 06:47 기상 · 07:47 출발" 카드
2. 일정 추가 — 이동수단 6개 선택 화면
3. 타임라인 — 기상부터 도착까지 한눈에
4. 실시간 교통 반영 — "길이 막혀요, 15분 일찍"
5. 전체 화면 알람
6. 반복 출근 + 공휴일 쉬기

---

## 5. 노트북이 생기면 할 일 (참고)
1. `git pull` → `npm install` → `npx cap add android` → `npm run android`
2. 폰에 설치해 확인: 잠금 화면 알람 · 재부팅 후 알람 · 앱을 끈 채 기상 20분 전 교통 재확인 알림
3. 빌드 오류나 이상한 동작은 메시지·화면을 Claude에게 보내면 바로 수정
