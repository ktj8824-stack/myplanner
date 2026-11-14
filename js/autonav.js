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
  /** myplanner://home — 시리·단축어로 '집으로' 바로 */
  isHomeLink(url) { return /^myplanner:\/\/(go[=/])?home\b/i.test(String(url || '')); },

  // 주소에 go=next 가 있으면 지우고 true
  _consumeFlag() {
    try {
      const u = new URL(location.href);
      const q = u.searchParams.get('go');
      const h = (u.hash || '').replace(/^#/, '');
      const home = q === 'home' || h === 'go=home';
      if (!home && q !== 'next' && h !== 'go=next' && h !== 'next') return false;
      u.searchParams.delete('go');
      if (h === 'go=next' || h === 'next' || h === 'go=home') u.hash = '';
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
      return home ? 'home' : true;
    } catch (e) { return false; }
  },

  init() {
    if (!this._watching) {
      this._watching = true;
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.keepNotice(); });
      window.addEventListener('pagehide', () => this.keepNotice());
    }
    const flag = this._consumeFlag();
    if (flag === 'home') { setTimeout(() => this.goHome(), 300); return; }
    if (flag) { this._run(); return; }
    const A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!A) return;
    // 아이폰 앱이 myplanner://next 로 처음 켜진 경우 + 이미 켜져 있을 때
    try { if (A.getLaunchUrl) A.getLaunchUrl().then(r => { if (r && this.isHomeLink(r.url)) setTimeout(() => this.goHome(), 300); else if (r && this.isAppLink(r.url)) this._run(); }).catch(() => {}); } catch (e) { /* */ }
    try { A.addListener('appUrlOpen', ev => { if (ev && this.isHomeLink(ev.url)) this.goHome(); else if (ev && this.isAppLink(ev.url)) this._run(); }); } catch (e) { /* */ }
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
        mode: gh.mode || 'transit', label: '집으로 귀가', home: true });
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
    try { localStorage.setItem('mp_autonav_used', String(Date.now())); } catch (e) { }   // 한 번 실행됨 → 홈 홍보 줄 숨김
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

  /* ── 출발 1시간 전부터 '다음 일정' 알림을 알림 목록에 남겨 두기 ──
     미리 눌러서 사라졌으면 앱을 떠날 때 다시 올려 두고(소리 없이), 길안내를 시작하면 지움 */
  _noticeInfo(now = new Date()) {
    const r = this.nextLeg(now);
    const l = r && (r.leg || r.later);
    if (!l || !l.s || l.home) return null;
    const left = (l.dep.getTime() - now.getTime()) / 60000;
    if (left > 65 || left < -20) return null;
    const sid = l.s.occId || l.s.id;
    try { if (localStorage.getItem('mp_autonav_gone') === sid) return null; } catch (e) { }
    return { sid, title: `🚗 다음 일정 · ${U.hm(l.dep)} 출발`, body: `${l.s.title || '일정'}${l.to && l.to.name ? ' · ' + l.to.name : ''}\n나갈 때 눌러서 바로 길안내` };
  },
  _ln() { const C = window.Capacitor; return C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.LocalNotifications; },
  async keepNotice() {
    try {
      const n = this._noticeInfo();
      const LN = this._ln();
      if (LN) {   // 아이폰 앱(로컬 알림): 1시간 전 알림이 이미 떠 있거나 아직 예약돼 있으면 그대로, 없으면 지금 다시 올림
        if (!n || !this._isIOSApp() || typeof Alarm === 'undefined') return;
        const id = Alarm.numId(n.sid + 'next');
        const d = await LN.getDeliveredNotifications();
        if ((d && d.notifications || []).some(x => Number(x.id) === id)) return;
        const p = await LN.getPending();
        if ((p && p.notifications || []).some(x => Number(x.id) === id)) return;
        await LN.schedule({ notifications: [{ id, title: n.title, body: n.body, schedule: { at: new Date(Date.now() + 1500) }, extra: { scheduleId: n.sid, kind: 'next', at: Date.now() } }] });
        return;
      }
      if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || !reg.showNotification) return;
      const tag = n ? 'next-' + n.sid : '';
      const all = await reg.getNotifications();
      all.forEach(x => { if (/^next-/.test(x.tag || '') && x.tag !== tag) x.close(); });
      if (!n || all.some(x => x.tag === tag)) return;
      await reg.showNotification(n.title, { body: n.body, tag, silent: true, icon: new URL('icon-192.png', reg.scope).href,
        data: { url: new URL('./?go=next', reg.scope).href } });
    } catch (e) { }
  },
  async clearNotice(sid) {
    try {
      const LN = this._ln();
      if (LN) { if (typeof Alarm !== 'undefined') { const id = Alarm.numId(sid + 'next'); await LN.removeDeliveredNotifications({ notifications: [{ id }] }).catch(() => { }); } return; }
      const reg = 'serviceWorker' in navigator && await navigator.serviceWorker.getRegistration();
      if (reg && reg.getNotifications) (await reg.getNotifications()).forEach(x => { if (/^next-/.test(x.tag || '')) x.close(); });
    } catch (e) { }
  },

  go(app) {
    clearTimeout(this._timer);
    const l = this._leg;
    this._close();
    if (!l) return;
    if (l.s && !l.home) { const sid = l.s.occId || l.s.id; try { localStorage.setItem('mp_autonav_gone', sid); } catch (e) { } this.clearNotice(sid); }   // 길안내 시작 = 출발 → 남겨 둔 알림 지움
    // 차에서 일정 장소로 길안내를 켠 순간 = 실제로 집을 나선 시각 (준비 시간 제안에 씀)
    if (l.s && !l.home && typeof Alarm !== 'undefined' && Alarm.habitMark) { try { Alarm.habitMark(l.s.occId || l.s.id, 'go', 'car'); } catch (e) { } }
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
    const home = this._homeFallback();
    this._overlay(`<div class="an-t">${title}</div>${sub ? `<div class="an-d">${sub}</div>` : ''}
      <div class="an-b">${home ? `<button type="button" class="an-x" onclick="AutoNav.cancel()">닫기</button>
      <button type="button" class="an-go" onclick="AutoNav.goHome()">집으로 안내</button>` : `<button type="button" class="an-go" onclick="AutoNav.cancel()">확인</button>`}</div>`, true);
  },

  /** 갈 일정이 없을 때: 오후 3시 이후 + 집 주소가 있으면 '집으로 안내' */
  _homeFallback() {
    const h = State.settings && State.settings.home;
    return h && isFinite(h.lat) && new Date().getHours() >= 15 ? h : null;
  },
  /** 집으로: 먼저 이동수단을 고름 → 자가용은 내비(티맵·카카오맵), 버스·지하철은 카카오맵 대중교통 길찾기 (출발 = 지금 있는 곳) */
  goHome() {
    const h = this._homeFallback() || (State.settings && State.settings.home);
    if (!h) { this.cancel(); U.toast('집 주소를 먼저 등록해 주세요'); return App.navigate('settings'); }
    if (!isFinite(h.lat)) { U.toast('집 주소를 다시 골라 주세요'); return App.navigate('settings'); }
    this._home = h;
    const ic = n => `<span class="gh-ic" aria-hidden="true">${U.modeIcon(n, "3d")}</span>`;
    this._overlay(`<div class="an-t">집으로 가요</div><div class="an-d">📍 ${this._esc(h.name || '집')} · 지금 있는 곳에서 출발</div>
      <div class="an-c">무엇으로 갈까요?</div>
      <div class="gh-modes">
        <button type="button" class="gh-mode" onclick="AutoNav.goHomeBy('car')">${ic('car')}<b>자가용</b><small>티맵·카카오맵 내비</small></button>
        <button type="button" class="gh-mode" onclick="AutoNav.goHomeBy('transit')">${ic('transit')}<b>버스·지하철</b><small>대중교통 길찾기</small></button>
        <button type="button" class="gh-mode" onclick="AutoNav.goHomeBy('walk')">${ic('walk')}<b>걸어서</b><small>도보 길찾기</small></button>
      </div>
      <button type="button" class="an-link" onclick="AutoNav.cancel()">닫기</button>`, true);
  },
  goHomeBy(mode) {
    const h = this._home || (State.settings && State.settings.home);
    if (!h) return this.cancel();
    try { localStorage.setItem('mp_gohome_mode', mode); } catch (e) { }
    if (mode !== 'car') {   // 버스·지하철·도보: 카카오맵이 지금 위치에서 집까지 경로를 보여 줌 (버스·지하철을 그 화면에서 고름)
      this._close();
      return Routes.openNav('kakaomap', mode, null, h);
    }
    this._leg = { to: h, mode: 'car', home: true, label: '집으로 귀가', s: null };
    const pref = this.pref();
    if (pref === 'tmap' || pref === 'kakaomap') return this.go(pref);
    this._overlay(`<div class="an-t">어느 내비로 갈까요?</div><div class="an-d">📍 ${this._esc(h.name || '집')}</div>
      <div class="an-b"><button type="button" class="an-go an-tmap" onclick="AutoNav.go('tmap')">티맵</button>
      <button type="button" class="an-go an-kakao" onclick="AutoNav.go('kakaomap')">카카오맵</button></div>
      <button type="button" class="an-link" onclick="AutoNav.goHome()">‹ 이동수단 다시 고르기</button>`, true);
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
      <div class="sheet-head"><b>🚗 차에 타면 자동 길안내</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
      <p class="small">휴대폰이 차와 연결되면 마이플래너가 열리면서 <b>지금 가야 할 곳</b>(일정 장소·역·공항·집)으로 내비가 켜져요. 출발지는 <b>지금 있는 곳</b>이에요.</p>
      <label class="lbl">1. 자가용 기본 내비</label>
      <div class="seg">${opt('tmap', '티맵')}${opt('kakaomap', '카카오맵')}${opt('choice', '매번 선택')}</div>
      <p class="muted small">버스·지하철·도보 일정은 카카오맵 길찾기, 택시 일정은 카카오T로 열어요.</p>
      <label class="lbl">2. 자동 실행 링크</label>
      <div class="an-g-link"><input class="input mono" readonly value="${this.LINK}" onclick="this.select()"><button class="btn primary" onclick="AutoNav.copyLink(this)">링크 복사</button></div>
      <label class="lbl">3. 휴대폰에 자동 실행 등록</label>
      ${isAndroid ? android + ios : ios + android}
      <a class="btn primary" style="display:flex;align-items:center;justify-content:center;text-decoration:none;margin-bottom:8px" href="autonav-guide.html?os=${isAndroid ? 'android' : 'ios'}" onclick="return AutoNav.guideClick('${isAndroid ? 'android' : 'ios'}')">그림으로 보는 설정 가이드</a>
      <button class="btn ghost" style="width:100%;margin-bottom:8px" onclick="AutoNav.markDone()">✓ 설정 완료했어요</button>
      <button class="btn ghost" onclick="Sheet.close(); AutoNav.start()">지금 시험해 보기</button>`, 'an-sheet');
  },

  /** 홈 홍보 줄: 한 번도 실행된 적 없고 ✕를 안 눌렀을 때만 */
  promoHtml() {
    try { if (localStorage.getItem('mp_autonav_used') || localStorage.getItem('mp_autonav_promo_off')) return ''; } catch (e) { return ''; }
    const os = /Android/i.test(navigator.userAgent) ? 'android' : 'ios';
    return `<div class="anp" role="note">
      <a class="anp-go" href="autonav-guide.html?os=${os}" onclick="return AutoNav.guideClick('${os}')">
        <span class="anp-ic" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 17h14M6 17l1.5-5h9L18 17M7.5 12l1.2-3.6A2 2 0 0 1 10.6 7h2.8a2 2 0 0 1 1.9 1.4L16.5 12"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/></svg></span>
        <span class="anp-t"><b>차에 타면 길안내가 저절로</b><small>차에 연결되면 다음 일정 내비 자동 실행</small></span>
        <span class="anp-btn">1분 설정</span>
      </a>
      <button type="button" class="anp-x" aria-label="다시 보지 않기" onclick="AutoNav.hidePromo()">✕</button>
    </div>`;
  },
  /** 설정 가이드: 앱(아이폰·안드로이드)에서는 앱을 떠나지 않고 화면 위에 띄움 → 아래 메뉴는 그대로, 광고는 숨김.
   *  웹은 가이드 페이지로 이동 (공유하기 좋게) */
  guideClick(os) {
    const C = window.Capacitor;
    if (!(C && C.isNativePlatform && C.isNativePlatform())) return true;
    this.showGuide(os);
    return false;
  },
  showGuide(os) {
    if (typeof Sheet !== 'undefined' && Sheet.close) { try { Sheet.close(); } catch (e) { } }
    this.closeGuide(true);
    const el = document.createElement('div');
    el.id = 'an-guide';
    el.innerHTML = `<div class="ang-bar"><button type="button" class="ang-back" onclick="AutoNav.closeGuide()" aria-label="뒤로">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>
        <b>차에 타면 자동 길안내</b></div>
      <iframe src="autonav-guide.html?os=${os === 'android' ? 'android' : 'ios'}&embed=1" title="자동 길안내 설정 가이드"></iframe>`;
    document.body.appendChild(el);
    document.body.classList.add('guide-open');
    if (typeof Ads !== 'undefined' && Ads.sync) Ads.sync();
  },
  /** fromNav: 아래 메뉴로 다른 화면에 갈 때 (광고는 App.navigate가 다시 맞춤) */
  closeGuide(fromNav) {
    const el = document.getElementById('an-guide');
    if (!el) return;
    el.remove();
    document.body.classList.remove('guide-open');
    if (!fromNav && typeof Ads !== 'undefined' && Ads.sync) Ads.sync();
  },

  /** '설정 완료' 버튼: 홈의 '1분 설정' 안내를 더 띄우지 않음 (가이드 안·설정 창에서 누름) */
  markDone() {
    try { localStorage.setItem('mp_autonav_setup_done', '1'); } catch (e) { }
    this.hidePromo();
    if (this.closeGuide) this.closeGuide();
    try { if (typeof App !== 'undefined' && App.closeModal) App.closeModal(); } catch (e) { }
    try { if (typeof Sheet !== 'undefined' && Sheet.close) Sheet.close(); } catch (e) { }
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
    const msg = '설정 완료! 홈에 설정 안내가 더 뜨지 않아요';
    if (typeof U !== 'undefined' && U.toast) U.toast(msg); else if (typeof App !== 'undefined' && App.toast) App.toast(msg);
  },

  /** 홈 맨 위 '집으로': 정해 둔 시간대(기본 18~23시)에만, 집 주소가 있을 때 */
  homeWin() {
    const w = State.settings.homeWin || {};
    return { on: w.on !== false, from: /^\d{2}:\d{2}$/.test(w.from) ? w.from : '18:00', to: /^\d{2}:\d{2}$/.test(w.to) ? w.to : '23:00' };
  },
  _inWin(now = new Date()) {
    const w = this.homeWin(), m = now.getHours() * 60 + now.getMinutes();
    const t = v => +v.slice(0, 2) * 60 + +v.slice(3);
    const a = t(w.from), b = t(w.to);
    return a <= b ? m >= a && m < b : m >= a || m < b;   // 22:00~02:00처럼 자정을 넘겨도
  },
  homeCardHtml() {
    const h = State.settings.home, w = this.homeWin();
    if (!w.on || !h || !isFinite(h.lat) || !this._inWin()) return '';
    try { if (localStorage.getItem('mp_gohome_off') === U.ymd(new Date())) return ''; } catch (e) { }
    return `<div class="gohome" role="group" aria-label="집으로">
      <button type="button" class="gohome-go" onclick="AutoNav.goHome()">
        <span class="gohome-ic" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg></span>
        <span class="gohome-t"><b>집으로</b><small>지금 있는 곳에서 ${this._esc(h.name || '집')}까지 바로 길안내</small></span>
        <span class="gohome-btn">바로 출발</span>
      </button>
      <button type="button" class="gohome-x" aria-label="오늘은 그만 보기" onclick="AutoNav.hideHomeToday()">✕</button>
    </div>`;
  },
  hideHomeToday() {
    try { localStorage.setItem('mp_gohome_off', U.ymd(new Date())); } catch (e) { }
    document.querySelectorAll('.gohome').forEach(el => el.remove());
    U.toast('오늘은 집으로 버튼을 숨겼어요');
  },

  hidePromo() {
    try { localStorage.setItem('mp_autonav_promo_off', '1'); } catch (e) { }
    document.querySelectorAll('.anp').forEach(el => el.remove());
  },
};
window.AutoNav = AutoNav;
