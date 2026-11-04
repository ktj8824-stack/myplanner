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
    /** 아무 반응이 없을 때 자동으로 다시 울리는 최대 횟수 */
    public static final int MAX_AUTO_REPEAT = 2;
    /** 알림만 뜨고 화면이 안 열린 경우의 안전장치: 울린 뒤 이 시간 안에 반응이 없으면 다시 울림 */
    public static final int BACKUP_MIN = 8;

    /** 원래 알람과 겹치지 않는 '다시 알림' id (같은 알람의 다시 알림은 항상 같은 id → 덮어쓰기) */
    static int snoozeId(int id) { return (int) ((id * 31L + 7) % 2000000000L); }

    /** 알람을 끄거나 일정 보기를 누르면: 예약해 둔 안전장치 다시 알림을 지움 */
    static void cancelBackup(Context ctx, int id) { AlarmScheduler.cancel(ctx, snoozeId(id)); }

    /** 울리기 시작할 때 안전장치를 걸어 둠 (반응하면 지워지고, 알람 화면이 3분 뒤 다시 5분 뒤로 바꿈) */
    static void armBackup(Context ctx, int id, String title, String body, String scheduleId, int rep) {
        if (rep >= 99) return; // 테스트 알람
        if (rep < MAX_AUTO_REPEAT) {
            snooze(ctx, id, title, scheduleId, rep + 1, "알람에 응답이 없어서 다시 깨워요 (" + (rep + 1) + "/" + MAX_AUTO_REPEAT + "). " + (body == null ? "" : body), BACKUP_MIN);
        } else {
            String t = title == null ? "" : title.replace("⏰ 다시 알림 · ", "");
            AlarmStore.Item note = new AlarmStore.Item(snoozeId(id), System.currentTimeMillis() + 4 * 60_000L,
                    "⚠️ 알람을 끄지 않으셨어요", t + " — 일정 시간을 확인해 주세요.", scheduleId);
            note.kind = AlarmStore.KIND_NOTE;
            note.snooze = true;
            AlarmScheduler.schedule(ctx, note);
        }
    }

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
            snooze(ctx, id, intent.getStringExtra("title"), intent.getStringExtra("scheduleId")); // 안전장치를 5분 뒤 다시 알림으로 바꿈
        } else {
            cancelBackup(ctx, id);
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
        snooze(ctx, id, title, scheduleId, rep, body, SNOOZE_MIN);
    }

    static void snooze(Context ctx, int id, String title, String scheduleId, int rep, String body, int afterMin) {
        String t = title == null ? "" : title;
        if (!t.startsWith("⏰ 다시 알림")) t = "⏰ 다시 알림 · " + t;
        long at = System.currentTimeMillis() + afterMin * 60 * 1000L;
        AlarmStore.Item item = new AlarmStore.Item(snoozeId(id), at, t, body, scheduleId);
        item.snooze = true;
        item.rep = rep;
        AlarmScheduler.schedule(ctx, item);
    }
}
