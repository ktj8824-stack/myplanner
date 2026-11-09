/* =========================================
   MyPlanner — 하루 동선
   같은 날 일정이 여러 개면 순서대로 이어서 보여 주고,
   일정 사이 여유 시간·겹침을 알려 주고, '앞 일정 장소에서 바로 출발'로 바꿀 수 있게 함
   - DayPlan: 화면과 무관한 계산 (test/day.test.js)
   - DayView: 하루 동선 화면
   ========================================= */

const DayPlan = {
  /** 일정이 시작되는 시각 (약속 시각 / 기차·비행기 출발) */
  startOf({ s, plan }) {
    if (Planner.isTrip(s.mode) && s.trip && s.trip.departTime) return Planner.at(s.date, s.trip.departTime);
    return s.arriveBy ? Planner.at(s.date, s.arriveBy) : plan.arriveAt;
  },
  /** 일정이 끝나는 시각 (끝나는 시간을 넣은 경우만, 기차·비행기는 도착) */
  endOf(x) {
    const { s, plan } = x;
    if (Planner.isTrip(s.mode)) return plan.arriveAt;
    if (!s.endBy || !/^\d\d:\d\d$/.test(s.endBy)) return null;
    let end = Planner.at(s.date, s.endBy);
    const start = this.startOf(x);
    if (end <= start) end = Planner.addMin(end, 24 * 60);
    return end;
  },
  /** 일정이 끝나고 있는 곳 */
  placeOf({ s }) {
    if (s.dest) return s.dest;
    if (Planner.isTrip(s.mode) && s.trip) return s.trip.arriveStation || null;
    return null;
  },
  near(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return false;
    return Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lng - b.lng) < 0.0025; // 약 200m
  },

  /**
   * [{s, plan}] → 출발 순서대로 [{ s, plan, start, end, prev?, gapMin?, knownEnd?, conflict?, canChain? }]
   * gapMin: 앞 일정이 끝난(모르면 시작한) 뒤 이 일정 출발까지 남는 시간
   * conflict: 앞 일정이 시작(또는 끝나기) 전에 출발해야 함
   * canChain: 앞 일정 장소에서 바로 출발로 바꿀 수 있음 (지금은 다른 곳 — 보통 집 — 에서 출발)
   */
  build(entries) {
    const list = entries.slice().sort((a, b) => a.plan.departAt - b.plan.departAt);
    return list.map((x, i) => {
      const r = { ...x, start: this.startOf(x), end: this.endOf(x) };
      const prev = list[i - 1];
      if (prev) {
        const pStart = this.startOf(prev), pEnd = this.endOf(prev);
        const ref = pEnd || pStart;
        r.prev = prev;
        r.knownEnd = !!pEnd;
        r.gapMin = Math.round((x.plan.departAt - ref) / 60000);
        r.conflict = x.plan.departAt < pStart || (!!pEnd && x.plan.departAt < pEnd);
        const place = this.placeOf(prev);
        r.prevPlace = place;
        r.canChain = !!place && !x.plan.chained && !x.s._shared && !this.near(x.s.origin, place);
      }
      return r;
    });
  },

  /* ---------- 같은 날 앞뒤 약속 자동 연결 ---------- */
  CHAIN_MAX_GAP_MIN: 180, // 앞 약속이 끝나고 3시간 안이면 집에 안 들르고 바로 가는 것으로 봄

  /** 일정 d(초안)의 시작 시각 (도착 약속 / 기차·비행기 출발) */
  startOfDraft(d) {
    if (Planner.isTrip(d.mode)) return d.trip && d.trip.departTime ? Planner.at(d.date, d.trip.departTime) : null;
    return d.arriveBy ? Planner.at(d.date, d.arriveBy) : null;
  },

  /** 같은 날 d보다 먼저 끝나는 바로 앞 약속 { s, place, end } (끝나는 시간을 아는 것만). 없으면 null */
  prevFor(d, extra = []) {
    const start = this.startOfDraft(d);
    if (!start || !d.date) return null;
    const list = State.byDate(d.date).concat(extra.filter(x => x && x.date === d.date))
      .filter(o => (o.baseId || o.id) !== (d.baseId || d.id) && !o._shared)
      .map(o => { try { return { s: o, plan: Planner.compute(o) }; } catch (e) { return null; } })
      .filter(x => x && !x.plan.invalid)
      .map(x => ({ s: x.s, start: this.startOf(x), end: this.endOf(x), place: this.placeOf(x) }))
      .filter(x => x.end && x.place && x.start < start && x.end <= start)
      .sort((a, b) => b.end - a.end);
    return list[0] || null;
  },

  /**
   * 시간·날짜를 바꾼 뒤에도 '앞 일정에서 이어서 출발'이 말이 되는지.
   * 앞 일정이 그날 없거나, 이 일정이 앞 일정이 끝나기 전에 시작하면 true (연결을 풀어야 함)
   */
  chainBroken(d) {
    if (!d || !d.chained || d.startNow) return false;
    const p = State.get(d.chained.from);
    if (!p || !d.date || !Recur.occursOn(p, d.date)) return true;
    const po = Recur.isRepeating(p) ? Recur.instance(p, d.date) : p;
    let plan;
    try { plan = Planner.compute(po); } catch (e) { return true; }
    const end = this.endOf({ s: po, plan }) || this.startOf({ s: po, plan });
    const start = this.startOfDraft(d);
    return !end || !start || end > start;
  },

  /** 연결을 풀 때 바꿀 값: 집에서 출발(경로도 집 기준으로 다시) + 준비 시간·기상 알람 복구 */
  async unchainPatch(d) {
    const st = State.settings;
    const home = st.home ? { ...st.home } : null;
    let route = null;
    if (home && d.dest && !Planner.isTrip(d.mode)) {
      try { route = (await Routes.options(home, d.dest, d.mode, d.arriveBy ? Planner.at(d.date, d.arriveBy) : null))[0] || null; } catch (e) {}
    }
    return { chained: false, origin: home || d.origin, route: home ? route : d.route, prepMin: +st.prepMin || 60 };
  },

  /**
   * 새 일정: 앞 약속이 끝나고 얼마 안 돼 시작하면 출발지를 앞 약속 장소로 (기상 없이 출발 알람만).
   * 사용자가 '집에서 출발'을 고른 일정(homeFirst)·지금 위치 출발·이미 연결된 일정은 그대로. 바뀌면 앞 약속을 돌려줌
   */
  applyAuto(d, extra = []) {
    // 반복 일정은 첫날 앞 약속 하나 때문에 매일 그 장소에서 출발로 바뀌면 안 됨 (수동 연결 버튼도 반복은 뺌)
    if (!d || d.startNow || d.homeFirst || d.chained || Planner.isTrip(d.mode) || (typeof Recur !== 'undefined' && Recur.isRepeating(d))) return null;
    const prev = this.prevFor(d, extra);
    if (!prev) return null;
    const start = this.startOfDraft(d);
    if ((start - prev.end) / 60000 > this.CHAIN_MAX_GAP_MIN) return null;
    if (this.near(d.origin, prev.place)) return null;
    const p = prev.place;
    d.origin = { name: p.name, address: p.address || '', lat: p.lat, lng: p.lng };
    d.chained = { from: prev.s.baseId || prev.s.id };
    d.prepMin = 0;
    d.alarm = { ...(d.alarm || {}), wake: false, nightBefore: false };
    d.route = null;
    return prev;
  },

  /**
   * x를 저장한 뒤: 같은 날 x 바로 다음 약속이 x의 앞 약속(또는 집)에서 출발로 되어 있으면 x 장소에서 출발로 바꿈.
   * (사이에 끼워 넣은 경우) 경로를 다시 찾아 저장. 바뀐 일정 이름을 돌려줌
   */
  async rechainNext(x) {
    if (!x || !x.date) return null;
    const xs = Recur.resolve((x.baseId || x.id) + (Recur.isRepeating(x) ? '@' + x.date : '')) || x;
    let xp;
    try { xp = Planner.compute(xs); } catch (e) { return null; }
    const xEnd = this.endOf({ s: xs, plan: xp }), xPlace = this.placeOf({ s: xs });
    if (!xEnd || !xPlace) return null;
    const xStart = this.startOf({ s: xs, plan: xp });
    const xId = xs.baseId || xs.id;
    const nexts = State.byDate(x.date).filter(o => (o.baseId || o.id) !== xId && !o._shared && !Planner.isTrip(o.mode))
      .map(o => ({ o, plan: Planner.compute(o) })).filter(n => !n.plan.invalid)
      .map(n => ({ ...n, start: this.startOf({ s: n.o, plan: n.plan }) }))
      .filter(n => n.start > xStart).sort((a, b) => a.start - b.start);
    const n = nexts[0];
    if (!n || n.o.startNow || (n.o.homeFirst && !n.o.chained) || n.start < xEnd) return null;
    if ((n.start - xEnd) / 60000 > this.CHAIN_MAX_GAP_MIN) return null;
    if (n.o.chained && n.o.chained.from === xId) return null;
    const prevOfX = xs.chained ? xs.chained.from : null;
    // 다음 약속이 집에서 출발이거나, x의 앞 약속에서 이어서 가던 경우만 바꿈 (사용자가 일부러 고른 다른 출발지는 존중)
    const fromHome = !n.o.chained && State.settings.home && this.near(n.o.origin, State.settings.home);
    const fromPrevOfX = n.o.chained && (n.o.chained.from === prevOfX || !State.get(n.o.chained.from));
    if (!fromHome && !fromPrevOfX && n.o.chained) return null;
    if (!fromHome && !n.o.chained) return null;
    const origin = { name: xPlace.name, address: xPlace.address || '', lat: xPlace.lat, lng: xPlace.lng };
    let route = null;
    try { route = (await Routes.options(origin, n.o.dest, n.o.mode, n.o.arriveBy ? Planner.at(x.date, n.o.arriveBy) : null))[0] || null; } catch (e) {}
    const base = State.get(n.o.baseId || n.o.id);
    if (!base) return null;
    const patch = { origin, route, chained: { from: xId }, prepMin: 0 };
    if (Recur.isRepeating(base)) base.overrides = { ...(base.overrides || {}), [x.date]: { ...((base.overrides || {})[x.date] || {}), ...patch } };
    else { Object.assign(base, patch); base.alarm = { ...(base.alarm || {}), wake: false, nightBefore: false }; }
    State.upsert(base);
    return n.o.title;
  }
};

const DayView = {
  date: null,
  from: 'calendar',

  /** 그날 일정 회차 + 계산 */
  entries(ymd) {
    return State.byDate(ymd).map(s => ({ s, plan: Planner.compute(s) }));
  },

  render(params = {}) {
    if (params.date) { this.date = params.date; this.from = params.from || 'calendar'; }
    const ymd = this.date || U.today();
    const list = DayPlan.build(this.entries(ymd));
    const now = Date.now();
    const first = list.find(x => !x.plan.chained);
    const last = list[list.length - 1];
    const hol = Recur.holiday(ymd);
    const back = this.from === 'home' ? "App.navigate('home')" : this.from.startsWith('timeline:') ? `App.navigate('timeline',{id:'${this.from.slice(9)}'})` : "App.navigate('calendar')";

    const rows = list.map((x, i) => {
      const { s, plan } = x;
      const trip = Planner.isTrip(s.mode);
      const id = s.occId || s.id;
      const past = t => (t.getTime() < now ? 'past' : '');
      let h = '';
      if (x.prev) {
        if (x.conflict) {
          h += `<div class="dv-gap bad">⚠️ 앞 일정 ${x.knownEnd ? '끝나기' : '시작하기'} 전에 출발해야 해요${x.canChain ? ' · 앞 일정 장소에서 출발하면 줄어들 수 있어요' : ''}</div>`;
        } else if (x.knownEnd) {
          // 빈 시간: 앞 약속이 끝나고 이 약속으로 출발하기 전까지 (이동 시간은 이미 빠짐)
          const endHM = U.hm(DayPlan.endOf(x.prev));
          h += `<div class="dv-free">
            <div><b>빈 시간 ${U.durLabel(x.gapMin)}</b><small>${endHM} ~ ${U.hm(plan.departAt)} · 다음 약속까지 이동 시간은 빼고 계산했어요</small></div>
            ${x.gapMin >= 30 ? `<button class="btn small" onclick="App.navigate('register',{date:'${ymd}',insert:{end:'${endHM}'}})">＋ 끼워 넣기</button>` : ''}
          </div>`;
        } else {
          h += `<div class="dv-gap">⏳ 앞 일정 시작부터 <b>${U.durLabel(x.gapMin)}</b> 뒤 출발
            <button class="link" onclick="DayView.askEnd('${x.prev.s.baseId || x.prev.s.id}')">· 앞 약속 끝나는 시간 넣기</button></div>`;
        }
        if (x.canChain && !trip) h += `<button class="dv-chain" onclick="DayView.chain('${s.baseId || s.id}','${(x.prev.s.baseId || x.prev.s.id)}')">📍 ${U.esc(x.prevPlace.name)}에서 바로 출발로 바꾸기 ›</button>`;
      }
      if (!plan.chained) h += `<div class="tl-item wake ${past(plan.wakeAt)}" onclick="App.navigate('timeline',{id:'${id}'})"><div class="tl-time">${U.hm(plan.wakeAt)}</div><div class="tl-dot"></div><div class="tl-body"><b>기상 · 준비</b><small>준비 ${s.prepMin}분${i ? ' · 집에 들렀다 가는 일정' : ''}</small></div></div>`;
      h += `<div class="tl-item depart ${past(plan.departAt)}" onclick="App.navigate('timeline',{id:'${id}'})"><div class="tl-time">${U.hm(plan.departAt)}</div><div class="tl-dot"></div><div class="tl-body"><b>${U.esc((s.origin && s.origin.name) || '집')}에서 출발</b><small>${U.modeIcon(trip ? s.trip.accessMode : s.mode)} ${Planner.MODES[trip ? s.trip.accessMode : s.mode].label}${(trip ? s.accessRoute : s.route) ? ' · ' + U.durLabel((trip ? s.accessRoute : s.route).travelMin) : ''}</small></div></div>`;
      h += `<div class="tl-item event ${past(x.start)}" onclick="App.navigate('timeline',{id:'${id}'})"><div class="tl-time">${U.hm(x.start)}</div><div class="tl-dot"></div><div class="tl-body"><b>${U.esc(s.title)}</b><small>${trip ? `${U.esc(s.trip.number || Planner.MODES[s.mode].label)} 탑승 · ${U.esc((s.trip.departStation && s.trip.departStation.name) || '')}` : U.esc((s.dest && s.dest.name) || '')}${x.end ? ` · ${U.hm(x.end)}까지` : ''}</small></div></div>`;
      if (plan.homeAt && i === list.length - 1) {
        if (plan.lastLeaveAt) h += `<div class="tl-item last ${past(plan.lastLeaveAt)}"><div class="tl-time">${U.hm(plan.lastLeaveAt)}</div><div class="tl-dot"></div><div class="tl-body"><b>막차 타려면 늦어도 출발</b><small>막차 ${U.esc(s.goHome.lastTime)}</small></div></div>`;
        h += `<div class="tl-item home ${past(plan.homeAt)}"><div class="tl-time">${U.hm(plan.homeAt)}</div><div class="tl-dot"></div><div class="tl-body"><b>집 도착</b><small>${U.modeIcon(s.goHome.mode || 'transit')} ${Planner.MODES[s.goHome.mode || 'transit'].label}${s.goHome.route ? ' · ' + U.durLabel(s.goHome.route.travelMin) : ''}</small></div></div>`;
      }
      return h;
    }).join('');

    App.setMain(`
      <header class="subhead"><button class="back" onclick="${back}" aria-label="뒤로"></button><h1>하루 동선</h1><span></span></header>
      <div class="card next">
        <div class="lb"><span>${U.dateLabel(ymd)}${hol ? ' · ' + hol : ''}</span><span>일정 ${list.length}개</span></div>
        <div class="tt">${list.length ? list.map(x => U.esc(x.s.title)).join(' → ') : '일정이 없어요'}</div>
        ${list.length ? `<div class="tri">
          <div class="on"><small>첫 기상</small><b>${first ? U.hm(first.plan.wakeAt) : '--:--'}</b></div>
          <div><small>첫 출발</small><b>${U.hm(list[0].plan.departAt)}</b></div>
          ${last.plan.homeAt ? `<div><small>집 도착</small><b>${U.hm(last.plan.homeAt)}</b></div>` : `<div><small>${last.end ? '마지막 끝' : '마지막 일정'}</small><b>${U.hm(last.end || last.start)}</b></div>`}
        </div>` : ''}
        ${list.some(x => x.conflict) ? '<div class="info"><span>⚠️ 시간이 겹치는 일정이 있어요</span></div>' : ''}
      </div>
      ${list.length ? `<div class="card" style="padding:12px 18px"><div class="tl">${rows}</div></div>` : ''}
      <p class="muted small" style="margin:0 4px 12px">일정에 <b>끝나는 시간</b>을 넣으면 사이 여유 시간을 더 정확히 계산해요.</p>
      <button class="btn primary big" onclick="App.navigate('register',{date:'${ymd}'})">＋ 이 날 일정 추가</button>
    `);
  },

  /** 앞 약속이 몇 시에 끝나는지 물어서 저장 (빈 시간·이어서 출발 계산용). 반복 일정은 이 날만 */
  askEnd(id) {
    const b = State.get(id);
    if (!b) return;
    const occ = Recur.isRepeating(b) ? Recur.instance(b, this.date) : b;
    Sheet.open(`
      <div class="sheet-head"><b>'${U.esc(b.title)}' 몇 시에 끝나요?</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <p class="muted small">끝나는 시간을 알면 다음 약속까지 남는 시간과 이동을 정확히 계산해요.</p>
      <input type="time" id="endIn" class="input" value="${U.esc(occ.endBy || '')}">
      <button class="btn primary big" style="margin-top:14px" onclick="DayView.saveEnd('${U.esc(id)}')">저장</button>`);
  },
  async saveEnd(id) {
    const v = (document.getElementById('endIn') || {}).value || '';
    if (!/^\d\d:\d\d$/.test(v)) return U.toast('끝나는 시간을 골라 주세요');
    const b = State.get(id);
    if (!b) return;
    if (Recur.isRepeating(b)) b.overrides = { ...(b.overrides || {}), [this.date]: { ...((b.overrides || {})[this.date] || {}), endBy: v } };
    else b.endBy = v;
    State.upsert(b);
    Sheet.close();
    const name = await DayPlan.rechainNext(Recur.isRepeating(b) ? Recur.instance(b, this.date) : b).catch(() => null);
    await Alarm.rescheduleAll();
    U.toast(name ? `다음 약속 '${name}'은 여기서 바로 출발로 바꿨어요` : '저장했어요');
    this.render();
  },

  /** 다음 일정을 '앞 일정 장소에서 바로 출발'로 바꾸고, 경로를 다시 찾도록 수정 화면으로 */
  chain(id, prevId) {
    const b = State.get(id), p = State.get(prevId);
    if (!b || !p) return;
    const prevOcc = Recur.resolve(prevId + (Recur.isRepeating(p) ? '@' + this.date : ''));
    const place = DayPlan.placeOf({ s: prevOcc || p });
    if (!place) return;
    if (Recur.isRepeating(b)) return this.chainDay(b, place, prevId);
    App.navigate('register', { id, chainFrom: { place, from: prevId } });
  },

  /** 반복 일정은 '이 날만' 앞 일정 장소에서 출발로 (다른 날 출근은 그대로 집에서) */
  async chainDay(b, place, prevId) {
    const ymd = this.date;
    const occ = Recur.instance(b, ymd);
    U.toast('이 날만 앞 일정 장소에서 출발하도록 경로를 찾는 중…');
    const origin = { name: place.name, address: place.address || '', lat: place.lat, lng: place.lng };
    let route = null;
    try { route = (await Routes.options(origin, occ.dest, occ.mode, occ.arriveBy ? Planner.at(ymd, occ.arriveBy) : null))[0] || null; } catch (e) {}
    if (!route) return U.toast('경로를 찾지 못했어요. 잠시 후 다시 해 주세요');
    const ov = { ...((b.overrides || {})[ymd] || {}), origin, route, chained: { from: prevId }, prepMin: 0 };
    b.overrides = { ...(b.overrides || {}), [ymd]: ov };
    State.upsert(b);
    await Alarm.rescheduleAll();
    U.toast(`이 날만 ${place.name}에서 바로 출발해요. 다른 날은 그대로예요`);
    this.render();
  }
};

if (typeof module !== 'undefined') module.exports = { DayPlan };
