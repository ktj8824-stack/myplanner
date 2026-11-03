package kr.myplanner.app;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * 버스 실시간 도착으로 '언제 나가야 하는지' 판단 (앱 js/bus.js의 BusMath와 같은 규칙)
 *  - 제때 오는 버스 중 가장 늦은 버스를 기준으로 출발 시각 계산 (정류장에 2분 먼저)
 *  - 그 출발이 3분 이상 이르면 EARLIER → 출발 알람을 당김
 *  - 제때 오는 버스가 없으면 LATE → 늦을 수 있다고 알림
 */
public final class BusMath {

    public static final int SLACK_MIN = 5;
    public static final int MARGIN_MIN = 2;

    public enum Kind { NONE, OK, EARLIER, LATE }

    public static final class Result {
        public Kind kind = Kind.NONE;
        public long busAt, leaveAt;
        public int deltaMin, lateMin;
        public boolean urgent;
    }

    private BusMath() {}

    public static Result decide(long now, long plannedDepart, int preStopMin, int walkMin, List<Integer> arrivalsSec) {
        final long M = 60_000L;
        Result r = new Result();
        long stopAt = plannedDepart + preStopMin * M;
        long deadline = stopAt + SLACK_MIN * M;
        List<Long> buses = new ArrayList<>();
        if (arrivalsSec != null) for (Integer s : arrivalsSec) {
            if (s == null) continue;
            long b = now + s * 1000L;
            if (b >= now + (walkMin + 1) * M) buses.add(b);
        }
        Collections.sort(buses);
        if (buses.isEmpty()) return r;
        Long target = null;
        for (long b : buses) if (b <= deadline) target = b;
        if (target != null) {
            r.busAt = target;
            r.leaveAt = target - (walkMin + MARGIN_MIN) * M;
            if (r.leaveAt <= now + M) { r.urgent = true; r.leaveAt = now + M; }
            r.deltaMin = (int) Math.round((r.leaveAt - plannedDepart) / (double) M);
            r.kind = r.deltaMin <= -3 ? Kind.EARLIER : Kind.OK;
        } else {
            r.kind = Kind.LATE;
            r.busAt = buses.get(0);
            r.lateMin = (int) Math.round((r.busAt - deadline) / (double) M);
        }
        return r;
    }
}
