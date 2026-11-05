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
  /** fetch + 시간 제한 (네트워크가 멈춰도 화면이 계속 기다리지 않게). 시간이 지나면 예외 */
  fetchT(url, opts = {}, ms = 12000) {
    if (typeof AbortController === 'undefined') return fetch(url, opts);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(t));
  },
  /**
   * 밖에서 들어온 일정(공유 링크·가족 공유·서버)을 안전한 모양으로 정리.
   * 날짜·시각 형식, 숫자, id 글자, 길이를 맞추고 모르는 값은 버림. 날짜가 없으면 null.
   */
  cleanSchedule(o, { keepId = true } = {}) {
    if (!o || typeof o !== 'object') return null;
    const str = (v, n) => (typeof v === 'string' || typeof v === 'number') ? String(v).slice(0, n) : '';
    const num = (v, lo, hi, d) => { const x = Number(v); return isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
    const YMD = /^\d{4}-\d{2}-\d{2}$/, HM = /^\d{2}:\d{2}$/;
    const ymd = v => (typeof v === 'string' && YMD.test(v) ? v : '');
    const hm = v => (typeof v === 'string' && HM.test(v) && +v.slice(0, 2) < 24 && +v.slice(3) < 60 ? v : '');
    const modes = typeof Planner !== 'undefined' ? Planner.MODES : { transit: 1, car: 1, taxi: 1, walk: 1, train: 1, flight: 1 };
    const mode = (v, d) => (typeof v === 'string' && modes[v] ? v : d);
    const word = v => str(v, 20).replace(/[^a-z_]/gi, '');
    const place = p => {
      if (!p || typeof p !== 'object') return null;
      const lat = Number(p.lat), lng = Number(p.lng);
      return { name: str(p.name, 80) || '장소', address: str(p.address, 160), lat: isFinite(lat) ? lat : null, lng: isFinite(lng) ? lng : null };
    };
    const step = st => (st && typeof st === 'object' ? {
      type: word(st.type) || 'walk', label: str(st.label, 80), from: str(st.from, 80), to: str(st.to, 80),
      min: num(st.min, 0, 1440, 0), ...(st.stops != null ? { stops: num(st.stops, 0, 200, 0) } : {}), ...(st.way ? { way: str(st.way, 40) } : {}),
      ...(st.stationId != null ? { stationId: str(st.stationId, 20).replace(/[^0-9]/g, '') } : {}),
      ...(Array.isArray(st.routeIds) ? { routeIds: st.routeIds.slice(0, 10).map(x => str(x, 20).replace(/[^0-9]/g, '')) } : {}),
      ...(Array.isArray(st.routeNos) ? { routeNos: st.routeNos.slice(0, 10).map(x => str(x, 20)) } : {}),
      ...(st.fromArs != null ? { fromArs: str(st.fromArs, 12).replace(/[^0-9-]/g, '') } : {}), ...(st.toArs != null ? { toArs: str(st.toArs, 12).replace(/[^0-9-]/g, '') } : {}),
      ...(st.busLocalBlID != null ? { busLocalBlID: str(st.busLocalBlID, 12).replace(/[^0-9]/g, '') } : {}), ...(st.cityCode != null ? { cityCode: str(st.cityCode, 8).replace(/[^0-9]/g, '') } : {})
    } : null);
    const route = r => (r && typeof r === 'object' ? {
      travelMin: num(r.travelMin, 0, 1440, 0), source: word(r.source) || 'estimate', summary: str(r.summary, 100),
      steps: Array.isArray(r.steps) ? r.steps.slice(0, 30).map(step).filter(Boolean) : [],
      ...(r.arsChecked ? { arsChecked: true } : {}),
      ...(r.fare != null ? { fare: num(r.fare, 0, 1e6, 0) } : {}), ...(r.transfers != null ? { transfers: num(r.transfers, 0, 20, 0) } : {})
    } : null);
    const date = ymd(o.date);
    if (!date) return null;
    const t = o.trip && typeof o.trip === 'object' ? o.trip : {};
    const r = o.repeat && typeof o.repeat === 'object' ? o.repeat : {};
    const id = str(o.id, 120);
    const out = {
      ...(keepId && /^[\w\-:@.]{1,120}$/.test(id) ? { id } : {}),
      title: str(o.title, 80) || '일정', date, arriveBy: hm(o.arriveBy), mode: mode(o.mode, 'transit'),
      prepMin: num(o.prepMin, 0, 300, 60), bufferMin: num(o.bufferMin, 0, 120, 10),
      origin: place(o.origin), dest: place(o.dest), route: route(o.route), accessRoute: route(o.accessRoute), egressRoute: route(o.egressRoute),
      trip: { accessMode: mode(t.accessMode, 'transit'), egressMode: mode(t.egressMode, 'transit'), departTime: hm(t.departTime), arriveTime: hm(t.arriveTime),
        number: str(t.number, 30), seat: str(t.seat, 30), from: str(t.from, 30), to: str(t.to, 30), international: !!t.international,
        departStation: place(t.departStation), arriveStation: place(t.arriveStation), ...(t.marginMin != null ? { marginMin: num(t.marginMin, 0, 300, 15) } : {}) },
      memo: str(o.memo, 1000),
      repeat: { type: ['none', 'daily', 'weekdays', 'weekly'].includes(r.type) ? r.type : 'none',
        days: Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter(d => d >= 0 && d <= 6))] : [], until: ymd(r.until), skipHolidays: r.skipHolidays !== false },
      skips: Array.isArray(o.skips) ? o.skips.map(ymd).filter(Boolean).slice(0, 400) : [],
      overrides: {}
    };
    if (o.overrides && typeof o.overrides === 'object') Object.keys(o.overrides).slice(0, 400).forEach(k => {
      const v = o.overrides[k];
      if (!ymd(k) || !v || typeof v !== 'object') return;
      const ov = {};
      if (v.arriveBy != null) ov.arriveBy = hm(v.arriveBy);
      if (v.endBy != null) ov.endBy = hm(v.endBy);
      if (v.prepMin != null) ov.prepMin = num(v.prepMin, 0, 300, 60);
      if (v.bufferMin != null) ov.bufferMin = num(v.bufferMin, 0, 120, 10);
      if (v.alarmOff != null) ov.alarmOff = !!v.alarmOff;
      if (v.trip && typeof v.trip === 'object') ov.trip = { ...out.trip, departTime: hm(v.trip.departTime) || out.trip.departTime };
      if (v.origin) ov.origin = place(v.origin);
      if (v.route) ov.route = route(v.route);
      if (v.chained) ov.chained = { from: str(v.chained.from, 120) };
      out.overrides[k] = ov;
    });
    if (hm(o.endBy)) out.endBy = hm(o.endBy);
    if (o.alarm && typeof o.alarm === 'object') { out.alarm = {}; ['wake', 'preDepart', 'depart', 'nightBefore', 'goHome'].forEach(k => { if (k in o.alarm) out.alarm[k] = !!o.alarm[k]; }); }
    if (o.alarmOff != null) out.alarmOff = !!o.alarmOff;
    if (o.chained && typeof o.chained === 'object') out.chained = { from: str(o.chained.from, 120) };
    if (o.goHome && typeof o.goHome === 'object') out.goHome = { on: !!o.goHome.on, mode: mode(o.goHome.mode, 'transit'), lastTime: hm(o.goHome.lastTime), route: route(o.goHome.route), to: place(o.goHome.to) };
    if (o.pack && typeof o.pack === 'object') out.pack = { add: (o.pack.add || []).slice(0, 50).map(x => str(x, 30)).filter(Boolean), removed: (o.pack.removed || []).slice(0, 50).map(x => str(x, 30)).filter(Boolean) };
    if (o.packDone && typeof o.packDone === 'object') { out.packDone = {}; Object.keys(o.packDone).slice(0, 30).forEach(k => { if (ymd(k) && Array.isArray(o.packDone[k])) out.packDone[k] = o.packDone[k].slice(0, 50).map(x => str(x, 30)); }); }
    const ua = Number(o.updatedAt); if (isFinite(ua) && ua > 0) out.updatedAt = ua;
    return out;
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
  /** 입체 아이콘 (img/icons) — 같은 뜻이면 앱 어디서나 같은 그림 */
  icon(name, cls = '') { return `<img class="emo ${cls}" src="img/icons/${name}.png" alt="">`; },
  MODE_ICON: { transit: 'bus', bus: 'bus', subway: 'subway', car: 'car', taxi: 'taxi', walk: 'walk', train: 'train', flight: 'plane' },
  modeIcon(mode, cls = '') { return U.icon(U.MODE_ICON[mode] || 'bus', cls); },
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
    if (!s._shared) { const prev = this.get(s.id); s.updatedAt = Math.max(Date.now(), ((prev && prev.updatedAt) || 0) + 1); } // 같은 순간 두 번 고쳐도 순서가 구분되게
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
