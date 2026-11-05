/* =========================================
   MyPlanner — 역산(거꾸로 계산) 엔진
   도착해야 하는 시간에서 거꾸로 계산해
   기상·준비·출발·환승 시간을 만들어 줍니다.
   (화면·네트워크와 상관없는 순수 계산 모듈)
   ========================================= */

const Planner = {
  // 이동수단 정의 — extraMin: 수단별 추가 여유, extraAt: 'start'(출발 직후) | 'end'(도착 직전)
  MODES: {
    transit: { label: '버스·지하철', emoji: '🚌', extraMin: 5,  extraAt: 'start', extraLabel: '정류장·역 대기' },
    car:     { label: '자가용',     emoji: '🚗', extraMin: 10, extraAt: 'end',   extraLabel: '주차 후 이동' },
    taxi:    { label: '택시',       emoji: '🚕', extraMin: 10, extraAt: 'start', extraLabel: '택시 호출 대기' },
    walk:    { label: '도보',       emoji: '🚶', extraMin: 0,  extraAt: 'start', extraLabel: '' },
    train:   { label: '기차',       emoji: '🚄', marginMin: 15,  marginLabel: '승강장 도착 여유' },
    flight:  { label: '비행기',     emoji: '✈️', marginMin: 40,  marginLabel: '탑승 수속 (국내선)', intlMarginMin: 150, intlMarginLabel: '탑승 수속 (국제선)' }
  },

  // 역·공항까지 갈 때 쓸 수 있는 수단
  ACCESS_MODES: ['transit', 'car', 'taxi', 'walk'],

  HOME_READY_MIN: 5,   // 일정 끝나고 나서기까지
  LAST_MARGIN_MIN: 5,  // 막차 시각보다 정류장·역에 일찍 도착

  isTrip(mode) { return mode === 'train' || mode === 'flight'; },

  /** 'YYYY-MM-DD' + 'HH:MM' → Date (한국 시간 기준 기기 로컬) */
  at(dateStr, hm) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const [hh, mm] = (hm || '00:00').split(':').map(Number);
    return new Date(y, m - 1, d, hh, mm, 0, 0);
  },

  addMin(date, min) { return new Date(date.getTime() + Math.round(min) * 60000); },

  /** 한 구간(경로 결과)을 출발 시각부터 순서대로 펼쳐 타임라인 항목으로 만듭니다. */
  expandRoute(route, startAt, mode) {
    const items = [];
    let t = startAt;
    const def = this.MODES[mode] || {};
    if (def.extraMin && def.extraAt === 'start') {
      items.push({ at: t, kind: 'wait', icon: def.emoji, title: def.extraLabel, detail: `약 ${def.extraMin}분 여유` });
      t = this.addMin(t, def.extraMin);
    }
    const steps = (route && route.steps && route.steps.length) ? route.steps
      : [{ type: mode, label: def.label || '이동', min: route ? route.travelMin : 0 }];
    steps.forEach(st => {
      items.push({ at: t, kind: 'move', icon: this.stepIcon(st.type), title: st.label, detail: this.stepDetail(st), step: st });
      t = this.addMin(t, st.min || 0);
    });
    if (def.extraMin && def.extraAt === 'end') {
      items.push({ at: t, kind: 'wait', icon: '🅿️', title: def.extraLabel, detail: `약 ${def.extraMin}분` });
      t = this.addMin(t, def.extraMin);
    }
    return { items, endAt: t };
  },

  /** 수단별 총 소요(이동 + 추가 여유) */
  totalMin(route, mode) {
    const def = this.MODES[mode] || {};
    return (route ? route.travelMin : 0) + (def.extraMin || 0);
  },

  stepIcon(type) {
    return { walk: '🚶', bus: '🚌', subway: '🚇', car: '🚗', taxi: '🚕', train: '🚄', flight: '✈️', transit: '🚌' }[type] || '➡️';
  },

  stepDetail(st) {
    const parts = [];
    if (st.from && st.to) parts.push(`${st.from} → ${st.to}`);
    else if (st.to) parts.push(`${st.to}까지`);
    if (st.stops) parts.push(`${st.stops}개 정류장`);
    if (st.min) parts.push(st.live ? `${st.min}분 (실시간 버스 위치 기준, 시간표 ${st.baseMin}분)` : st.baseMin != null && st.type === 'bus' ? `${st.min}분 (${st.rush ? '출퇴근길 막힘' : '도로 사정'} 반영, 시간표 ${st.baseMin}분)` : `${st.min}분`);
    return parts.join(' · ');
  },

  /* ---------- 실시간 교통 반영 ----------
     s.live = { 'YYYY-MM-DD': { travelMin, checkedAt, prevMin } }
     자가용·택시는 그날 아침 티맵 실시간 소요시간으로 다시 계산합니다.
     (버스·지하철은 시간표 기반이라 실시간 재계산 대상이 아님) */
  LIVE_MODES: ['car', 'taxi'],

  liveFor(s) { const v = s.live && s.live[s.date]; return v && v.travelMin ? v : null; },
  /** 서울 버스 실시간 '타는 시간' { min, stepIdx, checkedAt } (그날만) */
  rideFor(s) { const v = s.live && s.live[s.date]; return v && v.ride && v.ride.min ? v.ride : null; },
  /** 실시간 재계산 대상 버스 구간 (서울 버스 번호·정류장 번호가 있는 첫 버스) */
  rideLeg(s) {
    if (this.isTrip(s.mode) ? (s.trip && s.trip.accessMode) !== 'transit' : s.mode !== 'transit') return null;
    const route = this.isTrip(s.mode) ? s.accessRoute : s.route;
    const steps = (route && route.steps) || [];
    const i = steps.findIndex(st => st.type === 'bus' && st.fromArs && st.toArs && ((st.routeIds && st.routeIds.length) || st.busLocalBlID));
    return i < 0 ? null : { key: this.isTrip(s.mode) ? 'accessRoute' : 'route', stepIdx: i, step: steps[i] };
  },
  /** 폰이 버스 실시간 도착을 보고 당긴 출발 시각 (그날만) */
  busLeaveFor(s) { const v = s.live && s.live[s.date]; return v && v.busLeaveAt ? new Date(v.busLeaveAt) : null; },
  /** 실시간 값을 써도 되는지: 평소보다 빠른 값은 출발 1시간 안에 잰 것만 (이른 아침 한산한 길로 늦게 깨우지 않게) */
  LIVE_EARLY_MIN: 60,

  /** 이 일정에서 실시간으로 다시 잴 구간 { key: 'route'|'accessRoute', mode, from, to } — 없으면 null */
  liveLeg(s) {
    if (this.isTrip(s.mode)) {
      const m = (s.trip && s.trip.accessMode) || 'transit';
      return this.LIVE_MODES.includes(m) && s.trip.departStation ? { key: 'accessRoute', mode: m, from: s.origin, to: s.trip.departStation } : null;
    }
    return this.LIVE_MODES.includes(s.mode) && s.dest ? { key: 'route', mode: s.mode, from: s.origin, to: s.dest } : null;
  },

  /** 저장된 경로에 그날의 실시간 소요시간을 덮어씀 */
  liveRoute(s, key, mode) {
    const route = s[key];
    const live = this.liveFor(s);
    const leg = this.liveLeg(s);
    if (!route || !live || !leg || leg.key !== key || !this.LIVE_MODES.includes(mode)) return route;
    const baseDrive = (route.steps || []).filter(st => st.type === 'car' || st.type === 'taxi').reduce((a, st) => a + (st.min || 0), 0) || route.travelMin;
    if (live.travelMin * 3 < baseDrive) return route; // 평소의 1/3도 안 되면 잘못 잰 값
    if (live.travelMin < baseDrive) {
      const anchor = this.isTrip(s.mode) ? this.at(s.date, (s.trip && s.trip.departTime) || '00:00') : this.at(s.date, s.arriveBy || '00:00');
      const baseDepart = anchor.getTime() - (route.travelMin + Number(s.bufferMin ?? 10) + 30) * 60000;
      if (live.checkedAt < baseDepart - this.LIVE_EARLY_MIN * 60000) return route; // 너무 일찍 잰 한산한 값은 무시
    }
    const steps = (route.steps || []).map(st => (st.type === 'car' || st.type === 'taxi') ? { ...st, min: live.travelMin } : st);
    const others = steps.filter(st => st.type !== 'car' && st.type !== 'taxi').reduce((a, st) => a + (st.min || 0), 0);
    return { ...route, steps, travelMin: live.travelMin + others, source: 'live', summary: `실시간 ${live.travelMin}분` };
  },

  /**
   * 백그라운드 재확인 정보: 출발 = anchor − fixedMin − 이동시간
   * 네이티브가 티맵으로 이동시간만 다시 받아 같은 식으로 출발·기상 알람을 조정합니다.
   */
  recheckSpec(s, plan) {
    const leg = this.liveLeg(s);
    if (!leg || !leg.from || !leg.to || leg.from.lat == null || leg.to.lat == null) return null;
    const route = this.liveRoute(s, leg.key, leg.mode);
    if (!route) return null;
    const def = this.MODES[leg.mode];
    const buffer = Number(s.bufferMin ?? 10);
    let anchor;
    if (this.isTrip(s.mode)) {
      const tdef = this.MODES[s.mode], trip = s.trip;
      const margin = Number(trip.marginMin ?? (s.mode === 'flight' && trip.international ? tdef.intlMarginMin : tdef.marginMin));
      anchor = this.addMin(this.at(s.date, trip.departTime), -margin);
    } else {
      anchor = this.at(s.date, s.arriveBy);
    }
    const driveMin = (route.steps || []).filter(st => st.type === 'car' || st.type === 'taxi').reduce((a, st) => a + st.min, 0) || route.travelMin;
    const fixedMin = buffer + (def.extraMin || 0) + (route.travelMin - driveMin) + (plan.weather ? plan.weather.extraMin : 0);
    return { anchorMs: anchor.getTime(), fixedMin, travelMin: driveMin, plannedDepartMs: plan.departAt.getTime(),
      wakeMs: plan.wakeAt.getTime(), from: leg.from, to: leg.to, mode: leg.mode };
  },

  /**
   * 서울 버스 실시간 재확인 정보: 출발 = anchor − fixedMin − 버스 타는 시간
   * 폰이 백그라운드에서 '지금 타면 몇 분'을 받아 같은 식으로 출발·기상 알람을 조정 (기상은 당기기만)
   */
  rideSpec(s, plan) {
    const leg = this.rideLeg(s);
    if (!leg || plan.invalid) return null;
    const trip = this.isTrip(s.mode);
    let anchor;
    if (trip) {
      const tdef = this.MODES[s.mode], t = s.trip;
      const margin = Number(t.marginMin ?? (s.mode === 'flight' && t.international ? tdef.intlMarginMin : tdef.marginMin));
      anchor = this.addMin(this.at(s.date, t.departTime), -margin);
    } else anchor = this.at(s.date, s.arriveBy);
    const route = this.transitAdjust(s[leg.key], anchor, s);
    const rideMin = route.steps[leg.stepIdx].min;
    const buffer = Number(s.bufferMin ?? 10);
    const fixedMin = buffer + (this.MODES.transit.extraMin || 0) + (route.travelMin - rideMin) + (plan.weather ? plan.weather.extraMin : 0);
    const st = leg.step;
    return { type: 'ride', anchorMs: anchor.getTime(), fixedMin, travelMin: rideMin, plannedDepartMs: plan.departAt.getTime(), wakeMs: plan.wakeAt.getTime(),
      busID: String((st.routeIds || [])[0] || ''), busLocalBlID: String(st.busLocalBlID || ''), fromArs: String(st.fromArs), toArs: String(st.toArs) };
  },

  /* ---------- 버스·걷기 시간 보정 ----------
     ODsay 버스 시간은 시간표 기준이라 실제 도로 사정(특히 출퇴근길)보다 짧고,
     걷는 시간도 빠른 걸음 기준이라 실제(카카오맵 등)보다 짧게 나옴 → 늦지 않게 넉넉히.
     지하철은 시간표대로 다니므로 그대로. */
  RUSH: { bus: 1.3, busNormal: 1.15, walk: 1.3 },
  isRush(at) {
    const d = at.getDay(), m = at.getHours() * 60 + at.getMinutes();
    if (d === 0 || d === 6) return false;
    return (m >= 6 * 60 + 30 && m <= 10 * 60) || (m >= 17 * 60 && m <= 20 * 60);
  },
  /** at: 도착(또는 역 도착) 기준 시각 → 그 시간대에 맞게 버스·걷기 분 늘림 */
  transitAdjust(route, at, s) {
    if (!route || !route.steps || !route.steps.length || route.adjusted || !at || isNaN(at)) return route;
    const rush = this.isRush(at);
    // 서울 버스 실시간 타는 시간 (있으면 보정값 대신). 평소보다 짧은 값은 출발 1시간 안에 잰 것만
    const ride = s && s._noLive !== true ? this.rideFor(s) : null;
    const leg = ride ? this.rideLeg(s) : null;
    let changed = false;
    const steps = route.steps.map((st, i) => {
      const min = st.min || 0;
      let n = min;
      if (st.type === 'bus' && leg && i === leg.stepIdx && route.steps === (s[leg.key] || {}).steps) {
        const est = Math.ceil(min * (rush ? this.RUSH.bus : this.RUSH.busNormal));
        const baseDepart = at.getTime() - (route.travelMin + 40) * 60000;
        const ok = ride.min >= est || ride.checkedAt >= baseDepart - this.LIVE_EARLY_MIN * 60000;
        n = ok ? ride.min : est;
        if (ok) { changed = true; return { ...st, min: n, baseMin: min, live: true }; }
      } else if (st.type === 'bus') n = Math.ceil(min * (rush ? this.RUSH.bus : this.RUSH.busNormal));
      else if (st.type === 'walk' && route.steps.length > 1) n = Math.max(min + 1, Math.ceil(min * this.RUSH.walk));
      if (n === min) return st;
      changed = true;
      return { ...st, min: n, baseMin: min, rush: st.type === 'bus' && rush };
    });
    if (!changed) return route;
    const add = steps.reduce((a, st) => a + (st.min - (st.baseMin ?? st.min)), 0);
    return { ...route, steps, travelMin: route.travelMin + add, adjusted: true, rush };
  },

  /* ---------- 날씨 반영 ----------
     s.weather = { 'YYYY-MM-DD': { kind: 'rain'|'heavy'|'snow', prob, mm, temp, checkedAt } }
     그날 출발 시각 예보에 따라 이동 시간에 여유를 더합니다 (이동수단별 비율·최소값). */
  WEATHER: {
    rain:  { icon: '🌧', label: '비 예보',        tip: '우산 챙기세요',            car: [0.15, 5],  taxi: [0.15, 10], transit: [0, 5],  walk: [0.10, 3] },
    heavy: { icon: '⛈', label: '많은 비 예보',    tip: '우산·여벌 신발 챙기세요',  car: [0.25, 10], taxi: [0.25, 15], transit: [0, 10], walk: [0.20, 5] },
    snow:  { icon: '❄️', label: '눈 예보',        tip: '미끄럼 조심, 일찍 나가세요', car: [0.40, 15], taxi: [0.40, 20], transit: [0, 15], walk: [0.30, 5] }
  },

  weatherFor(s) { return (s.weather && s.weather[s.date]) || null; },

  /** 날씨 때문에 더하는 여유(분). mode = 실제로 이동하는 수단 */
  weatherExtra(s, mode, travelMin) {
    const w = this.weatherFor(s);
    const rule = w && this.WEATHER[w.kind];
    if (!rule || !rule[mode]) return 0;
    const [pct, min] = rule[mode];
    return Math.min(60, Math.max(min, Math.round((travelMin || 0) * pct)));
  },

  weatherItem(s, at, extra) {
    const w = this.weatherFor(s), rule = this.WEATHER[w.kind];
    return { at, kind: 'wait', icon: rule.icon, title: `${rule.label} 여유`, detail: `+${extra}분 · ${rule.tip}` };
  },

  /**
   * 핵심: 일정 하나의 전체 타임라인을 계산합니다.
   * @param s  일정 { date, arriveBy, mode, prepMin, bufferMin, route, trip, accessRoute, egressRoute }
   * @returns  { wakeAt, departAt, arriveAt, items[], warnings[] }
   */
  /** 앞 일정에서 바로 이어서 가는지 — 앞 일정이 지워졌거나 그날 건너뛰었으면 아님 */
  chainState(s) {
    if (s.startNow) return { chained: true, broken: false }; // 지금 있는 곳에서 바로 출발 (이미 밖)
    if (s._chainPreview && s.chained) return { chained: true, broken: false }; // AI 카드: 아직 저장 전인 앞 카드에서 이어서
    if (!s.chained) return { chained: false, broken: false };
    if (typeof State === 'undefined' || !State.get || typeof Recur === 'undefined') return { chained: true, broken: false };
    const p = State.get(s.chained.from);
    const ok = !!p && Recur.occursOn(p, s.date);
    return { chained: ok, broken: !ok };
  },

  compute(s) {
    const { chained, broken } = this.chainState(s);
    // 이어서 가던 일정이 혼자 남으면 준비 시간 0으로 깨우지 않도록 기본 1시간
    const prep = broken && !Number(s.prepMin) ? 60 : Number(s.prepMin ?? 60);
    const buffer = Number(s.bufferMin ?? 10);
    const warnings = [];
    let items = [];
    let departAt, arriveAt;
    let wx = 0;

    if (this.isTrip(s.mode)) {
      const trip = s.trip || {};
      const def = this.MODES[s.mode];
      const margin = Number(trip.marginMin ?? (s.mode === 'flight' && trip.international ? def.intlMarginMin : def.marginMin));
      const marginLabel = s.mode === 'flight' && trip.international ? def.intlMarginLabel : def.marginLabel;
      const vehicleDep = this.at(s.date, trip.departTime);
      let vehicleArr = this.at(s.date, trip.arriveTime || trip.departTime);
      if (vehicleArr < vehicleDep) vehicleArr = this.addMin(vehicleArr, 24 * 60); // 자정 넘김

      const accessMode = trip.accessMode || 'transit';
      const checkInAt = this.addMin(vehicleDep, -margin);
      const accessRoute = this.transitAdjust(this.liveRoute(s, 'accessRoute', accessMode), checkInAt, s);
      const accessTotal = this.totalMin(accessRoute, accessMode);
      wx = this.weatherExtra(s, accessMode, accessRoute ? accessRoute.travelMin : 0);
      departAt = this.addMin(checkInAt, -(accessTotal + buffer + wx));

      const access = this.expandRoute(accessRoute, departAt, accessMode);
      items.push(...access.items);
      if (wx) { items.push(this.weatherItem(s, access.endAt, wx)); access.endAt = this.addMin(access.endAt, wx); }
      const stName = (trip.departStation && trip.departStation.name) || (s.mode === 'flight' ? '출발 공항' : '출발역');
      items.push({ at: access.endAt, kind: 'arrive', icon: '📍', title: `${stName} 도착`, detail: `${marginLabel} ${margin}분 + 여유 ${buffer}분 전` });
      items.push({ at: vehicleDep, kind: 'board', icon: def.emoji, title: `${trip.number || def.label} 탑승·출발`, detail: stName });
      const arrName = (trip.arriveStation && trip.arriveStation.name) || (s.mode === 'flight' ? '도착 공항' : '도착역');
      items.push({ at: vehicleArr, kind: 'arrive', icon: '📍', title: `${arrName} 도착`, detail: '' });

      // 도착역 → 최종 목적지 (선택)
      if (s.egressRoute && s.egressRoute.travelMin) {
        const egressMode = trip.egressMode || 'transit';
        const eg = this.expandRoute(s.egressRoute, this.addMin(vehicleArr, 10), egressMode);
        items.push({ at: vehicleArr, kind: 'wait', icon: '🚪', title: '하차·출구 이동', detail: '약 10분' });
        items.push(...eg.items);
        arriveAt = eg.endAt;
      } else {
        arriveAt = vehicleArr;
      }
      if (s.arriveBy) {
        const due = this.at(s.date, s.arriveBy);
        if (arriveAt > due) warnings.push(`이 ${def.label}로는 약속 시간보다 ${Math.round((arriveAt - due) / 60000)}분 늦게 도착해요. 더 이른 편을 확인해 보세요.`);
      }
    } else {
      const due = this.at(s.date, s.arriveBy);
      const route = this.transitAdjust(this.liveRoute(s, 'route', s.mode), due, s);
      const total = this.totalMin(route, s.mode);
      wx = this.weatherExtra(s, s.mode, route ? route.travelMin : 0);
      departAt = this.addMin(due, -(total + buffer + wx));
      const r = this.expandRoute(route, departAt, s.mode);
      items.push(...r.items);
      if (wx) { items.push(this.weatherItem(s, r.endAt, wx)); r.endAt = this.addMin(r.endAt, wx); }
      arriveAt = r.endAt;
      if (buffer) items.push({ at: arriveAt, kind: 'arrive', icon: '📍', title: `${(s.dest && s.dest.name) || '목적지'} 도착`, detail: `약속 ${buffer}분 전 도착` });
    }

    // 앞 일정 장소에서 바로 이어서 가는 일정(s.chained)은 기상·준비 없이 출발부터
    let wakeAt = chained ? departAt : this.addMin(departAt, -prep);
    // 실시간 교통이 평소보다 빨라도 기상은 늦추지 않음 (출발만 늦춤)
    if (!chained && (this.liveFor(s) || this.rideFor(s)) && s._noLive !== true) {
      const base = this.compute({ ...s, live: null, _noLive: true });
      if (base.wakeAt < wakeAt) wakeAt = base.wakeAt;
    }
    const departRow = { at: departAt, kind: 'depart', icon: '🏠', title: `${(s.origin && s.origin.name) || '집'}에서 출발`, detail: this.isTrip(s.mode) ? `${this.MODES[(s.trip && s.trip.accessMode) || 'transit'].label}로 ${(s.trip && s.trip.departStation && s.trip.departStation.name) || '역'}까지` : this.MODES[s.mode].label };
    if (chained) items.unshift({ ...departRow, title: s.startNow ? `${(s.origin && s.origin.name) || '지금 위치'}에서 바로 출발` : `${(s.origin && s.origin.name) || '앞 일정 장소'}에서 이어서 출발` });
    else items.unshift({ at: wakeAt, kind: 'wake', icon: '⏰', title: '기상 · 준비 시작', detail: `준비 시간 ${prep}분` }, departRow);
    // 출발 행 바로 뒤의 첫 이동 항목과 시각이 같으므로, 출발이 먼저 보이도록 안정 정렬
    if (s.arriveBy) items.push({ at: this.at(s.date, s.arriveBy), kind: 'event', icon: '🎯', title: s.title || '일정 시작', detail: (s.dest && s.dest.name) || '' });
    let homeAt = null, homeDepartAt = null, lastLeaveAt = null;
    if (s.endBy && /^\d\d:\d\d$/.test(s.endBy)) {
      let end = this.at(s.date, s.endBy);
      const start = s.arriveBy ? this.at(s.date, s.arriveBy) : arriveAt;
      if (end <= start) end = this.addMin(end, 24 * 60);
      items.push({ at: end, kind: 'end', icon: '🏁', title: '일정 끝', detail: (s.dest && s.dest.name) || '' });
      // 끝나고 집에 가는 길 (s.goHome = { on, mode, route, lastTime })
      const gh = s.goHome;
      if (gh && gh.on) {
        const hm = gh.mode || 'transit';
        const hr = gh.route || null;
        homeDepartAt = this.addMin(end, this.HOME_READY_MIN);
        homeAt = this.addMin(homeDepartAt, this.totalMin(hr, hm));
        items.push({ at: homeDepartAt, kind: 'home-depart', icon: '🏠', title: '집으로 출발',
          detail: `${this.MODES[hm].label}${hr ? ' · ' + hr.travelMin + '분' : ''}` });
        if (gh.lastTime && /^\d\d:\d\d$/.test(gh.lastTime) && hm === 'transit') {
          let last = this.at(s.date, gh.lastTime);
          if (last < end && last.getHours() < 4) last = this.addMin(last, 24 * 60); // 00:10 같은 자정 넘은 막차
          const walk = hr && hr.steps && hr.steps[0] && hr.steps[0].type === 'walk' ? hr.steps[0].min : 0;
          lastLeaveAt = this.addMin(last, -(walk + this.LAST_MARGIN_MIN));
          items.push({ at: lastLeaveAt, kind: 'last', icon: '🚇', title: '막차 타려면 늦어도 출발',
            detail: `막차 ${gh.lastTime}${walk ? ` · 정류장·역까지 걸어서 ${walk}분` : ''}` });
          if (lastLeaveAt < homeDepartAt) warnings.push(`막차(${gh.lastTime})를 타려면 일정이 끝나기 전에 나서야 해요. 택시를 고려해 보세요.`);
        } else if (hm === 'transit' && (homeDepartAt.getHours() >= 23 || homeDepartAt.getHours() < 4)) {
          warnings.push('밤 11시가 넘으면 버스·지하철이 끊길 수 있어요. 카카오맵에서 막차 시간을 확인해 넣어 두세요.');
        }
        items.push({ at: homeAt, kind: 'home', icon: '🏠', title: '집 도착', detail: (gh.to && gh.to.name) || '' });
      }
    }
    items = items.map((it, i) => ({ ...it, _i: i })).sort((a, b) => (a.at - b.at) || (a._i - b._i));

    const HM0 = /^\d{1,2}:\d{2}$/;
    const hasTime = this.isTrip(s.mode) ? !!(s.trip && HM0.test(s.trip.departTime || '')) : HM0.test(s.arriveBy || '');
    if (hasTime && !chained && (wakeAt.getHours() < 4 || wakeAt.toDateString() !== this.at(s.date, '12:00').toDateString())) {
      warnings.push('기상 시간이 새벽이거나 전날이에요. 준비 시간·여유 시간을 확인해 주세요.');
    }
    if (s.route && s.route.source === 'estimate' || s.accessRoute && s.accessRoute.source === 'estimate') {
      warnings.push('경로를 찾지 못해 거리로 어림한 시간이에요 (넉넉하게 잡았어요). 인터넷이 될 때 일정 수정에서 [다시 찾기]를 눌러 주세요.');
    }
    // 시각이 없으면 계산이 의미 없음 → 알람을 만들지 않음 (AI·문자 등록에서 빠질 수 있음)
    const HM = /^\d{1,2}:\d{2}$/;
    const invalid = this.isTrip(s.mode) ? !(s.trip && HM.test(s.trip.departTime || '')) : !HM.test(s.arriveBy || '');
    if (invalid) warnings.unshift(this.isTrip(s.mode) ? '출발 시각이 없어 알람을 맞출 수 없어요. 일정을 수정해 시각을 넣어 주세요.' : '도착 시간이 없어 알람을 맞출 수 없어요. 일정을 수정해 시간을 넣어 주세요.');
    const noRoute = this.isTrip(s.mode) ? !s.accessRoute : !s.route;
    if (!invalid && noRoute && s.mode !== 'walk') warnings.push('경로 정보가 없어 이동 시간이 빠진 채로 계산됐어요. 일정을 수정해 경로를 찾아 주세요.');
    const w = this.weatherFor(s);
    const weather = w && this.WEATHER[w.kind] ? { ...w, ...this.WEATHER[w.kind], extraMin: wx } : null;
    if (broken) warnings.unshift(`앞 일정이 이 날 없어져서 ${(s.origin && s.origin.name) || '출발지'}에서 따로 출발하는 것으로 계산했어요. 출발지를 확인해 주세요.`);
    return { invalid, chained, wakeAt, departAt, arriveAt, items, warnings, live: this.liveFor(s), weather, homeAt, homeDepartAt, lastLeaveAt };
  },

  /** 알람 목록 (기상, 출발 10분 전, 출발, 전날 밤 안내) */
  alarms(s, plan) {
    const out = [];
    if (plan.invalid) return out;
    const opt = Object.assign({ wake: true, preDepart: true, depart: true, nightBefore: true }, s.alarm || {});
    if (plan.chained) opt.wake = false; // 앞 일정에서 바로 이어서 가는 일정은 깨울 필요 없음 (출발 알람만)
    else if (s.chained) { opt.wake = true; opt.nightBefore = true; } // 앞 일정이 없어진 날: 다시 깨워 줌
    const firstMove = plan.items.find(i => i.kind === 'move' || i.kind === 'board');
    const firstLabel = firstMove ? `${firstMove.title}${firstMove.detail ? ' (' + firstMove.detail + ')' : ''}` : '';
    const hm = d => U.hm(d);
    const dest = (s.dest && s.dest.name) || '';
    const wxTxt = plan.weather ? ` ${plan.weather.icon} ${plan.weather.label}(${plan.weather.prob}%) — ${plan.weather.tip}.` : '';
    const packTxt = typeof Pack !== 'undefined' ? Pack.line(s, plan) : '';
    if (opt.nightBefore) {
      // 전날 밤 9시. 기상이 그보다 이르거나 너무 가까우면(전날 밤 출발 등) 기상 2시간 전으로
      let night = this.at(s.date, '21:00');
      night.setDate(night.getDate() - 1);
      if (night.getTime() > plan.wakeAt.getTime() - 60 * 60000) night = this.addMin(plan.wakeAt, -120);
      const sameDay = night.toDateString() === plan.wakeAt.toDateString();
      const what = plan.chained ? '출발' : '기상';
      const t = plan.chained ? plan.departAt : plan.wakeAt;
      out.push({ key: 'night', at: night, title: `${sameDay ? '오늘' : '내일'} ${hm(t)} ${what} 예정`,
        body: `${s.title} ${s.arriveBy || ''} · ${hm(plan.departAt)} 출발 (${this.MODES[s.mode].label}).${wxTxt}${packTxt}` });
    }
    if (opt.wake) out.push({ key: 'wake', at: plan.wakeAt, alarm: true, title: `⏰ 일어날 시간이에요 — ${s.title}`,
      body: `${hm(plan.departAt)}에 출발해야 ${s.arriveBy || hm(plan.arriveAt)} ${dest} 도착. ${firstLabel}${wxTxt}${packTxt}` });
    if (opt.preDepart) out.push({ key: 'pre', at: this.addMin(plan.departAt, -10), title: '출발 10분 전',
      body: `${hm(plan.departAt)} 출발 · ${plan.weather ? plan.weather.tip : '소지품을 챙겨 주세요'}.${packTxt || ' '}${firstLabel}` });
    const bus = this.busLeaveFor(s);
    const busOk = bus && bus < plan.departAt && bus.getTime() > plan.departAt.getTime() - 60 * 60000;
    if (opt.depart) out.push({ key: 'depart', at: busOk ? bus : plan.departAt, alarm: true, title: `🚪 지금 출발하세요 — ${s.title}`,
      body: busOk ? `${s.live[s.date].busName || '버스'} 시간에 맞춰 지금 나가세요` : (firstLabel || `${dest}로 출발`) });
    if (plan.homeDepartAt && opt.goHome !== false) {
      const gh = s.goHome || {};
      out.push({ key: 'home', at: plan.homeDepartAt, title: `🏠 집에 갈 시간이에요 — ${s.title}`,
        body: `지금 나서면 ${hm(plan.homeAt)}에 집에 도착해요 (${this.MODES[gh.mode || 'transit'].label}${gh.route ? ' ' + gh.route.travelMin + '분' : ''}).` });
    }
    if (plan.lastLeaveAt) {
      out.push({ key: 'last', at: this.addMin(plan.lastLeaveAt, -15), alarm: true, title: `🚇 막차까지 15분 — ${s.title}`,
        body: `${hm(plan.lastLeaveAt)}에는 나서야 막차(${s.goHome.lastTime})를 탈 수 있어요.` });
    }
    return out.filter(a => a.at.getTime() > Date.now());
  }
};

if (typeof module !== 'undefined') module.exports = Planner;
