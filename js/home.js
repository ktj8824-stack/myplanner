/* =========================================
   MyPlanner — 홈 · 캘린더
   ========================================= */

const Home = {
  render() {
    const name = State.settings.name;
    const h = new Date().getHours();
    const greet = h < 5 ? '늦은 밤이에요' : h < 11 ? '좋은 아침이에요' : h < 17 ? '좋은 오후예요' : '좋은 저녁이에요';
    const up = State.upcoming();
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
      </div>
      <div class="card mini">
        <button onclick="App.navigate('register',{paste:true})"><span class="ic-box bg-purple"><img src="img/icons/message.png" alt=""></span>받은 문자</button>
        <button onclick="App.navigate('calendar')"><span class="ic-box bg-green"><img src="img/icons/calendar.png" alt=""></span>캘린더</button>
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
    const rel = U.dateLabel(s.date).split(' · ')[1] || U.dateLabel(s.date).split(' · ')[0];
    const wakePrev = U.hmRel(plan.wakeAt, s.date).startsWith('전날');
    const route = trip ? s.accessRoute : (plan.live ? null : s.route);
    const info = [];
    if (plan.weather) info.push(`${plan.weather.icon} ${U.esc(plan.weather.label)}${plan.weather.extraMin ? ' +' + plan.weather.extraMin + '분' : ''}`);
    const lv = plan.live ? Planner.liveFor(s) : null;
    if (lv) info.push(`📡 실시간 교통 ${lv.prevMin && lv.travelMin !== lv.prevMin ? (lv.travelMin > lv.prevMin ? '+' : '') + (lv.travelMin - lv.prevMin) + '분' : lv.travelMin + '분'}`);
    else if (route && route.travelMin) info.push(`${U.modeIcon(trip ? s.trip.accessMode : s.mode)} ${U.durLabel(route.travelMin)}${route.summary && /환승|원/.test(route.summary) ? ' · ' + U.esc(route.summary) : ''}`);
    if (Recur.isRepeating(s)) info.push('🔁 ' + U.esc(Recur.label(s)).replace(/ · .*/, ''));
    if (s._shared) info.push('👨‍👩‍👧 ' + U.esc(s._shared.from));
    return `
      <div class="card next">
        <div class="lb"><span>다음 일정 · ${U.esc(rel)}</span><span>${U.modeIcon(s.mode)} ${m.label}</span></div>
        <div class="tt">${U.esc(s.title)}</div>
        <div class="tri">
          <div class="${wakePassed ? 'dim' : 'on'}"><small>기상${wakePrev ? ' · 전날' : ''}</small><b>${U.hm(plan.wakeAt)}</b></div>
          <div class="${moving ? 'dim' : ''}"><small>출발</small><b>${U.hm(plan.departAt)}</b></div>
          <div><small>${trip ? '탑승' : '도착'}</small><b>${trip ? s.trip.departTime : s.arriveBy}</b></div>
        </div>
        ${info.length ? `<div class="info">${info.map(t => `<span>${t}</span>`).join('')}</div>` : ''}
        <div id="heroBus"></div>
        <button class="go" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})"><span>${moving ? '🚶 이동 중이에요' : '⏰ ' + (wakePassed ? '출발까지 ' : '기상까지 ') + U.durLabel(left)}</span><span>타임라인 ›</span></button>
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
      <div class="card" onclick="App.navigate('calendar')">
        <div class="ct"><b>이번 주</b><span>${now.getMonth() + 1}월</span></div>
        <div class="wk">${days.map((d, i) => {
          const k = U.ymd(d);
          return `<div class="${k === U.today() ? 'td' : ''}"><small class="${i === 0 || Recur.holiday(k) ? 'sun' : i === 6 ? 'sat' : ''}">${U.DOW[i]}</small><b>${d.getDate()}</b><i class="${has.has(k) ? '' : 'n'}"></i></div>`;
        }).join('')}</div>
      </div>`;
  },

  row(s, plan) {
    plan = plan || Planner.compute(s);
    const m = Planner.MODES[s.mode];
    const trip = Planner.isTrip(s.mode);
    const day = s.date === U.today() ? '오늘' : (U.dateLabel(s.date).split(' · ')[1] || U.DOW[Planner.at(s.date, '12:00').getDay()] + '요일');
    const timeLabel = trip ? `${s.trip.number ? U.esc(s.trip.number) + ' ' : ''}${s.trip.departTime} 탑승` : `${s.arriveBy} 도착`;
    const extra = Recur.isRepeating(s) ? ' · ' + U.esc(Recur.label(s)).replace(/ · .*/, '') : '';
    return `
      <button class="row" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
        <div class="row-time"><b>${U.hm(plan.wakeAt)}</b><small>기상</small></div>
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
    if (ns && (!ns.exact || !ns.fullScreen)) {
      el.innerHTML = `<button class="notice warn" onclick="App.navigate('settings')">⏰ 알람이 정확히 울리려면 권한 설정이 필요해요</button>`;
    }
  }
};

const CalendarView = {
  month: null,
  selected: null,

  render(params = {}) {
    const now = new Date();
    if (!this.month) this.month = new Date(now.getFullYear(), now.getMonth(), 1);
    if (!this.selected || params.date) this.selected = params.date || U.today();
    const y = this.month.getFullYear(), m = this.month.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    const counts = {};
    Recur.between(State.schedules, `${y}-${U.pad(m + 1)}-01`, `${y}-${U.pad(m + 1)}-${U.pad(days)}`)
      .forEach(s => { counts[s.date] = (counts[s.date] || 0) + 1; });

    let cells = '';
    for (let i = 0; i < first; i++) cells += '<div></div>';
    for (let d = 1; d <= days; d++) {
      const key = `${y}-${U.pad(m + 1)}-${U.pad(d)}`;
      const dow = (first + d - 1) % 7;
      cells += `<button class="cal-day ${key === U.today() ? 'today' : ''} ${key === this.selected ? 'sel' : ''} ${dow === 0 || Recur.holiday(key) ? 'sun' : dow === 6 ? 'sat' : ''}"
        onclick="CalendarView.select('${key}')"><span>${d}</span>${counts[key] ? `<i>${counts[key] > 1 ? counts[key] : ''}</i>` : ''}</button>`;
    }
    const list = State.byDate(this.selected);
    App.setMain(`
      <header class="top"><h1>${U.icon('calendar')} 캘린더</h1></header>
      <div class="card cal">
        <div class="cal-head">
          <button onclick="CalendarView.shift(-1)">‹</button>
          <b>${y}년 ${m + 1}월</b>
          <button onclick="CalendarView.shift(1)">›</button>
        </div>
        <div class="cal-grid dow">${U.DOW.map(d => `<div>${d}</div>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="sec-row"><h2 class="sec">${U.dateLabel(this.selected)}${Recur.holiday(this.selected) ? ` <span class="holiday">${Recur.holiday(this.selected)}</span>` : ''}</h2>
        <button class="btn small primary" onclick="App.navigate('register',{date:'${this.selected}'})">＋ 추가</button></div>
      <div class="list">${list.length ? list.map(s => Home.row(s)).join('') : '<div class="empty-line">이 날은 일정이 없어요.</div>'}</div>
    `);
  },
  select(d) { this.selected = d; this.render(); },
  shift(n) { this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1); this.render(); }
};
