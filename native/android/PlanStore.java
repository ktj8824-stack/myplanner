package kr.myplanner.app;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 앱이 넘겨준 장기 알람 계획(최대 45일)을 파일로 보관합니다.
 * 앱을 열지 않아도 AlarmScheduler.syncWindow()가 이 계획에서 앞으로 3일치를 계속 꺼내 예약합니다.
 *
 * plan.json = {
 *   alarms:   [{ id, at, title, body, scheduleId, kind: "full"|"note" }],
 *   rechecks: [{ id, at, occId, anchor, fixedMin, travelMin, plannedDepart, wake, wakeId, preId, departId,
 *                sx, sy, ex, ey, title, lastNotified }],
 *   tmapKey:  "...",
 *   live:     { occId: { travelMin, checkedAt, prevMin } }   // 백그라운드에서 잰 실시간 값 (앱이 가져감)
 * }
 */
public final class PlanStore {

    private static final String FILE = "myplanner_plan.json";
    private static final Object LOCK = new Object();

    private PlanStore() {}

    public static JSONObject load(Context ctx) {
        synchronized (LOCK) {
            File f = new File(ctx.getFilesDir(), FILE);
            if (!f.exists()) return empty();
            try (FileInputStream in = new FileInputStream(f)) {
                byte[] buf = new byte[(int) f.length()];
                int off = 0;
                while (off < buf.length) {
                    int n = in.read(buf, off, buf.length - off);
                    if (n < 0) break;
                    off += n;
                }
                return new JSONObject(new String(buf, 0, off, StandardCharsets.UTF_8));
            } catch (Exception e) {
                Log.e("MyPlannerPlan", "계획 파일 읽기 실패", e);
                return empty();
            }
        }
    }

    public static void save(Context ctx, JSONObject plan) {
        synchronized (LOCK) {
            File tmp = new File(ctx.getFilesDir(), FILE + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(plan.toString().getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) {
                Log.e("MyPlannerPlan", "계획 파일 저장 실패", e);
                return;
            }
            // 쓰는 도중 꺼져도 이전 계획이 남도록 임시 파일 → 교체
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(new File(ctx.getFilesDir(), FILE));
        }
    }

    public static JSONObject empty() {
        JSONObject o = new JSONObject();
        try {
            o.put("alarms", new JSONArray());
            o.put("rechecks", new JSONArray());
            o.put("live", new JSONObject());
            o.put("tmapKey", "");
        } catch (Exception ignored) {}
        return o;
    }

    public static JSONObject findById(JSONArray arr, int id) {
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o != null && o.optInt("id") == id) return o;
        }
        return null;
    }
}
