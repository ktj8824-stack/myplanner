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
    if (st.min) parts.push(`${st.min}분`);
    return parts.join(' · ');
  },

  /**
   * 핵심: 일정 하나의 전체 타임라인을 계산합니다.
   * @param s  일정 { date, arriveBy, mode, prepMin, bufferMin, route, trip, accessRoute, egressRoute }
   * @returns  { wakeAt, departAt, arriveAt, items[], warnings[] }
   */
  compute(s) {
    const prep = Number(s.prepMin ?? 60);
    const buffer = Number(s.bufferMin ?? 10);
    const warnings = [];
    let items = [];
    let departAt, arriveAt;

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
      const accessTotal = this.totalMin(s.accessRoute, accessMode);
      departAt = this.addMin(checkInAt, -(accessTotal + buffer));

      const access = this.expandRoute(s.accessRoute, departAt, accessMode);
      items.push(...access.items);
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
      const total = this.totalMin(s.route, s.mode);
      departAt = this.addMin(due, -(total + buffer));
      const r = this.expandRoute(s.route, departAt, s.mode);
      items.push(...r.items);
      arriveAt = r.endAt;
      if (buffer) items.push({ at: arriveAt, kind: 'arrive', icon: '📍', title: `${(s.dest && s.dest.name) || '목적지'} 도착`, detail: `약속 ${buffer}분 전 도착` });
    }

    const wakeAt = this.addMin(departAt, -prep);
    items.unshift(
      { at: wakeAt, kind: 'wake', icon: '⏰', title: '기상 · 준비 시작', detail: `준비 시간 ${prep}분` },
      { at: departAt, kind: 'depart', icon: '🏠', title: `${(s.origin && s.origin.name) || '집'}에서 출발`, detail: this.isTrip(s.mode) ? `${this.MODES[(s.trip && s.trip.accessMode) || 'transit'].label}로 ${(s.trip && s.trip.departStation && s.trip.departStation.name) || '역'}까지` : this.MODES[s.mode].label }
    );
    // 출발 행 바로 뒤의 첫 이동 항목과 시각이 같으므로, 출발이 먼저 보이도록 안정 정렬
    if (s.arriveBy) items.push({ at: this.at(s.date, s.arriveBy), kind: 'event', icon: '🎯', title: s.title || '일정 시작', detail: (s.dest && s.dest.name) || '' });
    items = items.map((it, i) => ({ ...it, _i: i })).sort((a, b) => (a.at - b.at) || (a._i - b._i));

    if (wakeAt.getHours() < 4 || wakeAt.toDateString() !== this.at(s.date, '12:00').toDateString()) {
      warnings.push('기상 시간이 새벽이거나 전날이에요. 준비 시간·여유 시간을 확인해 주세요.');
    }
    if (s.route && s.route.source === 'estimate' || s.accessRoute && s.accessRoute.source === 'estimate') {
      warnings.push('실제 경로 대신 거리로 추정한 시간이에요. API 키를 넣으면 정확해져요.');
    }
    return { wakeAt, departAt, arriveAt, items, warnings };
  },

  /** 알람 목록 (기상, 출발 10분 전, 출발, 전날 밤 안내) */
  alarms(s, plan) {
    const out = [];
    const opt = Object.assign({ wake: true, preDepart: true, depart: true, nightBefore: true }, s.alarm || {});
    const firstMove = plan.items.find(i => i.kind === 'move' || i.kind === 'board');
    const firstLabel = firstMove ? `${firstMove.title}${firstMove.detail ? ' (' + firstMove.detail + ')' : ''}` : '';
    const hm = d => U.hm(d);
    const dest = (s.dest && s.dest.name) || '';
    if (opt.nightBefore) {
      const night = this.at(s.date, '21:00');
      night.setDate(night.getDate() - 1);
      out.push({ key: 'night', at: night, title: `내일 ${hm(plan.wakeAt)} 기상 예정`,
        body: `${s.title} ${s.arriveBy || ''} · ${hm(plan.departAt)} 출발 (${this.MODES[s.mode].label})` });
    }
    if (opt.wake) out.push({ key: 'wake', at: plan.wakeAt, alarm: true, title: `⏰ 일어날 시간이에요 — ${s.title}`,
      body: `${hm(plan.departAt)}에 출발해야 ${s.arriveBy || hm(plan.arriveAt)} ${dest} 도착. ${firstLabel}` });
    if (opt.preDepart) out.push({ key: 'pre', at: this.addMin(plan.departAt, -10), title: '출발 10분 전',
      body: `${hm(plan.departAt)} 출발 · 소지품을 챙겨 주세요. ${firstLabel}` });
    if (opt.depart) out.push({ key: 'depart', at: plan.departAt, alarm: true, title: `🚪 지금 출발하세요 — ${s.title}`,
      body: firstLabel || `${dest}로 출발` });
    return out.filter(a => a.at.getTime() > Date.now());
  }
};

if (typeof module !== 'undefined') module.exports = Planner;
