/* =========================================
   MyPlanner — 공통 도구(U) · 저장소(State)
   ========================================= */

const U = {
  pad: n => String(n).padStart(2, '0'),
  hm(d) { return d ? `${U.pad(d.getHours())}:${U.pad(d.getMinutes())}` : ''; },
  ymd(d) { return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`; },
  today() { return U.ymd(new Date()); },
  DOW: ['일', '월', '화', '수', '목', '금', '토'],
  dateLabel(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const diff = Math.round((dt - new Date(new Date().toDateString())) / 86400000);
    const rel = { 0: '오늘', 1: '내일', 2: '모레', [-1]: '어제' }[diff];
    return `${m}월 ${d}일 (${U.DOW[dt.getDay()]})` + (rel ? ` · ${rel}` : '');
  },
  /** 기상 시각 같은 '전날' 표시용: 일정 날짜와 다르면 앞에 '전날' */
  hmRel(d, ymd) {
    const day = ymd ? Planner.at(ymd, '12:00').toDateString() : null;
    return (day && d.toDateString() !== day ? '전날 ' : '') + U.hm(d);
  },
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); },
  toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(U._t);
    U._t = setTimeout(() => el.classList.remove('show'), 2600);
  },
  durLabel(min) {
    min = Math.round(min);
    if (min < 60) return `${min}분`;
    return `${Math.floor(min / 60)}시간` + (min % 60 ? ` ${min % 60}분` : '');
  }
};

const State = {
  schedules: [],
  settings: {
    name: '',
    home: null,            // { name, address, lat, lng }
    defaultMode: 'transit',
    prepMin: 60,
    bufferMin: 10,
    alarm: { wake: true, preDepart: true, depart: true, nightBefore: true }
  },

  load() {
    try { this.schedules = JSON.parse(localStorage.getItem('mp_schedules') || '[]'); } catch (e) { this.schedules = []; }
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('mp_settings') || '{}')); } catch (e) {}
  },
  save() {
    try {
      localStorage.setItem('mp_schedules', JSON.stringify(this.schedules));
      localStorage.setItem('mp_settings', JSON.stringify(this.settings));
    } catch (e) { U.toast('저장 공간이 부족해요.'); }
  },
  get(id) { return this.schedules.find(s => s.id === id); },
  /** 사용자가 바꾼 일정 저장 → 로그인 상태면 서버에도 올림 (공유받은 일정은 내 폰에만) */
  upsert(s) {
    if (!s._shared) s.updatedAt = Date.now();
    this.putRaw(s);
    this.save();
    if (!s._shared && typeof Cloud !== 'undefined') Cloud.markDirty(s.id);
  },
  /** 서버에서 받은 일정 넣기 (다시 올리지 않음) */
  putRaw(s) {
    const i = this.schedules.findIndex(x => x.id === s.id);
    if (i >= 0) this.schedules[i] = s; else this.schedules.push(s);
    this.schedules.sort((a, b) => (a.date + (a.arriveBy || a.trip?.departTime || '')).localeCompare(b.date + (b.arriveBy || b.trip?.departTime || '')));
  },
  remove(id) {
    const s = this.get(id);
    this.schedules = this.schedules.filter(x => x.id !== id);
    this.save();
    if (s && !s._shared && typeof Cloud !== 'undefined') Cloud.markDirty(id);
  },
  /** 그 날짜의 일정 (반복 일정은 그날 회차로 펼침) */
  byDate(ymd) {
    return Recur.between(this.schedules, ymd, ymd)
      .sort((a, b) => Planner.compute(a).wakeAt - Planner.compute(b).wakeAt);
  },
  /** 앞으로 days일 동안의 일정 회차 + 계산 결과 (지난 일정 제외) */
  upcoming(days = 14) {
    const now = Date.now();
    const from = U.ymd(new Date(now - 86400000));
    const to = Recur.shift(U.today(), days);
    return Recur.between(this.schedules, from, to)
      .map(s => ({ s, plan: Planner.compute(s) }))
      .filter(x => x.plan.arriveAt.getTime() > now - 30 * 60000)
      .sort((a, b) => a.plan.wakeAt - b.plan.wakeAt);
  },
  /** 반복 일정 중 '단발 일정이 아닌' 원본 목록 */
  repeating() { return this.schedules.filter(s => Recur.isRepeating(s) && !s._shared); }
};
