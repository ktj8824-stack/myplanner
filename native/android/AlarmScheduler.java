package kr.myplanner.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

/**
 * 알람 예약·취소·자동 보충.
 *
 * 앱은 최대 45일치 계획을 PlanStore에 넘기고, 여기서는 그중 '앞으로 3일치'만 AlarmManager에 걸어 둡니다.
 * 매일 새벽(보충 알람)·알람이 울릴 때마다·재부팅 후 syncWindow()가 다시 3일치를 채우므로
 * 앱을 오래 열지 않아도 반복 일정 알람이 계속 이어집니다.
 *
 * 기상·출발(full)은 setAlarmClock(알람시계 방식) → 절전 중에도 정확, 상태 표시줄에 알람 아이콘.
 * 일반 알림·재계산·보충은 setExactAndAllowWhileIdle.
 */
public final class AlarmScheduler {

    private static final String TAG = "MyPlannerAlarm";
    public static final long WINDOW_MS = 3L * 24 * 60 * 60 * 1000;
    public static final int REFILL_ID = 1_999_999_001;

    private AlarmScheduler() {}

    /* ---------- 단일 알람 ---------- */

    public static boolean schedule(Context ctx, AlarmStore.Item item) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;
        PendingIntent fire = firePendingIntent(ctx, item);
        try {
            boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
            if (AlarmStore.KIND_REFILL.equals(item.kind)) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, fire); // 보충은 조금 늦어도 됨
            } else if (exact && AlarmStore.KIND_FULL.equals(item.kind)) {
                Intent show = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
                PendingIntent showPi = show == null ? null
                        : PendingIntent.getActivity(ctx, item.id, show, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(item.at, showPi), fire);
            } else if (exact) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, fire);
            } else {
                // '알람 및 리마인더' 권한이 없으면 몇 분 오차가 있을 수 있음
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, item.at, fire);
            }
        } catch (Exception e) {
            Log.e(TAG, "알람 예약 실패 " + item.id, e);
            return false;
        }
        AlarmStore.put(ctx, item);
        return true;
    }

    public static void cancel(Context ctx, int id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = firePendingIntent(ctx, new AlarmStore.Item(id, 0, null, null, null));
        try {
            if (am != null) am.cancel(pi);
            pi.cancel();
        } catch (Exception e) {
            Log.e(TAG, "알람 취소 실패 " + id, e);
        }
        AlarmStore.remove(ctx, id);
    }

    /* ---------- 계획 → 3일 창 동기화 ---------- */

    /** 계획에서 앞으로 3일치를 꺼내 예약하고, 계획에서 빠졌거나 시각이 바뀐 알람은 정리합니다. */
    public static synchronized int syncWindow(Context ctx) {
        long now = System.currentTimeMillis();
        long until = now + WINDOW_MS;
        JSONObject plan = PlanStore.load(ctx);
        Map<Integer, AlarmStore.Item> want = new HashMap<>();

        JSONArray alarms = plan.optJSONArray("alarms");
        if (alarms != null) for (int i = 0; i < alarms.length(); i++) {
            JSONObject a = alarms.optJSONObject(i);
            if (a == null) continue;
            long at = a.optLong("at");
            if (at <= now || at > until) continue;
            AlarmStore.Item it = new AlarmStore.Item(a.optInt("id"), at, a.optString("title"), a.optString("body"), a.optString("scheduleId"));
            it.kind = "note".equals(a.optString("kind")) ? AlarmStore.KIND_NOTE : AlarmStore.KIND_FULL;
            want.put(it.id, it);
        }
        JSONArray rechecks = plan.optJSONArray("rechecks");
        if (rechecks != null) for (int i = 0; i < rechecks.length(); i++) {
            JSONObject r = rechecks.optJSONObject(i);
            if (r == null) continue;
            long at = r.optLong("at");
            if (at <= now || at > until) continue;
            AlarmStore.Item it = new AlarmStore.Item(r.optInt("id"), at, r.optString("title"), "", r.optString("occId"));
            it.kind = AlarmStore.KIND_RECHECK;
            want.put(it.id, it);
        }

        // 정리: 스누즈·보충 알람은 유지, 나머지는 계획과 다르면 취소
        Map<Integer, AlarmStore.Item> have = new HashMap<>();
        for (AlarmStore.Item old : AlarmStore.all(ctx)) {
            if (old.snooze) {
                if (old.at <= now) AlarmStore.remove(ctx, old.id);
                else schedule(ctx, old); // 재부팅 후에도 스누즈 복구
                continue;
            }
            if (AlarmStore.KIND_REFILL.equals(old.kind)) continue;
            AlarmStore.Item w = want.get(old.id);
            if (w == null || w.at != old.at || !w.kind.equals(old.kind) || !w.body.equals(old.body) || !w.title.equals(old.title)) {
                cancel(ctx, old.id);
            } else {
                have.put(old.id, old);
            }
        }
        int ok = 0;
        for (AlarmStore.Item it : want.values()) {
            if (have.containsKey(it.id)) { ok++; continue; }
            if (schedule(ctx, it)) ok++;
        }
        scheduleRefill(ctx);
        NextWidget.updateAll(ctx); // 홈 화면 위젯도 새로 그림
        Log.d(TAG, "3일 창 동기화: " + ok + "개 예약");
        return ok;
    }

    /** 매일 새벽 3시 17분쯤 계획에서 다음 알람을 보충 */
    private static void scheduleRefill(Context ctx) {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 3);
        c.set(Calendar.MINUTE, 17);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        if (c.getTimeInMillis() <= System.currentTimeMillis()) c.add(Calendar.DAY_OF_YEAR, 1);
        AlarmStore.Item r = new AlarmStore.Item(REFILL_ID, c.getTimeInMillis(), "refill", "", "");
        r.kind = AlarmStore.KIND_REFILL;
        schedule(ctx, r);
    }

    private static PendingIntent firePendingIntent(Context ctx, AlarmStore.Item item) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.putExtra("id", item.id);
        i.putExtra("title", item.title);
        i.putExtra("body", item.body);
        i.putExtra("scheduleId", item.scheduleId);
        i.putExtra("kind", item.kind);
        return PendingIntent.getBroadcast(ctx, item.id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
