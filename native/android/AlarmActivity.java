package kr.myplanner.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
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
        handler.postDelayed(this::stopRinging, AUTO_STOP_MS);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        readIntent(intent);
        startRinging();
    }

    private void readIntent(Intent i) {
        alarmId = i.getIntExtra("id", 0);
        title = i.getStringExtra("title");
        body = i.getStringExtra("body");
        scheduleId = i.getStringExtra("scheduleId");
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
        try {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            player = new MediaPlayer();
            player.setDataSource(this, uri);
            player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            player.setLooping(true); // 끌 때까지 반복 (최대 3분)
            player.prepare();
            player.start();
        } catch (Exception e) {
            e.printStackTrace();
        }
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        if (vibrator != null) {
            long[] pattern = {0, 800, 600};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            else vibrator.vibrate(pattern, 0);
        }
    }

    private void stopRinging() {
        if (player != null) {
            try { if (player.isPlaying()) player.stop(); } catch (Exception ignored) {}
            player.release();
            player = null;
        }
        if (vibrator != null) { vibrator.cancel(); vibrator = null; }
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
