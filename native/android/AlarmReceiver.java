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
        AlarmStore.remove(ctx, id);
        Log.d(TAG, "알람 울림 " + id + " " + title);
        ring(ctx, id, title, body, scheduleId);
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
        ensureChannel(ctx);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent full = new Intent(ctx, AlarmActivity.class);
        full.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        full.putExtra("id", id);
        full.putExtra("title", title);
        full.putExtra("body", body);
        full.putExtra("scheduleId", scheduleId);
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
    }
}
