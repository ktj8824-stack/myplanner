/* =========================================
   MyPlanner — 일정 등록 · 수정
   도착 시간 + 이동수단 → 경로 조회 → 역산 미리보기
   ========================================= */

const Register = {
  d: null,          // 작성 중인 일정
  opts: [],         // 경로 후보 (일반 이동)
  accessOpts: [],   // 역·공항까지 경로 후보
  loading: false,

  QUICK: ['출근', '회의', '미팅', '병원', '약속', '등교', '여행', '면접'],

  render(params = {}) {
    this._seq = (this._seq || 0) + 1; // 이전 화면에서 찾던 경로 결과는 버림
    this.loading = false;
    this.backTo = params.back || null;  // 수정 화면을 연 곳 (반복 일정의 그 회차 등)
    if (!params.keep) { this.err = null; this.more = false; this.alarmOpen = false; }
    // 쉬운 화면: 새 일정은 ① 어디 ② 몇 시 ③ 확인, 세 화면으로 (수정·받은 문자·끼워 넣기는 기존 화면)
    this.easy = !!(State.settings.easy && !params.id && !params.draft && !params.paste && !params.insert && !params.chainFrom && !params.full && !params.keep);
    if (this.easy) EasyAdd.step = 1;
    if (params.id && State.get(params.id) && State.get(params.id)._shared) {
      U.toast('가족이 공유한 일정은 보낸 사람만 고칠 수 있어요');
      return App.navigate('timeline', { id: params.id });
    }
    if (params.draft) {
      // 링크로 받은 일정 → 새 일정으로 확인·저장
      this.d = JSON.parse(JSON.stringify(params.draft));
      this.editing = false;
      this.opts = []; this.accessOpts = [];
      this.draw();
      if (!this.ready()) this.fetchRoutes();
      U.toast('받은 일정이에요. 확인하고 저장하세요');
      return;
    }
    if (params.id && State.get(params.id)) {
      this.d = JSON.parse(JSON.stringify(State.get(params.id)));
      this.d.repeat = this.d.repeat || { type: 'none', days: [], until: '', skipHolidays: true };
      this.d.alarm = this.d.alarm || { ...State.settings.alarm };
      this.editing = true;
      this.opts = []; this.accessOpts = [];
    } else if (!params.keep) {
      const st = State.settings;
      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
      this.d = {
        id: U.uid(), title: '', date: params.date || U.ymd(tomorrow), arriveBy: '09:00',
        origin: st.home ? { ...st.home } : null, dest: null,
        mode: st.defaultMode || 'transit', prepMin: st.prepMin, bufferMin: st.bufferMin,
        route: null, trip: { accessMode: 'transit', egressMode: 'transit', departTime: '08:00', arriveTime: '10:30', international: false },
        accessRoute: null, egressRoute: null, alarm: { ...st.alarm }, memo: '',
        repeat: { type: 'none', days: [], until: '', skipHolidays: true }, skips: [], overrides: {}
      };
      this.editing = false;
      this.opts = []; this.accessOpts = [];
    }
    if (params.insert && this.d && !params.id) {
      // 하루 동선의 빈 시간에서 '끼워 넣기': 앞 약속 끝 + 1시간을 도착 시간으로 제안 (장소를 고르면 앞 약속에서 출발로 자동 연결)
      const [h, m] = String(params.insert.end || '12:00').split(':').map(Number);
      const tot = Math.ceil((h * 60 + m + 60) / 10) * 10;
      this.d.date = params.date || this.d.date;
      this.d.arriveBy = `${U.pad(Math.floor(tot / 60) % 24)}:${U.pad(tot % 60)}`;
      U.toast('어디로 가는지 고르면 앞 약속 장소에서 출발로 맞춰 드려요');
    }
    if (params.chainFrom && this.d) { this.applyChain(params.chainFrom.place, params.chainFrom.from); U.toast('앞 일정 장소에서 출발하도록 바꿨어요. 경로를 확인하고 저장하세요'); }
    this.draw();
    if (params.id) this.fetchRoutes({ keep: true }); // 수정: 고른 경로는 그대로 두고 후보만 채움
    else this.autoOrigin();
    if (params.paste) PasteImport.open(params.text || '');
  },

  draw() {
    if (this.easy) return EasyAdd.draw();
    const d = this.d, isTrip = Planner.isTrip(d.mode);
    const placeBtn = (field, title, emptyText, icon) => {
      const p = d[field];
      return `<button class="input place-btn ${p ? '' : 'empty'} ${this.badCls(field)}" id="f-${field}" onclick="Register.pick('${field}','${title}')">${U.icon(icon)} ${p ? U.esc(p.name) : emptyText}</button>${this.errLine(field)}`;
    };
    App.setMain(`
      <header class="subhead"><button class="back" onclick="Register.back()" aria-label="뒤로"></button><h1>${this.editing ? '일정 수정' : '새 일정'}</h1><span></span></header>
      ${this.editing ? '' : `<button class="paste-cta" onclick="PasteImport.open()">
        <span class="paste-ic"><img src="img/icons/message.png" alt=""></span><span><b>받은 문자로 채우기</b><small>KTX·항공권·병원 예약 문자 붙여넣기</small></span><span class="chev">›</span>
      </button>`}

      <div class="card">
        <div class="q">${isTrip ? '언제 어디로 가세요?' : '어디에 몇 시까지 가세요?'}</div>
        ${isTrip ? '' : placeBtn('dest', '목적지', '병원, 회사, 역 이름으로 검색', 'pin')}
        ${isTrip || this.editing ? '' : this.recentChips()}
        ${isTrip ? this.tripForm() : ''}
        <div class="grid2 mt">
          <div><label class="lbl" for="f-date">${Recur.isRepeating(d) ? '시작 날짜' : '날짜'}</label><input type="date" id="f-date" class="input" value="${d.date}" onchange="Register.set('date',this.value)"></div>
          ${isTrip ? '' : `<div><label class="lbl" for="f-arriveBy">도착 시간</label><input type="time" id="f-arriveBy" class="input ${this.badCls('arriveBy')}" value="${d.arriveBy || ''}" onchange="Register.set('arriveBy',this.value)">${this.errLine('arriveBy')}</div>`}
        </div>
        <label class="lbl">출발할 곳${d.chained ? ' · 앞 일정에서 바로 출발' : ''}</label>
        ${placeBtn('origin', '출발지', '출발지 검색', 'home')}
        ${isTrip ? '' : d.startNow
          ? `<div class="now-on"><span><b>📍 지금 위치에서 바로 출발</b><small>기상·준비 없이 출발 알람만 울려요</small></span><button class="link" onclick="Register.stopNow()">취소</button></div>`
          : `<button class="now-btn" onclick="Register.startNow()">📍 지금 위치에서 바로 출발 <small>이미 밖이에요</small></button>`}
        ${d.startNow ? '' : this.chainChips()}
        ${d.chained && !d.startNow ? `<button class="link" style="padding:8px 2px 0" onclick="Register.homeFirst()">🏠 집에 들렀다 가요 (집에서 출발로)</button>` : ''}
        <div id="loadLine">${this.loadLine()}</div>
        <div id="preview">${this.preview()}</div>
        ${this.errLine('route')}
      </div>

      <div class="card more-card ${this.more ? 'open' : ''}">
        <button class="more-head" id="moreHead" aria-expanded="${this.more ? 'true' : 'false'}" onclick="Register.toggleMore()">
          <span><b>자세히 설정</b><small>${U.esc(this.summary())}</small></span><span class="more-chev">${this.more ? '∧' : '∨'}</span>
        </button>
        ${this.more ? this.moreBody() : ''}
      </div>

      ${this.more ? this.goHomeForm() : ''}

      <div class="cta-bar"><button class="btn primary big" id="regSave" onclick="Register.save()">⏰ 저장하고 알람 켜기</button></div>
    `);
  },

  /** 접힌 '자세히 설정' 한 줄 요약: 버스·지하철 · 준비 1시간 · 알림 4개 */
  summary() {
    const d = this.d, on = this.ALARMS.filter(([k]) => d.alarm && d.alarm[k]).length;
    const parts = [Planner.MODES[d.mode] ? Planner.MODES[d.mode].label : '버스·지하철'];
    parts.push(d.chained || d.startNow ? '준비 없이 출발' : `준비 ${U.durLabel(+d.prepMin || 0)}`);
    if (+d.bufferMin) parts.push(`${d.bufferMin}분 일찍 도착`);
    if (Recur.isRepeating(d)) parts.push(Recur.label(d));
    parts.push(on ? `알림 ${on}개` : '알림 꺼짐');
    if (d.endBy) parts.push(`${d.endBy}에 끝남`);
    return parts.join(' · ');
  },

  ALARMS: [['nightBefore', '전날 밤 9시 미리 안내', '전날 밤'], ['wake', '기상 알람', '기상'], ['preDepart', '출발 10분 전 알림', '출발 10분 전'], ['depart', '출발 알람', '출발']],

  toggleMore() { this.more = !this.more; this.draw(); },

  moreBody() {
    const d = this.d, isTrip = Planner.isTrip(d.mode);
    const on = this.ALARMS.filter(([k]) => d.alarm[k]);
    return `
      <div class="more-body">
        <label class="lbl" for="rTitle">일정 이름 <small class="muted">비워 두면 목적지 이름으로 저장해요</small></label>
        <input class="input" id="rTitle" placeholder="${U.esc(this.autoTitle() || '예: 강남 거래처 미팅')}" value="${U.esc(d.title)}" oninput="Register.d.title=this.value">
        <div class="chips">${this.QUICK.map(q => `<button class="chip" onclick="Register.quick('${q}')">${q}</button>`).join('')}</div>
        ${isTrip ? `<label class="lbl" for="f-arriveBy">목적지 도착 희망 (선택)</label><input type="time" id="f-arriveBy" class="input" value="${d.arriveBy || ''}" onchange="Register.set('arriveBy',this.value)">` : `
        <div class="grid2 mt">
          <div><label class="lbl" for="f-endBy">끝나는 시간 (선택)</label><input type="time" id="f-endBy" class="input" value="${d.endBy || ''}" onchange="Register.setEnd(this.value)"></div>
          <div class="end-hint">다음 일정·귀가 시간을<br>계산할 때 써요</div>
        </div>`}
        ${isTrip ? `<label class="lbl">내린 뒤 갈 곳 (선택)</label><button class="input place-btn ${d.dest ? '' : 'empty'}" onclick="Register.pick('dest','목적지')">${U.icon('pin')} ${d.dest ? U.esc(d.dest.name) : '목적지 검색'}</button>` : ''}

        <div class="more-sec">어떻게 가세요?</div>
        <div class="modes">${Object.entries(Planner.MODES).map(([k, m]) =>
          `<button class="mode ${d.mode === k ? 'on' : ''}" onclick="Register.set('mode','${k}')">${U.modeIcon(k)}${m.label}</button>`).join('')}</div>
        <div id="routeBox">${this.routeBox()}</div>

        <div class="more-sec">준비는 얼마나 걸려요?</div>
        <div class="seg">${(d.chained || d.startNow ? [0, 20, 30, 45, 60, 90, 120] : [20, 30, 45, 60, 90, 120]).map(v => `<button class="${+d.prepMin === v ? 'on' : ''}" onclick="Register.set('prepMin',${v})">${v ? U.durLabel(v) : '바로 출발'}</button>`).join('')}</div>
        <label class="lbl">약속보다 몇 분 일찍 도착할까요?</label>
        <div class="seg">${[0, 5, 10, 20, 30].map(v => `<button class="${+d.bufferMin === v ? 'on' : ''}" onclick="Register.set('bufferMin',${v})">${v ? v + '분' : '없음'}</button>`).join('')}</div>
        <div id="f-repeat" class="${this.badCls('repeat') ? 'bad-box' : ''}">${this.repeatForm()}${this.errLine('repeat')}</div>

        <div class="more-sec">알림</div>
        ${this.alarmOpen
          ? this.ALARMS.map(([k, label]) => `<label class="toggle-row"><span>${label}</span><input type="checkbox" ${d.alarm[k] ? 'checked' : ''} onchange="Register.d.alarm['${k}']=this.checked;Register.refreshSummary()"></label>`).join('')
            + `<button class="link" onclick="Register.alarmOpen=false;Register.draw()">접기</button>`
          : `<div class="alarm-sum"><span>알림: ${on.length ? on.map(x => x[2]).join(' · ') : '모두 꺼짐'}</span><button class="link" onclick="Register.alarmOpen=true;Register.draw()">바꾸기</button></div>`}

        <label class="lbl" for="rMemo">메모</label>
        <textarea class="input" id="rMemo" rows="2" placeholder="챙길 것, 참고할 내용" oninput="Register.d.memo=this.value">${U.esc(d.memo || '')}</textarea>
      </div>`;
  },

  refreshSummary() {
    const el = document.querySelector('#moreHead small');
    if (el) el.textContent = this.summary();
  },

  /* ---------- 빠진 칸 표시: 화면을 그 칸으로 옮기고 빨간 테두리 + 설명 한 줄 ---------- */
  badCls(field) { return this.err && this.err.field === field ? 'bad' : ''; },
  errLine(field) { return this.err && this.err.field === field ? `<div class="field-err" role="alert">${U.esc(this.err.msg)}</div>` : ''; },
  fail(field, msg, inMore) {
    this.err = { field, msg };
    if (inMore) this.more = true;
    if (this.easy) EasyAdd.step = EasyAdd.stepFor(field);
    this.draw();
    const el = document.getElementById('f-' + field) || document.querySelector('.field-err');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (el.tagName === 'INPUT') setTimeout(() => { try { el.focus({ preventScroll: true }); } catch (e) {} }, 350);
    }
  },
  clearErr(field) { if (this.err && (!field || this.err.field === field)) this.err = null; },

  /** 이름이 비었을 때 쓸 이름: 목적지 이름 (기차·비행기는 도착역 + 수단) */
  autoTitle() {
    const d = this.d;
    if (Planner.isTrip(d.mode)) {
      const st = d.trip.arriveStation || d.dest || d.trip.departStation;
      const w = d.mode === 'flight' ? '비행기' : '기차';
      return st ? `${st.name} ${w}` : w;
    }
    return d.dest ? d.dest.name : '';
  },

  /* ---------- 지난번에 간 곳 3개 ---------- */
  recentPlaces() {
    const seen = new Set(), out = [];
    const list = State.schedules.filter(s => s.dest && !s._shared && !Planner.isTrip(s.mode))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const s of list) {
      const key = s.dest.name + '|' + Math.round(s.dest.lat * 1000) + '|' + Math.round(s.dest.lng * 1000);
      if (seen.has(key)) continue;
      seen.add(key); out.push(s);
      if (out.length >= 3) break;
    }
    return out;
  },

  recentChips() {
    const r = this.recentPlaces();
    if (!r.length) return '';
    return `<div class="recent"><div class="recent-lbl">지난번에 간 곳</div>${r.map(s => `
      <button class="recent-btn" onclick="Register.useRecent('${s.id}')">${U.modeIcon(s.mode)}<span><b>${U.esc(s.dest.name)}</b><small>${U.esc(Planner.MODES[s.mode] ? Planner.MODES[s.mode].label : '')} · 준비 ${U.durLabel(+s.prepMin || 0)}${s.title && s.title !== s.dest.name ? ' · ' + U.esc(s.title) : ''}</small></span></button>`).join('')}</div>`;
  },

  /** 지난번 그대로: 목적지·교통·준비 시간(+여유) 채우고 경로 다시 */
  useRecent(id) {
    const s = State.get(id);
    if (!s) return;
    const d = this.d;
    d.dest = { ...s.dest };
    d.mode = s.mode;
    if (!d.chained && !d.startNow) d.prepMin = s.prepMin;
    d.bufferMin = s.bufferMin;
    if (!d.title && s.title) d.title = s.title;
    d.route = null; this.opts = [];
    this.clearErr('dest');
    this.draw(); this.fetchRoutes();
  },

  /** 출발지 자동: 집이 없으면 지금 위치 (새 일정만) */
  autoOrigin() {
    const d = this.d;
    if (d.origin || this.editing || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      if (d !== this.d || d.origin) return;
      d.origin = { name: '지금 위치', address: '', lat: pos.coords.latitude, lng: pos.coords.longitude };
      this.clearErr('origin');
      this.draw(); this.fetchRoutes();
    }, () => {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  },

  /* ---------- 끝나고 집에 가는 길 · 막차 ---------- */
  HOME_MODES: ['transit', 'car', 'taxi', 'walk'],

  goHomeForm() {
    const d = this.d;
    if (Planner.isTrip(d.mode)) return '';
    const gh = d.goHome || {};
    const home = State.settings.home;
    const can = !!d.endBy && !!d.dest;
    let body = '';
    if (gh.on && can) {
      const r = gh.route;
      let plan = null;
      try { if (this.ready()) plan = Planner.compute(d); } catch (e) {}
      body = `
        <div class="seg">${this.HOME_MODES.map(k => `<button class="${(gh.mode || 'transit') === k ? 'on' : ''}" onclick="Register.setHome('mode','${k}')">${U.modeIcon(k)} ${Planner.MODES[k].label}</button>`).join('')}</div>
        <div class="gh-res">${this.homeLoading ? '🔎 집까지 경로를 찾는 중…'
          : r ? `${U.esc((d.dest && d.dest.name) || '')} → 집 <b>${U.durLabel(r.travelMin)}</b>${U.routeRest(r.summary) ? ` <small>${U.esc(U.routeRest(r.summary))}</small>` : ''}${plan && plan.homeAt ? `<br>${U.esc(d.endBy)}에 끝나면 <b>${U.hm(plan.homeAt)}</b> 집 도착` : ''}`
          : `<button class="link" onclick="Register.fetchHome()">🔎 집까지 경로 찾기</button>`}</div>
        ${(gh.mode || 'transit') === 'transit' ? `
          <div class="grid2 mt">
            <div><label class="lbl">막차 시간 (선택)</label><input type="time" class="input" value="${gh.lastTime || ''}" onchange="Register.setHome('lastTime',this.value)"></div>
            <div class="end-hint"><button class="link" style="padding:0" onclick="Register.checkLast()">🗺️ 카카오맵에서<br>막차 확인하기</button></div>
          </div>
          ${plan && plan.lastLeaveAt ? `<div class="gh-res">🚇 막차를 타려면 늦어도 <b>${U.hm(plan.lastLeaveAt)}</b>에 나서야 해요 · 15분 전에 알람</div>` : ''}` : ''}`;
    }
    return `<div class="card">
      <div class="q">끝나고 집에 갈 때</div>
      <label class="toggle-row"><span class="tr-2">집에 가는 시간도 알려 주기<small>${!d.endBy ? '위에서 끝나는 시간을 넣으면 켤 수 있어요' : !home ? '설정에서 집 주소를 넣으면 정확해요' : '일정이 끝나면 집 도착 시각과 함께 알려 드려요'}</small></span>
        <input type="checkbox" ${gh.on && can ? 'checked' : ''} ${can ? '' : 'disabled'} onchange="Register.toggleHome(this.checked)"></label>
      ${body}
    </div>`;
  },

  setEnd(v) {
    this.d.endBy = v;
    if (!v && this.d.goHome) this.d.goHome.on = false;
    this.draw();
  },

  toggleHome(on) {
    const d = this.d;
    d.goHome = { mode: d.mode === 'car' ? 'car' : 'transit', route: null, lastTime: '', ...(d.goHome || {}), on };
    this.draw();
    if (on && !d.goHome.route) this.fetchHome();
  },

  setHome(k, v) {
    const gh = this.d.goHome;
    gh[k] = v;
    this.draw();
    if (k === 'mode') { gh.route = null; this.fetchHome(); }
  },

  homePlace() {
    return State.settings.home || (this.d.chained ? null : this.d.origin);
  },

  async fetchHome() {
    const d = this.d, gh = d.goHome, home = this.homePlace();
    if (!gh || !d.dest) return;
    if (!home) return U.toast('설정에서 집 주소를 먼저 넣어 주세요.');
    this.homeLoading = true; this.draw();
    try {
      const list = await Routes.options(d.dest, home, gh.mode || 'transit', null);
      gh.route = list[0] || null;
      gh.to = { name: home.name, address: home.address || '', lat: home.lat, lng: home.lng };
    } catch (e) { U.toast('집까지 경로를 찾지 못했어요.'); }
    this.homeLoading = false;
    this.draw();
  },

  checkLast() {
    const home = this.homePlace();
    if (!this.d.dest || !home) return;
    Routes.openNav('kakao', 'transit', this.d.dest, home);
  },

  back() {
    const to = this.backTo;
    if (to && to.screen) return App.navigate(to.screen, to.params || {});
    if (this.editing && this.d) return App.navigate('timeline', { id: this.d.id });
    App.navigate('home');
  },

  /** 같은 날 앞 일정이 있으면 '그 장소에서 바로 출발' 버튼 */
  chainChips() {
    const d = this.d;
    if (!d || !d.date || typeof DayPlan === 'undefined' || Recur.isRepeating(d)) return ''; // 반복 전체에 적용되면 안 됨 (하루 동선에서 그날만)
    const mine = Planner.isTrip(d.mode) ? (d.trip.departTime || '23:59') : (d.arriveBy || '23:59');
    const before = State.byDate(d.date).filter(o => (o.baseId || o.id) !== d.id).map(o => ({ s: o, plan: Planner.compute(o) }))
      .filter(x => DayPlan.placeOf(x) && U.hm(DayPlan.startOf(x)) < mine && !DayPlan.near(DayPlan.placeOf(x), d.origin));
    if (!before.length) return '';
    return `<div class="chips">${before.slice(-2).map(x => `<button class="chip" onclick="Register.chainFrom('${x.s.occId || x.s.id}')">${U.icon('pin')} ${U.esc(DayPlan.placeOf(x).name)}에서 <small style="opacity:.7">(${U.esc(x.s.title)} 뒤)</small></button>`).join('')}</div>`;
  },

  chainFrom(occId) {
    const o = Recur.resolve(occId);
    const place = o && DayPlan.placeOf({ s: o });
    if (!place) return;
    this.applyChain(place, o.baseId || o.id);
    U.toast('앞 일정에서 바로 출발해요. 기상 알람 대신 출발 알람만 울려요');
    this.draw();
    this.fetchRoutes();
  },

  applyChain(place, fromId) {
    const d = this.d;
    d.origin = { name: place.name, address: place.address || '', lat: place.lat, lng: place.lng };
    d.chained = { from: fromId };
    d.prepMin = 0;
    d.alarm = { ...d.alarm, wake: false, nightBefore: false };
    d.route = null; d.accessRoute = null; this.opts = []; this.accessOpts = [];
  },

  /** 출발지를 직접 고르면 '이어서 출발'을 풀고 기본값으로 */
  /** 급한 약속: 지금 있는 곳(휴대폰 위치)에서 바로 출발 — 기상·준비·전날 안내 없이 출발 알람만 */
  startNow() {
    if (!navigator.geolocation) return U.toast('위치를 쓸 수 없어요. 출발지를 직접 골라 주세요.');
    U.toast('지금 위치를 찾는 중…');
    const d = this.d;
    navigator.geolocation.getCurrentPosition(pos => {
      if (d !== this.d) return;
      d.origin = { name: '지금 위치', address: '', lat: pos.coords.latitude, lng: pos.coords.longitude };
      delete d.chained;
      d.startNow = true;
      delete d.leftAt;
      d.prepMin = 0;
      d.alarm = { ...d.alarm, wake: false, nightBefore: false, depart: true };
      if (!d.date || d.date < U.today()) d.date = U.today();
      d.route = null; this.opts = []; this.taxiAlt = null;
      this.draw(); this.fetchRoutes();
    }, () => U.toast('위치 권한을 허용해 주세요. 또는 출발지를 직접 골라 주세요.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  },

  /** 앞 약속에서 바로 가지 않고 집에서 출발 (자동 연결 다시 안 함) */
  homeFirst() {
    const d = this.d, st = State.settings;
    this.unchain();
    d.homeFirst = true;
    d.origin = st.home ? { ...st.home } : d.origin;
    d.route = null; this.opts = [];
    this.draw(); this.fetchRoutes();
  },

  stopNow() {
    const d = this.d, st = State.settings;
    d.startNow = false;
    delete d.leftAt;
    d.origin = st.home ? { ...st.home } : null;
    d.prepMin = st.prepMin;
    d.alarm = { ...d.alarm, wake: st.alarm.wake, nightBefore: st.alarm.nightBefore };
    d.route = null; this.opts = []; this.taxiAlt = null;
    this.draw(); this.fetchRoutes();
  },

  unchain() {
    const d = this.d, st = State.settings;
    if (d.startNow) { d.startNow = false; delete d.leftAt; d.prepMin = st.prepMin; d.alarm = { ...d.alarm, wake: st.alarm.wake, nightBefore: st.alarm.nightBefore }; return; }
    if (!d.chained) return;
    delete d.chained;
    d.prepMin = st.prepMin;
    d.alarm = { ...d.alarm, wake: st.alarm.wake, nightBefore: st.alarm.nightBefore };
  },

  repeatForm() {
    const r = this.d.repeat;
    return `
      <label class="lbl">반복</label>
      <div class="seg wrap">${Object.entries(Recur.TYPES).map(([k, l]) => `<button class="${r.type === k ? 'on' : ''}" onclick="Register.setRepeat('type','${k}')">${l}</button>`).join('')}</div>
      ${r.type === 'weekly' ? `<div class="dow-pick">${U.DOW.map((n, i) => `<button class="${(r.days || []).includes(i) ? 'on' : ''} ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}" onclick="Register.toggleDay(${i})">${n}</button>`).join('')}</div>` : ''}
      ${r.type !== 'none' ? `
        <label class="toggle-row"><span>공휴일에는 쉬기</span><input type="checkbox" ${r.skipHolidays ? 'checked' : ''} onchange="Register.d.repeat.skipHolidays=this.checked;Register.refreshParts()"></label>
        <label class="lbl">반복 종료 <small class="muted">비우면 계속</small></label>
        <input type="date" class="input" value="${r.until || ''}" onchange="Register.d.repeat.until=this.value">
        <p class="muted small">반복 일정은 앞으로 2주치 알람을 자동으로 맞추고, 앱을 열 때마다 다음 회차를 이어서 예약해요.</p>` : ''}`;
  },

  setRepeat(k, v) {
    this.clearErr('repeat');
    const r = this.d.repeat;
    r[k] = v;
    if (k === 'type' && v === 'weekly' && !(r.days || []).length) r.days = [Planner.at(this.d.date, '12:00').getDay()];
    this.draw();
  },

  toggleDay(i) {
    this.clearErr('repeat');
    const r = this.d.repeat;
    r.days = (r.days || []).includes(i) ? r.days.filter(x => x !== i) : [...(r.days || []), i];
    this.draw();
  },

  tripForm() {
    const t = this.d.trip, isFlight = this.d.mode === 'flight';
    const word = isFlight ? '공항' : '역';
    return `
      <div class="sub">
        <label class="lbl">${isFlight ? '항공편' : '열차'} (선택)</label>
        <input class="input" placeholder="${isFlight ? '예: KE1203' : '예: KTX 101'}" value="${U.esc(t.number || '')}" oninput="Register.d.trip.number=this.value">
        <div class="grid2">
          <div><label class="lbl">출발 ${word}</label>
            <button class="input place-btn ${this.badCls('departStation')}" id="f-departStation" onclick="Register.pickTrip('departStation','출발 ${word}')">${t.departStation ? U.esc(t.departStation.name) : word + ' 검색'}</button>${this.errLine('departStation')}</div>
          <div><label class="lbl" for="f-departTime">출발 시각</label><input type="time" id="f-departTime" class="input ${this.badCls('departTime')}" value="${t.departTime || ''}" onchange="Register.setTrip('departTime',this.value)">${this.errLine('departTime')}</div>
          <div><label class="lbl">도착 ${word}</label>
            <button class="input place-btn" onclick="Register.pickTrip('arriveStation','도착 ${word}')">${t.arriveStation ? U.esc(t.arriveStation.name) : word + ' 검색'}</button></div>
          <div><label class="lbl">도착 시각</label><input type="time" class="input" value="${t.arriveTime || ''}" onchange="Register.setTrip('arriveTime',this.value)"></div>
        </div>
        ${isFlight ? `<label class="toggle-row"><span>국제선 (수속 ${Planner.MODES.flight.intlMarginMin}분 전 도착)</span><input type="checkbox" ${t.international ? 'checked' : ''} onchange="Register.setTrip('international',this.checked)"></label>` : ''}
        <label class="lbl">${word}까지 어떻게 가세요?</label>
        <div class="seg">${Planner.ACCESS_MODES.map(k => `<button class="${t.accessMode === k ? 'on' : ''}" onclick="Register.setTrip('accessMode','${k}')">${U.modeIcon(k)} ${Planner.MODES[k].label}</button>`).join('')}</div>
        <p class="muted small">${isFlight ? '항공 시간표는 항공사 앱' : '열차 시간표는 코레일톡·SRT 앱'}에서 예매한 시각을 그대로 넣어 주세요.</p>
      </div>`;
  },

  routeBox() {
    const d = this.d, isTrip = Planner.isTrip(d.mode);
    const from = d.origin, to = isTrip ? d.trip.departStation : d.dest;
    if (!from || !to) return `<p class="muted small" style="margin:12px 2px 0">출발지와 ${isTrip ? '출발 역·공항을' : '목적지를'} 고르면 경로와 시각을 계산해 드려요.</p>`;
    if (this.loading) return '<div class="muted pad">🔎 경로를 찾는 중…</div>';
    const list = isTrip ? this.accessOpts : this.opts;
    const chosen = isTrip ? d.accessRoute : d.route;
    if (!list.length && !chosen) return `<button class="btn ghost" onclick="Register.fetchRoutes()">🔎 경로 찾기</button>`;
    const shown = list.length ? list : [chosen];
    return `
      <label class="lbl" style="margin-top:16px">${isTrip ? (d.mode === 'flight' ? '공항' : '역') + '까지 ' : ''}경로 ${shown.length > 1 ? '· 하나를 고르세요' : ''}</label>
      ${shown.map((r, i) => `
        <button class="route-opt ${chosen && JSON.stringify(chosen.steps) === JSON.stringify(r.steps) ? 'on' : ''}" onclick="Register.chooseRoute(${i})">
          <div class="route-top"><b>${U.durLabel(r.travelMin)}</b><small>${U.esc(U.routeRest(r.summary))}</small>${r.source === 'estimate' ? '<span class="badge warn">추정</span>' : ''}</div>
          <div class="route-steps">${r.steps.filter(s => s.type !== 'walk' || s.min >= 3).map(s => `<span class="step ${s.type}">${U.modeIcon(s.type)} ${U.esc(s.type === 'walk' ? s.min + '분' : s.label.replace(/ \(또는.*\)/, ''))}</span>`).join('<i>›</i>')}</div>
        </button>`).join('')}
      <button class="link" onclick="Register.fetchRoutes()">↻ 다시 찾기</button>`;
  },

  preview() {
    const d = this.d;
    if (!this.ready()) return '';
    let plan;
    try { plan = Planner.compute(d); } catch (e) { return ''; }
    const now = Date.now(), trip = Planner.isTrip(d.mode);
    const travelMs = plan.arriveAt - plan.departAt;
    let nowBox = '';
    if (!trip && d.date === U.today() && d.arriveBy) {
      const due = Planner.at(d.date, d.arriveBy).getTime();
      const late = plan.departAt.getTime() < now;
      if (d.startNow || late) {
        const arriveNow = new Date(now + travelMs);
        const lateMin = Math.round((arriveNow.getTime() + (+d.bufferMin || 0) * 60000 - due) / 60000);
        const tx = this.taxiAlt;
        const txArrive = tx ? new Date(now + (Planner.totalMin(tx, 'taxi')) * 60000) : null;
        nowBox = `<div class="now-box ${late ? 'late' : ''}">
          <b>${late ? `지금 출발하면 ${U.hm(arriveNow)} 도착${lateMin > 0 ? ` · 약 ${lateMin}분 늦어요` : ''}` : `${U.hm(plan.departAt)}까지 출발하면 돼요 (${Math.max(0, Math.round((plan.departAt - now) / 60000))}분 남음)`}</b>
          ${late && txArrive && d.mode !== 'taxi' && txArrive < arriveNow ? `<span>🚕 택시면 ${U.hm(txArrive)} 도착 <button class="link" onclick="Routes.openNav('kakaot')">카카오T 부르기 ›</button></span>` : ''}
        </div>`;
      }
      // 이미 기상 시간이 지났는데 집에서 출발로 되어 있으면: 밖이냐고 물어봄
      if (!d.startNow && !d.chained && plan.wakeAt.getTime() < now) {
        nowBox = `<div class="now-ask"><span>기상 시간이 이미 지났어요. <b>지금 밖에 계세요?</b></span><button class="btn small primary" onclick="Register.startNow()">📍 지금 위치에서 출발</button></div>` + nowBox;
      }
    }
    return `
      ${nowBox}
      <div class="result">
        <div class="tri">
          ${plan.chained ? `<div class="on"><small>${d.startNow ? '지금 위치' : '앞 일정'}에서</small><b>바로</b></div>` : `<div class="on"><small>기상${U.hmRel(plan.wakeAt, d.date).startsWith('전날') ? ' · 전날' : ''}</small><b>${U.hm(plan.wakeAt)}</b></div>`}
          ${d.startNow && plan.departAt.getTime() < now
            ? `<div><small>출발</small><b>지금</b></div><div><small>도착 예상</small><b>${U.hm(new Date(now + travelMs))}</b></div>`
            : `<div><small>출발</small><b>${U.hm(plan.departAt)}</b></div>
          <div><small>${Planner.isTrip(d.mode) ? '탑승' : '도착'}</small><b>${Planner.isTrip(d.mode) ? d.trip.departTime : U.hm(plan.arriveAt)}</b></div>`}
        </div>
        ${plan.warnings.map(w => `<div class="warn-line">⚠️ ${U.esc(w)}</div>`).join('')}
      </div>`;
  },

  ready() {
    const d = this.d;
    if (Planner.isTrip(d.mode)) return d.origin && d.trip.departStation && d.trip.departTime && d.accessRoute;
    return d.origin && d.dest && d.arriveBy && d.route;
  },

  loadLine() {
    const d = this.d, isTrip = Planner.isTrip(d.mode);
    if (this.loading) return '<div class="muted pad">🔎 경로를 찾는 중…</div>';
    const from = d.origin, to = isTrip ? d.trip.departStation : d.dest;
    if (from && to && !this.ready()) return `<button class="btn ghost" onclick="Register.fetchRoutes()">🔎 경로 다시 찾기</button>`;
    return '';
  },

  refreshParts() {
    if (this.easy) return EasyAdd.refresh();
    const rb = document.getElementById('routeBox'), pv = document.getElementById('preview'), ll = document.getElementById('loadLine');
    if (rb) rb.innerHTML = this.routeBox();
    if (pv) pv.innerHTML = this.preview();
    if (ll) ll.innerHTML = this.loadLine();
    this.refreshSummary();
  },

  quick(q) {
    const el = document.getElementById('rTitle');
    this.d.title = this.d.title ? this.d.title : q;
    if (el) el.value = this.d.title;
    if (q === '출근' || q === '등교') {
      if (this.d.repeat.type === 'none') this.d.repeat = { type: 'weekdays', days: [], until: '', skipHolidays: true };
      this.set('arriveBy', '09:00');
    }
  },

  set(k, v) {
    this.d[k] = v;
    this.clearErr(k);
    if (k === 'mode') {
      this.opts = []; this.accessOpts = []; this.d.route = null; this.d.accessRoute = null;
      // 기차·비행기는 탑승 시각이 기준이라 '도착 희망'은 비워 둠 (넣으면 늦을 때 경고)
      if (Planner.isTrip(v) && !this.editing) this.d.arriveBy = '';
      else if (!Planner.isTrip(v) && !this.d.arriveBy) this.d.arriveBy = '09:00';
      this.draw();
      this.fetchRoutes();
      return;
    }
    if ((k === 'date' || k === 'arriveBy') && typeof DayPlan !== 'undefined' && DayPlan.chainBroken(this.d)) {
      // 앞 약속보다 이르게 바꿨으면 '이어서 출발'을 풀고 집에서 출발로 (기상 알람 복구)
      const st = State.settings;
      this.unchain();
      this.d.origin = st.home ? { ...st.home } : null;
      this.d.route = null; this.opts = [];
      U.toast('앞 일정보다 먼저라 집에서 출발로 바꿨어요');
      this.draw();
      return this.fetchRoutes();
    }
    if (k === 'date' || k === 'arriveBy') {
      // 자가용·택시는 도착 시각 기준 예측이라 다시 조회
      if (['car', 'taxi'].includes(this.d.mode)) { this.d.route = null; this.opts = []; return this.fetchRoutes(); }
    }
    this.draw();
  },

  setTrip(k, v) {
    this.d.trip[k] = v;
    this.clearErr(k);
    if (k === 'accessMode' || k === 'departTime') { this.d.accessRoute = null; this.accessOpts = []; this.draw(); return this.fetchRoutes(); }
    this.draw();
  },

  pick(field, title) {
    PlacePicker.open(title, p => {
      this.d[field] = p;
      this.clearErr(field); this.clearErr('route');
      this.d.route = null; this.d.accessRoute = null; this.opts = []; this.accessOpts = []; // 장소가 바뀌면 경로 새로
      if (field === 'origin') this.unchain();
      this.draw(); this.fetchRoutes();
      if (field === 'dest' && this.d.goHome && this.d.goHome.on) { this.d.goHome.route = null; this.fetchHome(); }
    });
  },
  pickTrip(field, title) {
    PlacePicker.open(title, p => {
      this.d.trip[field] = p;
      this.clearErr(field);
      if (field === 'departStation') { this.d.accessRoute = null; this.accessOpts = []; } else this.d.egressRoute = null;
      this.draw(); this.fetchRoutes();
    }, { allowHome: false });
  },

  chooseRoute(i) {
    if (Planner.isTrip(this.d.mode)) this.d.accessRoute = this.accessOpts[i] || this.d.accessRoute;
    else this.d.route = this.opts[i] || this.d.route;
    this.refreshParts();
  },

  /**
   * 경로 후보 찾기. keep: 이미 고른 경로가 있으면 그대로 두고 후보 목록만 채움 (수정 화면)
   * 늦게 도착한 이전 요청 결과(다른 일정·다른 수단)는 버림
   */
  async fetchRoutes({ keep = false } = {}) {
    const d = this.d;
    // 새 일정: 같은 날 앞 약속이 끝나고 바로면 그 장소에서 출발로 자동 연결
    if (!this.editing && typeof DayPlan !== 'undefined' && d.dest) {
      const prev = DayPlan.applyAuto(d);
      if (prev) { U.toast(`'${prev.s.title}' 끝나고 ${prev.place.name}에서 바로 출발로 맞췄어요`); this.draw(); }
    }
    const seq = this._seq = (this._seq || 0) + 1;
    const stale = () => seq !== this._seq || d !== this.d;
    const isTrip = Planner.isTrip(d.mode);
    const mode0 = d.mode, access0 = d.trip && d.trip.accessMode;
    const from = d.origin, to = isTrip ? d.trip.departStation : d.dest;
    if (!from || !to) return this.refreshParts();
    const same = (a, b) => a && b && JSON.stringify((a.steps || []).map(s => s.label)) === JSON.stringify((b.steps || []).map(s => s.label));
    const withChosen = (list, chosen) => (chosen && !list.some(r => same(r, chosen)) ? [chosen, ...list] : list);
    this.loading = true; this.refreshParts();
    try {
      if (isTrip) {
        const dep = d.trip.departTime ? Planner.at(d.date, d.trip.departTime) : null;
        const list = await Routes.options(from, to, access0, dep);
        let eg = null;
        if (d.trip.arriveStation && d.dest && !(keep && d.egressRoute)) eg = (await Routes.options(d.trip.arriveStation, d.dest, d.trip.egressMode || 'transit', null))[0] || null;
        if (stale() || d.mode !== mode0 || d.trip.accessMode !== access0) return;
        if (keep && d.accessRoute) this.accessOpts = withChosen(list, d.accessRoute);
        else { this.accessOpts = list; d.accessRoute = list[0] || null; }
        if (eg) d.egressRoute = eg;
        else if (!(d.trip.arriveStation && d.dest)) d.egressRoute = null;
      } else {
        const due = d.arriveBy ? Planner.at(d.date, d.arriveBy) : null;
        const list = await Routes.options(from, to, mode0, due);
        if (stale() || d.mode !== mode0) return;
        if (keep && d.route) this.opts = withChosen(list, d.route);
        else { this.opts = list; d.route = list[0] || null; }
        // 급한 약속이면 택시로 가면 언제 도착하는지도 (늦을 때 보여 줌)
        if (d.startNow && mode0 !== 'taxi' && d.date === U.today()) {
          Routes.options(from, to, 'taxi', due).then(t => { if (!stale()) { this.taxiAlt = t[0] || null; this.refreshParts(); } }).catch(() => {});
        }
      }
    } catch (e) {
      console.error(e);
      if (!stale()) U.toast('경로를 찾지 못했어요.');
    }
    if (stale()) return;
    this.loading = false;
    this.refreshParts();
  },

  async save() {
    if (this._saving) return;
    this._saving = true;
    const btn = document.getElementById('regSave');
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 알람 맞추는 중…'; }
    try { await this._save(); } finally {
      this._saving = false;
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
    }
  },

  async _save() {
    const d = this.d;
    this.err = null;
    d.title = (d.title || '').trim();
    if (Planner.isTrip(d.mode)) {
      if (!d.trip.departStation) return this.fail('departStation', `출발 ${d.mode === 'flight' ? '공항' : '역'}을 골라 주세요.`);
      if (!d.trip.departTime) return this.fail('departTime', '출발 시각을 넣어 주세요.');
    } else {
      if (!d.dest) return this.fail('dest', '어디로 가는지 골라 주세요. 위 칸을 누르면 검색할 수 있어요.');
      if (!d.arriveBy) return this.fail('arriveBy', '몇 시까지 도착해야 하는지 넣어 주세요.');
    }
    if (!d.origin) return this.fail('origin', '어디서 출발하는지 골라 주세요. 집 주소를 등록해 두면 자동으로 들어가요.');
    if (d.repeat.type === 'weekly' && !(d.repeat.days || []).length) return this.fail('repeat', '반복할 요일을 하나 이상 골라 주세요.', true);
    if (d.repeat.until && d.repeat.until < d.date) return this.fail('repeat', '반복 종료일이 시작일보다 빨라요. 날짜를 다시 골라 주세요.', true);
    // 이름이 비면 목적지 이름으로 (빠진 칸 검사를 다 통과한 뒤에만)
    if (!d.title) d.title = this.autoTitle() || '일정';
    // 반복이 아닌데 약속(탑승) 시각이 이미 지났으면 한 번 확인
    if (!Recur.isRepeating(d) && !d.startNow) {
      const at = Planner.at(d.date, Planner.isTrip(d.mode) ? d.trip.departTime : d.arriveBy);
      if (at.getTime() < Date.now() && !confirm('이미 지난 시간이에요. 알람은 울리지 않아요. 그래도 저장할까요?')) return;
    }
    if (!this.ready()) await this.fetchRoutes();
    if (!this.ready()) return this.fail('route', '경로를 찾지 못했어요. 인터넷 연결을 확인하고 아래 \'경로 다시 찾기\'를 눌러 주세요.');
    // 지금 위치에서 출발인데 원래 출발 시각이 이미 지났으면: 지금 나서는 것으로 기록 (화면·도착 예상이 지금 기준)
    if (d.startNow) {
      delete d.leftAt;
      try { if (Planner.compute(d).departAt.getTime() < Date.now()) d.leftAt = Date.now(); } catch (e) {}
    }
    d.updatedAt = Date.now();
    State.upsert(d);
    // 저장하자마자 날씨까지 반영해서 알람·안내 시각이 처음부터 맞도록
    await U.quickWeather();
    const list = await Alarm.rescheduleAll();
    const mine = list.filter(a => (a.s.baseId || a.s.id) === d.id);
    // 반복 일정이면 가장 가까운 회차로 이동
    const next = Recur.isRepeating(d) ? State.upcoming().find(x => x.s.baseId === d.id) : null;
    const goId = next ? next.s.occId : d.id;
    Saved.show(d, mine, () => App.navigate('timeline', { id: goId }));
    // 사이에 끼워 넣은 일정이면 다음 약속도 여기서 출발로 (기다리지 않음)
    if (typeof DayPlan !== 'undefined') DayPlan.rechainNext(d).then(async name => {
      if (!name) return;
      try { await Alarm.rescheduleAll(); } catch (e) {}
      U.toast(`다음 약속 '${name}'도 여기서 바로 출발로 바꿨어요`);
    }).catch(() => {});
  }
};

/* ---------- 문자로 등록: 붙여넣기 → 해석 → 미리보기 → 폼 채우기 ---------- */
const PasteImport = {
  result: null,

  open(text = '') {
    Sheet.open(`
      <div class="sheet-head"><b>받은 문자로 채우기</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <textarea id="pasteText" class="input paste-area" rows="6" placeholder="예) [코레일] 11월 5일 KTX 101열차 서울(08:00)→부산(10:40)&#10;예) [OO병원] 11월 6일 오후 2시 30분 진료 예약&#10;예) 내일 오전 10시 판교역 2번 출구에서 미팅"
        oninput="PasteImport.preview()">${U.esc(text)}</textarea>
      <div class="paste-row">
        <button class="btn" onclick="PasteImport.fromClipboard()">📋 복사한 내용 붙여넣기</button>
      </div>
      <div id="pastePreview" class="paste-preview"></div>
      <button id="pasteApply" class="btn primary big" onclick="PasteImport.apply()" disabled>이대로 채우기</button>
      <p class="muted small center">문자 내용은 휴대폰 안에서만 읽고 어디에도 보내지 않아요.</p>`);
    if (text) this.preview();
  },

  async fromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (!t) return U.toast('복사한 내용이 없어요.');
      document.getElementById('pasteText').value = t;
      this.preview();
    } catch (e) {
      U.toast('입력칸을 길게 눌러 붙여넣기 해 주세요.');
      document.getElementById('pasteText').focus();
    }
  },

  preview() {
    const text = document.getElementById('pasteText').value;
    const box = document.getElementById('pastePreview'), btn = document.getElementById('pasteApply');
    if (!text.trim()) { box.innerHTML = ''; btn.disabled = true; this.result = null; return; }
    const shared = Share.detect(text);
    if (shared) { Sheet.close(); return Share.openImport(shared); }
    const r = Parse.parse(text);
    this.result = r;
    const kindLbl = { train: '🚄 기차', flight: '✈️ 비행기', event: '📍 약속·예약' }[r.kind];
    const ok = r.found.length > 1 || (r.found.length === 1 && r.kind !== 'event');
    box.innerHTML = `
      <div class="pp-kind">${kindLbl}${r.title ? ' · <b>' + U.esc(r.title) + '</b>' : ''}</div>
      ${r.found.map(f => `<div class="pp-ok">✔ ${U.esc(/^\d{4}-\d{2}-\d{2}$/.test(f) ? U.dateLabel(f) : f)}</div>`).join('')}
      ${r.missing.map(f => `<div class="pp-miss">✎ ${U.esc(f)} — 채운 뒤 직접 골라 주세요</div>`).join('')}`;
    btn.disabled = !ok;
  },

  /** 역·공항·장소 이름 → 첫 검색 결과 (못 찾으면 null) */
  async lookup(q) {
    if (!q) return null;
    try {
      const list = await Routes.searchPlace(q);
      return list && list[0] ? list[0] : null;
    } catch (e) { return null; }
  },

  async apply() {
    const r = this.result;
    if (!r) return;
    const d = Register.d;
    Sheet.close();
    if (r.title) d.title = r.title;
    if (r.date) d.date = r.date;
    const unresolved = [];

    if (r.kind === 'train' || r.kind === 'flight') {
      d.mode = r.kind;
      d.arriveBy = '';
      d.route = null;
      d.trip = { ...d.trip, number: r.trip.number || '', departTime: r.trip.departTime || d.trip.departTime,
        arriveTime: r.trip.arriveTime || '', international: !!r.trip.international };
      U.toast('역·공항을 찾는 중…');
      const [from, to] = await Promise.all([this.lookup(r.trip.from), this.lookup(r.trip.to)]);
      d.trip.departStation = from || null;
      d.trip.arriveStation = to || null;
      if (r.trip.from && !from) unresolved.push(['departStation', r.trip.from, true]);
      if (r.trip.to && !to && r.kind === 'train') unresolved.push(['arriveStation', r.trip.to, true]);
      if (r.trip.seat) d.memo = [d.memo, `좌석 ${r.trip.seat}`].filter(Boolean).join('\n');
    } else {
      if (Planner.isTrip(d.mode)) d.mode = State.settings.defaultMode || 'transit';
      if (r.time) d.arriveBy = r.time;
      if (r.bufferMin) d.bufferMin = r.bufferMin;
      if (r.place) {
        U.toast('장소를 찾는 중…');
        const p = await this.lookup(r.place);
        if (p) d.dest = p; else unresolved.push(['dest', r.place, false]);
      }
    }
    Register.opts = []; Register.accessOpts = [];
    if (Register.easy) {
      // 쉬운 화면: 기차·비행기는 자세한 화면으로, 나머지는 채워진 만큼 다음 단계로
      if (Planner.isTrip(d.mode)) Register.easy = false;
      else EasyAdd.step = d.dest && d.arriveBy ? 3 : d.dest ? 2 : 1;
    }
    Register.draw();
    Register.fetchRoutes();

    // 못 찾은 장소는 검색어를 넣은 채로 장소 검색창을 열어 줌
    if (unresolved.length) {
      const [field, q, isTrip] = unresolved[0];
      PlacePicker.open(`'${q}' 장소 고르기`, p => {
        if (isTrip) d.trip[field] = p; else d[field] = p;
        Register.draw(); Register.fetchRoutes();
      }, { query: q.replace(/\s*\d+번 출구$/, ''), allowHome: false });
    } else {
      U.toast(r.missing.length ? `${r.missing.join('·')}만 확인해 주세요` : '문자 내용으로 채웠어요. 확인 후 저장하세요');
    }
  }
};
