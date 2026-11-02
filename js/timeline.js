/* =========================================
   MyPlanner — 일정 타임라인 · 설정
   ========================================= */

const Timeline = {
  id: null,

  render(params = {}) {
    this.id = params.id || this.id;
    const s = State.get(this.id);
    if (!s) return App.navigate('home');
    const plan = Planner.compute(s);
    const m = Planner.MODES[s.mode];
    const now = Date.now();
    const navTarget = Planner.isTrip(s.mode) ? s.trip.departStation : s.dest;
    const navMode = Planner.isTrip(s.mode) ? s.trip.accessMode : s.mode;

    App.setMain(`
      <header class="top row-between">
        <button class="back" onclick="App.navigate('home')">‹</button>
        <div class="grow"><div class="muted">${U.dateLabel(s.date)}</div><h1>${U.esc(s.title)}</h1></div>
      </header>

      <div class="card result big">
        <div class="result-row">
          <div><small>기상</small><b>${U.hmRel(plan.wakeAt, s.date)}</b></div>
          <div><small>출발</small><b>${U.hm(plan.departAt)}</b></div>
          <div><small>도착</small><b>${U.hm(plan.arriveAt)}</b></div>
        </div>
        <div class="result-meta">${m.emoji} ${m.label} · 준비 ${s.prepMin}분 · 여유 ${s.bufferMin}분</div>
        ${plan.warnings.map(w => `<div class="warn-line">⚠️ ${U.esc(w)}</div>`).join('')}
      </div>

      <div class="nav-btns">
        ${navMode === 'taxi' ? `<button class="btn" onclick="Routes.openNav('kakaot')">🚕 카카오T</button>` : ''}
        <button class="btn" onclick="Timeline.nav('kakaomap')">🗺️ 카카오맵</button>
        <button class="btn" onclick="Timeline.nav('tmap')">🧭 티맵</button>
      </div>

      <div class="card">
        <div class="tl">
          ${plan.items.map(it => `
            <div class="tl-item ${it.kind} ${it.at.getTime() < now ? 'past' : ''}">
              <div class="tl-time">${U.hmRel(it.at, s.date)}</div>
              <div class="tl-dot">${it.icon}</div>
              <div class="tl-body"><b>${U.esc(it.title)}</b>${it.detail ? `<small>${U.esc(it.detail)}</small>` : ''}
                ${it.step && it.step.way ? `<small>${U.esc(it.step.way)} 방면</small>` : ''}</div>
            </div>`).join('')}
        </div>
      </div>

      ${s.memo ? `<div class="card"><label class="lbl">메모</label><div>${U.esc(s.memo).replace(/\n/g, '<br>')}</div></div>` : ''}

      <div class="card">
        <label class="toggle-row"><span>🔔 이 일정 알람 켜기</span><input type="checkbox" ${s.alarmOff ? '' : 'checked'} onchange="Timeline.toggleAlarm(this.checked)"></label>
        <div id="alarmList" class="muted small"></div>
      </div>

      <div class="actions">
        <button class="btn ghost" onclick="Timeline.refresh()">↻ 실시간 경로로 다시 계산</button>
      </div>
      <div class="actions">
        <button class="btn ghost danger" onclick="Timeline.remove()">삭제</button>
        <button class="btn primary" onclick="App.navigate('register',{id:'${s.id}'})">수정</button>
      </div>
    `);
    this.showAlarms(s, plan);
  },

  showAlarms(s, plan) {
    const el = document.getElementById('alarmList');
    if (!el || s.alarmOff) return;
    const list = Planner.alarms(s, plan);
    el.innerHTML = list.length
      ? list.map(a => `· ${U.dateLabel(U.ymd(a.at)).split(' · ')[0]} ${U.hm(a.at)} — ${U.esc(a.title.replace(/ — .*/, ''))}`).join('<br>')
      : '남은 알람이 없어요.';
  },

  nav(app) {
    const s = State.get(this.id);
    const isTrip = Planner.isTrip(s.mode);
    Routes.openNav(app, isTrip ? s.trip.accessMode : s.mode, s.origin, isTrip ? s.trip.departStation : s.dest);
  },

  async toggleAlarm(on) {
    const s = State.get(this.id);
    s.alarmOff = !on;
    State.upsert(s);
    await Alarm.rescheduleAll();
    U.toast(on ? '알람을 켰어요.' : '알람을 껐어요.');
    this.render();
  },

  /** 출발 전 다시 열었을 때 실시간 교통으로 재계산 */
  async refresh() {
    const s = State.get(this.id);
    U.toast('경로를 다시 확인하는 중…');
    const isTrip = Planner.isTrip(s.mode);
    const before = Planner.compute(s).departAt;
    try {
      if (isTrip) {
        const r = await Routes.options(s.origin, s.trip.departStation, s.trip.accessMode, Planner.at(s.date, s.trip.departTime));
        if (r[0]) s.accessRoute = this.keepSimilar(s.accessRoute, r);
      } else {
        const r = await Routes.options(s.origin, s.dest, s.mode, Planner.at(s.date, s.arriveBy));
        if (r[0]) s.route = this.keepSimilar(s.route, r);
      }
      State.upsert(s);
      await Alarm.rescheduleAll();
      const after = Planner.compute(s).departAt;
      const diff = Math.round((before - after) / 60000);
      U.toast(diff > 0 ? `${diff}분 일찍 출발해야 해요. 알람을 당겼어요.` : diff < 0 ? `${-diff}분 늦게 출발해도 돼요.` : '변동 없어요.');
    } catch (e) { U.toast('경로를 확인하지 못했어요.'); }
    this.render();
  },

  // 사용자가 골랐던 노선과 같은 노선이 있으면 그걸 유지
  keepSimilar(prev, list) {
    if (!prev) return list[0];
    const sig = r => r.steps.filter(x => x.type !== 'walk').map(x => x.label).join('|');
    return list.find(r => sig(r) === sig(prev)) || list[0];
  },

  async remove() {
    if (!confirm('이 일정을 삭제할까요?')) return;
    State.remove(this.id);
    await Alarm.rescheduleAll();
    U.toast('삭제했어요.');
    App.navigate('home');
  }
};

const Settings = {
  render() {
    const st = State.settings;
    const keys = [['ODSAY_API_KEY', 'ODsay 키 (버스·지하철)'], ['TMAP_APP_KEY', '티맵 앱키 (자가용·도보·장소)'], ['KAKAO_REST_KEY', '카카오 REST 키 (장소 검색)']];
    App.setMain(`
      <header class="top"><h1>설정</h1></header>

      <div class="card">
        <label class="lbl">이름</label>
        <input class="input" value="${U.esc(st.name)}" onchange="State.settings.name=this.value.trim();State.save()">
        <label class="lbl">집 (기본 출발지)</label>
        <button class="input place-btn" onclick="Settings.pickHome()">${st.home ? '🏠 ' + U.esc(st.home.name) : '집 주소 검색'}</button>
      </div>

      <div class="card">
        <label class="lbl">기본 이동수단</label>
        <div class="seg wrap">${['transit', 'car', 'taxi', 'walk'].map(k => `<button class="${st.defaultMode === k ? 'on' : ''}" onclick="Settings.set('defaultMode','${k}')">${Planner.MODES[k].emoji} ${Planner.MODES[k].label}</button>`).join('')}</div>
        <label class="lbl">기본 준비 시간</label>
        <div class="seg">${[20, 30, 45, 60, 90, 120].map(v => `<button class="${+st.prepMin === v ? 'on' : ''}" onclick="Settings.set('prepMin',${v})">${U.durLabel(v)}</button>`).join('')}</div>
        <label class="lbl">기본 여유 시간</label>
        <div class="seg">${[0, 5, 10, 20, 30].map(v => `<button class="${+st.bufferMin === v ? 'on' : ''}" onclick="Settings.set('bufferMin',${v})">${v ? v + '분' : '없음'}</button>`).join('')}</div>
      </div>

      <div class="card">
        <label class="lbl">새 일정의 기본 알림</label>
        ${[['nightBefore', '전날 밤 9시 미리 안내'], ['wake', '기상 알람'], ['preDepart', '출발 10분 전'], ['depart', '출발 알람']].map(([k, l]) => `
          <label class="toggle-row"><span>${l}</span><input type="checkbox" ${st.alarm[k] ? 'checked' : ''} onchange="State.settings.alarm['${k}']=this.checked;State.save()"></label>`).join('')}
        <button class="btn ghost" onclick="Settings.perm()">🔔 알림 권한 확인</button>
        <button class="btn ghost" onclick="Settings.test()">🔊 알람 미리 듣기</button>
      </div>

      <details class="card">
        <summary class="lbl">개발자 설정 (API 키 테스트)</summary>
        <p class="muted small">출시 버전은 js/config.js의 키를 써요. 여기 넣은 값은 이 기기에서만 우선 적용돼요.</p>
        ${keys.map(([k, l]) => `<label class="lbl">${l}</label>
          <input class="input mono" value="${U.esc(localStorage.getItem('mp_key_' + k) || '')}" placeholder="${Routes.key(k) ? 'config.js 키 사용 중' : '비어 있음 → 추정치 사용'}"
            onchange="Settings.setKey('${k}',this.value)">`).join('')}
      </details>

      <div class="card">
        <button class="btn ghost danger" onclick="Settings.reset()">모든 일정 지우기</button>
        <p class="muted small center">마이플래너 v0.1</p>
      </div>
    `);
  },
  set(k, v) { State.settings[k] = v; State.save(); this.render(); },
  setKey(k, v) { v = v.trim(); if (v) localStorage.setItem('mp_key_' + k, v); else localStorage.removeItem('mp_key_' + k); U.toast('저장했어요.'); },
  pickHome() {
    PlacePicker.open('집 주소', p => { State.settings.home = { ...p, name: p.name === '현재 위치' ? '집' : p.name }; State.save(); this.render(); }, { allowHome: false });
  },
  async perm() { const ok = await Alarm.requestPermission(); U.toast(ok ? '알림이 허용되어 있어요.' : '휴대폰 설정에서 알림을 허용해 주세요.'); },
  test() { Alarm.showRinging('⏰ 알람 미리 듣기', '이런 소리로 깨워 드려요.', ''); },
  async reset() {
    if (!confirm('모든 일정을 지울까요? 되돌릴 수 없어요.')) return;
    State.schedules = []; State.save(); await Alarm.rescheduleAll(); U.toast('모두 지웠어요.'); App.navigate('home');
  }
};
