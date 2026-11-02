package kr.myplanner.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 아침 실시간 재계산 (자가용·택시, 기차·비행기의 역/공항까지 차로 가는 구간)
 *
 * 기상 20분 전, 출발 30분 전에 앱이 꺼져 있어도 실행됩니다.
 * 티맵 실시간 소요시간을 받아 RecheckMath 규칙대로 출발·기상 알람을 옮기고 알림으로 알려 줍니다.
 * 잰 값은 PlanStore.live에 남겨 두었다가 앱을 열면 화면에도 반영됩니다.
 */
public final class Recheck {

    private static final String TAG = "MyPlannerRecheck";

    private Recheck() {}

    public static void run(Context ctx, int recheckId, BroadcastReceiver.PendingResult pending) {
        new Thread(() -> {
            try {
                runNow(ctx, recheckId);
            } catch (Exception e) {
                Log.e(TAG, "재계산 실패", e);
            } finally {
                try { AlarmScheduler.syncWindow(ctx); } catch (Exception ignored) {}
                if (pending != null) pending.finish();
            }
        }, "myplanner-recheck").start();
    }

    static void runNow(Context ctx, int recheckId) throws Exception {
        JSONObject plan = PlanStore.load(ctx);
        String key = plan.optString("tmapKey", "");
        JSONArray rechecks = plan.optJSONArray("rechecks");
        JSONObject spec = rechecks == null ? null : PlanStore.findById(rechecks, recheckId);
        if (spec == null || key.isEmpty()) return;

        int live = tmapMinutes(key, spec.optDouble("sx"), spec.optDouble("sy"), spec.optDouble("ex"), spec.optDouble("ey"));
        if (live <= 0) return;

        long now = System.currentTimeMillis();
        int base = spec.optInt("travelMin");
        RecheckMath.Result r = RecheckMath.decide(now, spec.optLong("anchor"), spec.optInt("fixedMin"), base, live,
                spec.optLong("plannedDepart"), spec.optLong("wake"));
        String occId = spec.optString("occId");

        // 잰 값 기록 (앱이 열리면 가져가서 화면·계산에 반영)
        JSONObject liveMap = plan.optJSONObject("live");
        if (liveMap == null) { liveMap = new JSONObject(); plan.put("live", liveMap); }
        JSONObject lv = new JSONObject();
        lv.put("travelMin", live);
        lv.put("checkedAt", now);
        lv.put("prevMin", base);
        liveMap.put(occId, lv);

        if (r.kind != RecheckMath.Kind.NONE) {
            String title = spec.optString("title");
            String hmDepart = hm(r.newDepart);
            JSONArray alarms = plan.optJSONArray("alarms");
            if (alarms != null) {
                JSONObject dep = PlanStore.findById(alarms, spec.optInt("departId"));
                if (dep != null) {
                    dep.put("at", r.newDepart);
                    dep.put("body", (r.urgent ? "지금 바로 출발하세요" : hmDepart + " 출발") + " · 실시간 교통 " + live + "분 반영");
                }
                JSONObject pre = PlanStore.findById(alarms, spec.optInt("preId"));
                if (pre != null) {
                    long preAt = r.newDepart - 10 * 60_000L;
                    if (preAt > now + RecheckMath.MIN_LEAD_MS) {
                        pre.put("at", preAt);
                        pre.put("body", hmDepart + " 출발 · 실시간 교통 " + live + "분 반영");
                    } else {
                        pre.put("at", 0); // 이미 지났으면 울리지 않음
                    }
                }
                if (r.moveWake) {
                    JSONObject wake = PlanStore.findById(alarms, spec.optInt("wakeId"));
                    if (wake != null) {
                        wake.put("at", r.newWake);
                        wake.put("body", "길이 막혀 " + (-r.deltaMin) + "분 일찍 깨웠어요. " + hmDepart + "에 출발하세요 (실시간 " + live + "분)");
                    }
                }
            }
            // 같은 회차의 다른 재확인도 새 기준으로
            int lastNotified = spec.optInt("lastNotified", 0);
            for (int i = 0; i < rechecks.length(); i++) {
                JSONObject o = rechecks.optJSONObject(i);
                if (o == null || !occId.equals(o.optString("occId"))) continue;
                o.put("plannedDepart", r.newDepart);
                if (r.moveWake) o.put("wake", r.newWake);
            }
            // 알림: 기준(plannedDepart)이 이번 값으로 바뀌므로, 다음 재확인은 교통이 또 5분 이상 달라질 때만 알림
            int totalDelta = lastNotified + r.deltaMin;
            {
                String nTitle, nBody;
                if (r.kind == RecheckMath.Kind.EARLIER) {
                    nTitle = r.urgent ? "🚨 지금 바로 출발하세요 — " + title : "🚗 길이 막혀요 — " + (-r.deltaMin) + "분 일찍 출발하세요";
                    nBody = title + " · 티맵 실시간 " + live + "분 (예상 " + base + "분). " + hmDepart + "에 출발하세요."
                            + (r.moveWake ? " 기상 알람을 " + hm(r.newWake) + "로 당겼어요." : "");
                } else {
                    nTitle = "🙂 길이 한산해요 — " + hmDepart + "에 출발해도 돼요";
                    nBody = title + " · 티맵 실시간 " + live + "분 (예상 " + base + "분). 출발 알람을 " + hmDepart + "로 미뤘어요.";
                }
                AlarmReceiver.postNote(ctx, recheckId, nTitle, nBody, occId);
                for (int i = 0; i < rechecks.length(); i++) {
                    JSONObject o = rechecks.optJSONObject(i);
                    if (o != null && occId.equals(o.optString("occId"))) {
                        o.put("lastNotified", totalDelta);
                        o.put("travelMin", live); // 다음 재확인은 이번 값을 기준으로 비교
                    }
                }
            }
        } else {
            // 변화가 작아도 다음 비교 기준은 최신 값으로
            for (int i = 0; i < rechecks.length(); i++) {
                JSONObject o = rechecks.optJSONObject(i);
                if (o != null && occId.equals(o.optString("occId"))) o.put("travelMin", live);
            }
        }
        PlanStore.save(ctx, plan);
        Log.d(TAG, "재계산 " + occId + ": 실시간 " + live + "분, 변화 " + r.deltaMin + "분 (" + r.kind + ")");
    }

    /** 티맵 자동차 경로 실시간 소요시간(분). 실패 시 -1 */
    static int tmapMinutes(String key, double sx, double sy, double ex, double ey) {
        HttpURLConnection c = null;
        try {
            String q = "version=1&startX=" + sx + "&startY=" + sy + "&endX=" + ex + "&endY=" + ey
                    + "&reqCoordType=WGS84GEO&resCoordType=WGS84GEO&searchOption=0&trafficInfo=Y&appKey=" + key;
            c = (HttpURLConnection) new URL("https://apis.openapi.sk.com/tmap/routes?" + q).openConnection();
            c.setConnectTimeout(10_000);
            c.setReadTimeout(15_000);
            c.setRequestProperty("Accept", "application/json");
            if (c.getResponseCode() != 200) return -1;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            JSONObject res = new JSONObject(out.toString("UTF-8"));
            JSONObject props = res.getJSONArray("features").getJSONObject(0).getJSONObject("properties");
            return (int) Math.ceil(props.getDouble("totalTime") / 60.0);
        } catch (Exception e) {
            Log.w(TAG, "티맵 조회 실패", e);
            return -1;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String hm(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.KOREA).format(new Date(ms));
    }
}
