/* =========================================
   MyPlanner — 기상·출발 알람
   - 앱(안드로이드): Capacitor 로컬 알림으로 예약 → 앱이 꺼져 있어도 울림
   - 웹: 앱이 열려 있는 동안 브라우저 알림 + 화면 알람
   ========================================= */

const Alarm = {
  CHANNEL: 'mp_alarm',
  webTimers: [],
  ringing: null,

  plugin() {
    const C = window.Capacitor;
    return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.LocalNotifications;
  },

  async init() {
    const LN = this.plugin();
    if (LN) {
      try {
        await LN.createChannel({ id: this.CHANNEL, name: '기상·출발 알람', description: '일정에 맞춘 기상·출발 알림',
          importance: 5, visibility: 1, vibration: true, lights: true });
        LN.addListener('localNotificationActionPerformed', ev => {
          const id = ev?.notification?.extra?.scheduleId;
          if (id && State.get(id)) App.navigate('timeline', { id });
        });
        LN.addListener('localNotificationReceived', ev => {
          const n = ev || {};
          if (n.extra && n.extra.alarm) this.showRinging(n.title, n.body, n.extra.scheduleId);
        });
      } catch (e) { console.warn('알림 채널 생성 실패', e); }
    }
    await this.rescheduleAll();
    // 앱으로 돌아올 때마다 다시 예약 (일정 변경·시간 경과 반영)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.rescheduleAll(); });
  },

  async requestPermission() {
    const LN = this.plugin();
    if (LN) {
      const p = await LN.requestPermissions();
      try {
        // 안드로이드 12+ '정확한 알람' 권한 (설정 화면으로 안내)
        const ex = await LN.checkExactNotificationSetting?.();
        if (ex && ex.exact_alarm !== 'granted') await LN.changeExactNotificationSetting?.();
      } catch (e) {}
      return p.display === 'granted';
    }
    if ('Notification' in window) return (await Notification.requestPermission()) === 'granted';
    return false;
  },

  async permissionState() {
    const LN = this.plugin();
    if (LN) { try { return (await LN.checkPermissions()).display; } catch (e) { return 'prompt'; } }
    return ('Notification' in window) ? Notification.permission : 'unsupported';
  },

  /** 앞으로 7일 안의 모든 일정 알람 목록 */
  collect() {
    const limit = Date.now() + 7 * 86400000;
    const list = [];
    State.schedules.forEach(s => {
      if (s.alarmOff) return;
      try {
        const plan = Planner.compute(s);
        Planner.alarms(s, plan).forEach(a => { if (a.at.getTime() < limit) list.push({ ...a, s }); });
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
    const LN = this.plugin();
    if (LN) {
      try {
        const pending = await LN.getPending();
        if (pending.notifications.length) await LN.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
        if (list.length) {
          await LN.schedule({
            notifications: list.map(a => ({
              id: this.numId(a.s.id + a.key),
              title: a.title,
              body: a.body,
              largeBody: a.body,
              schedule: { at: a.at, allowWhileIdle: true },
              channelId: this.CHANNEL,
              extra: { scheduleId: a.s.id, alarm: !!a.alarm }
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
          if (a.alarm) this.showRinging(a.title, a.body, a.s.id);
          else U.toast(a.title);
        }, delay));
      }
    });
    return list;
  },

  next() { return this.collect().find(a => a.key === 'wake' || a.key === 'depart'); },

  /* ---------- 화면 알람 (앱이 열려 있을 때) ---------- */
  showRinging(title, body, scheduleId) {
    const el = document.getElementById('ringing');
    if (!el) return;
    el.innerHTML = `
      <div class="ring-box">
        <div class="ring-time">${U.hm(new Date())}</div>
        <div class="ring-title">${U.esc(title)}</div>
        <div class="ring-body">${U.esc(body)}</div>
        <button class="btn primary big" onclick="Alarm.stop(true,'${U.esc(scheduleId || '')}')">확인 · 타임라인 보기</button>
        <button class="btn ghost" onclick="Alarm.snooze('${U.esc(scheduleId || '')}')">5분 뒤 다시 알림</button>
      </div>`;
    el.classList.add('show');
    this.beep(true);
  },

  stop(open, scheduleId) {
    this.beep(false);
    document.getElementById('ringing').classList.remove('show');
    if (open && scheduleId && State.get(scheduleId)) App.navigate('timeline', { id: scheduleId });
  },

  async snooze(scheduleId) {
    this.stop(false);
    const at = new Date(Date.now() + 5 * 60000);
    const s = State.get(scheduleId);
    const title = '⏰ 다시 알림' + (s ? ` — ${s.title}` : '');
    const LN = this.plugin();
    if (LN) {
      await LN.schedule({ notifications: [{ id: this.numId('snooze' + Date.now()), title, body: '5분이 지났어요.', schedule: { at, allowWhileIdle: true }, channelId: this.CHANNEL, extra: { scheduleId, alarm: true } }] });
    } else {
      setTimeout(() => this.showRinging(title, '5분이 지났어요.', scheduleId), 5 * 60000);
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
