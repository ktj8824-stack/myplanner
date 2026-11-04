/* =========================================
   MyPlanner — 예시 일정 (둘러보기)
   검색·경로 서버 키가 없어도 앱의 주요 기능을 한눈에 볼 수 있도록
   실제 경로처럼 만든 일정 3개를 넣습니다.
   - demo: true 표시 → 서버로 올리지 않고(동기화 제외), 날씨·실시간 교통도 덮어쓰지 않음
   - 홈 안내 막대나 설정에서 한 번에 지움
   ========================================= */

const Demo = {
  IDS: ['demo-hospital', 'demo-commute', 'demo-busan'],

  has() { return State.schedules.some(s => s.demo); },

  /** 오늘 기준 n일 뒤 'YYYY-MM-DD' */
  day(n) { const d = new Date(); d.setDate(d.getDate() + n); return U.ymd(d); },

  /** from 날짜(포함)부터 첫 평일 */
  nextWeekday(fromN) {
    for (let n = fromN; n < fromN + 7; n++) {
      const d = new Date(); d.setDate(d.getDate() + n);
      if (d.getDay() !== 0 && d.getDay() !== 6 && !Recur.holiday(U.ymd(d))) return n;
    }
    return fromN;
  },

  build() {
    const st = State.settings;
    const home = st.home ? { ...st.home } : { name: '우리집 (마포구 공덕동)', address: '서울 마포구 공덕동', lat: 37.5446, lng: 126.9516 };
    const alarm = { wake: true, preDepart: true, depart: true, nightBefore: true };
    const base = { origin: home, prepMin: 60, bufferMin: 10, alarm, skips: [], overrides: {}, demo: true, updatedAt: Date.now(),
      repeat: { type: 'none', days: [], until: '', skipHolidays: true },
      trip: { accessMode: 'transit', egressMode: 'transit', departTime: '08:00', arriveTime: '10:30', international: false } };
    const now = Date.now();

    // 1) 병원 — 버스·지하철 환승 경로 + 비 예보(여유 추가·우산 안내) + 메모
    const d1 = this.day(1);
    const hospital = {
      ...base, id: this.IDS[0], title: '서울아산병원 정기검진', date: d1, arriveBy: '10:00', mode: 'transit', prepMin: 50,
      dest: { name: '서울아산병원', address: '서울 송파구 올림픽로43길 88', lat: 37.5266, lng: 127.1081 },
      route: { travelMin: 58, source: 'odsay', summary: '환승 1회 · 1,500원', fare: 1500, transfers: 1, steps: [
        { type: 'walk', label: '도보', to: '공덕역', min: 6 },
        { type: 'subway', label: '5호선', from: '공덕', to: '천호', stops: 14, min: 30, way: '마천' },
        { type: 'walk', label: '도보', to: '천호역 정류장', min: 3 },
        { type: 'bus', label: '3216번', from: '천호역', to: '서울아산병원', stops: 6, min: 14 },
        { type: 'walk', label: '도보', to: '서울아산병원 신관', min: 5 }] },
      weather: { [d1]: { kind: 'rain', prob: 70, mm: 2.4, temp: 9, checkedAt: now } },
      memo: '진료카드, 지난번 혈액검사 결과지 챙기기\n신관 2층 내과 접수'
    };

    // 2) 출근 — 평일 반복(공휴일 쉼) + 자가용 실시간 교통(평소보다 막힘) + 건너뛰는 날
    const n2 = this.nextWeekday(1);
    const d2 = this.day(n2);
    const skipDay = this.day(this.nextWeekday(n2 + 3));
    const commute = {
      ...base, id: this.IDS[1], title: '출근 · 강남 사무실', date: d2, arriveBy: '09:00', mode: 'car', prepMin: 45,
      repeat: { type: 'weekdays', days: [], until: '', skipHolidays: true },
      dest: { name: '강남역 2번 출구 (사무실)', address: '서울 강남구 강남대로 396', lat: 37.4979, lng: 127.0276 },
      route: { travelMin: 38, source: 'tmap', summary: '14.2km · 통행료 없음', steps: [
        { type: 'car', label: '자가용', from: '집', to: '강남역', min: 38 }] },
      live: { [d2]: { travelMin: 52, prevMin: 38, checkedAt: now - 4 * 60000 } },
      skips: [skipDay],
      memo: '지하 3층 주차 (월 정기권)'
    };

    // 3) 부산 출장 — KTX 탑승 기준 역산 + 역까지 택시 + 부산역에서 미팅 장소까지
    const d3 = this.day(3);
    const busan = {
      ...base, id: this.IDS[2], title: '부산 출장 · 벡스코 미팅', date: d3, arriveBy: '', mode: 'train', prepMin: 50, bufferMin: 10,
      dest: { name: '벡스코 제1전시장', address: '부산 해운대구 APEC로 55', lat: 35.1690, lng: 129.1360 },
      trip: { accessMode: 'taxi', egressMode: 'transit', number: 'KTX 011', seat: '8호차 12A', from: '서울', to: '부산',
        departStation: { name: '서울역', address: '서울 용산구 한강대로 405', lat: 37.5547, lng: 126.9707 },
        arriveStation: { name: '부산역', address: '부산 동구 중앙대로 206', lat: 35.1151, lng: 129.0422 },
        departTime: '08:00', arriveTime: '10:41', international: false },
      accessRoute: { travelMin: 17, source: 'tmap', summary: '4.1km', steps: [
        { type: 'taxi', label: '택시', from: '집', to: '서울역 서부 택시 승강장', min: 17 }] },
      egressRoute: { travelMin: 46, source: 'odsay', summary: '환승 0회', steps: [
        { type: 'walk', label: '도보', to: '부산역 지하철', min: 4 },
        { type: 'subway', label: '부산 1·2호선', from: '부산역', to: '센텀시티', stops: 19, min: 36 },
        { type: 'walk', label: '도보', to: '벡스코 제1전시장', min: 6 }] },
      memo: '승차권은 코레일톡 앱에 있음 · 명함, 노트북 충전기'
    };
    return [hospital, commute, busan];
  },

  async add() {
    this.build().forEach(s => State.putRaw(s));
    State.save();
    try { await Alarm.rescheduleAll(); } catch (e) {}
    U.toast('예시 일정 3개를 넣었어요. 눌러서 둘러보세요');
    App.navigate('home');
  },

  async remove() {
    State.schedules = State.schedules.filter(s => !s.demo);
    State.save();
    try { await Alarm.rescheduleAll(); } catch (e) {}
    U.toast('예시 일정을 지웠어요');
    App.navigate(App.current === 'settings' ? 'settings' : 'home');
  },

  /** 홈 맨 위 안내 막대 */
  bar() {
    if (!this.has()) return '';
    return `<div class="demo-bar"><span>✨ 예시 일정으로 둘러보는 중이에요</span><button onclick="Demo.remove()">지우기</button></div>`;
  }
};
