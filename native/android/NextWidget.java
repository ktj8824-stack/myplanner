package kr.myplanner.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

/**
 * 홈 화면 위젯: 다음 일정의 기상 · 출발 · 도착(탑승) 시각
 * 앱이 넘긴 계획(plan.json의 widget 목록)에서 아직 출발 전인 첫 일정을 보여 줍니다.
 * 계획이 바뀔 때·알람이 울릴 때·매일 새벽 보충 때·30분마다 새로 그립니다.
 */
public class NextWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        render(ctx, mgr, ids);
    }

    /** 설치된 모든 위젯 새로 그리기 (위젯이 없으면 아무것도 안 함) */
    public static void updateAll(Context ctx) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, NextWidget.class));
            if (ids != null && ids.length > 0) render(ctx, mgr, ids);
        } catch (Exception ignored) {}
    }

    private static void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        JSONObject next = pickNext(ctx, System.currentTimeMillis());
        for (int id : ids) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.mp_widget);
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (next == null) {
                v.setTextViewText(R.id.mp_w_date, "마이플래너");
                v.setTextViewText(R.id.mp_w_title, "예정된 일정이 없어요");
                v.setViewVisibility(R.id.mp_w_times, View.GONE);
                v.setTextViewText(R.id.mp_w_note, "눌러서 일정 추가");
            } else {
                long wake = next.optLong("wakeMs"), depart = next.optLong("departMs"), end = next.optLong("endMs");
                long now = System.currentTimeMillis();
                v.setViewVisibility(R.id.mp_w_times, View.VISIBLE);
                v.setTextViewText(R.id.mp_w_date, dayLabel(depart) + " · " + next.optString("modeEmoji") + " " + next.optString("modeLabel"));
                v.setTextViewText(R.id.mp_w_title, next.optString("title"));
                v.setTextViewText(R.id.mp_w_wake, (sameDay(wake, depart) ? "" : "전날 ") + hm(wake));
                v.setTextViewText(R.id.mp_w_depart, hm(depart));
                v.setTextViewText(R.id.mp_w_end_label, next.optString("endLabel", "도착"));
                v.setTextViewText(R.id.mp_w_end, hm(end));
                // 기상이 지났으면 기상 칸을 흐리게
                v.setTextColor(R.id.mp_w_wake, wake < now ? 0x99FFFFFF : 0xFFFFFFFF);
                String note = next.optString("note");
                v.setTextViewText(R.id.mp_w_note, note.isEmpty() ? "" : note);
                v.setViewVisibility(R.id.mp_w_note, note.isEmpty() ? View.GONE : View.VISIBLE);
                if (open != null) open.putExtra(MyAlarmPlugin.EXTRA_OPEN, next.optString("occId"));
            }
            if (open != null) {
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                PendingIntent pi = PendingIntent.getActivity(ctx, 7001 + id, open,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                v.setOnClickPendingIntent(R.id.mp_w_root, pi);
            }
            mgr.updateAppWidget(id, v);
        }
    }

    /** 출발 전(또는 출발 후 10분 이내)인 첫 일정. 백그라운드에서 출발이 당겨졌으면 그 시각을 반영 */
    static JSONObject pickNext(Context ctx, long now) {
        JSONObject plan = PlanStore.load(ctx);
        JSONArray items = plan.optJSONArray("widget");
        if (items == null) return null;
        JSONArray alarms = plan.optJSONArray("alarms");
        for (int i = 0; i < items.length(); i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            if (alarms != null) {
                JSONObject dep = PlanStore.findById(alarms, it.optInt("departId"));
                if (dep != null && dep.optLong("at") > 0) {
                    try { it.put("departMs", dep.optLong("at")); } catch (Exception ignored) {}
                }
                JSONObject wake = PlanStore.findById(alarms, it.optInt("wakeId"));
                if (wake != null && wake.optLong("at") > 0) {
                    try { it.put("wakeMs", wake.optLong("at")); } catch (Exception ignored) {}
                }
            }
            if (it.optLong("departMs") > now - 10 * 60_000L) return it;
        }
        return null;
    }

    private static String hm(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.KOREA).format(new Date(ms));
    }

    private static boolean sameDay(long a, long b) {
        Calendar x = Calendar.getInstance(), y = Calendar.getInstance();
        x.setTimeInMillis(a); y.setTimeInMillis(b);
        return x.get(Calendar.YEAR) == y.get(Calendar.YEAR) && x.get(Calendar.DAY_OF_YEAR) == y.get(Calendar.DAY_OF_YEAR);
    }

    /** "오늘" / "내일" / "11월 5일 (목)" — 위젯이 날짜가 바뀌어도 맞게 폰에서 계산 */
    private static String dayLabel(long ms) {
        Calendar d = Calendar.getInstance();
        d.setTimeInMillis(ms);
        Calendar today = Calendar.getInstance();
        today.set(Calendar.HOUR_OF_DAY, 0); today.set(Calendar.MINUTE, 0); today.set(Calendar.SECOND, 0); today.set(Calendar.MILLISECOND, 0);
        Calendar day = (Calendar) d.clone();
        day.set(Calendar.HOUR_OF_DAY, 0); day.set(Calendar.MINUTE, 0); day.set(Calendar.SECOND, 0); day.set(Calendar.MILLISECOND, 0);
        long diff = Math.round((day.getTimeInMillis() - today.getTimeInMillis()) / 86_400_000.0);
        if (diff == 0) return "오늘";
        if (diff == 1) return "내일";
        if (diff == 2) return "모레";
        return new SimpleDateFormat("M월 d일 (E)", Locale.KOREA).format(new Date(ms));
    }
}
