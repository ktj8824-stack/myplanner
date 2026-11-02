package kr.myplanner.app;

/**
 * 아침 실시간 재계산의 판단 규칙 (안드로이드 코드 없는 순수 계산 — 단위 테스트 가능)
 *
 * 출발 = anchor − (fixedMin + 실시간 이동분)
 *  - 5분 이상 일찍 나가야 하면: 출발·출발 10분 전 알람을 당기고, 아직 안 울린 기상 알람도 같은 만큼 당김
 *  - 5분 이상 늦게 나가도 되면: 출발 알람만 미룸 (기상 알람은 안전하게 그대로)
 *  - 티맵 값이 비정상(평소의 4배 초과, 10시간 초과)이면 무시
 */
public final class RecheckMath {

    public static final int THRESHOLD_MIN = 5;
    public static final long MIN_LEAD_MS = 60_000L; // 지금 시각보다 최소 1분 뒤에 울림

    public enum Kind { NONE, EARLIER, LATER }

    public static final class Result {
        public Kind kind = Kind.NONE;
        public long newDepart;
        public int deltaMin;          // 음수 = 더 일찍 출발
        public boolean moveWake;
        public long newWake;
        public boolean urgent;        // 지금 바로 출발해야 함
    }

    private RecheckMath() {}

    public static Result decide(long now, long anchor, int fixedMin, int baseTravelMin, int liveTravelMin,
                                long plannedDepart, long wakeAt) {
        Result r = new Result();
        r.newDepart = plannedDepart;
        r.newWake = wakeAt;
        if (liveTravelMin <= 0 || liveTravelMin > 600 || (baseTravelMin > 0 && liveTravelMin > baseTravelMin * 4 + 30)) return r;

        long depart = anchor - (long) (fixedMin + liveTravelMin) * 60_000L;
        int delta = (int) Math.round((depart - plannedDepart) / 60_000.0);
        if (Math.abs(delta) < THRESHOLD_MIN) return r;

        r.deltaMin = delta;
        if (delta < 0) {
            r.kind = Kind.EARLIER;
            if (depart <= now + 2 * 60_000L) {
                r.urgent = true;
                depart = Math.max(depart, now + MIN_LEAD_MS);
            }
            r.newDepart = depart;
            if (wakeAt > now + MIN_LEAD_MS) {
                r.moveWake = true;
                r.newWake = Math.max(wakeAt + (long) delta * 60_000L, now + MIN_LEAD_MS);
            }
        } else {
            r.kind = Kind.LATER;
            r.newDepart = depart;
        }
        return r;
    }
}
