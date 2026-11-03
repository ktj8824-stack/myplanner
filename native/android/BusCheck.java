package kr.myplanner.app;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 출발 15분 전: 첫 버스 정류장의 실시간 도착을 서버 함수(bus_arrival)로 확인해서
 *  - "7714번 08:21 도착 예정 — 08:13에 나가면 딱 맞아요" (그대로)
 *  - "7714번이 08:17에 와요 — 08:09에 나가세요" (출발 알람을 당김)
 *  - "다음 버스가 08:31이라 9분 늦을 수 있어요" (다른 방법 안내)
 * 를 알림으로 보냅니다. 앱이 꺼져 있어도 동작합니다.
 *
 * spec = { type:'bus', stationId, routeIds, busName, walkMin, preStopMin, plannedDepart, departId, preId, occId, title }
 */
public final class BusCheck {

    private static final String TAG = "MyPlannerBus";

    private BusCheck() {}

    static void run(Context ctx, JSONObject plan, JSONObject spec, String proxyUrl, String anon) throws Exception {
        String stationId = spec.optString("stationId");
        String routeIds = spec.optString("routeIds");
        if (stationId.isEmpty()) return;
        List<Integer> secs = fetch(proxyUrl, anon, stationId, routeIds);
        if (secs == null) return;

        long now = System.currentTimeMillis();
        BusMath.Result r = BusMath.decide(now, spec.optLong("plannedDepart"), spec.optInt("preStopMin"), spec.optInt("walkMin"), secs);
        String bus = spec.optString("busName", "버스");
        String occId = spec.optString("occId");
        String title, body;
        switch (r.kind) {
            case EARLIER: {
                title = r.urgent ? "🚨 지금 나가야 " + josa(bus, "을", "를") + " 탈 수 있어요" : "🚌 " + josa(bus, "이", "가") + " " + hm(r.busAt) + "에 와요";
                body = r.urgent ? hm(r.busAt) + " 정류장 도착 · 걸어서 " + spec.optInt("walkMin") + "분"
                        : hm(r.leaveAt) + "에 나가세요 (예정보다 " + (-r.deltaMin) + "분 일찍). 출발 알람을 당겼어요.";
                // 출발 알람 당기기 (출발 10분 전 알림은 이미 지났거나 곧이라 생략)
                JSONArray alarms = plan.optJSONArray("alarms");
                JSONObject dep = alarms == null ? null : PlanStore.findById(alarms, spec.optInt("departId"));
                if (dep != null) {
                    dep.put("at", r.leaveAt);
                    dep.put("body", bus + " " + hm(r.busAt) + " 도착 · 지금 출발하세요");
                }
                JSONObject pre = alarms == null ? null : PlanStore.findById(alarms, spec.optInt("preId"));
                if (pre != null && pre.optLong("at") > r.leaveAt - 60_000L) pre.put("at", 0);
                PlanStore.save(ctx, plan);
                break;
            }
            case OK:
                title = "🚌 " + bus + " " + hm(r.busAt) + " 도착 예정";
                body = hm(r.leaveAt) + "에 나가면 딱 맞아요 · 걸어서 " + spec.optInt("walkMin") + "분";
                break;
            case LATE:
                title = "⚠️ " + josa(bus, "이", "가") + " 늦어요";
                body = "다음 버스가 " + hm(r.busAt) + "에 와서 약 " + r.lateMin + "분 늦을 수 있어요. 다른 버스나 택시를 확인해 보세요.";
                break;
            default:
                return; // 정보 없음 → 알리지 않음
        }
        AlarmReceiver.postNote(ctx, spec.optInt("id"), title, body, occId);
        Log.d(TAG, "버스 확인 " + occId + ": " + r.kind + " " + title);
    }

    /** 서버 함수 → 도착 예정 초 목록 (해당 노선만 이미 걸러서 요청). 실패 시 null */
    static List<Integer> fetch(String url, String anon, String stationId, String routeIds) {
        HttpURLConnection c = null;
        try {
            JSONObject req = new JSONObject();
            req.put("service", "bus_arrival");
            req.put("stationID", stationId);
            req.put("routeIDs", routeIds);
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setConnectTimeout(10_000);
            c.setReadTimeout(15_000);
            c.setRequestProperty("Content-Type", "application/json");
            if (!anon.isEmpty()) {
                c.setRequestProperty("Authorization", "Bearer " + anon);
                c.setRequestProperty("apikey", anon);
            }
            c.getOutputStream().write(req.toString().getBytes("UTF-8"));
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            JSONArray arr = new JSONObject(out.toString("UTF-8")).optJSONArray("arrivals");
            if (arr == null) return null;
            List<String> ids = new ArrayList<>();
            for (String s : routeIds.split(",")) if (!s.isEmpty()) ids.add(s);
            List<Integer> secs = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject a = arr.optJSONObject(i);
                if (a == null) continue;
                if (!ids.isEmpty() && !ids.contains(a.optString("routeId"))) continue;
                secs.add(a.optInt("sec"));
            }
            return secs;
        } catch (Exception e) {
            Log.w(TAG, "버스 도착 조회 실패", e);
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** 받침에 맞는 조사 (341번이 / 마을버스가) */
    static String josa(String w, String withB, String without) {
        if (w == null || w.isEmpty()) return w;
        char c = w.charAt(w.length() - 1);
        boolean has;
        if (c >= 0xAC00 && c <= 0xD7A3) has = (c - 0xAC00) % 28 > 0;
        else if (Character.isDigit(c)) has = "2459".indexOf(c) < 0;
        else has = false;
        return w + (has ? withB : without);
    }

    private static String hm(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.KOREA).format(new Date(ms));
    }
}
