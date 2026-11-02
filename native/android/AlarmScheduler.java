package kr.myplanner.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.util.List;

/**
 * 알람 예약·취소·재등록.
 * setAlarmClock(알람시계 방식)으로 예약해서 절전(Doze) 중에도 정확한 시각에 울리고,
 * 상태 표시줄에 알람 아이콘이 표시됩니다.
 */
public final class AlarmScheduler {

    private static final String TAG = "MyPlannerAlarm";

    private AlarmScheduler() {}

    public static boolean schedule(Context ctx, AlarmStore.Item item) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        PendingIntent fire = firePendingIntent(ctx, item);
        try {
            boolean exactAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
            if (exactAllowed) {
                // 상태 표시줄 알람 아이콘을 누르면 앱이 열리도록
                Intent show = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
                PendingIntent showPi = show == null ? null
                        : PendingIntent.getActivity(ctx, item.id, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(item.at, showPi), fire);
            } else {
                // '알람 및 리마인더' 권한이 없으면 몇 분 오차가 있을 수 있는 방식으로 예약
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, fire);
                Log.w(TAG, "정확한 알람 권한 없음 → 일반 알람으로 예약 " + item.id);
            }
        } catch (Exception e) {
            Log.e(TAG, "알람 예약 실패 " + item.id, e);
            return false;
        }
        AlarmStore.put(ctx, item);
        return true;
    }

    public static void cancel(Context ctx, int id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = firePendingIntent(ctx, new AlarmStore.Item(id, 0, null, null, null));
        try {
            if (am != null) am.cancel(pi);
            pi.cancel();
        } catch (Exception e) {
            Log.e(TAG, "알람 취소 실패 " + id, e);
        }
        AlarmStore.remove(ctx, id);
    }

    /** 기록된 알람을 모두 취소하고 새 목록으로 교체 (앱에서 일정이 바뀔 때마다 호출) */
    public static int replaceAll(Context ctx, List<AlarmStore.Item> items) {
        for (AlarmStore.Item old : AlarmStore.all(ctx)) {
            if (!old.snooze) cancel(ctx, old.id); // 다시 알림(스누즈)은 유지
        }
        int ok = 0;
        long now = System.currentTimeMillis();
        for (AlarmStore.Item it : items) {
            if (it.at > now && schedule(ctx, it)) ok++;
        }
        return ok;
    }

    /** 재부팅·업데이트 후: 아직 지나지 않은 알람만 다시 등록 */
    public static void restoreAll(Context ctx) {
        long now = System.currentTimeMillis();
        for (AlarmStore.Item it : AlarmStore.all(ctx)) {
            if (it.at <= now) AlarmStore.remove(ctx, it.id);
            else schedule(ctx, it);
        }
    }

    private static PendingIntent firePendingIntent(Context ctx, AlarmStore.Item item) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.putExtra("id", item.id);
        i.putExtra("title", item.title);
        i.putExtra("body", item.body);
        i.putExtra("scheduleId", item.scheduleId);
        return PendingIntent.getBroadcast(ctx, item.id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
