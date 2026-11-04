package kr.myplanner.app;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 알림의 [알람 끄기] [5분 뒤] 버튼 처리 */
public class AlarmActionReceiver extends BroadcastReceiver {

    public static final String ACTION_STOP = "kr.myplanner.app.ALARM_STOP";
    public static final String ACTION_SNOOZE = "kr.myplanner.app.ALARM_SNOOZE";
    public static final int SNOOZE_MIN = 5;

    static PendingIntent pending(Context ctx, String action, int id, String title, String body, String scheduleId) {
        Intent i = new Intent(ctx, AlarmActionReceiver.class);
        i.setAction(action);
        i.putExtra("id", id);
        i.putExtra("title", title);
        i.putExtra("body", body);
        i.putExtra("scheduleId", scheduleId);
        int req = id * 2 + (ACTION_SNOOZE.equals(action) ? 1 : 0);
        return PendingIntent.getBroadcast(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null) return;
        int id = intent.getIntExtra("id", 0);
        dismiss(ctx, id);
        if (ACTION_SNOOZE.equals(intent.getAction())) {
            snooze(ctx, id, intent.getStringExtra("title"), intent.getStringExtra("scheduleId"));
        }
    }

    static void dismiss(Context ctx, int id) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(id);
    }

    static void snooze(Context ctx, int id, String title, String scheduleId) {
        snooze(ctx, id, title, scheduleId, 0, SNOOZE_MIN + "분이 지났어요.");
    }

    /** rep: 응답이 없어 자동으로 다시 울리는 횟수 (사용자가 누른 5분 뒤는 0부터 다시) */
    static void snooze(Context ctx, int id, String title, String scheduleId, int rep, String body) {
        String t = title == null ? "" : title;
        if (!t.startsWith("⏰ 다시 알림")) t = "⏰ 다시 알림 · " + t;
        long at = System.currentTimeMillis() + SNOOZE_MIN * 60 * 1000L;
        // 원래 알람과 겹치지 않는 id
        int snoozeId = (int) ((id * 31L + 7) % 2000000000L);
        AlarmStore.Item item = new AlarmStore.Item(snoozeId, at, t, body, scheduleId);
        item.snooze = true;
        item.rep = rep;
        AlarmScheduler.schedule(ctx, item);
    }
}
