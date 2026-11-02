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
const capCfg = fs.readFileSync(path.join(root, 'capacitor.config.ts'), 'utf8');
const appId = (capCfg.match(/appId:\s*'([^']+)'/) || [])[1] || 'kr.myplanner.app';
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
            android:exported="false" />
        <receiver android:name=".AlarmReceiver" android:exported="false" />
        <receiver android:name=".AlarmActionReceiver" android:exported="false" />
        <receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
                <action android:name="android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED" />
            </intent-filter>
        </receiver>
`;
if (!man.includes('.AlarmActivity')) man = man.replace('</application>', `${components}    </application>`);
fs.writeFileSync(manPath, man);
console.log('✅ AndroidManifest 권한·알람 구성요소 확인 완료');
console.log('🎉 전체 화면 기상 알람 설치 끝. 안드로이드 스튜디오에서 실행해 보세요.');
