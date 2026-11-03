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

    App.setMain(`
      <header class="top">
        <div><div class="muted">${U.dateLabel(U.today())}</div><h1>${name ? U.esc(name) + '님, ' : ''}${greet}</h1></div>
      </header>

      ${next ? this.heroCard(next) : `
        <div class="card hero empty">
          <div class="hero-emoji">🌙</div>
          <b>예정된 일정이 없어요</b>
          <p class="muted">도착 시간만 넣으면 기상·출발 시간을 계산해 드려요.</p>
          <button class="btn primary" onclick="App.navigate('register')">＋ 일정 추가</button>
        </div>`}

      ${!State.settings.home ? `<button class="notice" onclick="App.navigate('settings')">🏠 집 주소를 등록하면 출발지가 자동으로 들어가요 ›</button>` : ''}
      <div id="permNotice"></div>
      <button class="paste-cta" onclick="App.navigate('register',{paste:true})">
        <span class="paste-ic">📋</span><span><b>받은 문자로 일정 만들기</b><small>KTX·항공권·병원 예약 문자를 붙여넣으면 끝</small></span><span class="chev">›</span>
      </button>

      <h2 class="sec">오늘 일정</h2>
      ${today.length ? today.map(s => this.row(s)).join('') : '<div class="muted pad">오늘은 일정이 없어요.</div>'}

      <h2 class="sec">다가오는 일정</h2>
      ${up.filter(x => x.s.date !== U.today()).slice(0, 6).map(x => this.row(x.s, x.plan)).join('') || '<div class="muted pad">다가오는 일정이 없어요.</div>'}
    `);
    this.checkPermission();
    if (next) Bus.renderInto('heroBus', next.s, next.plan);
  },

  heroCard({ s, plan }) {
    const now = Date.now();
    const wakePassed = plan.wakeAt.getTime() < now;
    const target = wakePassed ? plan.departAt : plan.wakeAt;
    const left = Math.max(0, Math.round((target - now) / 60000));
    const mode = Planner.MODES[s.mode];
    return `
      <div class="card hero" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
        <div class="hero-top"><span class="badge">${U.dateLabel(s.date)}</span><span class="badge soft">${mode.emoji} ${mode.label}</span>${Recur.isRepeating(s) ? '<span class="badge soft">🔁 반복</span>' : ''}${plan.weather ? `<span class="badge soft">${plan.weather.icon} ${plan.weather.label}</span>` : ''}</div>
        <div class="hero-title">${U.esc(s.title)}</div>
        <div class="hero-times">
          <div class="${wakePassed ? 'dim' : ''}"><small>기상</small><b>${U.hmRel(plan.wakeAt, s.date)}</b></div>
          <div class="arrow">›</div>
          <div><small>출발</small><b>${U.hm(plan.departAt)}</b></div>
          <div class="arrow">›</div>
          <div><small>${Planner.isTrip(s.mode) ? '탑승' : '도착'}</small><b>${Planner.isTrip(s.mode) ? s.trip.departTime : s.arriveBy}</b></div>
        </div>
        <div class="hero-left">${plan.departAt.getTime() < now ? '이동 중' : (wakePassed ? '출발까지 ' : '기상까지 ') + U.durLabel(left)}</div>
        <div id="heroBus"></div>
      </div>`;
  },

  row(s, plan) {
    plan = plan || Planner.compute(s);
    const m = Planner.MODES[s.mode];
    const timeLabel = Planner.isTrip(s.mode) ? `${s.trip.departTime} ${m.label}` : `${s.arriveBy} 도착`;
    return `
      <button class="row" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
        <div class="row-ic">${m.emoji}</div>
        <div class="row-main">
          <b>${s._shared ? '👨‍👩‍👧 ' : ''}${Recur.isRepeating(s) ? '🔁 ' : ''}${U.esc(s.title)}${s.hasOverride ? ' <span class="tag">변경됨</span>' : ''}</b>
          <small>${s.date !== U.today() ? U.dateLabel(s.date) + ' · ' : ''}${timeLabel}${s.dest ? ' · ' + U.esc(s.dest.name) : ''}</small>
        </div>
        <div class="row-side"><small>기상</small><b>${U.hm(plan.wakeAt)}</b></div>
      </button>`;
  },

  async checkPermission() {
    const el = document.getElementById('permNotice');
    if (!el) return;
    const st = await Alarm.permissionState();
    if (st !== 'granted' && st !== 'unsupported') {
      el.innerHTML = `<button class="notice warn" onclick="Alarm.requestPermission().then(()=>Home.render())">🔔 알림이 꺼져 있어 깨워 드릴 수 없어요. 눌러서 허용 ›</button>`;
      return;
    }
    const ns = await Alarm.nativeStatus();
    if (ns && (!ns.exact || !ns.fullScreen)) {
      el.innerHTML = `<button class="notice warn" onclick="App.navigate('settings')">⏰ 알람이 정확히 울리려면 권한 설정이 필요해요 ›</button>`;
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
        <button class="btn small primary" onclick="App.navigate('register',{date:'${this.selected}'})">＋ 추가</button></div>
      ${list.length ? list.map(s => Home.row(s)).join('') : '<div class="muted pad">일정이 없어요.</div>'}
    `);
  },
  select(d) { this.selected = d; this.render(); },
  shift(n) { this.month = new Date(this.month.getFullYear(), this.month.getMonth() + n, 1); this.render(); }
};
