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
  ln() { return this.isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications; },
  native() { return this.isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.MyAlarm; },

  async init() {
    const LN = this.ln();
    if (LN) {
      try {
        await LN.createChannel({ id: this.CHANNEL, name: '일정 알림', description: '전날 안내·출발 전 알림',
          importance: 4, visibility: 1, vibration: true });
        LN.addListener('localNotificationActionPerformed', ev => this.openSchedule(ev?.notification?.extra?.scheduleId));
        LN.addListener('localNotificationReceived', n => {
          if (n && n.extra && n.extra.alarm) this.showRinging(n.title, n.body, n.extra.scheduleId);
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
    if (!N || !N.testAlarm) return false;
    try { await N.testAlarm({ seconds: sec }); return true; } catch (e) { return false; }
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
          stationId: String(bl.step.stationId), routeIds: (bl.step.routeIds || []).join(','), busName: Bus.busName(bl.step),
          walkMin: bl.walkMin, preStopMin: bl.preStopMin, plannedDepart: a.plan.departAt.getTime(),
          preId: this.numId(a.sid + 'pre'), departId: this.numId(a.sid + 'depart')
        });
      }
      const spec = Planner.recheckSpec(a.s, a.plan);
      if (!spec) return;
      const times = [spec.wakeMs - this.RECHECK_BEFORE_WAKE * 60000, spec.plannedDepartMs - this.RECHECK_BEFORE_DEPART * 60000];
      if (times[1] - times[0] < 10 * 60000) times.pop(); // 두 시점이 너무 가까우면 한 번만
      times.forEach((at, i) => {
        if (at <= now) return;
        out.push({
          id: this.numId(a.sid + 'chk' + i), at, occId: a.sid, title: a.s.title,
          anchor: spec.anchorMs, fixedMin: spec.fixedMin, travelMin: spec.travelMin,
          plannedDepart: spec.plannedDepartMs, wake: spec.wakeMs,
          wakeId: this.numId(a.sid + 'wake'), preId: this.numId(a.sid + 'pre'), departId: this.numId(a.sid + 'depart'),
          sx: spec.from.lng, sy: spec.from.lat, ex: spec.to.lng, ey: spec.to.lat
        });
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
          await LN.schedule({
            notifications: list.map(a => ({
              id: this.numId(a.sid + a.key), title: a.title, body: a.body, largeBody: a.body,
              schedule: { at: a.at, allowWhileIdle: true }, channelId: this.CHANNEL,
              extra: { scheduleId: a.sid, alarm: !!a.alarm }
            }))
          });
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
          if (a.alarm) this.showRinging(a.title, a.body, a.sid);
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
      if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
    } catch (e) {}
  },

  /* ---------- 화면 알람 (웹 / 앱이 열려 있을 때 대체용) ---------- */
  showRinging(title, body, scheduleId) {
    const el = document.getElementById('ringing');
    if (!el) return;
    this._ringId = scheduleId || '';
    el.innerHTML = `
      <div class="ring-box">
        <div class="ring-time">${U.hm(new Date())}</div>
        <div class="ring-title">${U.esc(title)}</div>
        <div class="ring-body">${U.esc(body)}</div>
        <button class="btn primary big" onclick="Alarm.stop(true)">확인 · 일정 보기</button>
        <button class="btn ghost" onclick="Alarm.snooze()">5분 뒤 다시 알림</button>
      </div>`;
    el.classList.add('show');
    this.beep(true);
  },

  stop(open) {
    this.beep(false);
    document.getElementById('ringing').classList.remove('show');
    if (open) this.openSchedule(this._ringId);
  },

  async snooze() {
    const id = this._ringId;
    this.stop(false);
    const at = new Date(Date.now() + 5 * 60000);
    const s = Recur.resolve(id);
    const title = '⏰ 다시 알림' + (s ? ` — ${s.title}` : '');
    const N = this.native();
    if (N) {
      try { await N.snooze({ id: this.numId('snooze' + id), at: at.getTime(), title, body: '5분이 지났어요.', scheduleId: id }); } catch (e) {}
    } else {
      setTimeout(() => this.showRinging(title, '5분이 지났어요.', id), 5 * 60000);
    }
    U.toast('5분 뒤에 다시 알려 드릴게요.');
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
