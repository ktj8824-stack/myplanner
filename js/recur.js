/* =========================================
   MyPlanner — 반복 일정
   s.repeat = { type: 'none'|'daily'|'weekdays'|'weekly', days: [0-6], until: 'YYYY-MM-DD'|'', skipHolidays: bool }
   s.skips = ['YYYY-MM-DD', ...]             // 이 날만 건너뛰기
   s.overrides = { 'YYYY-MM-DD': { arriveBy, prepMin, bufferMin } }  // 이 날만 시간 바꾸기
   반복 일정은 날짜별 '회차(occurrence)'로 펼쳐서 계산·알람에 씁니다.
   ========================================= */

const Recur = {
  // 대한민국 공휴일 (대체공휴일·선거일 포함) — 매년 1월에 다음 해를 추가하세요.
  HOLIDAYS: {
    '2026-01-01': '신정', '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
    '2026-03-01': '삼일절', '2026-03-02': '대체공휴일', '2026-05-01': '노동절', '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-06-03': '지방선거', '2026-06-06': '현충일',
    '2026-07-17': '제헌절', '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
    '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
    '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '크리스마스',
    '2027-01-01': '신정', '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '대체공휴일',
    '2027-03-01': '삼일절', '2027-05-01': '노동절', '2027-05-03': '대체공휴일', '2027-05-05': '어린이날',
    '2027-05-13': '부처님오신날', '2027-06-06': '현충일', '2027-07-17': '제헌절', '2027-07-19': '대체공휴일',
    '2027-08-15': '광복절', '2027-08-16': '대체공휴일', '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
    '2027-10-03': '개천절', '2027-10-04': '대체공휴일', '2027-10-09': '한글날', '2027-10-11': '대체공휴일',
    '2027-12-25': '크리스마스', '2027-12-27': '대체공휴일'
  },

  TYPES: {
    none: '반복 안 함',
    daily: '매일',
    weekdays: '평일 (월~금)',
    weekly: '요일 선택'
  },

  isRepeating(s) { return !!(s && s.repeat && s.repeat.type && s.repeat.type !== 'none'); },

  holiday(ymd) { return this.HOLIDAYS[ymd] || null; },

  label(s) {
    if (!this.isRepeating(s)) return '';
    const r = s.repeat;
    let t = r.type === 'weekly'
      ? '매주 ' + (r.days || []).slice().sort().map(d => U.DOW[d]).join('·')
      : this.TYPES[r.type];
    if (r.skipHolidays) t += ' · 공휴일 제외';
    return t;
  },

  /** 해당 날짜에 반복 규칙상 일정이 있는지 (건너뛴 날 포함 여부는 includeSkipped) */
  occursOn(s, ymd, includeSkipped = false) {
    if (!this.isRepeating(s)) return s.date === ymd;
    if (ymd < s.date) return false;
    const r = s.repeat;
    if (r.until && ymd > r.until) return false;
    if (!includeSkipped && (s.skips || []).includes(ymd)) return false;
    const dow = Planner.at(ymd, '12:00').getDay();
    if (r.type === 'weekdays' && (dow === 0 || dow === 6)) return false;
    if (r.type === 'weekly' && !(r.days || []).includes(dow)) return false;
    if (r.skipHolidays && this.holiday(ymd)) return false;
    return true;
  },

  /** 회차 하나: 원본 + 날짜 + 그날만의 변경 */
  instance(s, ymd) {
    if (!this.isRepeating(s)) return s;
    const ov = (s.overrides || {})[ymd] || {};
    return { ...s, ...ov, date: ymd, baseId: s.id, occId: s.id + '@' + ymd, isOccurrence: true, hasOverride: !!(s.overrides && s.overrides[ymd]) };
  },

  /** from~to(포함) 사이의 모든 일정 회차 */
  between(schedules, fromYmd, toYmd) {
    const out = [];
    schedules.forEach(s => {
      if (!this.isRepeating(s)) {
        if (s.date >= fromYmd && s.date <= toYmd) out.push(s);
        return;
      }
      let d = Planner.at(fromYmd < s.date ? s.date : fromYmd, '12:00');
      const end = Planner.at(toYmd, '12:00');
      while (d <= end) {
        const ymd = U.ymd(d);
        if (this.occursOn(s, ymd)) out.push(this.instance(s, ymd));
        d.setDate(d.getDate() + 1);
      }
    });
    return out;
  },

  /** 날짜를 더한 YMD */
  shift(ymd, days) { const d = Planner.at(ymd, '12:00'); d.setDate(d.getDate() + days); return U.ymd(d); },

  /** 회차 id('원본id@날짜') 또는 일반 id → 회차 객체 */
  resolve(id) {
    if (!id) return null;
    const [baseId, ymd] = String(id).split('@');
    const s = State.get(baseId);
    if (!s) return null;
    if (ymd && this.isRepeating(s)) return this.instance(s, ymd);
    return s;
  }
};

if (typeof module !== 'undefined') module.exports = Recur;
