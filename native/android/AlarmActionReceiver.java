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

    /** 출발 알람: 지금 '5분 뒤'를 눌러도 되는지 (다시 울릴 시각이 기차·비행기 마감 · 그때 나가도 약속에 안 늦는 시각 전)
        snoozeUntil 은 앱(Planner.snoozeLimit)이 계산: 보통 약속은 약속 − 이동 시간 (2026-11-22 점검) */
    static boolean canSnooze(long snoozeUntil) {
        return snoozeUntil <= 0 || System.currentTimeMillis() + SNOOZE_MIN * 60_000L < snoozeUntil;
    }

    /** 보통 약속에서 미루기를 막을 때 안내 (앱 Alarm.snoozeWhy 와 같은 말) */
    static String noSnoozeText(long snoozeDue) {
        return snoozeDue > 0 && System.currentTimeMillis() >= snoozeDue
                ? "약속 시각이 지나 더 미룰 수 없어요" : "5분 뒤에 나가면 약속에 늦어요 — 더 미룰 수 없어요";
    }

    /** 울리기 시작할 때 안전장치를 걸어 둠 (반응하면 지워지고, 알람 화면이 3분 뒤 다시 5분 뒤로 바꿈) */
    static void armBackup(Context ctx, int id, String title, String body, String scheduleId, int rep) {
        armBackup(ctx, id, title, body, scheduleId, rep, 0, false, 0);
    }

    static void armBackup(Context ctx, int id, String title, String body, String scheduleId, int rep, long snoozeUntil, boolean snoozeTrip, long snoozeDue) {
        if (rep >= 99) return; // 테스트 알람
        if (rep < MAX_AUTO_REPEAT) {
            // 응답이 없어 다시 깨우는 건 안전장치라 막지 않음 (미루기 제한 값만 이어서 넘김)
            snooze(ctx, id, title, scheduleId, rep + 1, "알람에 응답이 없어서 다시 깨워요 (" + (rep + 1) + "/" + MAX_AUTO_REPEAT + "). " + (body == null ? "" : body), BACKUP_MIN, snoozeUntil, snoozeTrip, snoozeDue);
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
        return pending(ctx, action, id, title, body, scheduleId, 0, false, 0);
    }

    static PendingIntent pending(Context ctx, String action, int id, String title, String body, String scheduleId, long snoozeUntil, boolean snoozeTrip, long snoozeDue) {
        Intent i = new Intent(ctx, AlarmActionReceiver.class);
        i.putExtra("snoozeUntil", snoozeUntil);
        i.putExtra("snoozeTrip", snoozeTrip);
        i.putExtra("snoozeDue", snoozeDue);
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
            long until = intent.getLongExtra("snoozeUntil", 0);
            boolean trip = intent.getBooleanExtra("snoozeTrip", false);
            long due = intent.getLongExtra("snoozeDue", 0);
            if (canSnooze(until)) {
                snooze(ctx, id, intent.getStringExtra("title"), intent.getStringExtra("scheduleId"), until, trip, due); // 안전장치를 5분 뒤 다시 알림으로 바꿈
            } else {
                // 알림을 오래 두었다가 누른 경우: 이미 미룰 수 없는 시각 → 안전장치는 지우고 안내만
                cancelBackup(ctx, id);
                AlarmReceiver.postNote(ctx, snoozeId(id), trip ? "지금 안 나가면 놓쳐요" : "더 미룰 수 없어요",
                        trip ? "더 미루면 탈 수 없어요. 바로 나가거나 택시를 타세요." : noSnoozeText(due), intent.getStringExtra("scheduleId"));
            }
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

    static void snooze(Context ctx, int id, String title, String scheduleId, long snoozeUntil, boolean snoozeTrip, long snoozeDue) {
        snooze(ctx, id, title, scheduleId, 0, SNOOZE_MIN + "분이 지났어요.", SNOOZE_MIN, snoozeUntil, snoozeTrip, snoozeDue);
    }

    /** rep: 응답이 없어 자동으로 다시 울리는 횟수 (사용자가 누른 5분 뒤는 0부터 다시) */
    static void snooze(Context ctx, int id, String title, String scheduleId, int rep, String body) {
        snooze(ctx, id, title, scheduleId, rep, body, SNOOZE_MIN);
    }

    static void snooze(Context ctx, int id, String title, String scheduleId, int rep, String body, int afterMin) {
        snooze(ctx, id, title, scheduleId, rep, body, afterMin, 0, false, 0);
    }

    static void snooze(Context ctx, int id, String title, String scheduleId, int rep, String body, int afterMin, long snoozeUntil, boolean snoozeTrip, long snoozeDue) {
        String t = title == null ? "" : title;
        if (!t.startsWith("⏰ 다시 알림")) t = "⏰ 다시 알림 · " + t;
        long at = System.currentTimeMillis() + afterMin * 60 * 1000L;
        AlarmStore.Item item = new AlarmStore.Item(snoozeId(id), at, t, body, scheduleId);
        item.snooze = true;
        item.rep = rep;
        item.snoozeUntil = snoozeUntil;
        item.snoozeTrip = snoozeTrip;
        item.snoozeDue = snoozeDue;
        AlarmScheduler.schedule(ctx, item);
    }
}
