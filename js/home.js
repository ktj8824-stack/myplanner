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
    const today = State.byDate(U.today());

    const rest = up.filter(x => x.s.date !== U.today()).slice(0, 6);
    App.setMain(`
      <header class="home-head">
        <div><div class="date">${U.dateLabel(U.today()).split(' · ')[0]}</div><h1>${name ? U.esc(name) + '님,<br>' : ''}${greet}</h1></div>
        <button class="avatar" onclick="App.navigate('settings')" aria-label="설정">${name ? U.esc(name.length >= 3 ? name.slice(-2) : name) : Icons.svg('settings')}</button>
      </header>

      ${next ? this.heroCard(next) : `
        <div class="hero empty">
          <div class="empty-mark">${Icons.svg('moon')}</div>
          <b>예정된 일정이 없어요</b>
          <p class="muted">도착 시간만 넣으면 기상·출발 시간을 거꾸로 계산해 깨워 드려요.</p>
          <button class="btn primary big" onclick="App.navigate('register')">${Icons.svg('plus')}&nbsp;첫 일정 추가</button>
        </div>`}

      <div class="quick">
        <button class="qa ai" onclick="App.navigate('assistant')"><span class="qa-ic">${Icons.svg('mic')}</span><span><b>AI 비서<span class="pro">PRO</span></b><small>말로 일정 등록</small></span></button>
        <button class="qa" onclick="App.navigate('register',{paste:true})"><span class="qa-ic">${Icons.svg('message')}</span><span><b>받은 문자</b><small>KTX·병원 예약</small></span></button>
        <button class="qa" onclick="App.navigate('register')"><span class="qa-ic">${Icons.svg('plus')}</span><span><b>직접 추가</b><small>도착 시간만</small></span></button>
      </div>

      ${!State.settings.home ? `<button class="notice" onclick="App.navigate('settings')">${Icons.svg('home')}&nbsp; 집 주소를 등록하면 출발지가 자동으로 들어가요</button>` : ''}
      <div id="permNotice"></div>
      ${Briefing.card()}

      <h2 class="sec">오늘</h2>
      <div class="list">${today.length ? today.map(s => this.row(s)).join('') : '<div class="empty-line">오늘은 일정이 없어요.</div>'}</div>

      <h2 class="sec">다가오는 일정</h2>
      <div class="list">${rest.map(x => this.row(x.s, x.plan)).join('') || '<div class="empty-line">다가오는 일정이 없어요.</div>'}</div>
    `);
    this.checkPermission();
    if (next) Bus.renderInto('heroBus', next.s, next.plan);
  },

  heroCard({ s, plan }) {
    const now = Date.now();
    const wakePassed = plan.wakeAt.getTime() < now;
    const moving = plan.departAt.getTime() < now;
    const target = wakePassed ? plan.departAt : plan.wakeAt;
    const left = Math.max(0, Math.round((target - now) / 60000));
    const mode = Planner.MODES[s.mode];
    const trip = Planner.isTrip(s.mode);
    // 지평선: 기상 8시간 전(잠드는 무렵)부터 도착까지 얼마나 왔는지
    const t0 = plan.wakeAt.getTime() - 8 * 3600000, t1 = plan.arriveAt.getTime();
    const pct = Math.max(3, Math.min(100, Math.round((now - t0) / (t1 - t0) * 100)));
    const wakeDay = U.hmRel(plan.wakeAt, s.date).startsWith('전날');
    return `
      <button class="hero" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
        <div class="hero-top"><span class="hero-kicker">다음 출발</span><span class="badge">${U.dateLabel(s.date).replace(/^.*· /, '')}</span><span class="badge">${Icons.svg(Icons.mode(s.mode))}&nbsp;${mode.label}</span>${Recur.isRepeating(s) ? `<span class="badge">${Icons.svg('repeat')}</span>` : ''}${plan.weather ? `<span class="badge">${plan.weather.icon}&nbsp;${plan.weather.label}</span>` : ''}</div>
        <div class="hero-title">${U.esc(s.title)}</div>
        <div class="hero-times">
          <div class="${wakePassed ? 'dim' : 'now'}"><small>기상${wakeDay ? ' · 전날' : ''}</small><b>${U.hm(plan.wakeAt)}</b></div>
          <div class="${moving ? 'dim' : wakePassed ? 'now' : ''}"><small>출발</small><b>${U.hm(plan.departAt)}</b></div>
          <div><small>${trip ? '탑승' : '도착'}</small><b>${trip ? s.trip.departTime : s.arriveBy}</b></div>
        </div>
        <div class="horizon"><i style="width:${pct}%"></i></div>
        <div class="hero-left"><span>${moving ? '이동 중이에요' : (wakePassed ? '출발까지 ' : '기상까지 ') + U.durLabel(left)}</span><span>자세히${Icons.svg('chevronRight')}</span></div>
        <div id="heroBus" onclick="event.stopPropagation()"></div>
      </button>`;
  },

  row(s, plan) {
    plan = plan || Planner.compute(s);
    const m = Planner.MODES[s.mode];
    const trip = Planner.isTrip(s.mode);
    const timeLabel = trip ? `${s.trip.departTime} ${s.trip.number ? U.esc(s.trip.number) : m.label} 탑승` : `${s.arriveBy} 도착`;
    const place = trip ? (s.trip.departStation && s.trip.departStation.name) : (s.dest && s.dest.name);
    return `
      <button class="row" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
        <div class="row-time"><b>${U.hm(plan.wakeAt)}</b><small>기상</small></div>
        <div class="row-main">
          <b>${U.esc(s.title)}${s.hasOverride ? ' <span class="tag">변경됨</span>' : ''}</b>
          <small>${s.date !== U.today() ? (U.dateLabel(s.date).split(' · ')[1] || U.dateLabel(s.date)) + ' · ' : ''}${timeLabel}${place ? ' · ' + U.esc(place) : ''}</small>
        </div>
        <div class="row-ic">${s._shared ? Icons.svg('users') : Recur.isRepeating(s) ? Icons.svg('repeat') : Icons.svg(Icons.mode(s.mode))}</div>
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
      <header class="top"><h1>캘린더</h1></header>
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
        <button class="btn small primary" onclick="App.navigate('register',{date:'${this.selected}'})">${Icons.svg('plus')}&nbsp;추가</button></div>
      <div class="list">${list.length ? list.map(s => Home.row(s)).join('') : '<div class="empty-line">이 날은 일정이 없어요.</div>'}</div>
    `);
  },
  select(d) { this.selected = d; this.render(); },
  shift(n) { this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1); this.render(); }
};
