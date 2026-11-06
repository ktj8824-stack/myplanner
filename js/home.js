/* =========================================
   MyPlanner — 홈 · 캘린더
   ========================================= */

const Home = {
  render() {
    const name = State.settings.name;
    const h = new Date().getHours();
    const greet = h < 5 ? '늦은 밤이에요' : h < 11 ? '좋은 아침이에요' : h < 17 ? '좋은 오후예요' : '좋은 저녁이에요';
    let up = State.upcoming();
    // 2주보다 먼 일정만 있어도 홈에 보이게: 가까운 게 적으면 1년 안까지 넓혀서 찾기
    if (up.length < 5) {
      const have = new Set(up.map(x => x.s.occId || x.s.id));
      up = up.concat(State.upcoming(365).filter(x => !have.has(x.s.occId || x.s.id)));
    }
    const next = up[0];
    // 다가오는 일정: 다음 일정은 위 카드에 있으니 빼고, 반복 일정은 가장 가까운 회차 하나만
    const seen = new Set(next ? [next.s.baseId || next.s.id] : []);
    const list = up.slice(1).filter(x => { const k = x.s.baseId || x.s.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 4);
    const today = new Date();

    App.setMain(`
      <header class="hello">
        <div><small>${today.getMonth() + 1}월 ${today.getDate()}일 ${U.DOW[today.getDay()]}요일</small><b>${name ? U.esc(name) + '님, ' : ''}${greet}</b></div>
        <button class="avatar" onclick="App.navigate('settings')" aria-label="마이">${name ? U.esc(name.length >= 3 ? name.slice(-2) : name) : '🙂'}</button>
      </header>

      ${Demo.bar()}
      ${next ? this.nextCard(next) : this.emptyCard()}
      <div id="permNotice"></div>
      ${!State.settings.home ? `<button class="notice" onclick="App.navigate('settings')">${U.icon('home')} 집 주소를 등록하면 출발지가 자동으로 들어가요</button>` : ''}

      <div class="acts">
        <button class="act" onclick="App.navigate('register')"><span class="ic-box bg-blue"><img src="img/icons/register.png" alt=""></span><b>일정 추가</b><small>도착 시간만 넣으면 끝</small></button>
        <button class="act" onclick="App.navigate('assistant')"><span class="ic-box bg-yellow"><img src="img/icons/community.png" alt=""></span><b>AI 비서<span class="pro">PRO</span></b><small>말로 일정 등록</small></button>
        <button class="act" onclick="App.navigate('register',{paste:true})"><span class="ic-box bg-purple"><img src="img/icons/message.png" alt=""></span><b>받은 문자</b><small>예약 문자로 바로 등록</small></button>
        <button class="act" onclick="App.navigate('calendar')"><span class="ic-box bg-green"><img src="img/icons/calendar.png" alt=""></span><b>캘린더</b><small>날짜별로 일정 보기</small></button>
      </div>
      <div class="card mini mini-2">
        <button onclick="App.navigate('market')"><span class="ic-box bg-cyan"><img src="img/icons/market.png" alt=""></span>마켓</button>
        <button onclick="App.navigate('settings')"><span class="ic-box bg-orange"><img src="img/icons/group.png" alt=""></span>가족 공유</button>
      </div>

      <div class="card up" style="padding:16px 18px 6px">
        <div class="ct"><b>다가오는 일정</b><button onclick="App.navigate('calendar')">전체보기</button></div>
        <div class="list">${list.length ? list.map(x => this.row(x.s, x.plan)).join('') : `<div class="empty-line">${next ? '그다음 일정은 아직 없어요.' : '아직 일정이 없어요.'}</div>`}</div>
      </div>

      ${this.week()}
      ${Briefing.card()}
    `);
    this.checkPermission();
    if (next) Bus.renderInto('heroBus', next.s, next.plan);
  },

  /** 남색 '다음 일정' 카드 */
  nextCard({ s, plan }) {
    const now = Date.now();
    const wakePassed = plan.wakeAt.getTime() < now;
    const moving = plan.departAt.getTime() < now;
    const left = Math.max(0, Math.round(((wakePassed ? plan.departAt : plan.wakeAt) - now) / 60000));
    const m = Planner.MODES[s.mode];
    const trip = Planner.isTrip(s.mode);
    const dday = Math.round((Planner.at(s.date, '12:00') - Planner.at(U.today(), '12:00')) / 86400000);
    const far = dday > Alarm.HORIZON_DAYS;
    const rel = far ? U.dateLabel(s.date) : (U.dateLabel(s.date).split(' · ')[1] || U.dateLabel(s.date).split(' · ')[0]);
    const wakePrev = U.hmRel(plan.wakeAt, s.date).startsWith('전날');
    const route = trip ? s.accessRoute : (plan.live ? null : s.route);
    const info = [];
    if (plan.weather) info.push(`${plan.weather.icon} ${U.esc(plan.weather.label)}${plan.weather.extraMin ? ' +' + plan.weather.extraMin + '분' : ''}`);
    const lv = plan.live ? Planner.liveFor(s) : null;
    if (lv) info.push(`실시간 교통 ${lv.prevMin && lv.travelMin !== lv.prevMin ? (lv.travelMin > lv.prevMin ? '+' : '') + (lv.travelMin - lv.prevMin) + '분' : lv.travelMin + '분'}`);
    else if (route && route.travelMin) info.push(`${U.modeIcon(trip ? s.trip.accessMode : s.mode)} ${U.durLabel(route.travelMin)}${route.summary && /환승|원/.test(route.summary) ? ' · ' + U.esc(U.routeRest(route.summary)) : ''}`);
    const packLeft = Pack.left(s, plan).length;
    if (packLeft) info.push(`챙길 것 ${packLeft}개`);
    if (Recur.isRepeating(s)) info.push(U.icon('calendar') + ' ' + U.esc(Recur.label(s)).replace(/ · .*/, ''));
    if (s._shared) info.push(U.icon('group') + ' ' + U.esc(s._shared.from));
    return `
      <div class="card next">
        <div class="lb"><span>다음 일정 · ${U.esc(rel)}</span><span>${U.modeIcon(s.mode)} ${m.label}</span></div>
        <div class="tt">${U.esc(s.title)}</div>
        <div class="tri">
          ${plan.chained ? `<div class="${moving ? 'dim' : 'on'}"><small>출발 · ${U.esc((s.origin && s.origin.name) || '앞 일정')}</small><b>${U.hm(plan.departAt)}</b></div>
          <div><small>시작</small><b>${s.arriveBy || U.hm(plan.arriveAt)}</b></div>` : `<div class="${wakePassed ? 'dim' : 'on'}"><small>기상${wakePrev ? ' · 전날' : ''}</small><b>${U.hm(plan.wakeAt)}</b></div>
          <div class="${moving ? 'dim' : ''}"><small>출발</small><b>${U.hm(plan.departAt)}</b></div>`}
          ${plan.chained ? `<div><small>끝</small><b>${s.endBy || '--:--'}</b></div>` : `<div><small>${trip ? '탑승' : '약속'}</small><b>${trip ? s.trip.departTime : s.arriveBy}</b></div>`}
        </div>
        ${info.length ? `<div class="info">${info.map(t => `<span>${t}</span>`).join('')}</div>` : ''}
        <div id="heroBus"></div>
        ${far ? `<div class="info"><span>⏰ 알람은 일정 2주 전부터 자동으로 맞춰져요</span></div>` : ''}
        <button class="go" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})"><span>${far ? '📅 D-' + dday : moving ? '🚶 이동 중이에요' : '⏰ ' + (wakePassed ? '출발까지 ' : '기상까지 ') + U.durLabel(left)}</span><span>타임라인 ›</span></button>
      </div>`;
  },

  emptyCard() {
    return `
      <div class="card next empty">
        <div class="lb"><span>다음 일정</span></div>
        <div class="tt">도착 시간만 넣으면<br>언제 일어나고 나갈지 계산해 드려요</div>
        <div class="tri"><div class="on"><small>기상</small><b>--:--</b></div><div><small>출발</small><b>--:--</b></div><div><small>도착</small><b>--:--</b></div></div>
        <button class="go" onclick="App.navigate('register')"><span>＋ 첫 일정 만들기</span><span>›</span></button>
      </div>
      <button class="notice" onclick="Demo.add()">✨ 예시 일정 3개로 먼저 둘러보기</button>`;
  },

  /** 이번 주 (일~토) */
  week() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const days = [...Array(7)].map((_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const has = new Set(Recur.between(State.schedules, U.ymd(days[0]), U.ymd(days[6])).map(s => s.date));
    return `
      <div class="card">
        <div class="ct"><b>이번 주</b><span>${now.getMonth() + 1}월</span></div>
        <div class="wk">${days.map((d, i) => {
          const k = U.ymd(d);
          return `<div class="${k === U.today() ? 'td' : ''}" onclick="${has.has(k) ? `App.navigate('day',{date:'${k}',from:'home'})` : `CalendarView.selected='${k}';CalendarView.month=new Date(${d.getFullYear()},${d.getMonth()},1);App.navigate('calendar')`}"><small class="${i === 0 || Recur.holiday(k) ? 'sun' : i === 6 ? 'sat' : ''}">${U.DOW[i]}</small><b>${d.getDate()}</b><i class="${has.has(k) ? '' : 'n'}"></i></div>`;
        }).join('')}</div>
      </div>`;
  },

  row(s, plan) {
    plan = plan || Planner.compute(s);
    const m = Planner.MODES[s.mode];
    const trip = Planner.isTrip(s.mode);
    const lb = U.dateLabel(s.date);
    const day = s.date === U.today() ? '오늘' : (lb.split(' · ')[1] || lb.replace(/^(\d+)월 (\d+)일/, '$1/$2'));
    const timeLabel = trip ? `${s.trip.number ? U.esc(s.trip.number) + ' ' : ''}${s.trip.departTime} 탑승` : `${s.arriveBy} 도착`;
    const extra = Recur.isRepeating(s) ? ' · ' + U.esc(Recur.label(s)).replace(/ · .*/, '') : '';
    return `
      <button class="row" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
        <div class="row-time"><b>${U.hm(plan.chained ? plan.departAt : plan.wakeAt)}</b><small>${plan.chained ? '출발' : '기상'}</small></div>
        <div class="row-main">
          <b>${U.esc(s.title)}${s.hasOverride ? ' <span class="tag">변경됨</span>' : ''}${s.demo ? ' <span class="tag demo">예시</span>' : ''}</b>
          <small>${day} · ${timeLabel}${extra}</small>
        </div>
        <div class="row-ic">${s._shared ? U.icon('group') : U.modeIcon(s.mode)}</div>
      </button>`;
  },

  async checkPermission() {
    const el = document.getElementById('permNotice');
    if (!el) return;
    const st = await Alarm.permissionState();
    if (st !== 'granted' && st !== 'unsupported') {
      el.innerHTML = `<button class="notice warn" onclick="Alarm.requestPermission().then(()=>Home.render())">🔔 알림이 꺼져 있어요. 눌러서 허용해 주세요</button>`;
      return;
    }
    const ns = await Alarm.nativeStatus();
    if (ns && Alarm.problems(st, ns).some(k => Alarm.CRITICAL.includes(k))) {
      el.innerHTML = `<button class="notice warn" onclick="App.navigate('settings')">⏰ 알람이 정확히 울리려면 권한 설정이 필요해요</button>`;
    }
  }
};

const CalendarView = {
  month: null,
  selected: null,
  view: null,        // 'month' | 'week'

  getView() {
    if (!this.view) { try { this.view = localStorage.getItem('mp_cal_view') || 'month'; } catch (e) { this.view = 'month'; } }
    return this.view;
  },
  setView(v) {
    this.view = v;
    try { localStorage.setItem('mp_cal_view', v); } catch (e) {}
    this.render();
  },

  /** 'YYYY-MM-DD' 범위 안 날짜별 일정 { date: [s] } (출발 순) */
  byDay(from, to) {
    const map = {};
    Recur.between(State.schedules, from, to).forEach(s => { (map[s.date] = map[s.date] || []).push(s); });
    Object.values(map).forEach(l => l.sort((a, b) => (a.arriveBy || (a.trip && a.trip.departTime) || '').localeCompare(b.arriveBy || (b.trip && b.trip.departTime) || '')));
    return map;
  },
  short(t) { const x = String(t || '').split(/\s*[·|]\s*/)[0]; return x.length > 6 ? x.slice(0, 5) + '…' : x; },
  dowCls(key) { const w = Planner.at(key, '12:00').getDay(); return w === 0 || Recur.holiday(key) ? 'sun' : w === 6 ? 'sat' : ''; },

  render(params = {}) {
    const now = new Date();
    if (params.date) this.selected = params.date;
    if (!this.selected) this.selected = U.today();
    if (params.date || !this.month) { const d = Planner.at(this.selected, '12:00'); this.month = new Date(d.getFullYear(), d.getMonth(), 1); }
    const view = this.getView();
    const body = view === 'week' ? this.weekHtml() : this.monthHtml();
    const list = State.byDate(this.selected);
    const isToday = this.selected === U.today();
    App.setMain(`
      <header class="top cal-top"><h1>${U.icon('calendar')} 캘린더</h1>
        <div class="cal-switch"><button class="${view === 'month' ? 'on' : ''}" onclick="CalendarView.setView('month')">월</button><button class="${view === 'week' ? 'on' : ''}" onclick="CalendarView.setView('week')">주</button></div>
      </header>
      ${body}
      ${view === 'month' ? `
      <div class="sec-row"><h2 class="sec">${U.dateLabel(this.selected)}${Recur.holiday(this.selected) ? ` <span class="holiday">${Recur.holiday(this.selected)}</span>` : ''}</h2>
        <button class="btn small primary" onclick="App.navigate('register',{date:'${this.selected}'})">＋ 추가</button></div>
      ${list.length > 1 ? `<button class="notice" onclick="App.navigate('day',{date:'${this.selected}',from:'calendar'})">🗓️ 이 날 일정 ${list.length}개 · 하루 동선 보기</button>` : ''}
      <div class="list">${list.length ? list.map(s => Home.row(s)).join('') : `<button class="empty-add" onclick="App.navigate('register',{date:'${this.selected}'})"><b>이 날은 일정이 없어요</b><small>눌러서 ${isToday ? '오늘' : U.dateLabel(this.selected).split(' · ')[0]} 일정 추가</small></button>`}</div>` : ''}
    `);
  },

  monthHtml() {
    const y = this.month.getFullYear(), m = this.month.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const map = this.byDay(`${y}-${U.pad(m + 1)}-01`, `${y}-${U.pad(m + 1)}-${U.pad(days)}`);
    const today = U.today();
    let cells = '';
    for (let i = 0; i < first; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${U.pad(m + 1)}-${U.pad(d)}`;
      const l = map[key] || [];
      const hol = Recur.holiday(key);
      cells += `<button class="cal-day ${key === today ? 'today' : ''} ${key === this.selected ? 'sel' : ''} ${key < today ? 'gone' : ''} ${this.dowCls(key)}"
        onclick="CalendarView.select('${key}')" aria-label="${m + 1}월 ${d}일${l.length ? ` 일정 ${l.length}개` : ''}">
        <span class="n">${d}</span>
        ${hol ? `<em class="hol">${U.esc(hol.length > 4 ? hol.slice(0, 3) + '…' : hol)}</em>` : ''}
        ${l.slice(0, 2).map(s => `<em class="ev ${s.mode}">${U.esc(this.short(s.title))}</em>`).join('')}
        ${l.length > 2 ? `<em class="more">+${l.length - 2}</em>` : ''}
      </button>`;
    }
    const isThis = y === new Date().getFullYear() && m === new Date().getMonth();
    return `<div class="card cal">
        <div class="cal-head">
          <button onclick="CalendarView.shift(-1)" aria-label="이전 달">‹</button>
          <b>${y}년 ${m + 1}월</b>
          <button onclick="CalendarView.shift(1)" aria-label="다음 달">›</button>
        </div>
        ${isThis && this.selected === today ? '' : `<button class="cal-today" onclick="CalendarView.goToday()">오늘</button>`}
        <div class="cal-grid dow">${U.DOW.map(d => `<div>${d}</div>`).join('')}</div>
        <div class="cal-grid month">${cells}</div>
      </div>`;
  },

  /** 주간: 선택한 날이 있는 주(일~토)를 날짜별로 */
  weekHtml() {
    const sel = Planner.at(this.selected, '12:00');
    const start = new Date(sel); start.setDate(sel.getDate() - sel.getDay());
    const keys = [...Array(7)].map((_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return U.ymd(d); });
    const map = this.byDay(keys[0], keys[6]);
    const today = U.today();
    const a = Planner.at(keys[0], '12:00'), b = Planner.at(keys[6], '12:00');
    const title = a.getMonth() === b.getMonth() ? `${a.getMonth() + 1}월 ${a.getDate()}일 ~ ${b.getDate()}일` : `${a.getMonth() + 1}/${a.getDate()} ~ ${b.getMonth() + 1}/${b.getDate()}`;
    const total = keys.reduce((n, k) => n + (map[k] || []).length, 0);
    const days = keys.map(k => {
      const d = Planner.at(k, '12:00');
      const l = (map[k] || []).map(s => ({ s, plan: Planner.compute(s) }));
      const hol = Recur.holiday(k);
      const items = l.map(({ s, plan }) => {
        const trip = Planner.isTrip(s.mode);
        return `<button class="wk-ev" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
          <span class="wk-t"><b>${U.hm(plan.chained ? plan.departAt : plan.wakeAt)}</b><small>${plan.chained ? '출발' : '기상'}</small></span>
          <span class="wk-m"><b>${U.esc(s.title)}</b><small>${trip ? `${U.esc(s.trip.departTime)} 탑승` : `${U.esc(s.arriveBy)} 도착`}${s.endBy && !trip ? ` · ${U.esc(s.endBy)} 끝` : ''}${plan.homeAt ? ` · ${U.hm(plan.homeAt)} 집` : ''}</small></span>
          ${U.modeIcon(s.mode, 'wk-ic')}
        </button>`;
      }).join('');
      return `<div class="wk-day ${k === today ? 'today' : ''} ${k < today ? 'gone' : ''}">
        <div class="wk-date ${this.dowCls(k)}"><small>${U.DOW[d.getDay()]}</small><b>${d.getDate()}</b></div>
        <div class="wk-list">
          ${hol ? `<div class="wk-hol">${U.esc(hol)}</div>` : ''}
          ${items || `<button class="wk-empty" onclick="App.navigate('register',{date:'${k}'})">＋ 일정 추가</button>`}
          ${l.length > 1 ? `<button class="wk-day-link" onclick="App.navigate('day',{date:'${k}',from:'calendar'})">하루 동선 보기 ›</button>` : ''}
        </div>
      </div>`;
    }).join('');
    return `<div class="card cal wkv">
        <div class="cal-head">
          <button onclick="CalendarView.shiftWeek(-1)" aria-label="이전 주">‹</button>
          <b>${title}</b>
          <button onclick="CalendarView.shiftWeek(1)" aria-label="다음 주">›</button>
        </div>
        <div class="wk-sub">${total ? `이번 주 일정 ${total}개` : '이 주에는 일정이 없어요'}${keys.includes(today) ? '' : ` · <button class="link" onclick="CalendarView.goToday()">오늘로</button>`}</div>
        ${days}
      </div>`;
  },

  select(d) {
    if (d === this.selected && !State.byDate(d).length) return App.navigate('register', { date: d });
    this.selected = d; this.render();
  },
  shift(n) { this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1); this.render(); },
  shiftWeek(n) {
    const d = Planner.at(this.selected, '12:00'); d.setDate(d.getDate() + 7 * n);
    this.selected = U.ymd(d); this.month = new Date(d.getFullYear(), d.getMonth(), 1); this.render();
  },
  goToday() { this.selected = U.today(); this.month = null; this.render({ date: this.selected }); }
};
