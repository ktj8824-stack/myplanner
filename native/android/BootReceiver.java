package kr.myplanner.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 재부팅·앱 업데이트·'알람 및 리마인더' 권한 변경 후 저장된 미래 알람을 다시 등록 */
public class BootReceiver extends BroadcastReceiver {
    private static final String EXACT_CHANGED = "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        String a = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(a) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(a)
                || EXACT_CHANGED.equals(a) || "android.intent.action.QUICKBOOT_POWERON".equals(a)) {
            AlarmScheduler.restoreAll(ctx);
        }
    }
}
