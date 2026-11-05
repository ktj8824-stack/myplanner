#!/bin/bash
# =====================================================================
# 마이플래너 아이폰 앱 준비 (맥 터미널에서 실행)
#   bash ~/Documents/마이플래너_아이폰_준비.sh
# 하는 일: 최신 코드 받기 → 패키지 설치 → 웹 빌드 → 아이폰 프로젝트 만들기/갱신
#          → 알람 음악·안전한 알림창·카카오·위치 설정 → 엑스코드 열기
# 여러 번 실행해도 안전합니다 (두 번째부터는 갱신만 함).
# =====================================================================
set -e
APP_DIR="$HOME/Documents/myplanner-app"
BUNDLE_ID="kr.myplanner.app"
TEAM_ID="WKR837G6CH"

step() { echo; echo "▶ $1"; }

step "1/6 최신 코드 받기"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone https://github.com/ktj8824-stack/myplanner.git "$APP_DIR"
fi
cd "$APP_DIR"

step "2/6 패키지 설치 (처음엔 몇 분 걸려요)"
npm install --no-audit --no-fund

step "3/6 웹 화면 빌드 + 알람 음악 넣기"
node build.js
cp native/ios/mp_alarm.caf www/mp_alarm.caf

step "4/6 아이폰 프로젝트 만들기/갱신"
if [ ! -d ios ]; then npx cap add ios; fi
npx cap sync ios

step "5/6 아이폰 설정 (앱 ID·팀·알림창·카카오·위치)"
cp native/ios/AppDelegate.swift ios/App/App/AppDelegate.swift
cp native/ios/SceneDelegate.swift ios/App/App/SceneDelegate.swift
# 앱 아이콘·시작 화면 (마이플래너 해 뜨는 시계)
AS=ios/App/App/Assets.xcassets
cp native/ios/assets/AppIcon-1024.png "$AS/AppIcon.appiconset/AppIcon-512@2x.png"
for f in splash-2732x2732.png splash-2732x2732-1.png splash-2732x2732-2.png; do cp native/ios/assets/splash-2732.png "$AS/Splash.imageset/$f"; done
PB=ios/App/App.xcodeproj/project.pbxproj
sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = [^;]*;/PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;/g" "$PB"
if ! grep -q "DEVELOPMENT_TEAM = $TEAM_ID" "$PB"; then
  sed -i '' "s/\(PRODUCT_BUNDLE_IDENTIFIER = $BUNDLE_ID;\)/\1\\
				DEVELOPMENT_TEAM = $TEAM_ID;/g" "$PB"
fi
PL=ios/App/App/Info.plist
PB_="/usr/libexec/PlistBuddy"
KAKAO_KEY=$(node -e "global.window={};eval(require('fs').readFileSync('js/defaults.js','utf8'));process.stdout.write((window.APP_DEFAULTS||{}).KAKAO_NATIVE_APP_KEY||'')")
$PB_ -c "Set :CFBundleDisplayName 마이플래너" "$PL" 2>/dev/null || $PB_ -c "Add :CFBundleDisplayName string 마이플래너" "$PL"
$PB_ -c "Delete :LSApplicationQueriesSchemes" "$PL" 2>/dev/null || true
$PB_ -c "Add :LSApplicationQueriesSchemes array" "$PL"
for s in kakaokompassauth kakaolink kakaotalk kakaomap tmap kakaot; do $PB_ -c "Add :LSApplicationQueriesSchemes: string $s" "$PL"; done
if [ -n "$KAKAO_KEY" ]; then
  $PB_ -c "Delete :CFBundleURLTypes" "$PL" 2>/dev/null || true
  $PB_ -c "Add :CFBundleURLTypes array" "$PL"
  $PB_ -c "Add :CFBundleURLTypes:0 dict" "$PL"
  $PB_ -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PL"
  $PB_ -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes: string kakao$KAKAO_KEY" "$PL"
fi
$PB_ -c "Delete :NSLocationWhenInUseUsageDescription" "$PL" 2>/dev/null || true
$PB_ -c "Add :NSLocationWhenInUseUsageDescription string 지금 있는 곳을 출발지로 쓰려면 위치가 필요해요." "$PL"

step "6/6 엑스코드 열기"
open ios/App/App.xcodeproj
echo
echo "✅ 준비 끝! 엑스코드 위쪽 기기 목록에서 내 아이폰을 고르고 ▶(실행)을 누르세요."
echo "   처음 한 번은 아이폰 [설정 > 일반 > VPN 및 기기 관리]에서 개발자 앱을 신뢰해 주세요."
