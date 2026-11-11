/* =========================================
   마이플래너 — 차에 타면 자동 길안내 (버디·로드플래너와 같은 방식)
   앱 주소 뒤에 ?go=next 를 붙여 열거나(웹), 아이폰 앱을 myplanner://next 로 열면
   오늘 일정에서 '지금 가야 할 곳'으로 내비를 엽니다. 출발지는 넘기지 않아 내비가 현재 위치에서 안내.
   - 아이폰: 단축어 자동화 "CarPlay(또는 차 블루투스)에 연결되면 → URL 열기"
   - 갤럭시: 모드 및 루틴 "차량 블루투스 연결 시 → 웹페이지 열기"
   가야 할 곳: (일정 장소 또는 역·공항) → (끝나고) 집
   ========================================= */
const AutoNav = {
  APP_LINK: 'myplanner://next',   // 아이폰 앱: 사파리 대신 앱이 바로 열림 → 내비 열 때 확인 창 없음
  get WEB_LINK() { return (typeof Share !== 'undefined' ? Share.WEB : 'https://ktj8824-stack.github.io/myplanner/') + '?go=next'; },
  get LINK() { return this._isIOSApp() ? this.APP_LINK : this.WEB_LINK; },
  WAIT_MS: 8000,
  EARLY_MIN: 30,      // 출발 30분 전부터는 그 구간으로 봄
  LATE_MIN: 45,       // 도착 시각 + 45분까지는 늦게 출발해도 그 장소로
  AHEAD_MIN: 120,     // 2시간보다 더 뒤에 출발하는 일정은 '다음 일정' 안내만
  HOME_GRACE: 180,    // 귀가 출발 후 3시간이 지나면 끝난 것으로
  _timer: null,
  _launched: false,

  _isIOSApp() { const C = window.Capacitor; return !!(C && C.getPlatform && C.getPlatform() === 'ios'); },
  isAppLink(url) { return /^myplanner:\/\/(go[=/])?next\b/i.test(String(url || '')); },

  // 주소에 go=next 가 있으면 지우고 true
  _consumeFlag() {
    try {
      const u = new URL(location.href);
      const q = u.searchParams.get('go');
      const h = (u.hash || '').replace(/^#/, '');
      if (q !== 'next' && h !== 'go=next' && h !== 'next') return false;
      u.searchParams.delete('go');
      if (h === 'go=next' || h === 'next') u.hash = '';
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      return true;
    } catch (e) { return false; }
  },

  init() {
    if (this._consumeFlag()) { this._run(); return; }
    const A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!A) return;
    // 아이폰 앱이 myplanner://next 로 처음 켜진 경우 + 이미 켜져 있을 때
    try { if (A.getLaunchUrl) A.getLaunchUrl().then(r => { if (r && this.isAppLink(r.url)) this._run(); }).catch(() => {}); } catch (e) { /* */ }
    try { A.addListener('appUrlOpen', ev => { if (ev && this.isAppLink(ev.url)) this._run(); }); } catch (e) { /* */ }
  },
  _run() {
    if (this._launched) return;
    this._launched = true; setTimeout(() => { this._launched = false; }, 4000);
    setTimeout(() => this.start(), 300);
  },

  /** 한 일정의 이동 구간 (가는 길, 끝나고 집) */
  _legs(s, plan) {
    const trip = Planner.isTrip(s.mode);
    const legs = [];
    const to = trip ? (s.trip && s.trip.departStation) : s.dest;
    if (to && isFinite(to.lat) && isFinite(to.lng) && plan.departAt) {
      const due = trip ? Planner.at(s.date, s.trip.departTime) : Planner.at(s.date, s.arriveBy);
      legs.push({ dep: plan.departAt, until: new Date(due.getTime() + this.LATE_MIN * 60000), to,
        mode: trip ? (s.trip.accessMode || 'transit') : s.mode,
        label: trip ? `${to.name || '역'}으로 출발` : `${s.title || '일정'} 장소로 출발` });
    }
    const gh = s.goHome;
    const home = (gh && gh.to) || State.settings.home;
    if (plan.homeDepartAt && gh && gh.on && home && isFinite(home.lat)) {
      legs.push({ dep: plan.homeDepartAt, until: new Date(plan.homeDepartAt.getTime() + this.HOME_GRACE * 60000), to: home,
        mode: gh.mode || 'transit', label: '집으로 귀가' });
    }
    return legs;
  },

  /** 지금 가야 할 곳 */
  nextLeg(now = new Date()) {
    if (typeof State === 'undefined' || !Array.isArray(State.schedules)) return null;
    const today = U.ymd(now);
    const list = Recur.between(State.schedules.filter(s => !s._shared), Recur.shift(today, -1), Recur.shift(today, 1));
    const t = now.getTime();
    let todayCount = 0, later = null;
    const cands = [];
    for (const s of list) {
      let plan; try { plan = Planner.compute(s); } catch (e) { continue; }
      if (!plan || plan.invalid) continue;
      const legs = this._legs(s, plan);
      if (!legs.length) continue;
      if (s.date === today) todayCount++;
      const open = legs.filter(l => t < l.until.getTime() && l.dep.getTime() - t < 36 * 3600000);
      if (!open.length) continue;
      // 출발 시각(30분 일찍까지)이 된 마지막 구간 = 지금 타야 하는 구간
      let pick = null;
      for (const l of open) if (l.dep.getTime() <= t + this.EARLY_MIN * 60000) pick = l;
      if (!pick) {
        const first = open[0];
        if (first.dep.getTime() - t <= this.AHEAD_MIN * 60000) pick = first;
        else { if (!later || first.dep < later.dep) later = { ...first, s }; continue; }
      }
      cands.push({ ...pick, s });
    }
    cands.sort((a, b) => Math.abs(a.dep - t) - Math.abs(b.dep - t));
    return { todayCount, leg: cands[0] || null, later };
  },

  start() {
    this._overlay('<div class="an-t">오늘 일정을 확인하는 중…</div>', false);
    const began = Date.now();
    const tick = () => {
      const r = this.nextLeg();
      if (r && r.leg) return this._ready(r.leg);
      if (Date.now() - began < this.WAIT_MS) { this._timer = setTimeout(tick, 500); return; }
      if (r && r.later) return this._laterMsg(r.later);
      if (r && r.todayCount) return this._message('오늘 이동이 모두 끝났어요', '수고하셨어요. 편안한 저녁 보내세요!');
      return this._message('지금 갈 일정이 없어요', '일정이 있는 날 차에 타면 목적지로 바로 안내해 드려요.');
    };
    tick();
  },

  _esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },

  pref() { return (State.settings && State.settings.navApp) || 'choice'; },
  setPref(v, el) {
    State.settings.navApp = v; State.save();
    if (el && el.parentElement) el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
  },

  _ready(leg) {
    const esc = this._esc;
    this._leg = leg;
    // 택시: 내비 대신 카카오T
    if (leg.mode === 'taxi') {
      return this._overlay(`<div class="an-k">${esc(leg.s.title || '일정')}</div>
        <div class="an-t">${esc(leg.label)} · ${U.hm(leg.dep)}</div><div class="an-d">📍 ${esc(leg.to.name || '')}</div>
        <div class="an-b"><button type="button" class="an-x" onclick="AutoNav.cancel()">닫기</button>
        <button type="button" class="an-go" onclick="AutoNav.cancel(); Routes.openNav('kakaot')">카카오T 부르기</button></div>`, true);
    }
    // 대중교통·도보는 카카오맵 길찾기, 자가용은 기본 내비(정해 두었으면 바로)
    const car = leg.mode === 'car';
    const pref = this.pref();
    if (!car) return this.go('kakaomap');
    if (pref === 'tmap' || pref === 'kakaomap') return this.go(pref);
    this._overlay(`
      <div class="an-k">${esc(leg.s.title || '일정')}</div>
      <div class="an-t">${esc(leg.label)} · ${U.hm(leg.dep)}</div>
      <div class="an-d">📍 ${esc(leg.to.name || '')}</div>
      <div class="an-c">어느 내비로 안내할까요?</div>
      <div class="an-b">
        <button type="button" class="an-go an-tmap" onclick="AutoNav.go('tmap')">티맵</button>
        <button type="button" class="an-go an-kakao" onclick="AutoNav.go('kakaomap')">카카오맵</button>
      </div>
      <button type="button" class="an-link" onclick="AutoNav.cancel()">닫기</button>`, true);
  },

  go(app) {
    clearTimeout(this._timer);
    const l = this._leg;
    this._close();
    if (!l) return;
    // 출발지는 넘기지 않음 → 지금 있는 곳(현재 위치)에서 안내
    Routes.openNav(app, l.mode, null, l.to);
  },

  cancel() { clearTimeout(this._timer); this._close(); },

  _laterMsg(l) {
    this._leg = l;
    this._overlay(`<div class="an-t">다음 일정은 ${U.hm(l.dep)} 출발이에요</div>
      <div class="an-d">${this._esc(l.s.title || '')} · 📍 ${this._esc(l.to.name || '')}</div>
      <div class="an-b"><button type="button" class="an-x" onclick="AutoNav.cancel()">닫기</button>
      <button type="button" class="an-go" onclick="AutoNav._ready(AutoNav._leg)">지금 길안내</button></div>`, true);
  },

  _message(title, sub) {
    clearTimeout(this._timer);
    this._overlay(`<div class="an-t">${title}</div>${sub ? `<div class="an-d">${sub}</div>` : ''}
      <div class="an-b"><button type="button" class="an-go" onclick="AutoNav.cancel()">확인</button></div>`, true);
  },

  _overlay(html, closable) {
    let bg = document.getElementById('an-bg');
    if (!bg) {
      bg = document.createElement('div');
      bg.id = 'an-bg';
      bg.innerHTML = '<div id="an-box" role="dialog" aria-live="polite"></div>';
      document.body.appendChild(bg);
    }
    bg.onclick = closable ? (e => { if (e.target === bg) this.cancel(); }) : null;
    document.getElementById('an-box').innerHTML = html;
  },
  _close() { const bg = document.getElementById('an-bg'); if (bg) bg.remove(); },

  copyLink(el) {
    const link = this.LINK;
    const done = () => { U.toast('링크를 복사했어요'); if (el) { el.textContent = '복사됨 ✓'; setTimeout(() => { el.textContent = '링크 복사'; }, 1600); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('아래 링크를 복사하세요', link));
    else prompt('아래 링크를 복사하세요', link);
  },

  /** 마이 > 차에 타면 자동 길안내 */
  openGuide() {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const pref = this.pref();
    const opt = (v, label) => `<button class="${pref === v ? 'on' : ''}" onclick="AutoNav.setPref('${v}', this)">${label}</button>`;
    const ios = `
      <div class="an-g-h">아이폰</div>
      <ol class="an-g-ol">
        <li><b>단축어</b> 앱 → 아래 <b>자동화</b> → <b>＋</b></li>
        <li><b>CarPlay</b> 선택 → <b>연결될 때</b> → <b>즉시 실행</b></li>
        <li>동작에서 <b>URL 열기</b> 추가 → 위 링크 붙여넣기</li>
      </ol>
      <p class="muted small">CarPlay가 없으면 2번에서 <b>블루투스</b> → 차량 이름을 고르세요. ${this._isIOSApp() ? '마이플래너 앱이 바로 열려요. 예전에 웹 주소(https://…)를 넣었다면 이 링크로 바꿔 주세요.' : '사파리에서 열려요. 마이플래너 앱을 쓰면 앱에서 이 링크를 복사해 넣으세요. 내비를 열 때 확인 창이 뜨지 않아요.'}</p>`;
    const android = `
      <div class="an-g-h">갤럭시</div>
      <ol class="an-g-ol">
        <li><b>설정</b> → <b>모드 및 루틴</b> → <b>루틴</b> → <b>＋</b></li>
        <li>조건: <b>블루투스 기기 연결</b> → 차량 선택 (Android Auto도 가능)</li>
        <li>실행: <b>웹페이지 열기</b>(또는 링크 열기) → 위 링크</li>
      </ol>`;
    Sheet.open(`
      <div class="sheet-head"><b>🚗 차에 타면 자동 길안내</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <p class="small">휴대폰이 차와 연결되면 마이플래너가 열리면서 <b>지금 가야 할 곳</b>(일정 장소·역·공항·집)으로 내비가 켜져요. 출발지는 <b>지금 있는 곳</b>이에요.</p>
      <label class="lbl">1. 자가용 기본 내비</label>
      <div class="seg">${opt('tmap', '티맵')}${opt('kakaomap', '카카오맵')}${opt('choice', '매번 선택')}</div>
      <p class="muted small">버스·지하철·도보 일정은 카카오맵 길찾기, 택시 일정은 카카오T로 열어요.</p>
      <label class="lbl">2. 자동 실행 링크</label>
      <div class="an-g-link"><input class="input mono" readonly value="${this.LINK}" onclick="this.select()"><button class="btn primary" onclick="AutoNav.copyLink(this)">링크 복사</button></div>
      <label class="lbl">3. 휴대폰에 자동 실행 등록</label>
      ${isAndroid ? android + ios : ios + android}
      <button class="btn ghost" onclick="Sheet.close(); AutoNav.start()">지금 시험해 보기</button>`, 'an-sheet');
  },
};
window.AutoNav = AutoNav;
