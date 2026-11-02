/* =========================================
   MyPlanner — 일정 타임라인 · 설정
   id는 일반 일정 id 또는 반복 회차 id('원본id@날짜')
   ========================================= */

const Timeline = {
  id: null,

  cur() { return Recur.resolve(this.id); },
  base() { const s = this.cur(); return s ? State.get(s.baseId || s.id) : null; },

  render(params = {}) {
    this.id = params.id || this.id;
    const s = this.cur();
    if (!s) return App.navigate('home');
    const plan = Planner.compute(s);
    const m = Planner.MODES[s.mode];
    const now = Date.now();
    const navMode = Planner.isTrip(s.mode) ? s.trip.accessMode : s.mode;
    const rep = Recur.isRepeating(s);
    const hol = Recur.holiday(s.date);

    App.setMain(`
      <header class="top row-between">
        <button class="back" onclick="App.navigate('home')">‹</button>
        <div class="grow"><div class="muted">${U.dateLabel(s.date)}${hol ? ` · <span class="holiday">${hol}</span>` : ''}</div><h1>${U.esc(s.title)}</h1></div>
      </header>

      ${rep ? `
        <div class="repeat-bar">
          <span>🔁 ${U.esc(Recur.label(s))}${s.hasOverride ? ' · <b>이 날만 변경됨</b>' : ''}</span>
          <span class="rep-nav">
            <button onclick="Timeline.step(-1)" aria-label="이전 회차">‹</button>
            <button onclick="Timeline.step(1)" aria-label="다음 회차">›</button>
          </span>
        </div>` : ''}

      <div class="card result big">
        <div class="result-row">
          <div><small>기상</small><b>${U.hmRel(plan.wakeAt, s.date)}</b></div>
          <div><small>출발</small><b>${U.hm(plan.departAt)}</b></div>
          <div><small>도착</small><b>${U.hm(plan.arriveAt)}</b></div>
        </div>
        <div class="result-meta">${m.emoji} ${m.label} · 준비 ${s.prepMin}분 · 여유 ${s.bufferMin}분</div>
        ${plan.live ? `<div class="live-line">📡 ${U.esc(Live.label(s))}</div>` : (Planner.liveLeg(s) && Routes.can('tmap') && !s.alarmOff ? `<div class="live-line dim">📡 기상 20분 전·출발 30분 전에 실시간 교통으로 다시 계산해요</div>` : '')}
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
        <label class="toggle-row"><span>🔔 ${rep ? '이 반복 일정 알람 켜기' : '이 일정 알람 켜기'}</span><input type="checkbox" ${s.alarmOff ? '' : 'checked'} onchange="Timeline.toggleAlarm(this.checked)"></label>
        <div id="alarmList" class="muted small"></div>
      </div>

      ${rep ? `
        <div class="card">
          <label class="lbl">이 날만</label>
          <div class="grid2 gap">
            <button class="btn ghost" onclick="Timeline.changeDay()">⏱ 시간 바꾸기</button>
            <button class="btn ghost" onclick="Timeline.skipDay()">⏭ 건너뛰기</button>
          </div>
          ${s.hasOverride ? `<button class="link" onclick="Timeline.resetDay()">↺ 이 날 변경 되돌리기</button>` : ''}
          ${this.skippedList()}
        </div>` : ''}

      <div class="actions">
        <button class="btn ghost" onclick="Timeline.refresh()">↻ 실시간 경로로 다시 계산</button>
      </div>
      <div class="actions">
        <button class="btn ghost danger" onclick="Timeline.remove()">삭제</button>
        <button class="btn primary" onclick="App.navigate('register',{id:'${s.baseId || s.id}'})">${rep ? '반복 전체 수정' : '수정'}</button>
      </div>
    `);
    this.showAlarms(s, plan);
  },

  skippedList() {
    const b = this.base();
    const skips = (b.skips || []).filter(d => d >= U.today()).sort();
    if (!skips.length) return '';
    return `<div class="muted small skip-list">건너뛰는 날: ${skips.map(d =>
      `<button class="chip" onclick="Timeline.unskip('${d}')">${U.dateLabel(d).split(' · ')[0]} ✕</button>`).join('')}</div>`;
  },

  showAlarms(s, plan) {
    const el = document.getElementById('alarmList');
    if (!el || s.alarmOff) return;
    const list = Planner.alarms(s, plan);
    el.innerHTML = list.length
      ? list.map(a => `· ${U.dateLabel(U.ymd(a.at)).split(' · ')[0]} ${U.hm(a.at)} — ${U.esc(a.title.replace(/ — .*/, ''))}${a.alarm ? ' <span class="tag">전체 화면</span>' : ''}`).join('<br>')
      : '남은 알람이 없어요.';
  },

  /** 반복 일정의 이전/다음 회차로 이동 */
  step(dir) {
    const s = this.cur(), b = this.base();
    let d = s.date;
    for (let i = 0; i < 400; i++) {
      d = Recur.shift(d, dir);
      if (b.repeat.until && d > b.repeat.until && dir > 0) break;
      if (d < b.date) break;
      if (Recur.occursOn(b, d)) { App.navigate('timeline', { id: b.id + '@' + d }); return; }
    }
    U.toast(dir > 0 ? '다음 회차가 없어요.' : '이전 회차가 없어요.');
  },

  nav(app) {
    const s = this.cur();
    const isTrip = Planner.isTrip(s.mode);
    Routes.openNav(app, isTrip ? s.trip.accessMode : s.mode, s.origin, isTrip ? s.trip.departStation : s.dest);
  },

  async save(b, msg) {
    State.upsert(b);
    await Alarm.rescheduleAll();
    if (msg) U.toast(msg);
    this.render();
  },

  async toggleAlarm(on) {
    const b = this.base();
    b.alarmOff = !on;
    await this.save(b, on ? '알람을 켰어요.' : '알람을 껐어요.');
  },

  /* ---------- 반복 일정: 이 날만 ---------- */
  changeDay() {
    const s = this.cur();
    const isTrip = Planner.isTrip(s.mode);
    Sheet.open(`
      <div class="sheet-head"><b>${U.dateLabel(s.date).split(' · ')[0]}만 바꾸기</b><button class="x" onclick="Sheet.close()">✕</button></div>
      ${isTrip ? '' : `<label class="lbl">도착 시간</label><input type="time" id="ovArrive" class="input" value="${s.arriveBy}">`}
      <label class="lbl">준비 시간 (분)</label><input type="number" id="ovPrep" class="input" inputmode="numeric" value="${s.prepMin}">
      <label class="lbl">여유 시간 (분)</label><input type="number" id="ovBuffer" class="input" inputmode="numeric" value="${s.bufferMin}">
      <button class="btn primary big" style="margin-top:16px" onclick="Timeline.saveDay()">이 날만 적용</button>`);
  },

  async saveDay() {
    const s = this.cur(), b = this.base();
    const ov = {};
    const a = document.getElementById('ovArrive');
    if (a && a.value && a.value !== b.arriveBy) ov.arriveBy = a.value;
    const p = parseInt(document.getElementById('ovPrep').value, 10);
    const f = parseInt(document.getElementById('ovBuffer').value, 10);
    if (!isNaN(p) && p !== +b.prepMin) ov.prepMin = Math.max(0, p);
    if (!isNaN(f) && f !== +b.bufferMin) ov.bufferMin = Math.max(0, f);
    b.overrides = b.overrides || {};
    if (Object.keys(ov).length) b.overrides[s.date] = ov; else delete b.overrides[s.date];
    Sheet.close();
    await this.save(b, '이 날만 바꿨어요. 알람도 다시 맞췄어요.');
  },

  async resetDay() {
    const s = this.cur(), b = this.base();
    if (b.overrides) delete b.overrides[s.date];
    await this.save(b, '원래 시간으로 되돌렸어요.');
  },

  async skipDay() {
    const s = this.cur(), b = this.base();
    if (!confirm(`${U.dateLabel(s.date).split(' · ')[0]} 하루만 건너뛸까요? 이 날은 알람이 울리지 않아요.`)) return;
    b.skips = [...new Set([...(b.skips || []), s.date])];
    State.upsert(b);
    await Alarm.rescheduleAll();
    U.toast('이 날은 건너뛰어요.');
    // 다음 회차로 이동
    const next = State.upcoming().find(x => x.s.baseId === b.id);
    if (next) App.navigate('timeline', { id: next.s.occId }); else App.navigate('home');
  },

  async unskip(d) {
    const b = this.base();
    b.skips = (b.skips || []).filter(x => x !== d);
    await this.save(b, `${U.dateLabel(d).split(' · ')[0]} 다시 포함했어요.`);
  },

  /** 출발 전 다시 열었을 때 실시간 교통으로 재계산 (경로는 원본 일정에 저장) */
  async refresh() {
    const s = this.cur(), b = this.base();
    U.toast('경로를 다시 확인하는 중…');
    const isTrip = Planner.isTrip(s.mode);
    const before = Planner.compute(s).departAt;
    try {
      const leg = Planner.liveLeg(s);
      if (leg) {
        // 자가용·택시: 지금 교통으로 그날만 다시 계산 (다른 날 회차에는 영향 없음)
        const r = await Routes.drive(leg.from, leg.to, leg.mode, null);
        if (r && r.source !== 'estimate') Live.record(s.occId || s.id, { travelMin: r.travelMin, prevMin: s[leg.key].travelMin });
        else throw new Error('실시간 조회 불가');
      } else if (isTrip) {
        const r = await Routes.options(s.origin, s.trip.departStation, s.trip.accessMode, Planner.at(s.date, s.trip.departTime));
        if (r[0]) b.accessRoute = this.keepSimilar(b.accessRoute, r);
      } else {
        const r = await Routes.options(s.origin, s.dest, s.mode, Planner.at(s.date, s.arriveBy));
        if (r[0]) b.route = this.keepSimilar(b.route, r);
      }
      State.upsert(b);
      await Alarm.rescheduleAll();
      const after = Planner.compute(this.cur()).departAt;
      const diff = Math.round((before - after) / 60000);
      U.toast(diff > 0 ? `${diff}분 일찍 출발해야 해요. 알람을 당겼어요.` : diff < 0 ? `${-diff}분 늦게 출발해도 돼요.` : '변동 없어요.');
    } catch (e) { U.toast(Routes.can('tmap') ? '경로를 확인하지 못했어요.' : '티맵 키가 있어야 실시간 교통을 확인할 수 있어요.'); }
    this.render();
  },

  // 사용자가 골랐던 노선과 같은 노선이 있으면 그걸 유지
  keepSimilar(prev, list) {
    if (!prev) return list[0];
    const sig = r => r.steps.filter(x => x.type !== 'walk').map(x => x.label).join('|');
    return list.find(r => sig(r) === sig(prev)) || list[0];
  },

  async remove() {
    const s = this.cur(), b = this.base();
    if (Recur.isRepeating(s)) {
      Sheet.open(`
        <div class="sheet-head"><b>반복 일정 삭제</b><button class="x" onclick="Sheet.close()">✕</button></div>
        <button class="btn ghost" onclick="Sheet.close();Timeline.skipDay()">이 날만 삭제 (건너뛰기)</button>
        <button class="btn ghost" onclick="Timeline.endFrom()">이 날부터 반복 끝내기</button>
        <button class="btn ghost danger" onclick="Timeline.removeAll()">반복 일정 전체 삭제</button>`);
      return;
    }
    if (!confirm('이 일정을 삭제할까요?')) return;
    this.removeAll();
  },

  async endFrom() {
    const s = this.cur(), b = this.base();
    Sheet.close();
    if (s.date <= b.date) return this.removeAll();
    b.repeat.until = Recur.shift(s.date, -1);
    State.upsert(b);
    await Alarm.rescheduleAll();
    U.toast('이 날부터 반복을 끝냈어요.');
    App.navigate('home');
  },

  async removeAll() {
    Sheet.close();
    State.remove(this.base().id);
    await Alarm.rescheduleAll();
    U.toast('삭제했어요.');
    App.navigate('home');
  }
};

const Settings = {
  render() {
    const st = State.settings;
    const keys = [['ROUTE_PROXY_URL', '경로 서버 주소 (Supabase 함수 URL)'], ['SUPABASE_ANON_KEY', 'Supabase 공개 키 (anon)'], ['ODSAY_API_KEY', 'ODsay 키 (버스·지하철)'], ['TMAP_APP_KEY', '티맵 앱키 (자가용·도보·장소)'], ['KAKAO_REST_KEY', '카카오 REST 키 (장소 검색)']];
    const reps = State.repeating();
    App.setMain(`
      <header class="top"><h1>설정</h1></header>

      <div class="card">
        <label class="lbl">이름</label>
        <input class="input" value="${U.esc(st.name)}" onchange="State.settings.name=this.value.trim();State.save()">
        <label class="lbl">집 (기본 출발지)</label>
        <button class="input place-btn" onclick="Settings.pickHome()">${st.home ? '🏠 ' + U.esc(st.home.name) : '집 주소 검색'}</button>
      </div>

      <div class="card" id="alarmCheck">
        <label class="lbl">알람 점검</label>
        <div class="muted small">확인 중…</div>
      </div>

      ${reps.length ? `
        <div class="card">
          <label class="lbl">반복 일정</label>
          ${reps.map(s => `<button class="row flat" onclick="App.navigate('register',{id:'${s.id}'})">
            <div class="row-ic">🔁</div>
            <div class="row-main"><b>${U.esc(s.title)}</b><small>${U.esc(Recur.label(s))} · ${Planner.isTrip(s.mode) ? s.trip.departTime + ' 출발' : s.arriveBy + ' 도착'}</small></div>
            <div class="row-side">›</div></button>`).join('')}
        </div>` : ''}

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
        ${[['nightBefore', '전날 밤 9시 미리 안내'], ['wake', '기상 알람 (전체 화면)'], ['preDepart', '출발 10분 전'], ['depart', '출발 알람 (전체 화면)']].map(([k, l]) => `
          <label class="toggle-row"><span>${l}</span><input type="checkbox" ${st.alarm[k] ? 'checked' : ''} onchange="State.settings.alarm['${k}']=this.checked;State.save()"></label>`).join('')}
        <button class="btn ghost" onclick="Settings.test()">🔊 알람 미리 듣기</button>
      </div>

      <details class="card">
        <summary class="lbl">개발자 설정 (API 키 테스트)</summary>
        <p class="muted small">경로 서버 주소를 넣으면 키 없이 서버가 대신 조회해요(권장). 출시 버전은 js/config.js 값을 써요. 여기 넣은 값은 이 기기에서만 우선 적용돼요.</p>
        ${keys.map(([k, l]) => `<label class="lbl">${l}</label>
          <input class="input mono" value="${U.esc(localStorage.getItem('mp_key_' + k) || '')}" placeholder="${Routes.key(k) ? 'config.js 키 사용 중' : '비어 있음 → 추정치 사용'}"
            onchange="Settings.setKey('${k}',this.value)">`).join('')}
      </details>

      <div class="card">
        <button class="btn ghost danger" onclick="Settings.reset()">모든 일정 지우기</button>
        <p class="muted small center"><a href="privacy.html" target="_blank">개인정보처리방침</a> · <a href="terms.html" target="_blank">이용약관</a><br>마이플래너 v0.4</p>
      </div>
    `);
    this.alarmCheck();
  },

  /** 알람이 확실히 울리는지 항목별 점검 + 바로 설정 열기 */
  async alarmCheck() {
    const el = document.getElementById('alarmCheck');
    if (!el) return;
    const perm = await Alarm.permissionState();
    const ns = await Alarm.nativeStatus();
    const row = (ok, label, desc, action) => `
      <div class="check-row ${ok ? 'ok' : 'bad'}">
        <span class="check-ic">${ok ? '✅' : '⚠️'}</span>
        <div class="grow"><b>${label}</b><small>${desc}</small></div>
        ${ok ? '' : `<button class="btn small primary" onclick="${action}">설정</button>`}
      </div>`;
    let html = '<label class="lbl">알람 점검</label>';
    html += row(perm === 'granted', '알림 허용', '꺼져 있으면 아무 알림도 오지 않아요', ns ? "Alarm.openSettings('notifications')" : "Settings.perm()");
    if (ns) {
      html += row(ns.exact, '알람 및 리마인더', '정확한 시각에 울리려면 필요해요', "Alarm.openSettings('exact')");
      html += row(ns.fullScreen, '전체 화면 알람', '잠금 화면 위로 알람 화면을 띄워요 (안드로이드 14+)', "Alarm.openSettings('fullscreen')");
      html += `<p class="muted small">앞으로 ${Alarm.NATIVE_DAYS}일 알림 ${ns.planned ?? 0}개를 폰에 맡겨 두었어요 (지금 예약 ${ns.scheduled}개, 매일 새벽 자동 보충). 앱을 오래 열지 않아도 이어서 울려요. 삼성 휴대폰은 '배터리 > 백그라운드 사용 제한'에서 마이플래너를 제외하면 더 안정적이에요.</p>`;
    } else if (perm !== 'unsupported') {
      html += `<p class="muted small">웹에서는 이 화면을 열어 둔 동안만 알람이 울려요. 앱을 설치하면 잠금 화면에서도 깨워 드려요.</p>`;
    }
    el.innerHTML = html;
  },

  set(k, v) { State.settings[k] = v; State.save(); this.render(); },
  setKey(k, v) { v = v.trim(); if (v) localStorage.setItem('mp_key_' + k, v); else localStorage.removeItem('mp_key_' + k); U.toast('저장했어요.'); },
  pickHome() {
    PlacePicker.open('집 주소', p => { State.settings.home = { ...p, name: p.name === '현재 위치' ? '집' : p.name }; State.save(); this.render(); }, { allowHome: false });
  },
  async perm() { const ok = await Alarm.requestPermission(); U.toast(ok ? '알림이 허용되어 있어요.' : '휴대폰 설정에서 알림을 허용해 주세요.'); this.alarmCheck(); },
  test() { Alarm.showRinging('⏰ 알람 미리 듣기', '이런 소리로 깨워 드려요.', ''); },
  async reset() {
    if (!confirm('모든 일정을 지울까요? 되돌릴 수 없어요.')) return;
    State.schedules = []; State.save(); await Alarm.rescheduleAll(); U.toast('모두 지웠어요.'); App.navigate('home');
  }
};
