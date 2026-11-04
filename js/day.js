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
        r.canChain = !!place && !x.s.chained && !x.s._shared && !this.near(x.s.origin, place);
      }
      return r;
    });
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
    const first = list.find(x => !x.s.chained);
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
        } else {
          h += `<div class="dv-gap">⏳ ${x.knownEnd ? '앞 일정 끝나고' : '앞 일정 시작부터'} <b>${U.durLabel(x.gapMin)}</b> 뒤 출발</div>`;
        }
        if (x.canChain && !trip) h += `<button class="dv-chain" onclick="DayView.chain('${s.baseId || s.id}','${(x.prev.s.baseId || x.prev.s.id)}')">📍 ${U.esc(x.prevPlace.name)}에서 바로 출발로 바꾸기 ›</button>`;
      }
      if (!s.chained) h += `<div class="tl-item wake ${past(plan.wakeAt)}" onclick="App.navigate('timeline',{id:'${id}'})"><div class="tl-time">${U.hm(plan.wakeAt)}</div><div class="tl-dot"></div><div class="tl-body"><b>기상 · 준비</b><small>준비 ${s.prepMin}분${i ? ' · 집에 들렀다 가는 일정' : ''}</small></div></div>`;
      h += `<div class="tl-item depart ${past(plan.departAt)}" onclick="App.navigate('timeline',{id:'${id}'})"><div class="tl-time">${U.hm(plan.departAt)}</div><div class="tl-dot"></div><div class="tl-body"><b>${U.esc((s.origin && s.origin.name) || '집')}에서 출발</b><small>${U.modeIcon(trip ? s.trip.accessMode : s.mode)} ${Planner.MODES[trip ? s.trip.accessMode : s.mode].label}${(trip ? s.accessRoute : s.route) ? ' · ' + U.durLabel((trip ? s.accessRoute : s.route).travelMin) : ''}</small></div></div>`;
      h += `<div class="tl-item event ${past(x.start)}" onclick="App.navigate('timeline',{id:'${id}'})"><div class="tl-time">${U.hm(x.start)}</div><div class="tl-dot"></div><div class="tl-body"><b>${U.esc(s.title)}</b><small>${trip ? `${U.esc(s.trip.number || Planner.MODES[s.mode].label)} 탑승 · ${U.esc((s.trip.departStation && s.trip.departStation.name) || '')}` : U.esc((s.dest && s.dest.name) || '')}${x.end ? ` · ${U.hm(x.end)}까지` : ''}</small></div></div>`;
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
          <div><small>${last.end ? '마지막 끝' : '마지막 일정'}</small><b>${U.hm(last.end || last.start)}</b></div>
        </div>` : ''}
        ${list.some(x => x.conflict) ? '<div class="info"><span>⚠️ 시간이 겹치는 일정이 있어요</span></div>' : ''}
      </div>
      ${list.length ? `<div class="card" style="padding:12px 18px"><div class="tl">${rows}</div></div>` : ''}
      <p class="muted small" style="margin:0 4px 12px">일정에 <b>끝나는 시간</b>을 넣으면 사이 여유 시간을 더 정확히 계산해요.</p>
      <button class="btn primary big" onclick="App.navigate('register',{date:'${ymd}'})">＋ 이 날 일정 추가</button>
    `);
  },

  /** 다음 일정을 '앞 일정 장소에서 바로 출발'로 바꾸고, 경로를 다시 찾도록 수정 화면으로 */
  chain(id, prevId) {
    const b = State.get(id), p = State.get(prevId);
    if (!b || !p) return;
    const prevOcc = Recur.resolve(prevId + (Recur.isRepeating(p) ? '@' + this.date : ''));
    const place = DayPlan.placeOf({ s: prevOcc || p });
    if (!place) return;
    App.navigate('register', { id, chainFrom: { place, from: prevId } });
  }
};

if (typeof module !== 'undefined') module.exports = { DayPlan };
