package kr.myplanner.app;

import java.util.Arrays;
import java.util.Collections;

// js/bus.js BusMath와 같은 결과인지 확인 (test/bus.test.js와 같은 사례)
public class BusMathTest {
    static int fails = 0;
    static void eq(Object a, Object b, String m) { if (!String.valueOf(a).equals(String.valueOf(b))) { fails++; System.out.println("✗ " + m + ": " + a + " != " + b); } }
    public static void main(String[] a) {
        long M = 60_000L, now = 1_000_000_000_000L, dep = now + 10 * M;
        BusMath.Result r = BusMath.decide(now, dep, 11, 6, Arrays.asList(22 * 60));
        eq(r.kind, BusMath.Kind.OK, "제때"); eq((r.leaveAt - now) / M, 14, "14분 뒤 출발");
        r = BusMath.decide(now, dep, 11, 6, Arrays.asList(15 * 60, 40 * 60));
        eq(r.kind, BusMath.Kind.EARLIER, "일찍"); eq(r.deltaMin, -3, "-3분");
        r = BusMath.decide(now, dep, 11, 6, Arrays.asList(17 * 60, 26 * 60));
        eq((r.busAt - now) / M, 26, "늦은 제때 버스");
        r = BusMath.decide(now, dep, 11, 6, Arrays.asList(35 * 60));
        eq(r.kind, BusMath.Kind.LATE, "늦음"); eq(r.lateMin, 9, "9분 늦음");
        r = BusMath.decide(now, dep, 11, 6, Arrays.asList(3 * 60, 8 * 60));
        eq(r.urgent, true, "긴급"); eq(r.leaveAt, now + M, "1분 뒤");
        eq(BusMath.decide(now, dep, 11, 6, Collections.<Integer>emptyList()).kind, BusMath.Kind.NONE, "없음");
        if (fails > 0) { System.out.println(fails + "개 실패"); System.exit(1); }
        System.out.println("버스 판단 규칙(자바) = 앱과 같음 확인 완료");
    }
}
