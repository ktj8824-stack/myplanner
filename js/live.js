/* =========================================
   MyPlanner — 실시간 교통 재계산
   - 앱을 열면: 출발 4시간 안에 있는 자가용·택시 일정을 티맵 실시간으로 다시 계산
   - 앱이 꺼져 있을 때: 네이티브(Recheck.java)가 기상 20분 전·출발 30분 전에 재계산 → 열면 그 값을 가져옴
   잰 값은 원본 일정의 s.live['YYYY-MM-DD']에 저장되어 그날 회차에만 적용됩니다.
   ========================================= */

const Live = {
  WINDOW_H: 4,          // 출발 몇 시간 전부터 자동 재계산
  STALE_MIN: 15,        // 같은 일정을 다시 재는 최소 간격
  THRESHOLD_MIN: 5,
  checking: false,

  /** 회차 id('원본@날짜' 또는 원본 id)에 실시간 값 기록 */
  record(occId, data) {
    const [baseId, ymd] = String(occId).split('@');
    const b = State.get(baseId);
    if (!b) return null;
    const date = ymd || b.date;
    b.live = b.live || {};
    const prev = b.live[date] || {};
    b.live[date] = { ...prev };
    if (data.travelMin) Object.assign(b.live[date], { travelMin: data.travelMin, checkedAt: data.checkedAt || Date.now(), prevMin: data.prevMin });
    if (data.busLeaveAt) Object.assign(b.live[date], { busLeaveAt: data.busLeaveAt, busAt: data.busAt, busName: data.busName });
    if (data.ride && data.ride.min) b.live[date].ride = { min: data.ride.min, stepIdx: data.ride.stepIdx || 0, checkedAt: data.ride.checkedAt || Date.now() };
    // 지난 기록 정리
    const cut = Recur.shift(U.today(), -2);
    Object.keys(b.live).forEach(d => { if (d < cut) delete b.live[d]; });
    return b;
  },

  /** 네이티브가 백그라운드에서 잰 값 가져오기 */
  async pullNative() {
    const N = Alarm.native();
    if (!N || !N.getLive) return 0;
    try {
      const r = await N.getLive();
      const map = (r && r.live) || {};
      let n = 0;
      Object.entries(map).forEach(([occId, v]) => { if (v && (v.travelMin || v.busLeaveAt) && this.record(occId, v)) n++; });
      if (n) State.save();
      return n;
    } catch (e) { return 0; }
  },

  /** 출발이 가까운 일정을 티맵 실시간으로 다시 계산. 바뀐 내용 목록을 돌려줌 */
  RIDE_WINDOW_MIN: 75,  // 서울 버스 실시간 타는 시간: 출발 75분 전부터 (버스가 도로에 있을 때)
  RIDE_STALE_MIN: 10,

  async autoCheck() {
    if (this.checking) return [];
    this.checking = true;
    const changes = [];
    try {
      const now = Date.now();
      // 서울 버스: 지금 오는 버스가 내릴 곳까지 몇 분 걸리는지
      const rides = State.upcoming(1).filter(({ s, plan }) => {
        if (s.demo || !Planner.rideLeg(s)) return false;
        const dep = plan.departAt.getTime();
        if (dep < now || dep > now + this.RIDE_WINDOW_MIN * 60000) return false;
        const rd = Planner.rideFor(s);
        return !rd || now - rd.checkedAt > this.RIDE_STALE_MIN * 60000;
      });
      for (const { s, plan } of rides) {
        const leg = Planner.rideLeg(s);
        const r = await Routes.busRide(leg.step);
        if (!r) continue;
        const before = plan.departAt;
        this.record(s.occId || s.id, { ride: { min: r.ride, stepIdx: leg.stepIdx, checkedAt: Date.now() } });
        const after = Planner.compute(Recur.resolve(s.occId || s.id)).departAt;
        const delta = Math.round((after - before) / 60000);
        if (Math.abs(delta) >= this.THRESHOLD_MIN) changes.push({ s, delta, after, travelMin: r.ride, bus: true });
      }
      if (rides.length) State.save();
      if (!Routes.can('tmap')) { this.checking = false; return changes; }
      const soon = State.upcoming(1).filter(({ s, plan }) => {
        const leg = Planner.liveLeg(s);
        if (!leg || s.demo) return false;
        const dep = plan.departAt.getTime();
        if (dep < now || dep > now + this.WINDOW_H * 3600000) return false;
        const lv = Planner.liveFor(s);
        return !lv || now - lv.checkedAt > this.STALE_MIN * 60000;
      });
      for (const { s, plan } of soon) {
        const leg = Planner.liveLeg(s);
        const r = await Routes.drive(leg.from, leg.to, leg.mode, null);
        if (!r || r.source !== 'tmap') continue;
        const before = plan.departAt;
        const prev = (Planner.liveFor(s) || {}).travelMin || (s[leg.key] || {}).travelMin || null;
        this.record(s.occId || s.id, { travelMin: r.travelMin, prevMin: prev });
        const after = Planner.compute(Recur.resolve(s.occId || s.id)).departAt;
        const delta = Math.round((after - before) / 60000);
        if (Math.abs(delta) >= this.THRESHOLD_MIN) changes.push({ s, delta, after, travelMin: r.travelMin });
      }
      if (soon.length) State.save();
    } catch (e) { console.warn('실시간 재계산 실패', e); }
    this.checking = false;
    return changes;
  },

  /** 앱 열 때: 백그라운드 값 가져오기 → 자동 재계산 → 알람 다시 맞춤 → 변화 안내 */
  async onOpen() {
    const pulled = await this.pullNative();
    const wxChanged = typeof Weather !== 'undefined' ? await Weather.refresh() : 0;
    const changes = await this.autoCheck();
    await Alarm.rescheduleAll(); // 변화가 없어도 항상: 날짜가 넘어가면 다음 회차를 이어서 넘겨야 함
    if (changes.length) {
      const c = changes[0];
      U.toast(c.bus ? (c.delta < 0 ? `🚌 ${c.s.title}: 버스가 막혀 ${c.travelMin}분 걸려요. ${-c.delta}분 일찍 ${U.hm(c.after)}에 출발하세요`
          : `🚌 ${c.s.title}: 버스가 잘 달려요. ${U.hm(c.after)}에 출발해도 돼요`)
        : c.delta < 0
        ? `🚗 ${c.s.title}: 길이 막혀요. ${-c.delta}분 일찍 ${U.hm(c.after)}에 출발하세요`
        : `🙂 ${c.s.title}: 길이 한산해요. ${U.hm(c.after)}에 출발해도 돼요`);
    }
    if ((pulled || wxChanged || changes.length) && ['home', 'timeline'].includes(App.current)) App.navigate(App.current, App.params);
  },

  /** 타임라인 표시용 문구 */
  rideLabel(s) {
    const rd = Planner.rideFor(s);
    if (!rd) return '';
    const mins = Math.max(0, Math.round((Date.now() - rd.checkedAt) / 60000));
    return `실시간 버스 위치로 계산: 버스 타는 시간 ${rd.min}분 (${mins < 1 ? '방금' : mins + '분 전'} 확인)`;
  },

  label(s) {
    const lv = Planner.liveFor(s);
    if (!lv) return '';
    const mins = Math.max(0, Math.round((Date.now() - lv.checkedAt) / 60000));
    const ago = mins < 1 ? '방금' : mins < 60 ? `${mins}분 전` : `${Math.round(mins / 60)}시간 전`;
    const diff = lv.prevMin ? lv.travelMin - lv.prevMin : 0;
    return `실시간 교통 ${lv.travelMin}분 반영 (${ago} 확인${diff ? `, 평소보다 ${diff > 0 ? '+' : ''}${diff}분` : ''})`;
  }
};
