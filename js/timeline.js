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

    // 실시간 교통을 반영했으면 그 시간으로 (시각 계산과 같은 숫자 — 2026-11-14 점검: 칩 38분 · 실제 계산 52분)
    const routeLeg = plan.route || (Planner.isTrip(s.mode) ? s.accessRoute : s.route);
    // 위 칸은 '약속' 시각, 여유를 뺀 실제 도착은 아래 줄에 따로 (홈·AI 카드와 같은 기준)
    const arriveNote = s.bufferMin ? `${U.hm(plan.arriveAt)} 도착 (${s.bufferMin}분 여유)` : `여유 0분`;
    const info = plan.chained ? [`📍 ${U.esc((s.origin && s.origin.name) || '앞 일정')}에서 바로`, arriveNote] : [`준비 ${s.prepMin}분`, arriveNote];
    if (routeLeg && routeLeg.travelMin) info.push(`${U.modeIcon(navMode)} ${U.durLabel(routeLeg.travelMin)}${routeLeg.summary && /환승|원/.test(routeLeg.summary) ? ' · ' + U.esc(U.routeRest(routeLeg.summary)) : ''}`);
    if (plan.homeAt) info.push(`🏠 ${U.hm(plan.homeAt)} 집 도착${plan.lastLeaveAt ? ` · 막차 ${U.esc(s.goHome.lastTime)}` : ''}`);
    if (Planner.isTrip(s.mode) && s.trip.number) info.push(`${U.modeIcon(s.mode)} ${U.esc(s.trip.number)}${s.trip.seat ? ' · ' + U.esc(s.trip.seat) : ''}`);
    App.setMain(`
      <header class="subhead"><button class="back" onclick="App.navigate('home')" aria-label="뒤로"></button><h1>일정</h1>
        ${s._shared ? '<span></span>' : `<button class="round-btn side" onclick="App.navigate('register',{id:'${s.baseId || s.id}',back:{screen:'timeline',params:{id:'${s.occId || s.id}'}}})" aria-label="수정">✏️</button>`}</header>

      ${s._shared ? `<div class="shared-bar">👨‍👩‍👧 <b>${U.esc(s._shared.from)}</b>님이 공유한 일정 · 내 폰에서도 알람이 울려요</div>` : ''}
      ${rep ? `
        <div class="repeat-bar">
          <span>🔁 ${U.esc(Recur.label(s))}${s.hasOverride ? ' · <b>이 날만 변경됨</b>' : ''}</span>
          <span class="rep-nav">
            <button onclick="Timeline.step(-1)" aria-label="이전 회차">‹</button>
            <button onclick="Timeline.step(1)" aria-label="다음 회차">›</button>
          </span>
        </div>` : ''}

      <div class="card next">
        <div class="lb"><span>${U.dateLabel(s.date)}${hol ? ` · ${hol}` : ''}</span><span>${U.modeIcon(s.mode)} ${m.label}</span></div>
        <div class="tt">${U.esc(s.title)}</div>
        <div class="tri">
          ${plan.chained ? `<div class="on"><small>출발</small><b>${U.hm(plan.departAt)}</b></div>
          <div><small>${Planner.isTrip(s.mode) ? '탑승' : '시작'}</small><b>${Planner.isTrip(s.mode) ? s.trip.departTime : s.arriveBy}</b></div>
          <div><small>끝</small><b>${s.endBy || '--:--'}</b></div>` : `<div class="on"><small>기상${U.hmRel(plan.wakeAt, s.date).startsWith('전날') ? ' · 전날' : ''}</small><b>${U.hm(plan.wakeAt)}</b></div>
          <div><small>출발</small><b>${U.hm(plan.departAt)}</b></div>
          <div><small>${Planner.isTrip(s.mode) ? '탑승' : '약속'}</small><b>${Planner.isTrip(s.mode) ? s.trip.departTime : s.arriveBy}</b></div>`}
        </div>
        <div class="info">${info.map(t => `<span>${t}</span>`).join('')}</div>
      </div>

      ${(() => { const n = State.byDate(s.date).length; return n > 1 ? `<button class="notice" onclick="App.navigate('day',{date:'${s.date}',from:'timeline:${U.esc(s.occId || s.id)}'})">${Icons.svg('calendar')} 이 날 일정 ${n}개 · 하루 동선 보기</button>` : ''; })()}
      ${plan.weather ? `<div class="note">${U.esc(Weather.label(plan))}</div>` : ''}
      ${Planner.rideFor(s) ? `<div class="note live">🚌 ${U.esc(Live.rideLabel(s))}</div>` : (Planner.rideLeg(s) && Routes.proxy() && !s.alarmOff ? `<div class="note dim">🚌 출발 1시간 전부터 실시간 버스 위치로 타는 시간을 다시 계산해요</div>` : '')}
      ${plan.live ? `<div class="note live">📡 ${U.esc(Live.label(s))}</div>` : (Planner.liveLeg(s) && Routes.can('tmap') && !s.alarmOff ? `<div class="note dim">📡 기상 20분 전·출발 30분 전에 실시간 교통으로 다시 계산해요</div>` : '')}
      ${plan.warnings.map(w => `<div class="note">⚠️ ${U.esc(w)}</div>`).join('')}
      <div id="busCard"></div>

      <div class="card" style="padding:12px 18px">
        <div class="tl">
          ${plan.items.map(it => `
            <div class="tl-item ${it.kind} ${it.at.getTime() < now ? 'past' : ''}">
              <div class="tl-time">${U.hm(it.at)}</div>
              <div class="tl-dot"></div>
              <div class="tl-body"><b>${U.esc(it.title)}</b>${it.detail ? `<small>${U.esc(it.detail)}</small>` : ''}
                ${it.step && it.step.way ? `<small>${U.esc(it.step.way)} 방면</small>` : ''}</div>
            </div>`).join('')}
        </div>
      </div>

      <div class="nav-btns">
        <button class="btn" onclick="Timeline.nav('kakaomap')">🗺️ 카카오맵 경로</button>
        ${navMode === 'taxi' ? `<button class="btn primary" onclick="Routes.openNav('kakaot')">카카오T 부르기</button>` : `<button class="btn primary" onclick="Timeline.nav('${['car'].includes(navMode) ? 'tmap' : 'kakaomap'}')">${navMode === 'car' ? '티맵 길안내' : '길안내 시작'}</button>`}
      </div>
      ${plan.homeAt && s.dest && s.goHome && s.goHome.to ? `<button class="btn ghost full-w" style="margin:-4px 0 12px" onclick="Timeline.navHome()">🏠 끝나고 집으로 길안내 (${U.esc(Planner.MODES[s.goHome.mode || 'transit'].label)})</button>` : ''}

      ${this.packCard(s, plan)}

      ${s.memo ? `<div class="card"><div class="q">메모</div><div style="color:var(--ink-2)">${U.esc(s.memo).replace(/\n/g, '<br>')}</div></div>` : ''}

      <div class="card">
        <label class="toggle-row" style="padding-top:0"><span>${Icons.svg('bell')} ${rep ? '이 반복 일정 알람' : '이 일정 알람'}</span><input type="checkbox" ${s.alarmOff ? '' : 'checked'} onchange="Timeline.toggleAlarm(this.checked)"></label>
        <div id="alarmList"></div>
      </div>

      ${rep && !s._shared ? `
        <div class="card">
          <div class="q">이 날만</div>
          <div class="grid2 gap">
            <button class="btn ghost" onclick="Timeline.changeDay()">⏱ 시간 바꾸기</button>
            <button class="btn ghost" onclick="Timeline.skipDay()">⏭ 건너뛰기</button>
          </div>
          ${s.hasOverride ? `<button class="link" onclick="Timeline.resetDay()">↺ 이 날 변경 되돌리기</button>` : ''}
          ${this.skippedList()}
        </div>` : ''}

      <div class="actions">
        <button class="btn ghost" onclick="Timeline.refresh()">↻ 실시간으로 다시 계산</button>
      </div>
      <div class="actions">
        <button class="btn ghost" onclick="Share.send('${U.esc(s.occId || s.id)}')">📤 카톡으로 보내기</button>
        ${!s._shared && Cloud.isSignedIn() ? `<button class="btn ghost" onclick="Timeline.familyShare()">👨‍👩‍👧 가족 공유${(Cloud.sharedTargets(s.baseId || s.id).length ? ' · ' + Cloud.sharedTargets(s.baseId || s.id).length + '명' : '')}</button>` : ''}
      </div>
      ${s._shared ? `
      <div class="actions">
        <button class="btn ghost danger" onclick="Timeline.declineShared()">공유 그만 받기</button>
      </div>` : `
      <div class="actions">
        <button class="btn ghost danger" onclick="Timeline.remove()">삭제</button>
        <button class="btn ghost" onclick="App.navigate('register',{id:'${s.baseId || s.id}',back:{screen:'timeline',params:{id:'${s.occId || s.id}'}}})">${rep ? '반복 전체 수정' : '수정'}</button>
      </div>`}
    `);
    this.showAlarms(s, plan);
    Bus.renderInto('busCard', s, plan);
  },

  /** 🎒 챙길 것 카드 */
  navHome() {
    const s = this.cur();
    if (!s || !s.goHome || !s.goHome.to) return;
    const m = s.goHome.mode || 'transit';
    if (m === 'taxi') return Routes.openNav('kakaot');
    Routes.openNav(m === 'car' ? 'tmap' : 'kakaomap', m, s.dest, s.goHome.to);
  },

  packCard(s, plan) {
    const list = Pack.list(s, plan);
    const left = list.filter(x => !x.done).length;
    const ro = !!s._shared;
    return `
      <div class="card pack">
        <div class="ct"><b>🎒 챙길 것</b><span>${list.length ? (left ? `${left}개 남음` : '다 챙겼어요') : ''}</span></div>
        ${list.length ? list.map(x => `
          <div class="pk-row ${x.done ? 'done' : ''}">
            <button class="pk-check" ${ro ? 'disabled' : ''} onclick="Timeline.packToggle(${U.esc(JSON.stringify(x.name))})" aria-label="${U.esc(x.name)} 챙김">${x.done ? '✓' : ''}</button>
            <span class="pk-name">${U.esc(x.name)}${x.auto ? '<small>자동</small>' : ''}</span>
            ${ro ? '' : `<button class="pk-del" onclick="Timeline.packRemove(${U.esc(JSON.stringify(x.name))},${x.auto})" aria-label="빼기">✕</button>`}
          </div>`).join('') : '<div class="empty-line">챙길 것이 없어요. 필요한 걸 적어 두면 알림에 같이 알려 드려요.</div>'}
        ${ro ? '' : `<div class="pk-add"><input id="pkInput" class="input" placeholder="예: 도장, 서류 봉투" maxlength="30" enterkeyhint="done" onkeydown="if(event.key==='Enter'){Timeline.packAdd()}"><button class="btn primary" onclick="Timeline.packAdd()">추가</button></div>`}
        <p class="muted small" style="margin:10px 0 0">전날 밤 안내와 기상 알람에 안 챙긴 것을 같이 알려 드려요.</p>
      </div>`;
  },
  async packToggle(name) {
    const s = this.cur(), b = this.base();
    Pack.toggle(b, s.date, name);
    State.upsert(b);
    this.render();
    Alarm.rescheduleAll(); // 알림 문구의 '챙길 것' 갱신
  },
  async packAdd() {
    const el = document.getElementById('pkInput');
    const b = this.base();
    if (!el || !Pack.addItem(b, el.value)) return;
    State.upsert(b);
    this.render();
    Alarm.rescheduleAll();
    setTimeout(() => document.getElementById('pkInput')?.focus(), 50);
  },
  async packRemove(name, wasAuto) {
    const b = this.base();
    Pack.removeItem(b, name, wasAuto);
    State.upsert(b);
    this.render();
    Alarm.rescheduleAll();
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
      ? list.map(a => `<div class="al-row"><span class="al-day">${a.at.getMonth() + 1}/${a.at.getDate()} ${U.hm(a.at)}</span>
          <span class="grow">${U.esc(a.title.replace(/ — .*/, '').replace(/^[^\w가-힣]+/u, ''))}${a.alarm ? ' · 전체 화면' : ''}</span></div>`).join('')
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
      <div class="sheet-head"><b>${U.dateLabel(s.date).split(' · ')[0]}만 바꾸기</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
      ${isTrip ? '' : `<label class="lbl">도착 시간</label><input type="time" id="ovArrive" class="input" value="${s.arriveBy}">`}
      <label class="lbl">준비 시간 (분)</label><input type="number" id="ovPrep" class="input" inputmode="numeric" min="0" max="300" value="${s.prepMin}">
      <label class="lbl">여유 시간 (분)</label><input type="number" id="ovBuffer" class="input" inputmode="numeric" min="0" max="300" value="${s.bufferMin}">
      <button class="btn primary big" style="margin-top:16px" onclick="Timeline.saveDay()">이 날만 적용</button>`);
  },

  async saveDay() {
    const s = this.cur(), b = this.base();
    const ov = {};
    const a = document.getElementById('ovArrive');
    if (a && a.value && a.value !== b.arriveBy) ov.arriveBy = a.value;
    const p = parseInt(document.getElementById('ovPrep').value, 10);
    const f = parseInt(document.getElementById('ovBuffer').value, 10);
    const bad = v => !isNaN(v) && (v < 0 || v > 300);
    if (bad(p) || bad(f)) return U.toast('준비·여유 시간은 0~300분 사이로 넣어 주세요.');
    if (!isNaN(p) && p !== +b.prepMin) ov.prepMin = Math.max(0, p);
    if (!isNaN(f) && f !== +b.bufferMin) ov.bufferMin = Math.max(0, f);
    // 시간을 앞 일정보다 이르게 바꿨으면 이 날만 '이어서 출발'을 풀고 집에서 출발로
    const occ = { ...s, ...ov };
    if (s.chained && typeof DayPlan !== 'undefined' && DayPlan.chainBroken(occ)) {
      Object.assign(ov, await DayPlan.unchainPatch(occ));
      U.toast('앞 일정보다 먼저라 이 날은 집에서 출발로 바꿨어요');
    }
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
        const real = r.filter(x => x.source !== 'estimate');
        if (!real.length) throw new Error('offline');
        b.accessRoute = this.keepSimilar(b.accessRoute, real);
      } else {
        const r = await Routes.options(s.origin, s.dest, s.mode, Planner.at(s.date, s.arriveBy));
        const real = r.filter(x => x.source !== 'estimate');
        if (!real.length) throw new Error('offline');
        b.route = this.keepSimilar(b.route, real);
      }
      State.upsert(b);
      await Alarm.rescheduleAll();
      const after = Planner.compute(this.cur()).departAt;
      const diff = Math.round((before - after) / 60000);
      U.toast(diff > 0 ? `${diff}분 일찍 출발해야 해요. 알람을 당겼어요.` : diff < 0 ? `${-diff}분 늦게 출발해도 돼요.` : '변동 없어요.');
    } catch (e) {
      U.toast(navigator.onLine === false || e.message === 'offline' ? '인터넷 연결 후 다시 시도해 주세요. 원래 경로와 알람은 그대로예요.'
        : Routes.can('tmap') ? '경로를 확인하지 못했어요. 원래 알람은 그대로예요.' : '티맵 키가 있어야 실시간 교통을 확인할 수 있어요.');
    }
    this.render();
  },

  // 사용자가 골랐던 노선과 같은 노선이 있으면 그걸 유지
  keepSimilar(prev, list) {
    if (!prev) return list[0];
    const sig = r => r.steps.filter(x => x.type !== 'walk').map(x => x.label).join('|');
    return list.find(r => sig(r) === sig(prev)) || list[0];
  },

  /** 이 일정을 가족 누구에게 공유할지 고르기 */
  async familyShare() {
    const s = this.base();
    if (!Cloud.families.length) { try { await Cloud.loadFamilies(); } catch (e) {} }
    const people = Cloud.familyPeople();
    if (!people.length) {
      Sheet.open(`<div class="sheet-head"><b>가족 공유</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
        <p>아직 가족이 없어요. <b>설정 &gt; 가족</b>에서 가족을 만들고 초대 코드를 보내 주세요.</p>
        <button class="btn primary big" onclick="Sheet.close();App.navigate('settings')">가족 만들러 가기</button>`);
      return;
    }
    const on = Cloud.sharedTargets(s.id);
    Sheet.open(`
      <div class="sheet-head"><b>누구 폰에서 알람이 울릴까요?</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
      <p class="muted small">고른 가족의 폰에도 이 일정과 기상·출발 알람이 들어가요. 고치면 가족 폰에도 반영돼요.</p>
      ${people.map(p => `<label class="toggle-row"><span>${U.esc(p.display_name || '가족')} <small class="muted">${U.esc(p.family)}</small></span>
        <input type="checkbox" class="fs-pick" value="${p.user_id}" ${on.includes(p.user_id) ? 'checked' : ''}></label>`).join('')}
      <button class="btn primary big" style="margin-top:14px" onclick="Timeline.saveFamilyShare()">저장</button>
      <p class="muted small center">가족 폰은 마이플래너를 열 때 일정을 받아요.</p>`);
  },

  async saveFamilyShare() {
    const s = this.base();
    const picks = [...document.querySelectorAll('.fs-pick:checked')].map(x => x.value);
    try {
      await Cloud.setShares(s.id, picks);
      Sheet.close();
      U.toast(picks.length ? `${picks.length}명에게 공유했어요` : '공유를 껐어요');
      this.render();
    } catch (e) { U.toast('공유하지 못했어요: ' + e.message); }
  },

  async declineShared() {
    const s = this.base();
    if (!confirm(`${s._shared.from}님이 공유한 이 일정을 그만 받을까요? 내 폰에서 알람이 울리지 않아요.`)) return;
    try { await Cloud.declineShare(s); U.toast('공유를 그만 받아요'); App.navigate('home'); }
    catch (e) { U.toast('처리하지 못했어요: ' + e.message); }
  },

  async remove() {
    const s = this.cur(), b = this.base();
    if (Recur.isRepeating(s)) {
      Sheet.open(`
        <div class="sheet-head"><b>반복 일정 삭제</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
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
    const bak = JSON.parse(JSON.stringify(this.base()));
    State.remove(bak.id);
    await Alarm.rescheduleAll();
    App.navigate('home');
    // 잘못 눌렀을 때 5초 안에 되살리기 (알람도 다시 맞춤)
    U.undoBar('삭제했어요', async () => {
      if (State.get(bak.id)) return;
      State.upsert(bak);
      await Alarm.rescheduleAll();
      U.toast('일정을 되살렸어요. 알람도 다시 맞췄어요');
      App.navigate('timeline', { id: bak.id });
    });
  }
};

const Settings = {
  setTextSize(k) {
    State.settings.textSize = k;
    State.save();
    App.applyTextSize();
    const y = window.scrollY;
    this.render();
    window.scrollTo(0, y);
  },

  render() {
    const st = State.settings;
    const keys = [['ROUTE_PROXY_URL', '경로 서버 주소 (Supabase 함수 URL)'], ['SUPABASE_ANON_KEY', 'Supabase 공개 키 (anon)'], ['SUPABASE_URL', 'Supabase 주소 (비우면 경로 서버 주소에서 자동)'], ['ODSAY_API_KEY', 'ODsay 키 (버스·지하철)'], ['TMAP_APP_KEY', '티맵 앱키 (자가용·도보·장소)'], ['KAKAO_REST_KEY', '카카오 REST 키 (장소 검색)']];
    const reps = State.repeating();
    App.setMain(`
      <div class="profile-head">
        <div class="profile-av">${st.name ? U.esc(st.name.length >= 3 ? st.name.slice(-2) : st.name) : Icons.svg('smile')}</div>
        <div><small>마이</small><div class="profile-name">${st.name ? U.esc(st.name) + '님' : '마이플래너'}</div></div>
      </div>
      <div class="pro-card"><div><small>내 이용권 · ${Pro.tier() === 'free' && Pro.promo() ? '출시 기념 무료' : { free: '무료', plus: '플러스', premium: '프리미엄' }[Pro.tier()]}</small><b>${Pro.tier() === 'premium' ? '광고 없이 AI 비서까지 쓰는 중' : Pro.tier() === 'plus' ? '광고 없이 쓰는 중' : Pro.promo() ? `${Pro.promoText()}까지 모든 기능 무료` : '플러스 1,900원 · 프리미엄 4,900원'}</b></div><button onclick="App.navigate('pro')">${Pro.tier() === 'free' ? '이용권 보기' : '관리'}</button></div>
      <button class="pt-mine" onclick="App.navigate('points')"><span><small>내 포인트</small><b>${Points.available() ? `<span data-points>${Points.balance().toLocaleString()}</span> P` : '<span class="pt-off">로그인하면 쌓여요</span>'}</b></span><span class="pt-mine-go">${Points.meta().attended_today ? '포인트 · 럭키드로우' : '출석 체크하기'}</span></button>

      <div class="card">
        <label class="lbl q-lbl">이름</label>
        <input class="input" maxlength="20" value="${U.esc(st.name)}" onchange="State.settings.name=this.value.trim().slice(0,20);State.save()">
        <label class="lbl q-lbl">집 <small>기본 출발지</small></label>
        <button class="input place-btn ${st.home ? '' : 'empty'}" onclick="Settings.pickHome()">${U.icon('home')} ${st.home ? U.esc(st.home.name) : '집 주소 검색'}</button>
        ${(() => { const w = AutoNav.homeWin(); const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
          const sel = (k, v) => `<select class="input hw-sel" onchange="Settings.setHomeWin('${k}', this.value)" ${w.on ? '' : 'disabled'}>${hours.map(t => `<option value="${t}" ${t === v ? 'selected' : ''}>${+t.slice(0, 2) < 12 ? '오전' : '오후'} ${(+t.slice(0, 2)) % 12 || 12}시</option>`).join('')}</select>`;
          return `<label class="lbl">홈에 '집으로' 버튼 보이는 시간</label>
          <div class="seg">${[[true, '켜기'], [false, '끄기']].map(([v, l]) => `<button class="${w.on === v ? 'on' : ''}" onclick="Settings.setHomeWin('on', ${v})">${l}</button>`).join('')}</div>
          <div class="hw-row"><div class="hw-pair">${sel('from', w.from)}<span>부터</span></div><div class="hw-pair">${sel('to', w.to)}<span>까지</span></div></div>
          <p class="muted small" style="margin:8px 0 0">이 시간에 홈 맨 위에 '집으로'가 떠요. 누르면 지금 있는 곳에서 집까지 바로 내비가 켜져요.</p>`; })()}
      </div>

      <div class="card" id="cloudCard"></div>

      <div class="card" id="alarmCheck">
        <label class="lbl q-lbl">알람 점검</label>
        <div class="muted small">확인 중…</div>
      </div>

      ${reps.length ? `
        <div class="card">
          <label class="lbl">반복 일정</label>
          ${reps.map(s => `<button class="row flat" onclick="App.navigate('register',{id:'${s.id}',back:{screen:'settings'}})">
            <div class="row-ic">🔁</div>
            <div class="row-main"><b>${U.esc(s.title)}</b><small>${U.esc(Recur.label(s))} · ${Planner.isTrip(s.mode) ? s.trip.departTime + ' 출발' : s.arriveBy + ' 도착'}</small></div>
            <div class="row-side">›</div></button>`).join('')}
        </div>` : ''}

      <button class="card row flat an-entry" onclick="AutoNav.openGuide()">
        <div class="row-ic">🚗</div>
        <div class="row-main"><b>차에 타면 자동 길안내</b><small>차와 연결되면 지금 갈 곳으로 내비가 켜져요</small></div>
        <div class="row-side">›</div></button>

      <div class="card">
        <label class="lbl q-lbl">글자 크기</label>
        <div class="seg text-size">${[['normal', '보통'], ['large', '크게'], ['xlarge', '아주 크게']].map(([k, l]) =>
          `<button class="${(st.textSize || 'normal') === k ? 'on' : ''} ts-${k}" onclick="Settings.setTextSize('${k}')">${l}</button>`).join('')}</div>
        <p class="muted small" style="margin:10px 0 0">글자와 버튼이 함께 커져요.</p>
      </div>

      <div class="card">
        <label class="lbl q-lbl">기본 이동수단</label>
        <div class="seg wrap">${['transit', 'car', 'taxi', 'walk'].map(k => `<button class="${st.defaultMode === k ? 'on' : ''}" onclick="Settings.set('defaultMode','${k}')">${U.modeIcon(k)} ${Planner.MODES[k].label}</button>`).join('')}</div>
        <label class="lbl">기본 준비 시간</label>
        <div class="seg">${[20, 30, 45, 60, 90, 120].map(v => `<button class="${+st.prepMin === v ? 'on' : ''}" onclick="Settings.set('prepMin',${v})">${U.durLabel(v)}</button>`).join('')}</div>
        <label class="lbl">기본 여유 시간</label>
        <div class="seg">${[0, 5, 10, 20, 30].map(v => `<button class="${+st.bufferMin === v ? 'on' : ''}" onclick="Settings.set('bufferMin',${v})">${v ? v + '분' : '없음'}</button>`).join('')}</div>
      </div>

      <div class="card">
        <label class="lbl q-lbl">새 일정의 기본 알림</label>
        ${[['nightBefore', '전날 밤 9시 미리 안내'], ['wake', '기상 알람 (전체 화면)'], ['preDepart', '출발 1시간·10분 전'], ['depart', '출발 알람 (전체 화면)']].map(([k, l]) => `
          <label class="toggle-row"><span>${l}</span><input type="checkbox" ${st.alarm[k] ? 'checked' : ''} onchange="State.settings.alarm['${k}']=this.checked;State.save()"></label>`).join('')}
        <button class="btn ghost" onclick="Settings.test()">🔊 알람 미리 듣기</button>
      </div>

      ${this.devOn() ? `<details class="card">
        <summary class="lbl">개발자 설정 (API 키 테스트)</summary>
        <p class="muted small">경로 서버 주소를 넣으면 키 없이 서버가 대신 조회해요(권장). 출시 버전은 js/config.js 값을 써요. 여기 넣은 값은 이 기기에서만 우선 적용돼요.</p>
        ${keys.map(([k, l]) => `<label class="lbl">${l}</label>
          <input class="input mono" value="${U.esc(localStorage.getItem('mp_key_' + k) || '')}" placeholder="${this.keySource(k)}"
            onchange="Settings.setKey('${k}',this.value)">`).join('')}
        <button class="btn ghost" onclick="Settings.devToggle(false)">개발자 설정 숨기기</button>
      </details>` : ''}

      <div class="card">
        <label class="lbl">예시 일정</label>
        <p class="muted small" style="margin-top:0">병원(버스·지하철·비 예보), 평일 출근(자가용·실시간 교통), 부산 출장(KTX) 일정으로 기능을 둘러볼 수 있어요. 서버에는 올라가지 않아요.</p>
        ${Demo.has() ? `<button class="btn ghost" onclick="Demo.remove()">예시 일정 지우기</button>` : `<button class="btn ghost" onclick="Demo.add()">${Icons.svg('sparkles')} 예시 일정 3개 넣기</button>`}
      </div>

      <div class="card">
        <button class="btn ghost danger" onclick="Settings.reset()">모든 일정 지우기</button>
        <p class="muted small center"><a href="privacy.html" target="_blank">개인정보처리방침</a> · <a href="terms.html" target="_blank">이용약관</a><br><span onclick="Settings.devTap()">마이플래너 v1.0</span></p>
      </div>
    `);
    this.alarmCheck();
    this.cloudCard();
  },

  /** 개발자 설정: 평소엔 숨김, 버전 글자를 7번 누르면 보임 */
  devOn() { try { return localStorage.getItem('mp_dev') === '1'; } catch (e) { return false; } },
  devTap() {
    this._devTaps = (this._devTaps || 0) + 1;
    clearTimeout(this._devT); this._devT = setTimeout(() => { this._devTaps = 0; }, 3000);
    if (this._devTaps >= 7) { this._devTaps = 0; this.devToggle(true); }
  },
  devToggle(on) {
    try { on ? localStorage.setItem('mp_dev', '1') : localStorage.removeItem('mp_dev'); } catch (e) {}
    U.toast(on ? '개발자 설정을 켰어요' : '개발자 설정을 숨겼어요');
    this.render();
  },
  /** 입력칸에 보여 줄 '지금 어떤 값을 쓰는지' */
  keySource(k) {
    let local = '';
    try { local = localStorage.getItem('mp_key_' + k) || ''; } catch (e) {}
    if (local) return '이 기기에 넣은 값 사용 중';
    if (window.APP_CONFIG && window.APP_CONFIG[k]) return 'config.js 값 사용 중';
    if (window.APP_DEFAULTS && window.APP_DEFAULTS[k]) return '기본 서버 값 사용 중';
    if (/ODSAY|TMAP|KAKAO/.test(k) && Routes.proxy()) return '비어 있음 → 경로 서버가 대신 조회';
    return '비어 있음 → 추정치 사용';
  },

  /** 로그인 · 동기화 · 가족 */
  cloudCard() {
    const el = document.getElementById('cloudCard');
    if (!el) return;
    if (!Cloud.isConfigured()) {
      el.innerHTML = `<label class="lbl">로그인 · 가족 공유</label><p class="muted small">서버 연결을 준비하고 있어요. 준비되면 여기서 로그인할 수 있어요.</p>`;
      return;
    }
    if (!Cloud.isSignedIn()) {
      el.innerHTML = `<label class="lbl">로그인 · 가족 공유</label>
        <p class="small">로그인하면 폰을 바꿔도 일정이 그대로고, <b>가족 폰에 내 일정 알람</b>을 보낼 수 있어요. (예: 엄마 병원 일정을 등록하면 엄마 폰에서 알람)</p>
        <button class="btn kakao big" onclick="Cloud.signInKakao()">카카오로 시작하기</button>`;
      return;
    }
    const st = { synced: '✅ 동기화됨', syncing: '⏳ 맞추는 중…', offline: '📴 오프라인', error: '⚠️ 동기화 오류', no_server: '🛠 서버 준비 중 (가족 공유 테이블 설정 필요)' }[Cloud.status] || '';
    const last = +localStorage.getItem(Cloud.LAST_KEY);
    const fams = Cloud.families;
    el.innerHTML = `
      <label class="lbl">계정</label>
      <div class="row-between"><div class="grow"><b>${U.esc(Cloud.myName())}</b> <small class="muted">카카오</small><br><small class="muted">${st}${last ? ' · ' + U.hm(new Date(last)) : ''}</small></div>
        <button class="btn small" onclick="Cloud.sync().catch(()=>U.toast('지금은 맞추지 못했어요. 잠시 뒤 다시 눌러 주세요.'))">지금 맞추기</button></div>
      <label class="lbl">가족</label>
      ${fams.length ? fams.map(f => `
        <div class="fam">
          <div class="row-between"><b>${U.esc(f.name)}</b><button class="link" onclick="Settings.leaveFamily('${f.id}')">나가기</button></div>
          <div class="chips">${f.members.map(m => `<span class="chip">${m.user_id === Cloud.userId() ? '나' : U.esc(m.display_name || '가족')}${m.role === 'owner' ? ' 👑' : ''}</span>`).join('')}</div>
          <button class="btn ghost" onclick="Settings.sendInvite('${f.id}')">초대 코드 <b class="mono">${f.invite_code}</b> 보내기</button>
        </div>`).join('') : `<p class="muted small">가족을 만들고 초대 코드를 보내면, 서로 일정 알람을 보낼 수 있어요.</p>`}
      <div class="grid2 gap">
        <button class="btn ghost" onclick="Settings.newFamily()">＋ 가족 만들기</button>
        <button class="btn ghost" onclick="Settings.joinFamily()">코드로 참여</button>
      </div>
      <div class="row-between"><button class="link" onclick="Settings.signOut()">로그아웃</button>
        <button class="link danger-link" onclick="Settings.deleteData()">서버 데이터 삭제</button></div>`;
  },

  async newFamily() {
    const name = prompt('가족 이름 (예: 우리 집, 부모님)', '우리 가족');
    if (name == null) return;
    try { const r = await Cloud.createFamily(name); U.toast(`가족을 만들었어요. 초대 코드 ${r.invite_code}`); this.cloudCard(); }
    catch (e) { U.toast('가족을 만들지 못했어요. 잠시 뒤 다시 해 주세요.'); }
  },
  async joinFamily() {
    const code = prompt('받은 초대 코드 6자리');
    if (!code) return;
    try { const r = await Cloud.joinFamily(code.trim()); U.toast(`'${r.name}' 가족에 참여했어요`); this.cloudCard(); }
    catch (e) { U.toast(e.message.includes('찾을 수') ? '초대 코드를 찾을 수 없어요' : '참여하지 못했어요. 잠시 뒤 다시 해 주세요.'); }
  },
  async leaveFamily(id) {
    if (!confirm('이 가족에서 나갈까요? 서로 공유한 일정도 끊겨요.')) return;
    try { await Cloud.leaveFamily(id); await Cloud.sync(); U.toast('가족에서 나왔어요'); this.cloudCard(); }
    catch (e) { U.toast('나가지 못했어요: ' + e.message); }
  },
  async sendInvite(id) {
    const f = Cloud.families.find(x => x.id === id);
    if (!f) return;
    const text = `[마이플래너] '${f.name}' 가족 초대\n초대 코드: ${f.invite_code}\n마이플래너 > 설정 > 가족 > 코드로 참여에 입력해 주세요.\n${Share.WEB}`;
    try { if (navigator.share) { await navigator.share({ title: '마이플래너 가족 초대', text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); U.toast('초대 문구를 복사했어요'); } catch (e) { prompt('복사해서 보내 주세요', f.invite_code); }
  },
  async deleteData() {
    if (!confirm('서버에 올린 마이플래너 일정·가족·공유를 모두 지우고 로그아웃할까요? 이 폰의 일정은 남아요. 되돌릴 수 없어요.')) return;
    try { await Cloud.deleteMyData(); U.toast('서버 데이터를 지웠어요'); App.navigate('start'); }
    catch (e) { U.toast('지우지 못했어요: ' + e.message); }
  },
  async signOut() {
    let n = 0; try { n = Object.keys(Cloud._dirty() || {}).length; } catch (e) {}
    if (!confirm('로그아웃할까요? 내 일정은 이 폰에 남고, 가족이 공유한 일정은 사라져요.' + (n ? `\n\n아직 서버에 안 올린 변경이 ${n}개 있어요. 지금 올리고, 못 올리면 다음에 로그인할 때 올라가요.` : ''))) return;
    let failed = false;
    if (n) {
      U.toast(`변경 ${n}개를 올리는 중…`);
      try { await Cloud.sync(); } catch (e) { failed = true; } // 아직 못 올린 변경을 먼저 올림
    }
    await Cloud.signOut();
    U.toast(failed ? '로그아웃했어요. 못 올린 변경은 인터넷 연결 뒤 다시 로그인하면 올라가요' : '로그아웃했어요');
    App.navigate('start'); // 로그인 화면으로 (다시 카카오로 로그인하거나 '로그인 없이 시작')
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
      if (ns.alarmChannel === false) html += row(false, '기상·출발 알람 알림', '이 알림 종류가 꺼져 있으면 알람이 울리지 않아요', "Alarm.openSettings('alarmChannel')");
      html += row(ns.exact, '알람 및 리마인더', '정확한 시각에 울리려면 필요해요', "Alarm.openSettings('exact')");
      html += row(ns.fullScreen, '전체 화면 알람', '잠금 화면 위로 알람 화면을 띄워요 (안드로이드 14+)', "Alarm.openSettings('fullscreen')");
      if (ns.battery !== undefined) html += row(ns.battery, '배터리 사용 제한 없음', "절전 때문에 알람이 늦거나 빠지지 않게 해요. 목록에서 마이플래너를 '제한 없음'(최적화 안 함)으로 바꿔 주세요", "Alarm.openSettings('battery')");
      if (ns.alarmVolume === 0) html += `<div class="check-row bad"><span class="check-ic">🔈</span><div class="grow"><b>알람 소리가 0이에요</b><small>울릴 때는 잠시 중간 크기로 올려서 깨워 드려요. 평소에도 들리게 하려면 폰의 알람 음량을 올려 주세요.</small></div></div>`;
      html += `<button class="btn primary" style="width:100%;margin:10px 0 4px" onclick="Settings.testReal()">⏰ 1분 뒤 진짜 알람 울려 보기</button>
        <p class="muted small" style="margin-top:4px">누른 뒤 화면을 끄고 기다려 보세요. 잠금 화면 위로 알람이 뜨고 소리가 나면 준비 완료예요.</p>`;
      html += `<p class="muted small">앞으로 ${Alarm.NATIVE_DAYS}일 알림 ${ns.planned ?? 0}개를 폰에 맡겨 두었어요 (지금 예약 ${ns.scheduled}개, 매일 새벽 자동 보충). 앱을 오래 열지 않아도 이어서 울려요. 삼성 휴대폰은 '배터리 > 백그라운드 사용 제한'에서 마이플래너를 제외하면 더 안정적이에요.</p>`;
    } else if (Alarm.ln() && perm === 'granted') {
      html += `<button class="btn primary" style="width:100%;margin:10px 0 4px" onclick="Settings.testReal()">⏰ 1분 뒤 진짜 알람 울려 보기</button>
        <p class="muted small" style="margin-top:4px">누른 뒤 화면을 끄고 기다려 보세요. 알림과 함께 알람 소리가 나면 준비 완료예요. (무음 모드면 진동만 울려요)</p>`;
    } else if (perm !== 'unsupported') {
      html += `<p class="muted small">웹에서는 이 화면을 열어 둔 동안만 알람이 울려요. 앱을 설치하면 잠금 화면에서도 깨워 드려요.</p>`;
    }
    el.innerHTML = html;
  },

  set(k, v) { State.settings[k] = v; State.save(); this.render(); },
  setKey(k, v) { v = v.trim(); if (v) localStorage.setItem('mp_key_' + k, v); else localStorage.removeItem('mp_key_' + k); U.toast('저장했어요.'); },
  setHomeWin(k, v) { State.settings.homeWin = { ...AutoNav.homeWin(), [k]: v }; State.save(); this.render(); },
  pickHome() {
    PlacePicker.open('집 주소', p => { State.settings.home = { ...p, name: p.name === '현재 위치' ? '집' : p.name }; State.save(); this.render(); }, { allowHome: false });
  },
  async perm() { const ok = await Alarm.requestPermission(); U.toast(ok ? '알림이 허용되어 있어요.' : '휴대폰 설정에서 알림을 허용해 주세요.'); this.alarmCheck(); },
  async testReal() {
    const ok = await Alarm.testNative(60);
    U.toast(ok ? '1분 뒤에 알람이 울려요. 지금 화면을 꺼 보세요' : '테스트 알람을 맞추지 못했어요. 위 항목을 먼저 확인해 주세요');
  },
  test() { Alarm.showRinging('⏰ 알람 미리 듣기', '이런 소리로 깨워 드려요.', ''); },
  async reset() {
    if (!confirm('모든 일정을 지울까요? 되돌릴 수 없어요.')) return;
    // 내 일정은 지운 것으로 기록해서 로그인한 다른 기기·서버에서도 지워지게 (공유받은 일정은 남김)
    const mine = State.schedules.filter(s => !s._shared && !s.demo).map(s => s.id);
    State.schedules = State.schedules.filter(s => s._shared); State.save();
    if (typeof Cloud !== 'undefined') mine.forEach(id => Cloud.markDirty(id));
    await Alarm.rescheduleAll(); U.toast('모두 지웠어요.'); App.navigate('home');
  }
};
