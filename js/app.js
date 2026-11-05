/* =========================================
   MyPlanner — 라우터 · 공통 화면 요소
   ========================================= */

const App = {
  current: null,
  params: {},
  screens: { home: () => Home, calendar: () => CalendarView, register: () => Register, timeline: () => Timeline, settings: () => Settings, welcome: () => Welcome, assistant: () => Assistant, market: () => MarketView, day: () => DayView },

  async init() {
    State.load();
    this.applyTextSize();
    Cloud.init();
    this.renderNav();
    const first = !localStorage.getItem('mp_onboarded');
    this.navigate(first ? 'welcome' : 'home');
    Share.fromLocation(); // 카톡으로 받은 일정 링크로 열렸으면
    await Alarm.init();
    if (this.current === 'home') Home.render();

    // 안드로이드 뒤로가기
    const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (capApp) {
      capApp.addListener('backButton', () => {
        if (Sheet.isOpen()) return Sheet.close();
        if (this.current === 'home') return capApp.exitApp();
        this.navigate('home');
      });
    }
    // 앱이 일정 링크로 열렸을 때 (도메인 앱 링크 연결 후 동작. 카카오 로그인 콜백 등 다른 주소는 무시)
    if (capApp) {
      capApp.addListener('appUrlOpen', ev => {
        const o = Share.detect(ev && ev.url);
        if (o) setTimeout(() => Share.openImport(o), 300);
      });
    }
    if ('serviceWorker' in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  },

  navigate(name, params = {}) {
    this.current = name;
    this.params = params;
    const view = this.screens[name]();
    document.getElementById('nav').style.display = name === 'welcome' ? 'none' : '';
    document.querySelectorAll('#nav [data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
    const b = document.body.classList;
    b.toggle('no-nav', name === 'welcome' || name === 'assistant');
    document.getElementById('nav').style.display = ['welcome', 'register'].includes(name) ? 'none' : '';
    const main = document.getElementById('main');
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    view.render(params);
  },

  renderNav() {
    document.getElementById('topbar').innerHTML = `
      <div class="topbar-in">
        <button class="brand" onclick="App.navigate('home')"><img src="icon-192.png" alt="">마이플래너</button>
        <button class="top-btn" onclick="App.openMenu()" aria-label="전체 메뉴"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M3.5 7h17M3.5 12h17M3.5 17h17"/></svg></button>
      </div>`;
    const items = [['home', 'home', '홈'], ['calendar', 'calendar', '캘린더'], ['assistant', null, 'AI 비서'], ['market', 'bag', '마켓'], ['settings', 'user', '마이']];
    document.getElementById('nav').innerHTML = items.map(([k, ic, label]) =>
      `<button data-nav="${k}" class="${k === 'assistant' ? 'nav-ai' : ''}" onclick="App.navigate('${k}')" aria-label="${label}"><span class="nav-ic">${ic ? Icons.svg(ic) : '<img src="img/icons/community.png" alt="">'}</span><span>${label}</span></button>`).join('');
  },

  /** 전체 메뉴 (상단 ≡) */
  openMenu() {
    const items = [
      ['register', 'img/icons/register.png', '일정 추가', '도착 시간만 넣으면 알람까지'],
      ['paste', 'img/icons/message.png', '받은 문자로 등록', 'KTX·항공권·병원 예약 문자'],
      ['assistant', 'img/icons/community.png', 'AI 비서', '말로 일정 등록 · 질문'],
      ['calendar', 'img/icons/calendar.png', '캘린더', '월별 일정 보기'],
      ['market', 'img/icons/market.png', '마켓', '출퇴근·여행 필수템'],
      ['settings', 'img/icons/settings.png', '설정', '집 주소 · 알람 · 글자 크기 · 가족']
    ];
    Sheet.open(`<div class="sheet-head"><b>전체 메뉴</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <div class="menu-list">${items.map(([k, img, t, d]) => `<button class="menu-item" onclick="Sheet.close();${k === 'paste' ? "App.navigate('register',{paste:true})" : `App.navigate('${k}')`}"><img src="${img}" alt=""><span>${t}<small>${d}</small></span></button>`).join('')}
      ${typeof Demo !== 'undefined' ? `<button class="menu-item" onclick="Sheet.close();${Demo.has() ? 'Demo.remove()' : 'Demo.add()'}"><img src="img/icons/timeline.png" alt=""><span>${Demo.has() ? '예시 일정 지우기' : '예시 일정으로 둘러보기'}<small>기능을 한눈에 보는 일정 3개</small></span></button>` : ''}</div>`);
  },

  /** 글자 크기: 보통 / 크게 / 아주 크게 (40~60대) — 화면 전체를 같은 비율로 키움 */
  TEXT_SIZES: { normal: 1, large: 1.12, xlarge: 1.25 },
  applyTextSize() {
    const k = State.settings.textSize || 'normal';
    document.documentElement.dataset.text = k;
    document.documentElement.style.setProperty('--zoom', this.TEXT_SIZES[k] || 1);
  },

  setMain(html) { document.getElementById('main').innerHTML = html; }
};

/* ---------- 아래에서 올라오는 시트 (장소 검색 등) ---------- */
const Sheet = {
  open(html) {
    const el = document.getElementById('sheet');
    el.innerHTML = `<div class="sheet-bg" onclick="Sheet.close()"></div><div class="sheet-panel">${html}</div>`;
    el.classList.add('show');
  },
  close() { document.getElementById('sheet').classList.remove('show'); },
  isOpen() { return document.getElementById('sheet').classList.contains('show'); }
};

/* ---------- 장소 검색 시트 ---------- */
const PlacePicker = {
  cb: null,
  open(title, cb, opts = {}) {
    this.cb = cb;
    this.results = [];
    const home = State.settings.home;
    Sheet.open(`
      <div class="sheet-head"><b>${U.esc(title)}</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <div class="search-row">
        <div class="search-box">${Icons.svg('search')}
          <input id="ppInput" class="input" placeholder="장소·역·주소 (예: 서울아산병원)" enterkeyhint="search" autocomplete="off"
            onkeydown="if(event.key==='Enter'){PlacePicker.search()}" oninput="PlacePicker.debounced()"></div>
        <button class="btn primary" onclick="PlacePicker.search()">검색</button>
      </div>
      <div class="quick-row">
        ${home && opts.allowHome !== false ? `<button class="chip" onclick="PlacePicker.pickHome()">${U.icon('home')} 집 · ${U.esc(home.name)}</button>` : ''}
        <button class="chip" onclick="PlacePicker.pickCurrent()">${U.icon('pin')} 현재 위치</button>
      </div>
      <div id="ppResults" class="pp-results"><div class="muted pad">가는 곳 이름을 적어 주세요.</div></div>`);
    if (opts.query) {
      document.getElementById('ppInput').value = opts.query;
      this.search();
    } else {
      setTimeout(() => document.getElementById('ppInput')?.focus(), 250);
    }
  },
  debounced() { clearTimeout(this._t); this._t = setTimeout(() => this.search(), 450); },
  async search() {
    const q = document.getElementById('ppInput').value;
    if (!q.trim()) return;
    const box = document.getElementById('ppResults');
    box.innerHTML = '<div class="muted pad">찾는 중…</div>';
    const seq = (this._seq = (this._seq || 0) + 1);
    const results = await Routes.searchPlace(q);
    if (seq !== this._seq) return; // 더 최근 검색이 있으면 무시
    this.results = results;
    const sampleNote = Routes.lastSource === 'offline' || navigator.onLine === false
      ? `<div class="pp-note">장소 검색 서버에 연결하지 못했어요. 인터넷 연결을 확인하고 다시 검색해 주세요. (지금은 주요 역·공항만 찾을 수 있어요)</div>`
      : Routes.lastSource === 'sample'
      ? `<div class="pp-note">지금은 장소 검색 서버가 준비 중이라 주요 역·공항만 찾을 수 있어요. 곧 모든 장소가 검색돼요.</div>` : '';
    if (!this.results.length) {
      box.innerHTML = `<div class="muted pad">‘${U.esc(q.trim())}’ 검색 결과가 없어요. 다른 이름이나 주소로 찾아 보세요.</div>${sampleNote}`;
      return;
    }
    box.innerHTML = this.results.map((p, i) => `
      <button class="pp-item" onclick="PlacePicker.pick(${i})">
        <span class="pp-pin"><img src="img/icons/pin.png" alt=""></span>
        <span><b>${U.esc(p.name)}</b>${p.address ? `<small>${U.esc(p.address)}</small>` : ''}</span>
      </button>`).join('') + sampleNote;
  },
  pick(i) { this.done(this.results[i]); },
  pickHome() { this.done({ ...State.settings.home }); },
  pickCurrent() {
    if (!navigator.geolocation) return U.toast('위치를 사용할 수 없어요.');
    U.toast('현재 위치를 찾는 중…');
    navigator.geolocation.getCurrentPosition(
      pos => this.done({ name: '현재 위치', address: '', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => U.toast('위치 권한을 허용해 주세요.'), { enableHighAccuracy: true, timeout: 10000 });
  },
  done(place) { Sheet.close(); if (this.cb) this.cb(place); }
};

/* ---------- 첫 실행 안내 ---------- */
const Welcome = {
  render() {
    const st = State.settings;
    App.setMain(`
      <div class="welcome">
        <div class="welcome-logo"><img src="icon-192.png" alt=""></div>
        <h1>마이플래너</h1>
        <p class="lead">도착 시간만 정하면, 언제 일어나고<br>언제 나가야 할지 거꾸로 계산해서 깨워 드려요.</p>

        <div class="welcome-demo" aria-label="예: 9시 도착이면 7시 12분 기상">
          <div><small>도착</small><b>09:00</b></div>
          <span>‹</span>
          <div><small>출발</small><b>08:12</b></div>
          <span>‹</span>
          <div class="wake"><small>기상</small><b>07:12</b></div>
        </div>
        <p class="welcome-caption">버스·지하철·자가용 경로와 날씨, 아침 교통까지 반영해요</p>

        <div class="card">
          <label class="lbl">이름 <small class="muted">(선택)</small></label>
          <input id="wName" class="input" placeholder="예: 김민지" value="${U.esc(st.name)}" autocomplete="name">
          <label class="lbl">집 <small class="muted">출발지로 써요</small></label>
          <button id="wHome" class="input place-btn ${st.home ? '' : 'empty'}" onclick="Welcome.pickHome()">${U.icon('home')} ${st.home ? U.esc(st.home.name) : '집 주소 검색'}</button>
          <label class="lbl">글자 크기</label>
          <div class="seg text-size">${[['normal', '보통'], ['large', '크게'], ['xlarge', '아주 크게']].map(([k, l]) =>
            `<button class="${(st.textSize || 'normal') === k ? 'on' : ''} ts-${k}" onclick="Welcome.setText('${k}')">${l}</button>`).join('')}</div>
        </div>

        <button class="btn primary big" onclick="Welcome.finish('register')">첫 일정 만들기</button>
        <button class="btn ghost big" onclick="Welcome.finish('demo')">✨ 예시 일정으로 먼저 둘러보기</button>
        <p class="muted small center" style="margin-top:14px">알람을 받으려면 다음에 나오는 알림 허용을 눌러 주세요.</p>
      </div>`);
  },
  keepName() {
    const el = document.getElementById('wName');
    if (el) State.settings.name = el.value.trim();
  },
  setText(k) {
    this.keepName();
    State.settings.textSize = k;
    State.save();
    App.applyTextSize();
    this.render();
  },
  pickHome() {
    this.keepName();
    PlacePicker.open('집 주소', p => {
      State.settings.home = { ...p, name: p.name === '현재 위치' ? '집' : p.name };
      State.save();
      this.render();
    }, { allowHome: false });
  },
  async finish(next) {
    this.keepName();
    State.save();
    localStorage.setItem('mp_onboarded', '1');
    await Alarm.requestPermission().catch(() => {});
    if (next === 'demo') return Demo.add();
    App.navigate(next === 'register' ? 'register' : 'home');
    if (next === 'register' && !State.settings.home) U.toast('출발지를 고르면 경로를 찾아 드려요');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
