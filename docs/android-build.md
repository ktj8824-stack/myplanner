# 노트북(윈도우)에서 마이플래너 안드로이드 앱 만들기

처음 한 번만 30~40분 정도 걸려요 (대부분 설치 기다리는 시간). 막히면 화면을 찍어서 Claude에게 보내 주세요.

## 1. 도구 설치 (처음 한 번)
1. **시작 → PowerShell** 열기
2. 마이플래너를 받아 둘 폴더로 이동 후 내려받기
   ```
   cd $HOME\Documents
   git clone https://github.com/ktj8824-stack/myplanner.git
   cd myplanner
   ```
   - git이 없다고 나오면: `winget install --id Git.Git -e` → PowerShell을 닫았다 다시 열기
3. 필요한 도구 자동 설치
   ```
   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Install
   ```
   - Node.js · 안드로이드 스튜디오가 설치돼요 (관리자 허용 창이 뜨면 [예])
4. **안드로이드 스튜디오를 한 번 열어** 처음 설정에서 **Standard → Next → Finish** (SDK 내려받기, 10분쯤)
5. PowerShell을 닫았다가 다시 열기

## 2. 앱 만들기 (한 줄)
```
cd $HOME\Documents\myplanner
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```
→ 의존성 설치, 안드로이드 프로젝트 생성, 네이티브 알람·위젯·카카오 로그인 설정까지 끝나고 안드로이드 스튜디오가 열려요.

## 3. 폰에 설치
1. 폰: **설정 → 휴대전화 정보 → 소프트웨어 정보 → 빌드번호 7번 누르기** → 개발자 옵션 켜짐
2. **설정 → 개발자 옵션 → USB 디버깅 켜기**
3. USB로 노트북에 연결 → 폰에 뜨는 **[USB 디버깅 허용]**
4. 안드로이드 스튜디오 위쪽에 폰 이름이 보이면 **▶ (Run)** → 폰에 마이플래너가 설치돼요

## 4. 카카오 로그인 연결 (한 번)
1. 스크립트 끝에 나온 **키 해시**를 복사 (다시 보기: `scripts\setup-windows.ps1 -KeyHash`)
2. 카카오 디벨로퍼스 → **BuddyPlanner 앱(1513605)** → 앱 → 플랫폼 → **Android 추가**
   - 패키지명 `kr.myplanner.app`, 키 해시 붙여넣기
3. 카카오 로그인 → **OpenID Connect 사용 ON** (이미 켜져 있으면 그대로)

## 5. 폰에서 꼭 확인할 것
- [ ] 예시 일정 넣기 → 일정 상세 → **[카카오맵 경로]**: 출발·도착이 채워져서 열리는지
- [ ] 1~2분 뒤 시각으로 일정 만들기 → **잠금 화면 위로 전체 화면 알람**이 뜨는지
- [ ] 앱을 완전히 끈 상태에서도 알람이 울리는지
- [ ] 폰을 껐다 켠 뒤에도 알람이 남아 있는지
- [ ] 홈 화면 길게 누르기 → 위젯 → **마이플래너 다음 일정** 추가
- [ ] 문자 앱에서 KTX 문자 길게 누르기 → 공유 → **마이플래너**
- [ ] 설정 → 카카오로 시작하기 → 로그인 후 AI 비서

알람이 늦게 울리거나 안 울리면: 설정 → 알람 점검의 ⚠️ 항목 [설정] 버튼, 그리고 삼성폰은 **배터리 → 백그라운드 사용 제한에서 마이플래너 제외**.

## 코드가 바뀐 뒤 다시 설치할 때
```
cd $HOME\Documents\myplanner
git pull
npm run cap-sync
```
→ 안드로이드 스튜디오에서 ▶
