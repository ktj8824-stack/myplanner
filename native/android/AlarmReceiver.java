package kr.myplanner.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * 알람 시각이 되면 호출됩니다.
 * - 잠금 화면/꺼진 화면: 전체 화면 알람(AlarmActivity)을 띄움
 * - 휴대폰을 쓰는 중: 상단 알림으로 뜨며, 알람 소리가 끌 때까지 반복(INSISTENT)
 * 알림에 [알람 끄기] [5분 뒤] 버튼이 있어 화면을 열지 않고도 끌 수 있습니다.
 */
public class AlarmReceiver extends BroadcastReceiver {

    public static final String CHANNEL_ID = "mp_wake_alarm_v1";
    private static final String TAG = "MyPlannerAlarm";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || intent.getAction() != null) return; // 앱이 예약한 알람만 처리
        int id = intent.getIntExtra("id", 0);
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String scheduleId = intent.getStringExtra("scheduleId");
        String kind = intent.getStringExtra("kind");
        if (kind == null) kind = AlarmStore.KIND_FULL;
        int rep = intent.getIntExtra("rep", 0);
        AlarmStore.remove(ctx, id);
        Log.d(TAG, "알람 실행 " + kind + " " + id + " " + title);

        switch (kind) {
            case AlarmStore.KIND_RECHECK:
                // 네트워크(티맵) 조회는 시간이 걸리므로 비동기로 처리 — 끝나면 3일 창도 다시 동기화
                Recheck.run(ctx.getApplicationContext(), id, goAsync());
                return;
            case AlarmStore.KIND_NOTE:
                postNote(ctx, id, title, body, scheduleId);
                break;
            case AlarmStore.KIND_REFILL:
                break; // 아래 syncWindow가 다음 3일치를 보충
            default:
                ring(ctx, id, title, body, scheduleId, rep);
        }
        AlarmScheduler.syncWindow(ctx);
    }

    public static final String NOTE_CHANNEL_ID = "mp_notes_v1";

    /** 전날 밤 안내·출발 10분 전·교통 변화 같은 일반 알림 */
    public static void postNote(Context ctx, int id, String title, String body, String scheduleId) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(NOTE_CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(NOTE_CHANNEL_ID, "일정 알림", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("전날 안내, 출발 전 알림, 교통 변화 안내");
            nm.createNotificationChannel(ch);
        }
        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent pi = null;
        if (open != null) {
            open.putExtra(MyAlarmPlugin.EXTRA_OPEN, scheduleId); // 알림을 누르면 그 일정 화면으로
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            pi = PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, NOTE_CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true);
        if (pi != null) b.setContentIntent(pi);
        try {
            nm.notify(id, b.build());
        } catch (SecurityException e) {
            Log.e(TAG, "알림 권한 없음", e);
        }
    }

    public static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "기상·출발 알람", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("일정에 맞춰 깨워 주는 알람입니다.");
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        ch.setSound(sound, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setBypassDnd(true);
        nm.createNotificationChannel(ch);
    }

    public static void ring(Context ctx, int id, String title, String body, String scheduleId) {
        ring(ctx, id, title, body, scheduleId, 0);
    }

    public static void ring(Context ctx, int id, String title, String body, String scheduleId, int rep) {
        ensureChannel(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent full = new Intent(ctx, AlarmActivity.class);
        full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        full.putExtra("id", id);
        full.putExtra("title", title);
        full.putExtra("body", body);
        full.putExtra("scheduleId", scheduleId);
        full.putExtra("rep", rep);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullPi = PendingIntent.getActivity(ctx, id, full, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title == null || title.isEmpty() ? "마이플래너 알람" : title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(fullPi, true)
                .setContentIntent(fullPi)
                .setOngoing(true)
                .setAutoCancel(false)
                .setTimeoutAfter(5 * 60 * 1000L) // 5분 동안 아무 반응이 없으면 자동으로 멈춤
                .addAction(0, "알람 끄기", AlarmActionReceiver.pending(ctx, AlarmActionReceiver.ACTION_STOP, id, title, body, scheduleId))
                .addAction(0, "5분 뒤", AlarmActionReceiver.pending(ctx, AlarmActionReceiver.ACTION_SNOOZE, id, title, body, scheduleId));

        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // 끌 때까지 소리 반복
        try {
            nm.notify(id, n);
        } catch (SecurityException e) {
            Log.e(TAG, "알림 권한 없음", e);
        }
        // 알림만 뜨고 알람 화면이 안 열려도(폰 사용 중·권한 없음) 반응이 없으면 다시 울리도록
        AlarmActionReceiver.armBackup(ctx, id, title, body, scheduleId, rep);
    }
}
