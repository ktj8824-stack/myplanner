package kr.myplanner.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 예약한 알람을 기기에 기록해 둡니다.
 * AlarmManager 알람은 재부팅하면 사라지므로, BootReceiver가 이 기록으로 다시 등록합니다.
 * (버디플래너 AlarmScheduler의 저장 방식을 JSON으로 정리)
 */
public final class AlarmStore {

    private static final String PREFS = "myplanner_alarms";
    private static final String PREFS_STATE = "myplanner_alarm_state";

    public static final String KIND_FULL = "full";
    public static final String KIND_NOTE = "note";
    public static final String KIND_RECHECK = "recheck";
    public static final String KIND_REFILL = "refill";

    private AlarmStore() {}

    public static final class Item {
        public int id;
        public long at;
        public String title;
        public String body;
        public String scheduleId;
        public boolean snooze; // '5분 뒤' 알람 — 앱이 알람을 다시 맞출 때 지우지 않음
        /** full: 전체 화면 알람 · note: 일반 알림 · recheck: 실시간 재계산 · refill: 매일 알람 보충 */
        public String kind = KIND_FULL;
        /** 응답이 없어 자동으로 다시 울린 횟수 (0 = 처음) */
        public int rep;

        public Item(int id, long at, String title, String body, String scheduleId) {
            this.id = id;
            this.at = at;
            this.title = title == null ? "" : title;
            this.body = body == null ? "" : body;
            this.scheduleId = scheduleId == null ? "" : scheduleId;
        }

        String toJson() {
            try {
                JSONObject o = new JSONObject();
                o.put("id", id);
                o.put("at", at);
                o.put("title", title);
                o.put("body", body);
                o.put("scheduleId", scheduleId);
                o.put("snooze", snooze);
                o.put("kind", kind);
                o.put("rep", rep);
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        static Item fromJson(String s) {
            try {
                JSONObject o = new JSONObject(s);
                Item it = new Item(o.getInt("id"), o.getLong("at"), o.optString("title"), o.optString("body"), o.optString("scheduleId"));
                it.snooze = o.optBoolean("snooze", false);
                it.kind = o.optString("kind", KIND_FULL);
                it.rep = o.optInt("rep", 0);
                return it;
            } catch (Exception e) {
                return null;
            }
        }
    }

    public static void put(Context ctx, Item item) {
        prefs(ctx).edit().putString(String.valueOf(item.id), item.toJson()).apply();
    }

    public static void remove(Context ctx, int id) {
        prefs(ctx).edit().remove(String.valueOf(id)).apply();
    }

    public static List<Item> all(Context ctx) {
        List<Item> list = new ArrayList<>();
        for (Map.Entry<String, ?> e : prefs(ctx).getAll().entrySet()) {
            Item it = Item.fromJson(String.valueOf(e.getValue()));
            if (it != null) list.add(it);
        }
        return list;
    }

    /** 알람 화면에서 '일정 보기'를 누르면 앱이 열린 뒤 이 일정으로 이동하도록 기록 */
    public static void setPendingOpen(Context ctx, String scheduleId) {
        state(ctx).edit().putString("pendingOpen", scheduleId == null ? "" : scheduleId).apply();
    }

    /** 다른 앱(문자·카톡)에서 '공유'로 보낸 글 — 앱이 열리면 문자로 등록 화면에 채움 */
    public static void setPendingShare(Context ctx, String text) {
        state(ctx).edit().putString("pendingShare", text == null ? "" : text).apply();
    }

    public static String consumePendingShare(Context ctx) {
        String v = state(ctx).getString("pendingShare", "");
        state(ctx).edit().remove("pendingShare").apply();
        return v;
    }

    /** 계획이 오래돼 '앱을 열어 주세요' 안내를 이미 보냈는지 (계획 저장 시각 기준) */
    public static boolean staleNoticeSent(Context ctx, long savedAt) {
        return state(ctx).getLong("staleNotice", 0) == savedAt;
    }

    public static void markStaleNotice(Context ctx, long savedAt) {
        state(ctx).edit().putLong("staleNotice", savedAt).apply();
    }

    public static String consumePendingOpen(Context ctx) {
        String v = state(ctx).getString("pendingOpen", "");
        state(ctx).edit().remove("pendingOpen").apply();
        return v;
    }

    private static SharedPreferences prefs(Context ctx) {
        return Storage.of(ctx).getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SharedPreferences state(Context ctx) {
        return Storage.of(ctx).getSharedPreferences(PREFS_STATE, Context.MODE_PRIVATE);
    }
}
