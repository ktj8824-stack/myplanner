/* =========================================
   MyPlanner — 하단 배너 광고 (버디플래너 방식)
   - 아이폰·안드로이드 앱: 구글 애드몹 배너를 아래 메뉴 바로 위에 띄움
   - 웹: 카카오 애드핏 (광고 단위 ID가 있을 때만)
   - PRO 회원, 시작·일정 추가·AI 비서·PRO 화면, 알람 화면·아래 시트가 열렸을 때는 숨김
   - 광고 단위 ID가 없으면 구글 공식 '테스트 광고'(Test Ad 표시)로 나옴 → 실제 수익 없음, 정책 위반 없음
   ========================================= */
const Ads = {
  // 구글이 공개한 테스트 광고 단위 (출시 전 마이플래너 애드몹 앱의 실제 ID로 교체)
  TEST_BANNER: { ios: 'ca-app-pub-3940256099942544/2934735716', android: 'ca-app-pub-3940256099942544/6300978111' },
  HIDDEN: ['welcome', 'start', 'register', 'assistant', 'pro'],
  GAP: 8,          // 메뉴와 광고 사이 간격(px)
  HEIGHT: 50,      // 애드몹 BANNER 320×50
  state: 'off',    // off | loading | shown | hidden
  pending: null,

  cfg(k) { const c = Object.assign({}, window.APP_DEFAULTS || {}, window.APP_CONFIG || {}); return c[k] || ''; },
  native() { const C = window.Capacitor; return !!(C && C.isNativePlatform && C.isNativePlatform()); },
  plugin() {
    const C = window.Capacitor;
    if (!this.native() || !(C.isPluginAvailable && C.isPluginAvailable('AdMob'))) return null; // 플러그인을 아직 안 넣은 앱에서는 아무것도 안 함
    return C.Plugins.AdMob || (C.Plugins.AdMob = C.registerPlugin('AdMob'));
  },
  platform() { const C = window.Capacitor; return (C && C.getPlatform && C.getPlatform()) === 'android' ? 'android' : 'ios'; },
  isPro() { return !!(typeof Pro !== 'undefined' && Pro.status && Pro.status.pro); },
  /** 실제 광고 단위 ID가 있으면 실제 광고, 없으면 테스트 광고 */
  bannerId() {
    const p = this.platform();
    const real = this.cfg(p === 'android' ? 'ADMOB_BANNER_ANDROID' : 'ADMOB_BANNER_IOS');
    return { id: real || this.TEST_BANNER[p], testing: !real || this.cfg('ADS_TEST_MODE') === true };
  },
  wanted() {
    if (this.isPro()) return false;
    if (this.HIDDEN.includes(App.current)) return false;
    const ring = document.getElementById('ringing'), sheet = document.getElementById('sheet');
    if (ring && ring.classList.contains('show')) return false;
    if (sheet && sheet.classList.contains('show')) return false;
    return true;
  },

  /** 화면 아래에서 메뉴 윗변까지 거리 (아이폰 홈 막대 영역 제외, 애드몹 margin 기준) */
  margin() {
    let safe = 0, navTop = 0;
    try {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;visibility:hidden;height:env(safe-area-inset-bottom,0px)';
      document.body.appendChild(probe); safe = probe.getBoundingClientRect().height || 0; probe.remove();
      const nav = document.getElementById('nav').getBoundingClientRect();
      navTop = window.innerHeight - nav.top;
    } catch (e) {}
    if (!navTop) navTop = Math.max(10, safe - 12) + 66;
    return Math.max(0, Math.round(navTop + this.GAP - safe));
  },

  /** 화면이 바뀔 때마다 부름 */
  async sync() {
    const want = this.wanted();
    document.body.classList.toggle('ad-on', want && (this.state === 'shown' || this.state === 'loading' || !!this.webOn));
    const A = this.plugin();
    if (!A) return this.web(want);
    try {
      if (want) {
        if (this.state === 'off') {
          this.state = 'loading';
          if (!this._init) { await A.initialize({}); this._init = true; }
          const b = this.bannerId();
          await A.showBanner({ adId: b.id, adSize: 'BANNER', position: 'BOTTOM_CENTER', margin: this.margin(), isTesting: b.testing });
          this.state = 'shown';
          if (!this.wanted()) { await A.hideBanner(); this.state = 'hidden'; } // 준비하는 사이 광고 없는 화면으로 갔으면
        } else if (this.state === 'hidden') { await A.resumeBanner(); this.state = 'shown'; }
      } else if (this.state === 'shown') { await A.hideBanner(); this.state = 'hidden'; }
    } catch (e) { console.warn('[Ads] 배너', e && e.message); if (this.state === 'loading') this.state = 'off'; }
    document.body.classList.toggle('ad-on', this.wanted() && this.state === 'shown');
  },

  /** PRO가 되면 광고를 아예 지움 */
  async applyPro() {
    if (!this.isPro()) return this.sync();
    const A = this.plugin();
    if (A && this.state !== 'off') { try { await A.removeBanner(); } catch (e) {} this.state = 'off'; }
    const w = document.getElementById('adfit-wrap'); if (w) w.remove(); this.webOn = false;
    document.body.classList.remove('ad-on');
  },

  /** 웹: 카카오 애드핏 (광고 단위 ID가 있을 때만) */
  web(want) {
    const unit = this.cfg('ADFIT_UNIT_ID');
    if (!unit) { document.body.classList.remove('ad-on'); return; }
    let w = document.getElementById('adfit-wrap');
    if (!w && want) {
      w = document.createElement('div'); w.id = 'adfit-wrap';
      w.innerHTML = `<ins class="kakao_ad_area" style="display:none" data-ad-unit="${unit.replace(/[^A-Za-z0-9-]/g, '')}" data-ad-width="320" data-ad-height="50"></ins>`;
      const s = document.createElement('script'); s.async = true; s.src = 'https://t1.daumcdn.net/kas/static/ba.min.js';
      w.appendChild(s); document.body.appendChild(w);
    }
    if (w) w.style.display = want ? '' : 'none';
    this.webOn = !!w && want;
    document.body.classList.toggle('ad-on', this.webOn);
  },
};
