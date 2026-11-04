package kr.myplanner.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;

/**
 * 알람 기록·계획을 '기기 보호 저장소'에 둡니다.
 * 밤새 자동 업데이트로 폰이 재부팅되고 아직 잠금을 풀지 않은 상태(Direct Boot)에서도
 * 기상 알람을 다시 걸 수 있게 하기 위함입니다. 예전 위치에 있던 기록은 처음 한 번 옮깁니다.
 */
final class Storage {
    private static final String TAG = "MyPlannerStorage";
    private static final String MIGRATED = "mp_storage_migrated_v1";
    static final String[] PREFS = {"myplanner_alarms", "myplanner_alarm_state"};
    static final String PLAN_FILE = "myplanner_plan.json";

    private Storage() {}

    static Context of(Context ctx) {
        Context app = ctx.getApplicationContext() != null ? ctx.getApplicationContext() : ctx;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return app;
        Context dp = app.isDeviceProtectedStorage() ? app : app.createDeviceProtectedStorageContext();
        migrate(app, dp);
        return dp;
    }

    private static boolean done;

    private static synchronized void migrate(Context app, Context dp) {
        if (done || Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return;
        SharedPreferences flag = dp.getSharedPreferences("mp_storage", Context.MODE_PRIVATE);
        if (flag.getBoolean(MIGRATED, false)) { done = true; return; }
        // 잠금을 풀기 전에는 예전(자격 증명 보호) 저장소를 읽을 수 없음 → 다음 기회에
        android.os.UserManager um = (android.os.UserManager) app.getSystemService(Context.USER_SERVICE);
        if (um != null && !um.isUserUnlocked()) return;
        try {
            for (String p : PREFS) dp.moveSharedPreferencesFrom(app, p);
            File from = new File(app.getFilesDir(), PLAN_FILE), to = new File(dp.getFilesDir(), PLAN_FILE);
            if (from.exists() && !to.exists()) {
                try (FileInputStream in = new FileInputStream(from); FileOutputStream out = new FileOutputStream(to)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                }
                //noinspection ResultOfMethodCallIgnored
                from.delete();
            }
            flag.edit().putBoolean(MIGRATED, true).apply();
            done = true;
        } catch (Exception e) {
            Log.w(TAG, "저장소 옮기기 실패 (다음에 다시)", e);
        }
    }
}
