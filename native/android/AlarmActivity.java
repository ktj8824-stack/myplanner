package kr.myplanner.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 잠금 화면 위에 뜨는 전체 화면 알람.
 * 버디플래너 AlarmActivity를 기반으로, 일정 제목·안내 문구 표시, 소리 반복,
 * 5분 뒤 다시 알림, 일정 보기 버튼을 추가했습니다. (레이아웃 XML 없이 코드로 화면 구성)
 */
public class AlarmActivity extends Activity {

    private static final long AUTO_STOP_MS = 3 * 60 * 1000L;
    /** 3분 동안 아무것도 누르지 않으면 5분 뒤 다시 울림 — 최대 이 횟수까지 */
    private static final int MAX_AUTO_REPEAT = 2;
    private static final int MISSED_NOTICE_OFFSET = 7;

    private int rep;
    private AudioManager audio;
    private int savedVolume = -1;    // 알람 소리가 0이라 잠시 올렸으면 원래 값
    private final Runnable noResponse = this::onNoResponse;

    private MediaPlayer player;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int alarmId;
    private String title, body, scheduleId;
    private TextView tvTime, tvTitle, tvBody;

    private final Runnable clock = new Runnable() {
        @Override public void run() {
            if (tvTime != null) tvTime.setText(new SimpleDateFormat("HH:mm", Locale.KOREA).format(new Date()));
            handler.postDelayed(this, 10_000);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        buildUi();
        readIntent(getIntent());
        startRinging();
        handler.post(clock);
        handler.postDelayed(noResponse, AUTO_STOP_MS);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readIntent(intent);
        startRinging();
        handler.removeCallbacks(noResponse);
        handler.postDelayed(noResponse, AUTO_STOP_MS);
    }

    /** 끄지도 미루지도 않았을 때: 자는 중일 수 있으니 5분 뒤 다시 깨우고, 그래도 없으면 놓친 알람 알림을 남김 */
    private void onNoResponse() {
        stopRinging();
        if (rep < MAX_AUTO_REPEAT) {
            AlarmActionReceiver.snooze(this, alarmId, title, scheduleId, rep + 1,
                    "알람에 응답이 없어서 다시 깨워요 (" + (rep + 1) + "/" + MAX_AUTO_REPEAT + "). " + (body == null ? "" : body));
        } else if (rep < 99) {
            String t = title == null ? "" : title.replace("⏰ 다시 알림 · ", "");
            AlarmReceiver.postNote(this, alarmId + MISSED_NOTICE_OFFSET, "⚠️ 알람을 끄지 않으셨어요",
                    t + " — 일정 시간을 확인해 주세요.", scheduleId);
        }
        finishAndMoveBack();
    }

    private void readIntent(Intent i) {
        alarmId = i.getIntExtra("id", 0);
        title = i.getStringExtra("title");
        body = i.getStringExtra("body");
        scheduleId = i.getStringExtra("scheduleId");
        rep = i.getIntExtra("rep", 0);
        tvTitle.setText(title == null || title.isEmpty() ? "마이플래너 알람" : title);
        tvBody.setText(body == null ? "" : body);
        // 알림의 반복 소리는 끄고, 이 화면이 직접 소리를 냄 (소리 두 번 겹침 방지)
        AlarmActionReceiver.dismiss(this, alarmId);
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(dp(28), dp(48), dp(28), dp(40));
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{Color.parseColor("#0B1B45"), Color.parseColor("#1E3A8A"), Color.parseColor("#2563EB")});
        root.setBackground(bg);

        tvTime = text(72, true, 1f);
        tvTitle = text(24, true, 1f);
        tvBody = text(17, false, 0.85f);
        tvTitle.setPadding(0, dp(8), 0, dp(12));
        tvBody.setPadding(0, 0, 0, dp(40));
        root.addView(tvTime);
        root.addView(tvTitle);
        root.addView(tvBody);

        root.addView(button("알람 끄기", true, v -> { stopRinging(); finishAndMoveBack(); }));
        root.addView(button("5분 뒤 다시 알림", false, v -> {
            stopRinging();
            AlarmActionReceiver.snooze(this, alarmId, title, scheduleId);
            finishAndMoveBack();
        }));
        root.addView(button("일정 보기", false, v -> {
            stopRinging();
            AlarmStore.setPendingOpen(this, scheduleId);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                km.requestDismissKeyguard(this, null); // 잠금 해제 화면 표시 후 앱으로
            }
            Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(open);
            }
            finish();
        }));
        setContentView(root);
    }

    private TextView text(int sp, boolean bold, float alpha) {
        TextView t = new TextView(this);
        t.setTextColor(Color.WHITE);
        t.setTextSize(sp);
        t.setAlpha(alpha);
        t.setGravity(Gravity.CENTER);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button button(String label, boolean primary, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(18);
        b.setAllCaps(false);
        b.setTextColor(primary ? Color.parseColor("#1E3A8A") : Color.WHITE);
        GradientDrawable d = new GradientDrawable();
        d.setCornerRadius(dp(16));
        if (primary) d.setColor(Color.WHITE);
        else { d.setColor(Color.TRANSPARENT); d.setStroke(dp(2), Color.parseColor("#66FFFFFF")); }
        b.setBackground(d);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(58));
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        b.setOnClickListener(l);
        return b;
    }

    private void startRinging() {
        stopRinging();
        ensureAudible();
        // 기본 알람음 → 벨소리 → 알림음 순서로, 소리가 나는 것을 찾을 때까지
        int[] types = {RingtoneManager.TYPE_ALARM, RingtoneManager.TYPE_RINGTONE, RingtoneManager.TYPE_NOTIFICATION};
        for (int type : types) {
            Uri uri = RingtoneManager.getDefaultUri(type);
            if (uri == null) continue;
            MediaPlayer mp = new MediaPlayer();
            try {
                mp.setDataSource(this, uri);
                mp.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                mp.setLooping(true); // 끌 때까지 반복 (최대 3분)
                mp.prepare();
                mp.start();
                player = mp;
                break;
            } catch (Exception e) {
                mp.release();
            }
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator != null) {
            long[] pattern = {0, 800, 600};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            else vibrator.vibrate(pattern, 0);
        }
    }

    /** 알람 소리 크기가 0이면 알람이 무음이 되므로, 울리는 동안만 중간 크기로 올림 (끄면 되돌림) */
    private void ensureAudible() {
        try {
            if (audio == null) audio = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audio == null) return;
            int v = audio.getStreamVolume(AudioManager.STREAM_ALARM);
            if (v > 0) return;
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            if (savedVolume < 0) savedVolume = v;
            audio.setStreamVolume(AudioManager.STREAM_ALARM, Math.max(1, Math.round(max * 0.6f)), 0);
        } catch (Exception ignored) {
            // 방해 금지 등으로 바꿀 수 없으면 그대로 (진동은 울림)
        }
    }

    private void restoreVolume() {
        if (savedVolume < 0 || audio == null) return;
        try { audio.setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0); } catch (Exception ignored) {}
        savedVolume = -1;
    }

    private void stopRinging() {
        if (player != null) {
            try { if (player.isPlaying()) player.stop(); } catch (Exception ignored) {}
            player.release();
            player = null;
        }
        if (vibrator != null) { vibrator.cancel(); vibrator = null; }
        restoreVolume();
    }

    private void finishAndMoveBack() {
        moveTaskToBack(true);
        finish();
    }

    @Override
    public void onBackPressed() {
        // 실수로 뒤로가기를 눌러 알람이 꺼지지 않도록 막음 (버튼으로만 끄기)
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        stopRinging();
        super.onDestroy();
    }
}
