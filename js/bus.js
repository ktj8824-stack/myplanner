/* =========================================
   MyPlanner — 버스 실시간 도착 반영
   출발 직전(30분 이내)에 첫 버스 정류장의 실시간 도착 정보를 보고
   "7714번이 08:21에 와요 — 08:13에 나가세요"처럼 알려 줍니다.
   (판단 규칙 BusMath는 폰 백그라운드의 BusMath.java와 같아야 함)
   ========================================= */

const BusMath = {
  SLACK_MIN: 5,      // 계획한 정류장 도착 시각보다 이만큼 늦은 버스까지는 '제때'로 봄
  MARGIN_MIN: 2,     // 정류장에 버스보다 2분 먼저 도착하도록

  /**
   * @param now, plannedDepart  ms
   * @param preStopMin  출발 → 정류장 도착까지 계획한 시간(대기 여유 + 걷기)
   * @param walkMin     정류장까지 실제 걷는 시간
   * @param arrivalsSec 실시간 도착 예정(초, 지금 기준)
   * @returns { kind: 'none'|'ok'|'earlier'|'late', busAt, leaveAt, deltaMin, lateMin, urgent }
   */
  decide(now, plannedDepart, preStopMin, walkMin, arrivalsSec) {
    const M = 60000;
    const stopAt = plannedDepart + preStopMin * M;
    const deadline = stopAt + this.SLACK_MIN * M;
    const buses = (arrivalsSec || []).map(s => now + s * 1000)
      .filter(b => b >= now + (walkMin + 1) * M) // 걸어가서 탈 수 있는 버스만
      .sort((a, b) => a - b);
    if (!buses.length) return { kind: 'none' };
    const ok = buses.filter(b => b <= deadline);
    if (ok.length) {
      const busAt = ok[ok.length - 1];             // 제때 도착하는 버스 중 가장 늦은 것
      let leaveAt = busAt - (walkMin + this.MARGIN_MIN) * M;
      const urgent = leaveAt <= now + M;
      if (urgent) leaveAt = now + M;
      const deltaMin = Math.round((leaveAt - plannedDepart) / M);
      return { kind: deltaMin <= -3 ? 'earlier' : 'ok', busAt, leaveAt, deltaMin, urgent };
    }
    const busAt = buses[0];
    return { kind: 'late', busAt, lateMin: Math.round((busAt - deadline) / M) };
  }
};

const Bus = {
  WINDOW_MIN: 30,     // 출발 30분 전부터 확인 (그보다 이르면 버스가 아직 출발 전)
  cache: {},          // occId → { at, result, step }

  /** 이 일정의 첫 이동이 버스면 { step, walkMin, preStopMin, key } */
  leg(s) {
    const isTrip = Planner.isTrip(s.mode);
    const mode = isTrip ? (s.trip && s.trip.accessMode) : s.mode;
    if (mode !== 'transit') return null;
    const route = isTrip ? s.accessRoute : s.route;
    if (!route || !route.steps) return null;
    let walkMin = 0;
    for (const st of route.steps) {
      if (st.type === 'walk') { walkMin += st.min || 0; continue; }
      if (st.type !== 'bus' || !st.stationId) return null; // 첫 탈것이 지하철이면 대상 아님
      return { step: st, walkMin, preStopMin: (Planner.MODES.transit.extraMin || 0) + walkMin };
    }
    return null;
  },

  /** 출발 30분 이내면 실시간 도착을 확인 (1분 캐시) */
  async check(s, plan, force) {
    const leg = this.leg(s);
    if (!leg) return null;
    const now = Date.now();
    const dep = plan.departAt.getTime();
    if (dep - now > this.WINDOW_MIN * 60000 || dep < now - 10 * 60000) return null;
    const id = s.occId || s.id;
    const c = this.cache[id];
    if (!force && c && now - c.at < 60000) return c;
    const arr = await Routes.busArrivals(leg.step);
    if (!arr) return null;
    const result = BusMath.decide(now, dep, leg.preStopMin, leg.walkMin, arr.map(a => a.sec));
    const out = { at: now, result, step: leg.step, arrivals: arr, walkMin: leg.walkMin };
    this.cache[id] = out;
    return out;
  },

  busName(step) { return (step.label || '버스').replace(/ \(또는.*\)/, '').replace(/번 버스$/, '번'); },

  /** 받침에 맞는 조사: 341번이 / 마을버스가 */
  josa(word, withB, without) {
    const c = word.charCodeAt(word.length - 1);
    const has = c >= 0xAC00 && c <= 0xD7A3 ? (c - 0xAC00) % 28 > 0 : /[0-9]$/.test(word) ? !/[2459]$/.test(word) : false;
    return word + (has ? withB : without);
  },

  /** 화면 문구 { tone, title, body } */
  message(c) {
    if (!c) return null;
    const r = c.result, name = this.busName(c.step), hm = t => U.hm(new Date(t));
    const next = c.arrivals.slice(0, 2).map(a => `${Math.max(0, Math.round(a.sec / 60))}분 뒤`).join(' · ');
    if (r.kind === 'none') return { tone: 'info', title: `🚌 ${name} 실시간 정보 없음`, body: next ? `곧 도착: ${next}` : '아직 운행 중인 버스 정보가 없어요' };
    if (r.kind === 'late') return { tone: 'warn', title: `⚠️ ${this.josa(name, '이', '가')} 늦어요`, body: `다음 버스가 ${hm(r.busAt)}에 와서 약 ${r.lateMin}분 늦을 수 있어요. 다른 버스나 택시를 확인해 보세요.` };
    if (r.urgent) return { tone: 'warn', title: `🚨 지금 나가야 ${this.josa(name, '을', '를')} 탈 수 있어요`, body: `${hm(r.busAt)} 정류장 도착 · 걸어서 ${c.walkMin}분` };
    if (r.kind === 'earlier') return { tone: 'warn', title: `🚌 ${this.josa(name, '이', '가')} ${hm(r.busAt)}에 와요`, body: `${hm(r.leaveAt)}에 나가세요 (예정보다 ${-r.deltaMin}분 일찍)` };
    return { tone: 'ok', title: `🚌 ${name} ${hm(r.busAt)} 도착 예정`, body: `${hm(r.leaveAt)}에 나가면 딱 맞아요 · 걸어서 ${c.walkMin}분${next ? ' · ' + next : ''}` };
  },

  /** 타임라인 카드 HTML (출발 30분 전부터만) */
  async renderInto(elId, s, plan, force) {
    const el = document.getElementById(elId);
    if (!el || !this.leg(s)) return;
    const c = await this.check(s, plan, force);
    const m = this.message(c);
    if (!m) {
      const dep = plan.departAt.getTime() - Date.now();
      if (dep > this.WINDOW_MIN * 60000 && Routes.can('odsay')) {
        el.innerHTML = `<div class="bus-card dim">🚌 출발 ${this.WINDOW_MIN}분 전부터 ${U.esc(this.busName(this.leg(s).step))} 실시간 도착을 보여 드려요</div>`;
      }
      return;
    }
    el.innerHTML = `<div class="bus-card ${m.tone}"><b>${U.esc(m.title)}</b><small>${U.esc(m.body)}</small>
      <button class="link" onclick="event.stopPropagation();Bus.renderInto('${elId}', Recur.resolve('${U.esc(s.occId || s.id)}'), Planner.compute(Recur.resolve('${U.esc(s.occId || s.id)}')), true)">↻ 새로고침</button></div>`;
  }
};

if (typeof module !== 'undefined') module.exports = { BusMath, Bus };
