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
  upsert(s) {
    const i = this.schedules.findIndex(x => x.id === s.id);
    if (i >= 0) this.schedules[i] = s; else this.schedules.push(s);
    this.schedules.sort((a, b) => (a.date + (a.arriveBy || a.trip?.departTime || '')).localeCompare(b.date + (b.arriveBy || b.trip?.departTime || '')));
    this.save();
  },
  remove(id) { this.schedules = this.schedules.filter(s => s.id !== id); this.save(); },
  byDate(ymd) { return this.schedules.filter(s => s.date === ymd); },
  upcoming() {
    const now = Date.now();
    return this.schedules
      .map(s => ({ s, plan: Planner.compute(s) }))
      .filter(x => x.plan.arriveAt.getTime() > now - 30 * 60000)
      .sort((a, b) => a.plan.wakeAt - b.plan.wakeAt);
  }
};
