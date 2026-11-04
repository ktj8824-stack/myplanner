/* =========================================
   MyPlanner — 홈 · 캘린더
   ========================================= */

const Home = {
  render() {
    const name = State.settings.name;
    const up = State.upcoming();
    const next = up[0];
    // 다가오는 일정: 반복 일정은 가장 가까운 회차 하나만
    const seen = new Set();
    const list = up.filter(x => { const k = x.s.baseId || x.s.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);

    App.setMain(`
      ${next ? this.hero(next, name) : this.emptyHero(name)}
      <div class="hm-sheet">
        ${Demo.bar()}
        <div id="permNotice"></div>
        ${!State.settings.home ? `<button class="notice" onclick="App.navigate('settings')">🏠 집 주소를 등록하면 출발지가 자동으로 들어가요</button>` : ''}

        <div class="up-box">
          <div class="up-head"><span class="up-title">다가오는 일정</span><button class="up-more" onclick="App.navigate('calendar')">전체보기 ›</button></div>
          <div class="list">${list.length ? list.map(x => this.row(x.s, x.plan)).join('') : '<div class="empty-line">아직 일정이 없어요. 아래 일정 등록을 눌러 보세요.</div>'}</div>
        </div>

        <div class="qa-big">
          <button class="qa" onclick="App.navigate('register')"><span class="qa-ic bg-blue"><img src="img/icons/register.png" alt=""></span><span><b>일정 등록</b><small>도착 시간 · 출발 알람</small></span></button>
          <button class="qa" onclick="App.navigate('assistant')"><span class="qa-ic bg-yellow"><img src="img/icons/community.png" alt=""></span><span><b>AI 비서<span class="pro">PRO</span></b><small>말로 일정 등록</small></span></button>
        </div>
        <div class="qa-small">
          <button class="qa" onclick="App.navigate('register',{paste:true})"><span class="qa-ic bg-purple"><img src="img/icons/message.png" alt=""></span><span>받은 문자</span></button>
          <button class="qa" onclick="App.navigate('calendar')"><span class="qa-ic bg-green"><img src="img/icons/calendar.png" alt=""></span><span>캘린더</span></button>
          <button class="qa" onclick="App.navigate('market')"><span class="qa-ic bg-cyan"><img src="img/icons/market.png" alt=""></span><span>마켓</span></button>
          <button class="qa" onclick="App.navigate('settings')"><span class="qa-ic bg-orange"><img src="img/icons/group.png" alt=""></span><span>가족 공유</span></button>
        </div>

        ${this.week()}
        ${Briefing.card()}
      </div>
    `);
    this.checkPermission();
    if (next) Bus.renderInto('heroBus', next.s, next.plan);
  },

  /** 남색 히어로: 다음 일정의 기상 → 출발 → 도착 */
  hero({ s, plan }, name) {
    const now = Date.now();
    const wakePassed = plan.wakeAt.getTime() < now;
    const moving = plan.departAt.getTime() < now;
    const left = Math.max(0, Math.round(((wakePassed ? plan.departAt : plan.wakeAt) - now) / 60000));
    const mode = Planner.MODES[s.mode];
    const trip = Planner.isTrip(s.mode);
    const rel = U.dateLabel(s.date).split(' · ')[1] || U.dateLabel(s.date);
    const wakeRel = U.hmRel(plan.wakeAt, s.date).startsWith('전날');
    const title = moving ? `이동 중이에요<br>${trip ? '탑승' : '도착'} <b>${trip ? s.trip.departTime : s.arriveBy}</b>`
      : wakePassed ? `<b>${U.hm(plan.departAt)}</b>에<br>출발하세요`
      : `${wakeRel ? '전날 ' : rel === '오늘' ? '오늘 ' : rel === '내일' ? '내일 ' : ''}<b>${U.hm(plan.wakeAt)}</b>에<br>깨워 드릴게요`;
    return `
      <section class="hm-hero">
        <div class="hm-row">
          <div class="hm-text">
            <div class="hm-tag">${U.esc(rel)} · ${U.esc(s.title)}</div>
            <div class="hm-title">${title}</div>
          </div>
          <div class="hm-figure"><img src="img/hero-alarm.png" alt=""></div>
        </div>
        <div class="hm-chips"><span class="hm-chip">${mode.emoji} ${mode.label}</span>${Recur.isRepeating(s) ? '<span class="hm-chip">🔁 반복</span>' : ''}${plan.weather ? `<span class="hm-chip">${plan.weather.icon} ${plan.weather.label}</span>` : ''}${s._shared ? `<span class="hm-chip">👨‍👩‍👧 ${U.esc(s._shared.from)}</span>` : ''}</div>
        <button class="mini-tl" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
          <div class="mini-node ${wakePassed ? 'dim' : 'hl'}"><span class="mini-tag t-wake">기상</span><span class="mini-val">${U.hm(plan.wakeAt)}</span>${wakeRel ? '<span class="mini-sub">전날</span>' : ''}</div>
          <span class="mini-arrow">›</span>
          <div class="mini-node ${moving ? 'dim' : ''}"><span class="mini-tag t-depart">출발</span><span class="mini-val">${U.hm(plan.departAt)}</span></div>
          <span class="mini-arrow">›</span>
          <div class="mini-node"><span class="mini-tag t-arrive">${trip ? '탑승' : '도착'}</span><span class="mini-val">${trip ? s.trip.departTime : s.arriveBy}</span></div>
        </button>
        ${plan.live ? `<div class="hm-live">📡 ${U.esc(Live.label(s))}</div>` : ''}
        <div id="heroBus"></div>
        <div class="hm-actions">
          <button class="pill-btn" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">타임라인 보기 ›</button>
          <span class="hm-left">${moving ? '' : (wakePassed ? '출발까지 ' : '기상까지 ') + U.durLabel(left)}</span>
        </div>
      </section>`;
  },

  emptyHero(name) {
    const h = new Date().getHours();
    const greet = h < 5 ? '늦은 밤이에요' : h < 11 ? '좋은 아침이에요' : h < 17 ? '좋은 오후예요' : '좋은 저녁이에요';
    return `
      <section class="hm-hero">
        <div class="hm-row">
          <div class="hm-text">
            <div class="hm-tag">${name ? U.esc(name) + '님, ' : ''}${greet}</div>
            <div class="hm-title">도착 시간만 넣으면<br>거꾸로 계산해<br>깨워 드려요</div>
          </div>
          <div class="hm-figure"><img src="img/hero-alarm.png" alt=""></div>
        </div>
        <button class="mini-tl" onclick="App.navigate('register')">
          <div class="mini-node hl"><span class="mini-tag t-wake">기상</span><span class="mini-val">--:--</span></div>
          <span class="mini-arrow">›</span>
          <div class="mini-node"><span class="mini-tag t-depart">출발</span><span class="mini-val">--:--</span></div>
          <span class="mini-arrow">›</span>
          <div class="mini-node"><span class="mini-tag t-arrive">도착</span><span class="mini-val">--:--</span></div>
        </button>
        <div class="hm-actions">
          <button class="pill-btn" onclick="App.navigate('register')">새 일정 등록하기 ›</button>
          <button class="hm-left" onclick="Demo.add()" style="text-decoration:underline;text-underline-offset:3px">예시로 둘러보기</button>
        </div>
      </section>`;
  },

  /** 이번 주 띠 (일~토) */
  week() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const days = [...Array(7)].map((_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const from = U.ymd(days[0]), to = U.ymd(days[6]);
    const has = new Set(Recur.between(State.schedules, from, to).map(s => s.date));
    return `
      <div class="week-card">
        <div class="week-head"><b>${now.getMonth() + 1}월 이번 주</b><button class="btn small primary" onclick="App.navigate('register')">＋ 일정등록</button></div>
        <div class="week-grid" onclick="App.navigate('calendar')">${days.map((d, i) => {
          const k = U.ymd(d);
          return `<div class="week-col"><span class="week-dn ${i === 0 || Recur.holiday(k) ? 'sun' : i === 6 ? 'sat' : ''}">${U.DOW[i]}</span>
            <span class="week-num ${k === U.today() ? 'today' : ''}">${d.getDate()}</span><span class="week-dot ${has.has(k) ? '' : 'none'}"></span></div>`;
        }).join('')}</div>
      </div>`;
  },

  row(s, plan) {
    plan = plan || Planner.compute(s);
    const m = Planner.MODES[s.mode];
    const trip = Planner.isTrip(s.mode);
    const timeLabel = trip ? `${s.trip.departTime} ${s.trip.number ? U.esc(s.trip.number) : m.label} 탑승` : `${s.arriveBy} 도착`;
    const place = trip ? (s.trip.departStation && s.trip.departStation.name) : (s.dest && s.dest.name);
    const day = s.date === U.today() ? '오늘' : (U.dateLabel(s.date).split(' · ')[1] || U.dateLabel(s.date));
    return `
      <button class="row" onclick="App.navigate('timeline',{id:'${s.occId || s.id}'})">
        <div class="row-time"><b>${U.hm(plan.wakeAt)}</b><small>기상</small></div>
        <div class="row-main">
          <b>${s._shared ? '👨‍👩‍👧 ' : ''}${Recur.isRepeating(s) ? '🔁 ' : ''}${U.esc(s.title)}${s.hasOverride ? ' <span class="tag">변경됨</span>' : ''}${s.demo ? ' <span class="tag demo">예시</span>' : ''}</b>
          <small>${day} · ${timeLabel}${place ? ' · ' + U.esc(place) : ''}</small>
        </div>
        <div class="row-ic">${m.emoji}</div>
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
      <header class="top"><h1>📅 캘린더</h1></header>
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
