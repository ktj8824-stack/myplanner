/* =========================================
   MyPlanner — 기상·출발 알람
   - 기상·출발 알람: 네이티브 MyAlarm 플러그인 → 잠금화면 위 전체 화면 알람 (알람시계 방식)
     (플러그인이 없으면 로컬 알림으로 대체)
   - 전날 밤 안내·출발 10분 전: Capacitor 로컬 알림
   - 웹: 앱이 열려 있는 동안 브라우저 알림 + 화면 알람
   ========================================= */

const Alarm = {
  CHANNEL: 'mp_alarm',
  HORIZON_DAYS: 14,     // 웹·로컬 알림: 앞으로 며칠치 예약
  NATIVE_DAYS: 45,      // 앱(네이티브): 45일치 계획을 넘기면 폰이 매일 3일치씩 알아서 보충
  RECHECK_BEFORE_WAKE: 20,   // 기상 20분 전 실시간 재계산
  RECHECK_BEFORE_DEPART: 30, // 출발 30분 전 실시간 재계산
  BUS_CHECK_BEFORE: 15,      // 출발 15분 전 버스 실시간 도착 확인
  webTimers: [],

  isNative() { const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); },
  isIOS() { const C = window.Capacitor; return !!(C && C.getPlatform && C.getPlatform() === 'ios'); },
  IOS_MAX: 60,          // 아이폰은 앱당 예약 알림 64개까지 → 가까운 것부터 60개
  IOS_REPEAT: [1, 2],   // 아이폰: 알람(기상·출발)은 1분·2분 뒤에 한 번씩 더 울려 깨움 (전체 화면 알람이 없어서)
  ln() { return this.isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications; },
  native() { return this.isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.MyAlarm; },

  async init() {
    const LN = this.ln();
    if (LN) {
      try {
        await LN.createChannel({ id: this.CHANNEL, name: '일정 알림', description: '전날 안내·출발 전 알림',
          importance: 4, visibility: 1, vibration: true });
        LN.addListener('localNotificationActionPerformed', ev => {
          const n = ev && ev.notification, x = (n && n.extra) || {};
          // 기상 알람을 울린 지 얼마 안 돼서 눌렀으면 기상 화면을 보여 줌 (소리는 다시 내지 않음)
          if (x.kind === 'wake' && x.at && Date.now() - x.at < 20 * 60000) return this.showRinging(n.title, n.body, x.scheduleId, 'wake', true);
          if (x.kind === 'depart' && x.at && Date.now() - x.at < 30 * 60000) this.habitMark(x.scheduleId, 'go');
          this.openSchedule(x.scheduleId);
        });
        LN.addListener('localNotificationReceived', n => {
          if (n && n.extra && n.extra.alarm) this.showRinging(n.title, n.body, n.extra.scheduleId, n.extra.kind);
        });
      } catch (e) { console.warn('알림 채널 생성 실패', e); }
    }
    // 앱을 열 때마다: 백그라운드 실시간 값 가져오기 → 출발 임박 일정 재계산 → 알람 다시 맞춤
    await Live.onOpen();
    this.consumeOpen();
    // 어림값으로 저장된 경로가 있으면 실제 경로로 (기다리지 않음)
    setTimeout(() => Routes.healEstimates().then(ch => { if (ch && App.current === 'home') Home.render(); }).catch(() => {}), 3000);
    // 앱이 켜져 있는 중에 문자 앱에서 공유로 들어온 경우
    const N0 = this.native();
    if (N0 && N0.addListener) { try { N0.addListener('shared', () => this.consumeOpen()); } catch (e) {} }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      Live.onOpen();
      this.consumeOpen();
    });
  },

  openSchedule(id) {
    if (id && Recur.resolve(id)) App.navigate('timeline', { id });
  },

  async consumeOpen() {
    const N = this.native();
    if (!N) return;
    try {
      const r = await N.consumeOpen();
      if (r && r.sharedText) App.navigate('register', { paste: true, text: r.sharedText });
      else if (r && r.scheduleId) this.openSchedule(r.scheduleId);
    } catch (e) {}
  },

  /* ---------- 권한 ---------- */
  async requestPermission() {
    const LN = this.ln();
    if (LN) {
      const p = await LN.requestPermissions();
      return p.display === 'granted';
    }
    if ('Notification' in window) return (await Notification.requestPermission()) === 'granted';
    return false;
  },

  async permissionState() {
    const LN = this.ln();
    if (LN) { try { return (await LN.checkPermissions()).display; } catch (e) { return 'prompt'; } }
    return ('Notification' in window) ? Notification.permission : 'unsupported';
  },

  /** 전체 화면 알람이 제대로 울리려면 필요한 권한들 { exact, fullScreen, notifications, battery } */
  async nativeStatus() {
    const N = this.native();
    if (!N) return null;
    try { return await N.status(); } catch (e) { return null; }
  },
  /** 실제 전체 화면 알람을 sec초 뒤에 울려 봄 (앱에서만) */
  async testNative(sec = 60) {
    const N = this.native();
    if (N && N.testAlarm) { try { await N.testAlarm({ seconds: sec }); return true; } catch (e) { return false; } }
    // 아이폰 앱: 폰 알림으로 sec초 뒤 알람 소리 한 번 (앱을 닫거나 화면을 꺼도 울림)
    const LN = this.ln();
    if (!LN) return false;
    try {
      const at = new Date(Date.now() + sec * 1000);
      await LN.schedule({ notifications: [{ id: this.numId('test-alarm'), title: '⏰ 알람 시험', body: '이 소리가 들리면 준비 완료예요.', schedule: { at, allowWhileIdle: true },
        channelId: this.CHANNEL, ...(this.isIOS() ? { sound: 'mp_alarm.caf' } : {}), extra: { alarm: true, keep: true, at: at.getTime() } }] });
      return true;
    } catch (e) { return false; }
  },
  /** 점검 결과 → 문제 목록 (화면과 무관, test/alarmcheck.test.js) */
  problems(perm, ns) {
    const out = [];
    if (perm !== 'granted' && perm !== 'unsupported') out.push('notifications');
    if (!ns) return out;
    if (ns.alarmChannel === false) out.push('alarmChannel');
    if (!ns.exact) out.push('exact');
    if (!ns.fullScreen) out.push('fullscreen');
    if (ns.battery === false) out.push('battery');
    if (ns.alarmVolume === 0) out.push('volume');
    return out;
  },
  /** 홈 경고로 띄울 만큼 중요한 문제 (배터리·소리 크기는 설정 화면에서만 안내) */
  CRITICAL: ['notifications', 'alarmChannel', 'exact', 'fullscreen'],

  async openSettings(which) {
    const N = this.native();
    if (N) { try { await N.openSettings({ which }); } catch (e) { U.toast('설정을 열 수 없어요.'); } }
  },

  /* ---------- 예약 ---------- */
  /** 앞으로 HORIZON_DAYS일 안의 모든 일정 회차 알람 */
  collect(days = this.HORIZON_DAYS) {
    const now = Date.now();
    const limit = now + days * 86400000;
    const list = [];
    const from = Recur.shift(U.today(), -1);
    const to = Recur.shift(U.today(), days + 1);
    Recur.between(State.schedules, from, to).forEach(s => {
      if (s.alarmOff) return;
      try {
        const plan = Planner.compute(s);
        Planner.alarms(s, plan).forEach(a => { if (a.at.getTime() < limit) list.push({ ...a, s, plan, sid: s.occId || s.id }); });
      } catch (e) { console.warn('알람 계산 실패', s, e); }
    });
    return list.sort((a, b) => a.at - b.at);
  },

  numId(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 2000000000;
  },

  /** 실시간 재계산 시점 (자가용·택시 일정만): 기상 20분 전, 출발 30분 전 */
  rechecks(list) {
    const now = Date.now();
    const out = [];
    const seen = new Set();
    list.forEach(a => {
      if (seen.has(a.sid) || a.s.alarmOff) return;
      seen.add(a.sid);
      // 버스: 출발 15분 전에 첫 정류장 실시간 도착 확인 (서버 함수가 있을 때만)
      const bl = typeof Bus !== 'undefined' ? Bus.leg(a.s) : null;
      if (bl && Routes.proxy()) {
        const at = a.plan.departAt.getTime() - this.BUS_CHECK_BEFORE * 60000;
        if (at > now) out.push({
          id: this.numId(a.sid + 'bus'), at, type: 'bus', occId: a.sid, title: a.s.title,
          stationId: String(bl.step.stationId), routeIds: (bl.step.routeIds || []).join(','), routeNos: (bl.step.routeNos || []).join(','), busName: Bus.busName(bl.step),
          walkMin: bl.walkMin, preStopMin: bl.preStopMin, plannedDepart: a.plan.departAt.getTime(),
          preId: this.numId(a.sid + 'pre'), departId: this.numId(a.sid + 'depart')
        });
      }
      // 자가용·택시는 티맵 실시간, 서울 버스는 실시간 버스 위치로 '타는 시간'
      const ride = Routes.proxy() ? Planner.rideSpec(a.s, a.plan) : null;
      const spec = Planner.recheckSpec(a.s, a.plan) || ride;
      if (!spec) return;
      let times = [spec.wakeMs - this.RECHECK_BEFORE_WAKE * 60000, spec.plannedDepartMs - this.RECHECK_BEFORE_DEPART * 60000];
      if (spec.type === 'ride') times = [spec.wakeMs - this.RECHECK_BEFORE_WAKE * 60000, spec.plannedDepartMs - 45 * 60000, spec.plannedDepartMs - 20 * 60000];
      times = times.sort((x, y) => x - y).filter((t, i, arr) => i === 0 || t - arr[i - 1] >= 10 * 60000); // 너무 가까운 시점은 한 번만
      times.forEach((at, i) => {
        if (at <= now) return;
        const o = {
          id: this.numId(a.sid + 'chk' + i), at, occId: a.sid, title: a.s.title,
          anchor: spec.anchorMs, fixedMin: spec.fixedMin, travelMin: spec.travelMin,
          plannedDepart: spec.plannedDepartMs, wake: spec.wakeMs,
          wakeId: this.numId(a.sid + 'wake'), preId: this.numId(a.sid + 'pre'), departId: this.numId(a.sid + 'depart')
        };
        if (spec.type === 'ride') Object.assign(o, { type: 'ride', busID: spec.busID, busLocalBlID: spec.busLocalBlID, fromArs: spec.fromArs, toArs: spec.toArs, stepIdx: Planner.rideLeg(a.s).stepIdx });
        else Object.assign(o, { sx: spec.from.lng, sy: spec.from.lat, ex: spec.to.lng, ey: spec.to.lat });
        out.push(o);
      });
    });
    return out;
  },

  /** 홈 화면 위젯에 보여 줄 다음 일정 5개 */
  widgetItems() {
    return State.upcoming(this.NATIVE_DAYS).slice(0, 5).map(({ s, plan }) => {
      const isTrip = Planner.isTrip(s.mode), m = Planner.MODES[s.mode], sid = s.occId || s.id;
      const end = isTrip ? Planner.at(s.date, s.trip.departTime) : plan.arriveAt;
      const note = plan.weather ? `${plan.weather.icon} ${plan.weather.label} · ${plan.weather.tip}`
        : plan.live ? `📡 실시간 교통 ${plan.live.travelMin}분 반영` : (s.dest ? `📍 ${s.dest.name}` : '');
      return { occId: sid, title: s.title, wakeMs: plan.wakeAt.getTime(), departMs: plan.departAt.getTime(),
        endMs: end.getTime(), endLabel: isTrip ? '탑승' : '도착', modeEmoji: m.emoji, modeLabel: m.label, note,
        wakeId: this.numId(sid + 'wake'), departId: this.numId(sid + 'depart') };
    });
  },

  async rescheduleAll() {
    const N = this.native();
    if (N && N.setPlan) {
      // 앱: 45일치 계획을 통째로 넘김 → 폰이 3일치씩 예약하고 매일 새벽 보충, 기상 전 실시간 재계산
      const list = this.collect(this.NATIVE_DAYS);
      try {
        await N.setPlan({
          alarms: list.map(a => ({ id: this.numId(a.sid + a.key), at: a.at.getTime(), title: a.title, body: a.body,
            scheduleId: a.sid, kind: a.alarm ? 'full' : 'note' })),
          rechecks: this.rechecks(list),
          widget: this.widgetItems(),
          // 폰이 백그라운드에서 티맵을 부를 방법: 서버 함수(권장) 또는 키
          tmapKey: Routes.proxy() ? '' : Routes.key('TMAP_APP_KEY'),
          proxyUrl: Routes.proxy() ? Routes.proxy().url : '',
          proxyKey: Routes.proxy() ? Routes.proxy().anon : ''
        });
        await this.clearLocal(); // 예전 버전이 로컬 알림으로 예약한 것 정리
        return list.filter(a => a.at.getTime() < Date.now() + this.HORIZON_DAYS * 86400000);
      } catch (e) { console.warn('네이티브 계획 전달 실패 → 로컬 알림으로 대체', e); }
    }
    const list = this.collect();
    const LN = this.ln();
    if (LN) {
      try {
        await this.clearLocal();
        if (list.length) {
          let notes = list.map(a => ({
            id: this.numId(a.sid + a.key), title: a.title, body: a.body, largeBody: a.body,
            schedule: { at: a.at, allowWhileIdle: true }, channelId: this.CHANNEL,
            extra: { scheduleId: a.sid, alarm: !!a.alarm, kind: a.key, at: a.at.getTime() }
          }));
          if (this.isIOS()) {
            notes.forEach(n => { if (n.extra.alarm) n.sound = 'mp_alarm.caf'; }); // 30초 알람 음악 (AppDelegate가 Library/Sounds로 복사)
            // 기상·출발은 1·2분 뒤 다시 울림, 시간 순으로 가까운 60개만 (넘치면 아이폰이 조용히 버림)
            const more = [];
            list.forEach(a => { if (a.alarm) this.IOS_REPEAT.forEach(m => more.push({
              id: this.numId(a.sid + a.key + 'r' + m), title: a.title, body: `${m}분 지났어요. ${a.body}`,
              schedule: { at: new Date(a.at.getTime() + m * 60000) }, sound: 'mp_alarm.caf', extra: { scheduleId: a.sid, alarm: true, kind: a.key, at: a.at.getTime() + m * 60000 } })); });
            // 64개 한도 안에서 기상·출발 알람을 더 많은 날짜만큼 넣으려고, 안내 알림(전날 밤·10분 전 등)은 3일 안의 것만
            const soon = Date.now() + 3 * 86400000;
            notes = notes.concat(more).filter(n => n.extra.alarm || n.schedule.at.getTime() < soon)
              .sort((x, y) => x.schedule.at - y.schedule.at);
            // 넘치면 마지막 자리에 '여기까지 예약돼 있어요' 안내 1개 (앱을 오래 안 열어 알람이 조용히 끊기지 않게)
            if (notes.length > this.IOS_MAX) {
              notes = notes.slice(0, this.IOS_MAX - 1);
              const last = notes[notes.length - 1].schedule.at, d = new Date(last);
              notes.push({ id: this.numId('mp-end-notice'), title: '마이플래너 알람 안내',
                body: `알람이 ${d.getMonth() + 1}월 ${d.getDate()}일까지 예약돼 있어요. 앱을 한 번 열어 주시면 다음 알람을 이어서 예약해요.`,
                schedule: { at: new Date(last.getTime() + 60000) }, extra: { kind: 'end-notice' } });
            }
          }
          await LN.schedule({ notifications: notes });
        }
      } catch (e) { console.warn('알림 예약 실패', e); }
      return list;
    }
    // 웹: 열려 있는 동안만 동작
    this.webTimers.forEach(clearTimeout);
    this.webTimers = [];
    list.forEach(a => {
      const delay = a.at.getTime() - Date.now();
      if (delay > 0 && delay < 2147483000) {
        this.webTimers.push(setTimeout(() => {
          try { if ('Notification' in window && Notification.permission === 'granted') new Notification(a.title, { body: a.body, icon: 'icon-192.png' }); } catch (e) {}
          if (a.alarm) this.showRinging(a.title, a.body, a.sid, a.key);
          else U.toast(a.title);
        }, delay));
      }
    });
    return list;
  },

  async clearLocal() {
    const LN = this.ln();
    if (!LN) return;
    try {
      const pending = await LN.getPending();
      // '5분 뒤 다시'·'1분 뒤 알람 시험'은 앱을 껐다 켜도 남김 (extra.keep, 아직 안 울린 것만)
      const keep = this._snooze && this._snooze.at > Date.now() ? this._snooze.id : null;
      const kept = n => n.id === keep || (n.extra && n.extra.keep && (!n.extra.at || n.extra.at > Date.now()));
      const ids = pending.notifications.filter(n => !kept(n)).map(n => ({ id: n.id }));
      if (ids.length) await LN.cancel({ notifications: ids });
    } catch (e) {}
  },

  /* ---------- 화면 알람 (웹 / 앱이 열려 있을 때 대체용) ---------- */
  SNOOZE_MAX: 3,   // 기상 알람 '5분 뒤 다시'는 3번까지

  /** 같은 기상 알람에서 '5분 뒤 다시'를 몇 번 눌렀는지 (앱을 다시 켜도 이어지게 저장) */
  snoozeCount(id) {
    try { const v = JSON.parse(localStorage.getItem('mp_snooze') || '{}'); return v.id === id && v.day === U.today() ? v.n || 0 : 0; } catch (e) { return 0; }
  },
  setSnoozeCount(id, n) { try { localStorage.setItem('mp_snooze', JSON.stringify({ id, n, day: U.today() })); } catch (e) {} },

  /** 기상 알람 전체 화면: 일정·출발·날씨·교통을 한눈에 */
  wakeHTML(s, id) {
    const plan = Planner.compute(s);
    const now = new Date(), hm = d => U.hm(d), DOW = ['일', '월', '화', '수', '목', '금', '토'];
    const isTrip = Planner.isTrip(s.mode), m = Planner.MODES[s.mode] || {};
    const place = isTrip ? ((s.trip && s.trip.departStation && s.trip.departStation.name) || '') : ((s.dest && s.dest.name) || '');
    const go = isTrip
      ? `<b>${hm(plan.departAt)}</b>에 나가면 <b>${U.esc((s.trip && s.trip.departTime) || '')}</b> ${U.esc(m.label || '')} 탈 수 있어요`
      : `<b>${hm(plan.departAt)}</b>에 나가면 <b>${U.esc(s.arriveBy || hm(plan.arriveAt))}</b> 전에 도착해요`;
    const svg = (p) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
    const umbrella = svg('<path d="M3 12a9 9 0 0 1 18 0Z"/><path d="M12 12v6a2 2 0 0 0 4 0"/><path d="M12 3v0"/>');
    const car = svg('<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v2H3z"/><circle cx="7.5" cy="13.5" r=".8"/><circle cx="16.5" cy="13.5" r=".8"/>');
    const lines = [];
    if (plan.weather) lines.push(`<div class="wa-line wx">${umbrella}<span>${U.esc(plan.weather.label)} · ${U.esc(plan.weather.tip)}</span></div>`);
    // 실제로 계산에 쓴 실시간 값일 때만 '이미 반영했어요' (너무 일찍 잰 값·이상한 값은 계산에서 빠지므로 문구도 뺌)
    const lr = Planner.LIVE_MODES.includes(s.mode) ? Planner.liveRoute(s, 'route', s.mode) : null;
    const base = s.route && s.route.travelMin, checked = plan.live && plan.live.checkedAt;
    const fresh = checked && Date.now() - checked < 3 * 3600000; // 3시간 넘은 값은 안 보임
    if (lr && lr.source === 'live' && base && fresh && Math.abs(lr.travelMin - base) >= 3) {
      const d = lr.travelMin - base, ago = Math.max(1, Math.round((Date.now() - checked) / 60000));
      lines.push(`<div class="wa-line">${car}<span>${d > 0 ? `길이 평소보다 ${d}분 막혀요` : `길이 평소보다 ${-d}분 빨라요`} · 이미 반영했어요 (${ago}분 전 확인)</span></div>`);
    }
    const left = this.SNOOZE_MAX - this.snoozeCount(id);
    const next = Planner.alarms(s, plan).find(a => (a.key === 'pre' || a.key === 'depart') && a.at > now);
    const foot = [left > 0 ? `다시 울림까지 ${left}번 남았어요` : '다시 울림을 모두 썼어요',
      next ? `${hm(next.at)}에 ${next.key === 'pre' ? '출발 10분 전' : '출발'} 알림` : ''].filter(Boolean).join(' · ');
    return `
      <div class="wa">
        <div class="wa-top">
          <div class="wa-date">${now.getMonth() + 1}월 ${now.getDate()}일 (${DOW[now.getDay()]}) · 기상 알람</div>
          <div class="wa-time">${hm(now)}</div>
          <div class="wa-msg">일어날 시간이에요</div>
        </div>
        <div class="wa-card">
          <div class="wa-title">${U.esc(s.title || '일정')}${place ? ' · ' + U.esc(place) : ''}</div>
          <div class="wa-go">${go}</div>
          ${lines.join('')}
        </div>
        <div class="wa-bottom">
          <button class="wa-up" onclick="Alarm.awake()">일어났어요</button>
          <div class="wa-row">
            <button class="wa-sub" onclick="Alarm.snooze()" ${left > 0 ? '' : 'disabled'}>5분 뒤 다시</button>
            <button class="wa-sub" onclick="Alarm.stop(true)">일정 보기</button>
          </div>
          <div class="wa-foot">${foot}</div>
        </div>
      </div>`;
  },

  showRinging(title, body, scheduleId, kind, quiet) {
    const el = document.getElementById('ringing');
    if (!el) return;
    this._ringId = scheduleId || '';
    this._ringKind = kind || '';
    const s = kind === 'wake' && scheduleId ? Recur.resolve(scheduleId) : null;
    let html = '';
    if (s) { try { html = this.wakeHTML(s, scheduleId); } catch (e) { html = ''; } }
    el.classList.toggle('wake', !!html);
    if (html) {
      el.innerHTML = html;
      el.classList.add('show'); if (typeof Ads !== 'undefined') Ads.sync();
      if (!quiet) this.beep(true);
      clearInterval(this._clockTimer);
      this._clockTimer = setInterval(() => { const t = el.querySelector('.wa-time'); if (t) t.textContent = U.hm(new Date()); }, 15000);
      return;
    }
    el.innerHTML = `
      <div class="ring-box">
        <div class="ring-time">${U.hm(new Date())}</div>
        <div class="ring-title">${U.esc(title)}</div>
        <div class="ring-body">${U.esc(body)}</div>
        <button class="btn primary big" onclick="Alarm.stop(true)">확인 · 일정 보기</button>
        <button class="btn ghost" onclick="Alarm.snooze()">5분 뒤 다시 알림</button>
      </div>`;
    el.classList.add('show'); if (typeof Ads !== 'undefined') Ads.sync();
    this.beep(true);
    // 울리는 동안 큰 시계 숫자도 흘러가게
    clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => { const t = el.querySelector('.ring-time'); if (t) t.textContent = U.hm(new Date()); }, 15000);
  },

  /** '일어났어요': 소리 끄고, 아이폰이 1·2분 뒤 다시 울리려고 예약해 둔 알림도 지움 */
  async awake() {
    const id = this._ringId;
    this.stop(false);
    this.setSnoozeCount(id, 0);
    this.clearSnoozeMark();
    this.habitMark(id, 'up');
    const LN = this.ln();
    if (LN && id) {
      try { await LN.cancel({ notifications: this.IOS_REPEAT.map(m => ({ id: this.numId(id + 'wake' + 'r' + m) })) }); } catch (e) {}
    }
    U.toast('좋은 아침이에요. 출발 전에 다시 알려 드릴게요');
  },

  stop(open) {
    clearInterval(this._clockTimer);
    this.beep(false);
    document.getElementById('ringing').classList.remove('show');
    if (typeof Ads !== 'undefined') Ads.sync();
    if (open && this._ringKind === 'depart') this.habitMark(this._ringId, 'go');   // '5분 뒤 다시'(stop(false))는 출발로 치지 않음
    if (open) {
      // '일정 보기'로 끈 것도 알람을 본 것 → 아이폰이 1·2분 뒤 다시 울리려고 예약해 둔 알림 지움
      const id = this._ringId, kind = this._ringKind, LN = this.ln();
      if (LN && id && kind) {
        try { LN.cancel({ notifications: this.IOS_REPEAT.map(m => ({ id: this.numId(id + kind + 'r' + m) })) }).catch(() => {}); } catch (e) {}
      }
      this.openSchedule(id);
    }
  },

  async snooze() {
    const id = this._ringId, kind = this._ringKind;
    if (kind === 'wake') {
      const n = this.snoozeCount(id);
      if (n >= this.SNOOZE_MAX) return U.toast('다시 울림을 모두 썼어요. 이제 일어나실 시간이에요');
      this.setSnoozeCount(id, n + 1);
    }
    this.stop(false);
    const at = new Date(Date.now() + 5 * 60000);
    const s = Recur.resolve(id);
    const title = '⏰ 다시 알림' + (s ? ` — ${s.title}` : '');
    const N = this.native(), LN = this.ln();
    if (N) {
      try { await N.snooze({ id: this.numId('snooze' + id), at: at.getTime(), title, body: '5분이 지났어요.', scheduleId: id }); } catch (e) {}
    } else if (LN) {
      // 아이폰 앱(전체 화면 알람 플러그인 없음): 앱을 닫거나 화면을 꺼도 울리도록 폰 알림으로 예약
      try {
        this._snooze = { id: this.numId('snooze' + id), at: at.getTime() }; // 알람 다시 맞추기(clearLocal)에서 지우지 않게
        await LN.schedule({ notifications: [{ id: this.numId('snooze' + id), title, body: '5분이 지났어요.', schedule: { at, allowWhileIdle: true },
          channelId: this.CHANNEL, ...(this.isIOS() ? { sound: 'mp_alarm.caf' } : {}), extra: { scheduleId: id, alarm: true, kind, at: at.getTime(), keep: true } }] });
        // 기상 알람을 미뤘으면 1·2분 뒤 다시 울림 예약은 지움 (5분 뒤에 한 번만)
        if (kind === 'wake') await LN.cancel({ notifications: this.IOS_REPEAT.map(m => ({ id: this.numId(id + 'wake' + 'r' + m) })) });
      } catch (e) { clearTimeout(this._webSnooze); this._webSnooze = setTimeout(() => this.showRinging(title, '5분이 지났어요.', id, kind), 5 * 60000); }
    } else {
      clearTimeout(this._webSnooze);
      this._webSnooze = setTimeout(() => this.showRinging(title, '5분이 지났어요.', id, kind), 5 * 60000);
    }
    try { localStorage.setItem('mp_snooze_at', JSON.stringify({ id, kind, at: at.getTime(), nid: this.numId('snooze' + id), title: s ? s.title : '' })); } catch (e) {}
    U.toast('5분 뒤에 다시 알려 드릴게요.');
    if (typeof App !== 'undefined' && App.current === 'home' && typeof Home !== 'undefined') Home.render();
  },

  /* ---------- '5분 뒤 다시' 대기 중 (홈에 '끄기' 띠) ---------- */
  pendingSnooze() {
    try { const v = JSON.parse(localStorage.getItem('mp_snooze_at') || 'null'); return v && v.at > Date.now() ? v : null; } catch (e) { return null; }
  },
  clearSnoozeMark() { try { localStorage.removeItem('mp_snooze_at'); } catch (e) {} },
  /** 안드로이드 전체 화면 알람(네이티브)은 앱에서 취소할 방법이 아직 없음 → '끄기'를 안 보임 */
  canCancelSnooze() { return !this.native(); },
  async cancelSnooze() {
    const v = this.pendingSnooze();
    this.clearSnoozeMark();
    if (!v) return;
    clearTimeout(this._webSnooze);
    this._snooze = null;
    const LN = this.ln();
    if (LN) { try { await LN.cancel({ notifications: [{ id: v.nid }] }); } catch (e) {} }
    if (v.kind === 'wake') this.setSnoozeCount(v.id, 0);
    U.toast('5분 뒤 알림을 껐어요');
  },

  /* ---------- 예약 확인 한 줄 (홈) ---------- */
  /** { count, last: Date } — 아이폰은 폰에 실제로 예약된 알림 기준 */
  async summary() {
    const N = this.native(), LN = this.ln();
    if (!N && LN) {
      try {
        const p = (await LN.getPending()).notifications || [];
        const al = p.filter(n => n.extra && n.extra.alarm && n.extra.kind !== 'end-notice');
        const ats = al.map(n => Number(n.extra.at) || (n.schedule && n.schedule.at ? new Date(n.schedule.at).getTime() : 0)).filter(Boolean);
        // 1·2분 뒤 다시 울림은 같은 알람이므로 세지 않음
        return { count: al.filter(n => !/r[12]$/.test(String(n.extra.kind || '')) && !/^[12]분 지났어요/.test(n.body || '')).length, last: ats.length ? new Date(Math.max(...ats)) : null };
      } catch (e) { return null; }
    }
    const days = N ? this.NATIVE_DAYS : this.HORIZON_DAYS;
    const al = this.collect(days).filter(a => a.alarm && a.at.getTime() > Date.now());
    return { count: al.length, last: al.length ? al[al.length - 1].at : null, web: !N && !LN };
  },

  /* ---------- 준비 시간 제안 (실제 '일어났어요' ~ 출발 알람 확인 사이) ---------- */
  HABIT_MIN: 5,
  habitAll() { try { return JSON.parse(localStorage.getItem('mp_habit') || '{}') || {}; } catch (e) { return {}; } },
  habitMark(sid, what) {
    if (!sid) return;
    let s = null; try { s = Recur.resolve(sid); } catch (e) {}
    if (!s || s.chained || Planner.isTrip(s.mode)) return;
    let plan; try { plan = Planner.compute(s); } catch (e) { return; }
    const now = Date.now(), ref = (what === 'up' ? plan.wakeAt : plan.departAt).getTime();
    if (Math.abs(now - ref) > 90 * 60000) return; // 엉뚱한 때 누른 건 기록 안 함
    const all = this.habitAll(), base = s.baseId || s.id, list = all[base] || (all[base] = []);
    let rec = list.find(r => r.occ === sid && r.day === s.date);
    if (!rec) { rec = { occ: sid, day: s.date }; list.push(rec); }
    if (!rec[what]) rec[what] = now;
    all[base] = list.slice(-10);
    try { localStorage.setItem('mp_habit', JSON.stringify(all)); } catch (e) {}
  },
  /** 기록 → 제안할 준비 시간(분) 또는 null. 5번 이상, 지금과 10분 이상 차이 날 때만 */
  prepSuggest(records, prepMin) {
    const mins = (records || []).filter(r => r.up && r.go && r.go > r.up).map(r => (r.go - r.up) / 60000).filter(m => m >= 10 && m <= 240);
    if (mins.length < this.HABIT_MIN) return null;
    const sorted = mins.slice(-7).sort((a, b) => a - b), mid = sorted[Math.floor(sorted.length / 2)];
    const sug = Math.round(mid / 5) * 5;
    return Math.abs(sug - Number(prepMin ?? 60)) >= 10 ? { min: sug, n: mins.length } : null;
  },
  /** 일정 s에 대한 제안 (이미 '괜찮아요' 한 값이면 안 보임) */
  prepFor(s) {
    const base = s.baseId || s.id, all = this.habitAll(), sug = this.prepSuggest(all[base], s.prepMin);
    if (!sug) return null;
    let off = {}; try { off = JSON.parse(localStorage.getItem('mp_habit_off') || '{}'); } catch (e) {}
    return off[base] === sug.min ? null : { ...sug, base };
  },
  applyPrep(base, min) {
    const s = State.get(base);
    if (!s) return;
    s.prepMin = min; State.upsert(s);
    const all = this.habitAll(); delete all[base];
    try { localStorage.setItem('mp_habit', JSON.stringify(all)); } catch (e) {}
    this.rescheduleAll();
    U.toast(`준비 시간을 ${min}분으로 바꿨어요. 알람도 다시 맞췄어요`);
  },
  skipPrep(base, min) {
    let off = {}; try { off = JSON.parse(localStorage.getItem('mp_habit_off') || '{}'); } catch (e) {}
    off[base] = min; try { localStorage.setItem('mp_habit_off', JSON.stringify(off)); } catch (e) {}
  },

  beep(on) {
    clearInterval(this._beepTimer);
    if (!on) return;
    try {
      this._ctx = this._ctx || new (window.AudioContext || window.webkitAudioContext)();
      const play = () => {
        const ctx = this._ctx, o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(880, ctx.currentTime);
        o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.8, ctx.currentTime + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
        o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.5);
      };
      play();
      this._beepTimer = setInterval(play, 900);
      setTimeout(() => clearInterval(this._beepTimer), 60000);
    } catch (e) {}
  }
};
