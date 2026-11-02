package kr.myplanner.app;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * JS의 window.Capacitor.Plugins.MyAlarm
 *  - setAll({ alarms: [{ id, at, title, body, scheduleId }] })  기상·출발 알람 전체 교체
 *  - snooze({ id, at, title, body, scheduleId })
 *  - status() → { exact, fullScreen, notifications, battery }
 *  - openSettings({ which: 'exact' | 'fullscreen' | 'notifications' | 'battery' })
 *  - consumeOpen() → { scheduleId }  알람 화면에서 '일정 보기'를 눌렀으면 그 일정
 */
@CapacitorPlugin(name = "MyAlarm")
public class MyAlarmPlugin extends Plugin {

    @Override
    public void load() {
        AlarmReceiver.ensureChannel(getContext());
    }

    @PluginMethod
    public void setAll(PluginCall call) {
        JSArray arr = call.getArray("alarms", new JSArray());
        List<AlarmStore.Item> items = new ArrayList<>();
        try {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                items.add(new AlarmStore.Item(o.getInt("id"), o.getLong("at"),
                        o.optString("title"), o.optString("body"), o.optString("scheduleId")));
            }
        } catch (Exception e) {
            call.reject("알람 목록 형식 오류", e);
            return;
        }
        int ok = AlarmScheduler.replaceAll(getContext(), items);
        JSObject r = new JSObject();
        r.put("scheduled", ok);
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
        call.resolve(r);
    }
}
