# =========================================================
# 마이플래너 안드로이드 앱 — 윈도우 노트북 한 번에 준비하기
#
# 사용법 (PowerShell, 마이플래너 폴더에서):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1            # 점검 + 빌드 + 안드로이드 스튜디오 열기
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -Install   # 없는 도구를 winget으로 설치까지
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1 -KeyHash   # 카카오 키 해시만 보기
#
# 하는 일
#   1) Git · Node.js(20 이상) · 안드로이드 스튜디오(자바·SDK 포함) 확인
#   2) npm install → (처음이면) npx cap add android → npm run cap-sync (네이티브 알람·위젯·카카오 로그인 설치)
#   3) 카카오 디벨로퍼스에 넣을 '키 해시' 출력
#   4) 안드로이드 스튜디오 열기 → 폰을 USB로 연결하고 ▶ 실행
# =========================================================
param([switch]$Install, [switch]$KeyHash)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location (Join-Path $PSScriptRoot '..')

function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!] $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

# 안드로이드 스튜디오에 들어 있는 자바(JBR)를 우선 사용
$studioDirs = @("$env:ProgramFiles\Android\Android Studio", "$env:LOCALAPPDATA\Programs\Android Studio")
$studio = $studioDirs | Where-Object { Test-Path "$_\bin\studio64.exe" } | Select-Object -First 1
if ($studio -and (Test-Path "$studio\jbr\bin\java.exe")) {
  $env:JAVA_HOME = "$studio\jbr"
  $env:Path = "$env:JAVA_HOME\bin;$env:Path"
}
if (-not $env:ANDROID_HOME -and (Test-Path "$env:LOCALAPPDATA\Android\Sdk")) { $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk" }

function Show-KeyHash {
  Step '카카오 키 해시 (카카오 디벨로퍼스 > 앱 > 플랫폼 > Android 에 등록)'
  $ks = "$env:USERPROFILE\.android\debug.keystore"
  if (-not (Has 'keytool')) { Warn 'keytool이 없어요. 안드로이드 스튜디오를 설치한 뒤 다시 실행해 주세요.'; return }
  if (-not (Test-Path $ks)) { Warn '디버그 키가 아직 없어요. 안드로이드 스튜디오에서 앱을 한 번 실행한 뒤 다시 실행해 주세요.'; return }
  $out = & keytool -list -v -keystore $ks -alias androiddebugkey -storepass android -keypass android 2>$null | Out-String
  $m = [regex]::Match($out, 'SHA1:\s*([0-9A-F:]{59})')
  if (-not $m.Success) { Warn 'SHA1 값을 읽지 못했어요.'; return }
  $bytes = ($m.Groups[1].Value -split ':') | ForEach-Object { [Convert]::ToByte($_, 16) }
  $hash = [Convert]::ToBase64String([byte[]]$bytes)
  Write-Host "  패키지명 : kr.myplanner.app"
  Write-Host "  키 해시  : $hash" -ForegroundColor White
  Write-Host "  (출시용 키를 만들면 그 키의 해시도 추가해야 해요. 플레이 콘솔 > 앱 무결성 > 앱 서명 키 SHA-1을 같은 방법으로 바꾼 값)"
}

if ($KeyHash) { Show-KeyHash; exit 0 }

Step '1) 도구 확인'
$need = @()
if (Has 'git') { Ok "Git $((git --version) -replace 'git version ','')" } else { Warn 'Git이 없어요'; $need += 'Git.Git' }
if (Has 'node') {
  $v = (node -v).TrimStart('v'); $major = [int]($v.Split('.')[0])
  if ($major -ge 20) { Ok "Node.js $v" } else { Warn "Node.js $v — 20 이상이 필요해요"; $need += 'OpenJS.NodeJS.LTS' }
} else { Warn 'Node.js가 없어요'; $need += 'OpenJS.NodeJS.LTS' }
if ($studio) { Ok "안드로이드 스튜디오: $studio" } else { Warn '안드로이드 스튜디오가 없어요'; $need += 'Google.AndroidStudio' }
if ($env:ANDROID_HOME) { Ok "안드로이드 SDK: $env:ANDROID_HOME" } elseif ($studio) { Warn '안드로이드 SDK가 아직 없어요 — 안드로이드 스튜디오를 한 번 열어 처음 설정(Standard)을 끝내 주세요' }

if ($need.Count) {
  if ($Install -and (Has 'winget')) {
    Step '없는 도구 설치 (winget)'
    foreach ($id in $need) { winget install --id $id -e --accept-source-agreements --accept-package-agreements }
    Write-Host "`n설치가 끝났어요. PowerShell 창을 닫았다가 다시 열고, 이 스크립트를 한 번 더 실행해 주세요." -ForegroundColor Yellow
    if ($need -contains 'Google.AndroidStudio') { Write-Host '안드로이드 스튜디오는 처음 한 번 열어서 [Standard] 설정을 끝내야 SDK가 설치돼요.' -ForegroundColor Yellow }
  } else {
    Write-Host "`n아래를 설치한 뒤 다시 실행해 주세요 (또는 -Install 을 붙이면 자동 설치):" -ForegroundColor Yellow
    $need | ForEach-Object { Write-Host "  winget install --id $_ -e" }
  }
  exit 1
}

Step '2) 의존성 설치 (npm install)'
npm install
if ($LASTEXITCODE) { throw 'npm install 실패' }

Step '3) 안드로이드 프로젝트 준비'
if (-not (Test-Path 'android')) { npx cap add android; if ($LASTEXITCODE) { throw 'cap add android 실패' } } else { Ok 'android 폴더가 이미 있어요' }
npm run cap-sync
if ($LASTEXITCODE) { throw 'cap-sync 실패' }
Ok '웹 파일 복사 · 네이티브 알람 · 위젯 · 카카오 로그인 설정 완료'

Show-KeyHash

Step '4) 안드로이드 스튜디오 열기'
Write-Host '  폰을 USB로 연결 → 폰에서 [USB 디버깅 허용] → 스튜디오 위쪽 ▶(Run) 버튼'
npx cap open android
