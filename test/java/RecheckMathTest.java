package kr.myplanner.app;

// 실행: npm run test:native  (javac만 있으면 됨, 안드로이드 SDK 불필요)
public class RecheckMathTest {
    static final long M = 60_000L;
    static int fails = 0;
    static void eq(Object a, Object b, String msg) {
        if (!String.valueOf(a).equals(String.valueOf(b))) { fails++; System.out.println("✗ " + msg + ": " + a + " != " + b); }
    }

    public static void main(String[] args) {
        long t0 = 1_000_000_000_000L;            // 기준 시각
        long anchor = t0 + 180 * M;              // 09:00 (지금 06:00이라 가정)
        int fixed = 20;                          // 여유 10 + 주차 10
        long planned = anchor - (fixed + 40) * M;// 평소 40분 → 08:00 출발
        long wake = planned - 60 * M;            // 07:00 기상

        // 1) 막힘 55분 → 15분 일찍, 아직 안 울린 기상도 당김
        RecheckMath.Result r = RecheckMath.decide(t0 + 40 * M, anchor, fixed, 40, 55, planned, wake);
        eq(r.kind, RecheckMath.Kind.EARLIER, "막힘 판정");
        eq(r.deltaMin, -15, "15분 일찍");
        eq((planned - r.newDepart) / M, 15, "출발 15분 당김");
        eq(r.moveWake, true, "기상 당김");
        eq((wake - r.newWake) / M, 15, "기상 15분 당김");
        System.out.println("✓ 막힘 → 출발·기상 15분 당김");

        // 2) 3분 차이는 무시
        r = RecheckMath.decide(t0, anchor, fixed, 40, 43, planned, wake);
        eq(r.kind, RecheckMath.Kind.NONE, "작은 변화 무시");
        System.out.println("✓ 5분 미만 변화는 무시");

        // 3) 한산 28분: 출발 2시간 전에 잰 값으로는 늦추지 않음 (출근 시간대에 다시 막힐 수 있음)
        r = RecheckMath.decide(t0, anchor, fixed, 40, 28, planned, wake);
        eq(r.kind, RecheckMath.Kind.NONE, "이른 한산은 무시");
        // 출발 30분 전에 잰 한산 → 출발만 12분 미룸, 기상은 그대로
        r = RecheckMath.decide(planned - 30 * M, anchor, fixed, 40, 28, planned, wake);
        eq(r.kind, RecheckMath.Kind.LATER, "한산 판정");
        eq((r.newDepart - planned) / M, 12, "출발 12분 미룸");
        eq(r.moveWake, false, "기상은 그대로");
        System.out.println("✓ 한산 → 출발만 미룸 (기상 유지)");

        // 4) 기상 이미 지남(출발 30분 전 재확인) → 출발만 당김
        long now = planned - 30 * M;
        r = RecheckMath.decide(now, anchor, fixed, 40, 52, planned, wake);
        eq(r.kind, RecheckMath.Kind.EARLIER, "막힘");
        eq(r.moveWake, false, "지난 기상은 안 건드림");
        eq((planned - r.newDepart) / M, 12, "출발 12분 당김");
        System.out.println("✓ 기상 후 재확인 → 출발만 당김");

        // 5) 이미 늦음 → 지금 바로 출발 (1분 뒤 알람)
        now = planned - 5 * M;
        r = RecheckMath.decide(now, anchor, fixed, 40, 70, planned, wake);
        eq(r.urgent, true, "긴급");
        eq(r.newDepart, now + RecheckMath.MIN_LEAD_MS, "1분 뒤 알람");
        System.out.println("✓ 늦었으면 '지금 바로 출발' (1분 뒤)");

        // 6) 기상 당김이 과거로 가면 1분 뒤로
        now = wake - 5 * M;
        r = RecheckMath.decide(now, anchor, fixed, 40, 60, planned, wake);
        eq(r.newWake, now + RecheckMath.MIN_LEAD_MS, "기상 1분 뒤");
        System.out.println("✓ 당긴 기상이 지났으면 1분 뒤에 울림");

        // 6-1) 평소의 1/3도 안 되는 값은 무시
        r = RecheckMath.decide(planned - 30 * M, anchor, fixed, 40, 10, planned, wake);
        eq(r.kind, RecheckMath.Kind.NONE, "너무 작은 값 무시");
        System.out.println("✓ 이른 한산·너무 작은 값은 출발을 늦추지 않음");

        // 7) 비정상 값 무시
        eq(RecheckMath.decide(t0, anchor, fixed, 40, 900, planned, wake).kind, RecheckMath.Kind.NONE, "비정상");
        eq(RecheckMath.decide(t0, anchor, fixed, 40, 0, planned, wake).kind, RecheckMath.Kind.NONE, "0분");
        System.out.println("✓ 비정상 티맵 값 무시");

        if (fails > 0) { System.out.println(fails + "개 실패"); System.exit(1); }
        System.out.println("\n재계산 판단 규칙 확인 완료");
    }
}
