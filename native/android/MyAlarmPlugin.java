package kr.myplanner.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
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
 *  - status() → { exact, fullScreen, notifications, battery, scheduled, planned }
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
            i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
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
