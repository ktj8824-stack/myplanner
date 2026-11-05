/* =========================================
   전체 화면 기상 알람(네이티브)을 안드로이드 프로젝트에 설치합니다.
   `npx cap add android`로 android 폴더를 만든 뒤 실행하세요. (npm run cap-sync에 포함)
   여러 번 실행해도 안전합니다(이미 들어간 내용은 건너뜀).
   ========================================= */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const android = path.join(root, 'android', 'app', 'src', 'main');
if (!fs.existsSync(android)) {
  console.log('ℹ️  android 폴더가 없어 네이티브 알람 설치를 건너뜁니다. (npx cap add android 후 다시 실행)');
  process.exit(0);
}

// 1) appId → 자바 패키지
// (TypeScript 설치 없이 쓰도록 capacitor.config.json)
let appId = 'kr.myplanner.app';
try { appId = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8')).appId || appId; } catch (e) {}
const pkgDir = path.join(android, 'java', ...appId.split('.'));
fs.mkdirSync(pkgDir, { recursive: true });

// 2) 자바 파일 복사 (패키지명 맞춤)
const srcDir = path.join(root, 'native', 'android');
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.java'));
files.forEach(f => {
  let code = fs.readFileSync(path.join(srcDir, f), 'utf8');
  code = code.replace(/^package [\w.]+;/m, `package ${appId};`).replace(/kr\.myplanner\.app\.ALARM_/g, `${appId}.ALARM_`);
  fs.writeFileSync(path.join(pkgDir, f), code);
});
console.log(`✅ 알람 자바 파일 ${files.length}개 복사 → ${path.relative(root, pkgDir)}`);

// 2-1) 위젯 리소스 (레이아웃·모양·설정·문구)
const resSrc = path.join(srcDir, 'res');
const resDst = path.join(android, 'res');
if (fs.existsSync(resSrc)) {
  for (const dir of fs.readdirSync(resSrc)) {
    fs.mkdirSync(path.join(resDst, dir), { recursive: true });
    for (const f of fs.readdirSync(path.join(resSrc, dir))) fs.copyFileSync(path.join(resSrc, dir, f), path.join(resDst, dir, f));
  }
  fs.mkdirSync(path.join(resDst, 'values'), { recursive: true });
  fs.writeFileSync(path.join(resDst, 'values', 'mp_strings.xml'),
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="mp_widget_desc">다음 일정의 기상·출발·도착 시각</string>\n    <string name="mp_widget_label">마이플래너 다음 일정</string>\n</resources>\n');
  console.log('✅ 위젯 리소스 복사');
}

// 3) MainActivity에 플러그인 등록
const mainPath = path.join(pkgDir, 'MainActivity.java');
let main = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf8') : '';
if (!main.includes('MyAlarmPlugin')) {
  if (/extends BridgeActivity\s*\{\s*\}/.test(main) || !main) {
    main = `package ${appId};

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MyAlarmPlugin.class); // 전체 화면 기상 알람
        super.onCreate(savedInstanceState);
    }
}
`;
  } else if (main.includes('super.onCreate(')) {
    main = main.replace(/(\n\s*)super\.onCreate\(/, '$1registerPlugin(MyAlarmPlugin.class); // 전체 화면 기상 알람$1super.onCreate(');
  } else {
    console.error('❌ MainActivity 구조를 알 수 없어요. onCreate의 super.onCreate 앞에 registerPlugin(MyAlarmPlugin.class); 를 직접 넣어 주세요.');
  }
  fs.writeFileSync(mainPath, main);
  console.log('✅ MainActivity에 MyAlarm 플러그인 등록');
}

// 4) AndroidManifest 권한·구성요소
const manPath = path.join(android, 'AndroidManifest.xml');
let man = fs.readFileSync(manPath, 'utf8');
// USE_EXACT_ALARM: 알람시계·캘린더 앱은 설치 즉시 정확한 알람 허용 (구글 플레이 '정확한 알람' 정책 대상)
//   심사에서 거절되면 이 줄을 지우세요 → SCHEDULE_EXACT_ALARM(사용자가 직접 허용)만으로 동작합니다.
const perms = [
  'android.permission.USE_EXACT_ALARM',
  'android.permission.SCHEDULE_EXACT_ALARM',
  'android.permission.USE_FULL_SCREEN_INTENT',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.WAKE_LOCK',
  'android.permission.VIBRATE',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION'
];
const addPerms = perms.filter(p => !man.includes(`"${p}"`)).map(p => `    <uses-permission android:name="${p}" />`).join('\n');
if (addPerms) man = man.replace('</manifest>', `${addPerms}\n</manifest>`);

const components = `
        <!-- 마이플래너 전체 화면 기상 알람 -->
        <activity
            android:name=".AlarmActivity"
            android:theme="@android:style/Theme.DeviceDefault.NoActionBar"
            android:showWhenLocked="true"
            android:turnScreenOn="true"
            android:launchMode="singleTask"
            android:taskAffinity=""
            android:excludeFromRecents="true"
            android:directBootAware="true"
            android:exported="false" />
        <receiver android:name=".AlarmReceiver" android:exported="false" android:directBootAware="true" />
        <receiver android:name=".AlarmActionReceiver" android:exported="false" android:directBootAware="true" />
        <receiver android:name=".BootReceiver" android:exported="true" android:directBootAware="true">
            <intent-filter>
                <action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" />
            </intent-filter>
        </receiver>
`;
if (!man.includes('.AlarmActivity')) man = man.replace('</application>', `${components}    </application>`);
// 예전에 설치한 프로젝트: 재부팅 후 잠금 해제 전에도 알람이 울리도록(Direct Boot) 고침
if (!man.includes('LOCKED_BOOT_COMPLETED')) {
  man = man.replace('<action android:name="android.intent.action.BOOT_COMPLETED" />',
    '<action android:name="android.intent.action.LOCKED_BOOT_COMPLETED" />\n                <action android:name="android.intent.action.BOOT_COMPLETED" />');
  man = man.replace(/(<receiver android:name="\.(AlarmReceiver|AlarmActionReceiver|BootReceiver)"(?![^>]*directBootAware))/g, '$1 android:directBootAware="true"');
  man = man.replace(/(android:name="\.AlarmActivity"(?![^>]*directBootAware))/, '$1\n            android:directBootAware="true"');
}

// 홈 화면 위젯
if (!man.includes('.NextWidget')) {
  man = man.replace('</application>', `        <!-- 마이플래너 홈 화면 위젯 -->
        <receiver android:name=".NextWidget" android:exported="false" android:label="@string/mp_widget_label">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/mp_widget_info" />
        </receiver>
    </application>`);
}

// 문자·카톡 '공유' → 마이플래너 (받은 문자로 일정 만들기)
if (!man.includes('android.intent.action.SEND')) {
  const share = `
            <!-- 문자 앱에서 공유로 받기 -->
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>
`;
  const m = man.match(/<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/);
  if (m) man = man.replace(m[0], m[0].replace(/\s*<\/activity>$/, `${share}        </activity>`));
  else console.warn('⚠️  MainActivity를 찾지 못해 공유 받기를 추가하지 못했어요.');
}
// 카카오맵·티맵·카카오T·카카오톡 앱을 열 수 있게 (안드로이드 11+ 앱 목록 보기 제한)
if (!man.includes('net.daum.android.map')) {
  const q = `
    <!-- 길안내·로그인에 쓰는 다른 앱 -->
    <queries>
        <package android:name="com.kakao.talk" />
        <package android:name="net.daum.android.map" />
        <package android:name="com.skt.tmap.ku" />
        <package android:name="com.kakao.taxi" />
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="kakaomap" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="tmap" />
        </intent>
    </queries>
`;
  man = man.replace('</manifest>', `${q}</manifest>`);
}

// 카카오 로그인 (버디플래너와 같은 카카오 앱 · @team-lepisode/capacitor-kakao-login)
const kakaoKey = readKakaoKey();
if (kakaoKey) {
  fs.mkdirSync(path.join(android, 'res', 'values'), { recursive: true });
  fs.writeFileSync(path.join(android, 'res', 'values', 'mp_kakao.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="kakao_app_key" translatable="false">${kakaoKey}</string>\n    <string name="kakao_scheme" translatable="false">kakao${kakaoKey}</string>\n</resources>\n`);
  if (!man.includes('com.kakao.sdk.auth.AuthCodeHandlerActivity')) {
    man = man.replace('</application>', `        <!-- 카카오 로그인 돌아오기 -->
        <activity android:name="com.kakao.sdk.auth.AuthCodeHandlerActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:host="oauth" android:scheme="@string/kakao_scheme" />
            </intent-filter>
        </activity>
    </application>`);
  }
  // 카카오 SDK 저장소
  const gradlePath = path.join(root, 'android', 'build.gradle');
  if (fs.existsSync(gradlePath)) {
    let g = fs.readFileSync(gradlePath, 'utf8');
    if (!g.includes('devrepo.kakao.com')) {
      g = g.replace(/allprojects\s*\{\s*repositories\s*\{/, m => `${m}\n        maven { url 'https://devrepo.kakao.com/nexus/content/groups/public/' }`);
      fs.writeFileSync(gradlePath, g);
    }
  }
  console.log('✅ 카카오 로그인 설정 (앱 키·돌아오기 화면·SDK 저장소)');
} else {
  console.warn('⚠️  카카오 네이티브 앱 키를 찾지 못해 카카오 로그인 설정을 건너뛰어요 (js/defaults.js의 KAKAO_NATIVE_APP_KEY)');
}

fs.writeFileSync(manPath, man);
console.log('✅ AndroidManifest 권한·알람 구성요소 확인 완료');
console.log('🎉 전체 화면 기상 알람 설치 끝. 안드로이드 스튜디오에서 실행해 보세요.');

/** js/config.js(있으면) → js/defaults.js 순서로 카카오 네이티브 앱 키 */
function readKakaoKey() {
  for (const f of ['config.js', 'defaults.js']) {
    const fp = path.join(root, 'js', f);
    if (!fs.existsSync(fp)) continue;
    const m = fs.readFileSync(fp, 'utf8').match(/KAKAO_NATIVE_APP_KEY\s*:\s*'([0-9a-f]{32})'/);
    if (m) return m[1];
  }
  return '';
}
