/* =========================================
   MyPlanner — 기상·출발 알람
   - 기상·출발 알람: 네이티브 MyAlarm 플러그인 → 잠금화면 위 전체 화면 알람 (알람시계 방식)
     (플러그인이 없으면 로컬 알림으로 대체)
   - 전날 밤 안내·출발 10분 전: Capacitor 로컬 알림
   - 웹: 앱이 열려 있는 동안 브라우저 알림 + 화면 알람
   ========================================= */

const Alarm = {
  CHANNEL: 'mp_alarm',
  HORIZON_DAYS: 14,     // 앞으로 며칠치 알람을 예약할지 (반복 일정 포함)
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
    await this.rescheduleAll();
    this.consumeOpen();
    // 앱으로 돌아올 때마다: 알람 다시 예약 + 전체 화면 알람에서 '일정 보기'를 눌렀는지 확인
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      this.rescheduleAll();
      this.consumeOpen();
    });
  },

  openSchedule(id) {
    if (id && Recur.resolve(id)) App.navigate('timeline', { id });
  },

  async consumeOpen() {
    const N = this.native();
    if (!N) return;
    try { const r = await N.consumeOpen(); if (r && r.scheduleId) this.openSchedule(r.scheduleId); } catch (e) {}
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
  async openSettings(which) {
    const N = this.native();
    if (N) { try { await N.openSettings({ which }); } catch (e) { U.toast('설정을 열 수 없어요.'); } }
  },

  /* ---------- 예약 ---------- */
  /** 앞으로 HORIZON_DAYS일 안의 모든 일정 회차 알람 */
  collect() {
    const now = Date.now();
    const limit = now + this.HORIZON_DAYS * 86400000;
    const list = [];
    const from = Recur.shift(U.today(), -1);
    const to = Recur.shift(U.today(), this.HORIZON_DAYS + 1);
    Recur.between(State.schedules, from, to).forEach(s => {
      if (s.alarmOff) return;
      try {
        const plan = Planner.compute(s);
        Planner.alarms(s, plan).forEach(a => { if (a.at.getTime() < limit) list.push({ ...a, s, sid: s.occId || s.id }); });
      } catch (e) { console.warn('알람 계산 실패', s, e); }
    });
    return list.sort((a, b) => a.at - b.at);
  },

  numId(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 2000000000;
  },

  async rescheduleAll() {
    const list = this.collect();
    if (this.isNative()) {
      const N = this.native();
      const full = N ? list.filter(a => a.alarm) : [];
      const notes = N ? list.filter(a => !a.alarm) : list;
      // 1) 기상·출발 → 전체 화면 알람 (전부 교체)
      if (N) {
        try {
          await N.setAll({ alarms: full.map(a => ({ id: this.numId(a.sid + a.key), at: a.at.getTime(), title: a.title, body: a.body, scheduleId: a.sid })) });
        } catch (e) { console.warn('전체 화면 알람 예약 실패 → 일반 알림으로 대체', e); notes.push(...full); }
      }
      // 2) 나머지 → 로컬 알림 (전부 교체)
      const LN = this.ln();
      if (LN) {
        try {
          const pending = await LN.getPending();
          if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
          if (notes.length) {
            await LN.schedule({
              notifications: notes.map(a => ({
                id: this.numId(a.sid + a.key), title: a.title, body: a.body, largeBody: a.body,
                schedule: { at: a.at, allowWhileIdle: true }, channelId: this.CHANNEL,
                extra: { scheduleId: a.sid, alarm: !!a.alarm }
              }))
            });
          }
        } catch (e) { console.warn('알림 예약 실패', e); }
      }
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
