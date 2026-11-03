/* =========================================
   MyPlanner — 라우터 · 공통 화면 요소
   ========================================= */

const App = {
  current: null,
  params: {},
  screens: { home: () => Home, calendar: () => CalendarView, register: () => Register, timeline: () => Timeline, settings: () => Settings, welcome: () => Welcome },

  async init() {
    State.load();
    this.renderNav();
    const first = !localStorage.getItem('mp_onboarded');
    this.navigate(first ? 'welcome' : 'home');
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
    const main = document.getElementById('main');
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    view.render(params);
  },

  renderNav() {
    const items = [['home', '🏠', '홈'], ['calendar', '📅', '캘린더'], ['register', '＋', '일정 추가'], ['settings', '⚙️', '설정']];
    document.getElementById('nav').innerHTML = items.map(([k, ic, label]) =>
      `<button data-nav="${k}" class="${k === 'register' ? 'nav-add' : ''}" onclick="App.navigate('${k}')"><span class="nav-ic">${ic}</span><span>${label}</span></button>`).join('');
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
        <input id="ppInput" class="input" placeholder="장소, 역, 주소 검색 (예: 강남역)" enterkeyhint="search"
          onkeydown="if(event.key==='Enter'){PlacePicker.search()}" oninput="PlacePicker.debounced()">
        <button class="btn primary" onclick="PlacePicker.search()">검색</button>
      </div>
      <div class="quick-row">
        ${home && opts.allowHome !== false ? `<button class="chip" onclick="PlacePicker.pickHome()">🏠 집 · ${U.esc(home.name)}</button>` : ''}
        <button class="chip" onclick="PlacePicker.pickCurrent()">📍 현재 위치</button>
      </div>
      <div id="ppResults" class="pp-results"><div class="muted pad">검색어를 입력하세요.</div></div>`);
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
    box.innerHTML = '<div class="muted pad">검색 중…</div>';
    this.results = await Routes.searchPlace(q);
    if (!this.results.length) {
      box.innerHTML = `<div class="muted pad">검색 결과가 없어요.${Routes.can('tmap') || Routes.key('KAKAO_REST_KEY') ? '' : '<br><small>장소 검색 키가 없어 예시 장소(주요 역·공항)만 검색돼요.</small>'}</div>`;
      return;
    }
    box.innerHTML = this.results.map((p, i) => `
      <button class="pp-item" onclick="PlacePicker.pick(${i})">
        <b>${U.esc(p.name)}</b><small>${U.esc(p.address || '')}</small>
      </button>`).join('');
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
    App.setMain(`
      <div class="welcome">
        <div class="welcome-logo">🗓️</div>
        <h1>마이플래너</h1>
        <p class="lead">도착 시간만 정하면<br>언제 일어나고 언제 나가야 할지<br>거꾸로 계산해서 깨워 드려요.</p>
        <div class="card">
          <label class="lbl">이름 (선택)</label>
          <input id="wName" class="input" placeholder="예: 김민지" value="${U.esc(State.settings.name)}">
          <label class="lbl">집 (출발지)</label>
          <button id="wHome" class="input place-btn" onclick="Welcome.pickHome()">${State.settings.home ? '🏠 ' + U.esc(State.settings.home.name) : '집 주소 검색'}</button>
        </div>
        <button class="btn primary big" onclick="Welcome.finish()">시작하기</button>
        <p class="muted small center">알람을 받으려면 다음 화면에서 알림을 허용해 주세요.</p>
      </div>`);
  },
  pickHome() {
    PlacePicker.open('집 주소', p => {
      State.settings.home = { ...p, name: p.name === '현재 위치' ? '집' : p.name };
      document.getElementById('wHome').textContent = '🏠 ' + State.settings.home.name;
    }, { allowHome: false });
  },
  async finish() {
    State.settings.name = document.getElementById('wName').value.trim();
    State.save();
    localStorage.setItem('mp_onboarded', '1');
    await Alarm.requestPermission().catch(() => {});
    App.navigate('home');
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
