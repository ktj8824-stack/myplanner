package kr.myplanner.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.app.NotificationChannel;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * JS의 window.Capacitor.Plugins.MyAlarm
 *  - setPlan({ alarms, rechecks, tmapKey | proxyUrl+proxyKey })  최대 45일치 계획 전달 → 앞으로 3일치 예약, 이후 자동 보충
 *  - getLive() → { live: { occId: { travelMin, checkedAt, prevMin } } }  백그라운드 실시간 값 (가져가면 비움)
 *  - snooze({ id, at, title, body, scheduleId })
 *  - status() → { exact, fullScreen, notifications, battery, scheduled, planned, alarmVolume, alarmVolumeMax, alarmChannel }
 *  - testAlarm({ seconds }) → 실제 전체 화면 알람을 n초 뒤에 울려 봄 (화면을 끄고 기다려 보기)
 *  - openSettings({ which: 'exact' | 'fullscreen' | 'notifications' | 'battery' })
 *  - consumeOpen() → { scheduleId, sharedText }  ·  'shared' 이벤트: 문자 앱에서 공유로 들어옴
 *  - (이전) consumeOpen() → { scheduleId }  알람 화면 '일정 보기'·알림을 눌러 앱이 열렸으면 그 일정
 */
@CapacitorPlugin(name = "MyAlarm")
public class MyAlarmPlugin extends Plugin {

    public static final String EXTRA_OPEN = "kr.myplanner.OPEN_SCHEDULE";

    @Override
    public void load() {
        AlarmReceiver.ensureChannel(getContext());
        if (getActivity() != null) captureOpen(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        captureOpen(intent);
    }

    private void captureOpen(Intent intent) {
        if (intent == null) return;
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null && !text.isEmpty()) AlarmStore.setPendingShare(getContext(), text.length() > 4000 ? text.substring(0, 4000) : text);
            intent.setAction(Intent.ACTION_MAIN); // 다시 열 때 중복 처리 방지
            notifyListeners("shared", new JSObject());
        }
        String id = intent.getStringExtra(EXTRA_OPEN);
        if (id != null && !id.isEmpty()) {
            AlarmStore.setPendingOpen(getContext(), id);
            intent.removeExtra(EXTRA_OPEN);
        }
    }

    @PluginMethod
    public void setPlan(PluginCall call) {
        try {
            JSONObject old = PlanStore.load(getContext());
            JSONObject plan = new JSONObject();
            JSONArray alarms = call.getArray("alarms");
            JSONArray rechecks = call.getArray("rechecks");
            plan.put("alarms", alarms == null ? new JSONArray() : alarms);
            plan.put("rechecks", rechecks == null ? new JSONArray() : rechecks);
            plan.put("tmapKey", call.getString("tmapKey", ""));
            plan.put("proxyUrl", call.getString("proxyUrl", ""));
            JSONArray widget = call.getArray("widget");
            plan.put("widget", widget == null ? new JSONArray() : widget);
            plan.put("proxyKey", call.getString("proxyKey", ""));
            plan.put("savedAt", System.currentTimeMillis());
            // 앱이 아직 가져가지 않은 실시간 값은 유지
            JSONObject live = old.optJSONObject("live");
            plan.put("live", live == null ? new JSONObject() : live);
            PlanStore.save(getContext(), plan);
        } catch (Exception e) {
            call.reject("계획 저장 실패", e);
            return;
        }
        int ok = AlarmScheduler.syncWindow(getContext());
        JSObject r = new JSObject();
        r.put("scheduled", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void getLive(PluginCall call) {
        JSONObject plan = PlanStore.load(getContext());
        JSONObject live = plan.optJSONObject("live");
        JSObject r = new JSObject();
        try {
            r.put("live", live == null ? new JSObject() : JSObject.fromJSONObject(live));
            plan.put("live", new JSONObject());
            PlanStore.save(getContext(), plan);
        } catch (Exception e) {
            r.put("live", new JSObject());
        }
        call.resolve(r);
    }

    @PluginMethod
    public void snooze(PluginCall call) {
        Double at = call.getDouble("at");
        Integer id = call.getInt("id");
        if (at == null || id == null) { call.reject("id, at 필요"); return; }
        AlarmStore.Item item = new AlarmStore.Item(id, at.longValue(),
                call.getString("title", ""), call.getString("body", ""), call.getString("scheduleId", ""));
        item.snooze = true;
        boolean ok = AlarmScheduler.schedule(getContext(), item);
        if (ok) call.resolve(); else call.reject("예약 실패");
    }

    @PluginMethod
    public void testAlarm(PluginCall call) {
        int sec = Math.max(10, Math.min(600, call.getInt("seconds", 60)));
        AlarmStore.Item item = new AlarmStore.Item(1_999_999_003, System.currentTimeMillis() + sec * 1000L,
                "⏰ 알람 테스트", "이 화면이 보이고 소리가 났다면 일정 알람도 똑같이 울려요.", "");
        item.snooze = true;   // 계획을 다시 맞춰도 지워지지 않게
        item.rep = 99;        // 테스트는 응답이 없어도 다시 울리지 않음
        boolean ok = AlarmScheduler.schedule(getContext(), item);
        if (ok) call.resolve(); else call.reject("예약 실패");
    }

    @PluginMethod
    public void status(PluginCall call) {
        Context ctx = getContext();
        JSObject r = new JSObject();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        r.put("exact", Build.VERSION.SDK_INT < Build.VERSION_CODES.S || (am != null && am.canScheduleExactAlarms()));
        r.put("fullScreen", Build.VERSION.SDK_INT < 34 || (nm != null && nm.canUseFullScreenIntent()));
        r.put("notifications", nm != null && nm.areNotificationsEnabled());
        r.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        r.put("scheduled", AlarmStore.all(ctx).size());
        // 알람 소리 크기 (0이면 알람 화면이 잠시 올려서 울림)
        AudioManager audio = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        r.put("alarmVolume", audio == null ? -1 : audio.getStreamVolume(AudioManager.STREAM_ALARM));
        r.put("alarmVolumeMax", audio == null ? -1 : audio.getStreamMaxVolume(AudioManager.STREAM_ALARM));
        // 사용자가 '기상·출발 알람' 알림 종류만 꺼 두었는지
        boolean channelOn = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            AlarmReceiver.ensureChannel(ctx);
            NotificationChannel ch = nm.getNotificationChannel(AlarmReceiver.CHANNEL_ID);
            channelOn = ch == null || ch.getImportance() != NotificationManager.IMPORTANCE_NONE;
        }
        r.put("alarmChannel", channelOn);
        JSONArray planned = PlanStore.load(ctx).optJSONArray("alarms");
        r.put("planned", planned == null ? 0 : planned.length());
        call.resolve(r);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "notifications");
        Context ctx = getContext();
        Uri pkg = Uri.parse("package:" + ctx.getPackageName());
        Intent i;
        if ("exact".equals(which) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, pkg);
        } else if ("fullscreen".equals(which) && Build.VERSION.SDK_INT >= 34) {
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, pkg);
        } else if ("battery".equals(which)) {
            // 배터리 최적화 목록 화면 (바로 바꾸는 창은 플레이 정책상 쓰지 않음)
            i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        } else if ("alarmChannel".equals(which) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
            i.putExtra(Settings.EXTRA_CHANNEL_ID, AlarmReceiver.CHANNEL_ID);
        } else {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(i);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(fallback);
        }
        call.resolve();
    }

    @PluginMethod
    public void consumeOpen(PluginCall call) {
        JSObject r = new JSObject();
        r.put("scheduleId", AlarmStore.consumePendingOpen(getContext()));
        r.put("sharedText", AlarmStore.consumePendingShare(getContext()));
        call.resolve(r);
    }
}
