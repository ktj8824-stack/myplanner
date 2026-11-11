/* =========================================
   MyPlanner — 라우터 · 공통 화면 요소
   ========================================= */

const App = {
  current: null,
  params: {},
  screens: { home: () => Home, calendar: () => CalendarView, register: () => Register, timeline: () => Timeline, settings: () => Settings, welcome: () => Welcome, start: () => StartScreen, assistant: () => Assistant, market: () => MarketView, day: () => DayView, pro: () => Pro, points: () => PointsView, raffle: () => Raffle },

  async init() {
    State.load();
    this.trackViewport();
    this.applyTextSize();
    await Cloud.init(); // 웹 카카오 로그인에서 돌아온 경우 로그인을 마친 뒤 첫 화면을 고름
    const payBack = await Pro.consumeReturn(); // 토스 결제창에서 돌아온 경우 서버 승인 → PRO 화면
    Pro.refresh(); // 플러스·프리미엄이면 광고 없음 (확인 뒤 광고 정리)
    Points.refresh().then(r => { if (r && this.current === 'home') Home.render(); }); // 홈 출석 체크 줄
    this.renderNav();
    const first = !localStorage.getItem('mp_onboarded');
    // 처음 켤 때: 로그인 화면(한 번) → 시작 화면(이름·집·글자 크기)
    let seen = false;
    try { seen = !!localStorage.getItem('mp_start_seen'); } catch (e) {}
    let after = null;
    try { after = sessionStorage.getItem('mp_after_login'); sessionStorage.removeItem('mp_after_login'); } catch (e) {}
    this.navigate(payBack && !first ? payBack : first ? (seen || Cloud.isSignedIn() ? 'welcome' : 'start') : (after && Cloud.isSignedIn() && this.screens[after] ? after : 'home'));
    Share.fromLocation(); // 카톡으로 받은 일정 링크로 열렸으면
    await Alarm.init();
    if (this.current === 'home') Home.render();

    // 안드로이드 뒤로가기
    const capApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (capApp) {
      capApp.addListener('backButton', () => {
        if (Sheet.isOpen()) return Sheet.close();
        if (this.current === 'register' && typeof Register !== 'undefined') return Register.back(); // 쓰던 새 일정을 묻지 않고 버리지 않게
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
    document.getElementById('nav').style.display = ['welcome', 'start'].includes(name) ? 'none' : '';
    document.querySelectorAll('#nav [data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
    const b = document.body.classList;
    b.toggle('no-nav', ['welcome', 'start'].includes(name));
    b.toggle('scr-ai', name === 'assistant'); // AI 비서: 아래 메뉴 위에 입력창
    document.getElementById('nav').style.display = ['welcome', 'start', 'register'].includes(name) ? 'none' : '';
    const main = document.getElementById('main');
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    view.render(params);
    if (typeof Ads !== 'undefined') Ads.sync(); // 아래 배너 광고 (광고 없는 화면이면 숨김)
  },

  renderNav() {
    document.getElementById('topbar').innerHTML = `
      <div class="topbar-in">
        <button class="brand" onclick="App.navigate('home')"><img src="icon-192.png" alt="">마이플래너</button>
        <button class="top-btn" onclick="App.openMenu()" aria-label="전체 메뉴"><svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M3.5 7h17M3.5 12h17M3.5 17h17"/></svg></button>
      </div>`;
    const items = [['home', 'home', '홈'], ['calendar', 'calendar', '캘린더'], ['assistant', null, 'AI 비서'], ['market', 'bag', '마켓'], ['settings', 'user', '마이']];
    document.getElementById('nav').innerHTML = items.map(([k, ic, label]) =>
      `<button data-nav="${k}" class="${k === 'assistant' ? 'nav-ai' : ''}" onclick="App.navigate('${k}')" aria-label="${label}"><span class="nav-ic">${ic ? Icons.svg(ic) : App.micSvg()}</span><span${k === 'assistant' ? ' class="nav-ai-label"' : ''}>${label}</span></button>`).join('');
  },

  /** AI 비서 마이크 (입체: 위쪽 빛, 아래 그림자) */
  micSvg() {
    return `<svg class="mic3d" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="micBody" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFE7A3"/><stop offset=".45" stop-color="#FFC94D"/><stop offset="1" stop-color="#E9A21C"/></linearGradient>
        <linearGradient id="micStand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C9D2E3"/></linearGradient>
      </defs>
      <ellipse cx="16" cy="28.4" rx="6.5" ry="1.3" fill="#0B1324" opacity=".35"/>
      <path d="M9.2 14.6a6.8 6.8 0 0 0 13.6 0" fill="none" stroke="url(#micStand)" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M16 21.4v4.4M12.2 26.4h7.6" stroke="url(#micStand)" stroke-width="2.2" stroke-linecap="round"/>
      <rect x="11.6" y="3.6" width="8.8" height="15.2" rx="4.4" fill="url(#micBody)"/>
      <path d="M12.8 9h2.4M12.8 11.6h2.4M12.8 14.2h2.4M16.8 9h2.4M16.8 11.6h2.4M16.8 14.2h2.4" stroke="#B9790A" stroke-width=".9" stroke-linecap="round" opacity=".55"/>
      <rect x="13" y="4.8" width="2.2" height="7.6" rx="1.1" fill="#FFFFFF" opacity=".75"/>
    </svg>`;
  },

  /** 전체 메뉴 (상단 ≡) */
  openMenu() {
    const items = [
      ['register', 'img/icons/register.png', '일정 추가', '도착 시간만 넣으면 알람까지'],
      ['paste', 'img/icons/message.png', '받은 문자로 등록', 'KTX·항공권·병원 예약 문자'],
      ['assistant', 'img/icons/community.png', 'AI 비서', '말로 일정 등록 · 질문'],
      ['calendar', 'img/icons/calendar.png', '캘린더', '월별 일정 보기'],
      ['points', 'img/icons/raffle.png', '포인트 · 출석 체크', '출석하고 포인트 모아 럭키드로우 응모'],
      ['raffle', 'img/icons/raffle.png', '럭키드로우', '모은 포인트로 경품 응모'],
      ['pro', 'img/icons/settings.png', '이용권', '3월 31일까지 출시 기념 무료'],
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
/* 아이폰 자판이 올라오면 보이는 화면 높이가 줄어듦 → 시트를 보이는 영역에 맞춰 위가 잘리지 않게 */
App.trackViewport = function () {
  const vv = window.visualViewport;
  if (!vv) return;
  const set = () => {
    const r = document.documentElement.style;
    r.setProperty('--vvh', Math.round(vv.height) + 'px');
    r.setProperty('--vvtop', Math.round(vv.offsetTop) + 'px');
  };
  vv.addEventListener('resize', set);
  vv.addEventListener('scroll', set);
  set();
};

const Sheet = {
  open(html, cls = '') {
    const el = document.getElementById('sheet');
    el.innerHTML = `<div class="sheet-bg" onclick="Sheet.close()"></div><div class="sheet-panel ${cls}">${html}</div>`;
    el.classList.add('show');
    if (typeof Ads !== 'undefined') Ads.sync(); // 앱 광고는 화면 위에 따로 떠 있어 시트를 가리므로 숨김
  },
  close() { document.getElementById('sheet').classList.remove('show'); if (typeof Ads !== 'undefined') Ads.sync(); },
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
      <div id="ppResults" class="pp-results"><div class="muted pad">가는 곳 이름을 적어 주세요.</div></div>`, 'pp-sheet');
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
    const offline = Routes.lastSource === 'offline' || navigator.onLine === false;
    if (!this.results.length) {
      box.innerHTML = offline
        ? `<div class="pp-note">장소 검색이 잠시 안 돼요. 인터넷을 확인하고 다시 검색해 주세요. (지금은 주요 역·공항만 찾을 수 있어요)</div>`
        : `<div class="muted pad">‘${U.esc(q.trim())}’ 검색 결과가 없어요. 다른 이름이나 주소로 찾아 보세요.</div>${sampleNote}`;
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
/* ---------- 로그인 화면: 처음 켤 때 한 번 ---------- */
const StartScreen = {
  render() {
    App.setMain(`
      <div class="start">
        <div class="start-top">
          <div class="start-logo"><img src="icon-192.png" alt=""></div>
          <h1>마이플래너</h1>
          <p>도착 시간만 정하면<br>언제 일어나고 언제 나갈지 깨워 드려요</p>
        </div>
        <div class="start-bottom">
          <ul class="start-perks" aria-label="로그인하면 쓸 수 있는 것">
            <li><img src="img/icons/community.png" alt="">AI 비서에게 말로 일정 등록</li>
            <li><img src="img/icons/register.png" alt="">폰을 바꿔도 일정 그대로</li>
            <li><img src="img/icons/group.png" alt="">가족에게 알람 보내기</li>
          </ul>
          <button class="kakao-btn" onclick="StartScreen.kakao()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.48 3 2 6.58 2 11c0 2.83 1.84 5.31 4.6 6.73l-.93 3.43c-.08.3.25.54.51.37l4.08-2.7c.57.08 1.15.12 1.74.12 5.52 0 10-3.58 10-8S17.52 3 12 3z"/></svg>
            카카오로 시작하기</button>
          <button class="start-skip" onclick="StartScreen.skip()">로그인 없이 시작하기</button>
          <p class="start-note">로그인 없이도 일정·알람은 모두 쓸 수 있어요.<br>나중에 마이 화면에서 언제든 로그인할 수 있어요.</p>
        </div>
      </div>`);
  },
  seen() { try { localStorage.setItem('mp_start_seen', '1'); } catch (e) {} },
  async kakao() {
    if (navigator.onLine === false) return U.toast('인터넷에 연결된 뒤 다시 눌러 주세요.');
    if (this._busy) return; // 두 번 눌러도 로그인 창은 한 번만
    this._busy = true;
    try {
      this.seen();
      // 웹은 카카오 화면으로 갔다가 돌아오면 시작 화면부터, 앱은 그 자리에서 로그인 후 시작 화면으로
      await Cloud.signInKakao();
      if (Cloud.isSignedIn()) App.navigate(this.next()); // 실패하면 이 화면에 남아 다시 누르거나 '로그인 없이' 고를 수 있게
    } finally { this._busy = false; }
  },
  skip() { this.seen(); App.navigate(this.next()); },
  /** 처음이면 이름·집 넣는 화면, 로그아웃 뒤 다시 온 경우면 바로 홈 */
  next() { return localStorage.getItem('mp_onboarded') ? 'home' : 'welcome'; },
};

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
        <button class="btn ghost big" onclick="Welcome.finish('demo')">예시 일정으로 먼저 둘러보기</button>
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
