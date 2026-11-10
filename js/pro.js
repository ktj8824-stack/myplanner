/* =========================================
   MyPlanner — PRO 구독 (월 4,900원)
   - 웹: 토스 결제위젯 (로드플래너와 같은 방식). 금액·주문번호는 서버(myplanner-payments)가 정하고,
         결제 뒤 돌아오면 서버가 토스에 승인을 요청해 확인된 것만 PRO 기간(1개월)을 늘림
   - 앱(아이폰·안드로이드): 애플·구글 구독 (RevenueCat). 앱 안에서는 토스를 쓰지 않음 (스토어 규정)
   - PRO 여부는 서버가 웹 결제 기록 + 앱 구독을 함께 보고 판단 (AI 비서 하루 횟수)
   ========================================= */

const Pro = {
  PRICE: 4900,
  ENTITLEMENT: 'pro',
  status: null,      // 서버 status 응답
  loading: false,
  widgets: null,     // 토스 결제위젯
  rc: null,          // RevenueCat 플러그인

  isNative() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); },
  platform() { return window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web'; },

  /** 서버 함수 부르기 (로그인 필요) */
  async call(body) {
    const { url, key } = Cloud.cfg();
    const res = await U.fetchT(`${url}/functions/v1/myplanner-payments`, { method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${await Cloud._token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 20000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error((data.error && data.error.message) || `결제 서버 오류 (${res.status})`); e.code = data.error && data.error.code; throw e; }
    return data;
  },

  async refresh() {
    if (!Cloud.isSignedIn()) { this.status = null; return; }
    try { this.status = await this.call({ action: 'status' }); } catch (e) { console.warn('[Pro] 상태 확인 실패', e.message); }
  },

  render() {
    this._extend = false;
    this.paint();
    if (Cloud.isSignedIn() && !this.loading) { this.loading = true; this.refresh().finally(() => { this.loading = false; if (App.current === 'pro') this.paint(); }); }
  },

  until(s) {
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d) ? '' : `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
  },

  paint() {
    const st = this.status, signed = Cloud.isSignedIn();
    const active = !!(st && st.pro);
    const untilTxt = st && st.web && st.web.active ? `${this.until(st.web.until)}까지` : st && st.app && st.app.active ? (st.app.until ? `${this.until(st.app.until)}에 자동 갱신` : '앱 구독 중') : '';
    const perks = [
      ['AI 비서 하루 60번', '무료는 하루 5번이에요'],
      ['말 한마디로 일정 관리', '"내일 10시 아산병원" 처럼 말하면 등록·변경·질문까지'],
      ['여러 일정도 한 번에', '"병원 갔다가 2시에 회사" 같은 하루 동선을 바로 정리'],
    ];
    let action = '';
    if (!signed) {
      action = `<p class="muted small" style="margin:0 0 10px">결제하려면 먼저 카카오로 로그인해 주세요. 폰을 바꿔도 PRO가 그대로 이어져요.</p>
        <button class="btn primary" style="width:100%" onclick="Cloud.signInKakao()">카카오로 로그인</button>`;
    } else if (active) {
      action = `<div class="pro-on">PRO 이용 중 · ${U.esc(untilTxt)}</div>`
        + (st.web && st.web.active && !this.isNative() ? (this._extend ? `<div style="margin-top:12px">${this.tossBlock(st, '1개월 더 연장 · ' + this.PRICE.toLocaleString() + '원 결제하기')}</div>`
          : `<button class="btn" style="width:100%;margin-top:10px" onclick="Pro._extend=true;Pro.paint()">1개월 더 연장 (${this.PRICE.toLocaleString()}원)</button>`) : '')
        + (this.isNative() ? `<button class="link small" style="margin-top:10px" onclick="Pro.manage()">구독 관리 (해지는 ${this.platform() === 'ios' ? '앱스토어' : '플레이 스토어'}에서)</button>` : '');
    } else if (this.isNative()) {
      action = `<button class="btn primary" style="width:100%" onclick="Pro.buyApp()">월 ${this.PRICE.toLocaleString()}원 구독하기</button>
        <button class="link small" style="margin-top:10px" onclick="Pro.restore()">이전에 구독했어요 (구매 복원)</button>
        <p class="muted small" style="margin:8px 0 0">${this.platform() === 'ios' ? 'Apple ID' : 'Google 계정'}으로 결제되고, 해지하기 전까지 매달 자동으로 갱신돼요.</p>`;
    } else {
      action = this.tossBlock(st, `월 ${this.PRICE.toLocaleString()}원 결제하기`);
    }
    const hist = st && st.payments && st.payments.length ? `<div class="card"><div class="lbl" style="margin-bottom:8px">결제 내역</div>${st.payments.map(p =>
      `<div class="small" style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid var(--line)"><span>${U.esc((p.approved_at || p.created_at || '').slice(0, 10))} · ${p.status === 'DONE' ? '결제 완료' : p.status === 'FAILED' ? '실패' : U.esc(p.status)}${p.mode === 'test' ? ' (시험)' : ''}</span><b>${Number(p.amount).toLocaleString()}원</b></div>`).join('')}</div>` : '';
    App.setMain(`
      <header class="subhead"><button class="back" onclick="App.navigate('settings')" aria-label="뒤로"></button><h1>마이플래너 PRO</h1><span></span></header>
      <div class="pro-hero">
        <small>마이플래너 PRO</small>
        <div class="pro-price"><b>월 ${this.PRICE.toLocaleString()}원</b><span>VAT 포함</span></div>
        <ul class="pro-perks">${perks.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ul>
      </div>
      <div class="card">${action}</div>
      ${hist}
      <p class="muted small" style="padding:0 6px">결제·환불 안내는 <a href="terms.html#pay" target="_blank" rel="noopener">이용약관</a>에 있어요. 일정·알람 등 기본 기능은 PRO가 아니어도 그대로 무료예요.</p>`);
    if (signed && (!active || this._extend) && !this.isNative()) { this.widgets = null; this.mountToss(); }
  },

  tossBlock(st, label) {
    return `<div id="tossMethods"></div><div id="tossAgreement"></div>
        <button class="btn primary" id="tossPay" style="width:100%;margin-top:6px" onclick="Pro.payWeb()">${label}</button>
        <p class="muted small" style="margin:8px 0 0">한 번 결제하면 1개월 동안 PRO예요. 자동으로 다시 결제되지 않아요.${st && st.mode === 'test' ? ' <b>(지금은 시험 결제 — 실제 돈이 나가지 않아요)</b>' : ''}</p>`;
  },

  /* ---------- 웹: 토스 결제위젯 ---------- */
  loadToss() {
    if (window.TossPayments) return Promise.resolve();
    if (this._tossLoading) return this._tossLoading;
    this._tossLoading = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = 'https://js.tosspayments.com/v2/standard';
      s.onload = ok; s.onerror = () => { this._tossLoading = null; no(new Error('결제 모듈을 불러오지 못했어요')); };
      document.head.appendChild(s);
    });
    return this._tossLoading;
  },

  async mountToss() {
    try {
      await this.loadToss();
      if (App.current !== 'pro' || !document.getElementById('tossMethods')) return;
      const tp = TossPayments(Routes.key('TOSS_CLIENT_KEY'));
      this.widgets = tp.widgets({ customerKey: TossPayments.ANONYMOUS });
      await this.widgets.setAmount({ currency: 'KRW', value: this.PRICE });
      await this.widgets.renderPaymentMethods({ selector: '#tossMethods' });
      await this.widgets.renderAgreement({ selector: '#tossAgreement' });
    } catch (e) {
      console.warn('[Pro] 토스 위젯', e);
      const m = document.getElementById('tossMethods');
      if (m) m.innerHTML = '<p class="muted small">결제 화면을 불러오지 못했어요. 인터넷을 확인하고 다시 열어 주세요.</p>';
    }
  },

  async payWeb() {
    const btn = document.getElementById('tossPay');
    if (btn) btn.disabled = true;
    try {
      if (!this.widgets) await this.mountToss();
      if (!this.widgets) throw new Error('결제 화면이 아직 준비되지 않았어요');
      const order = await this.call({ action: 'prepare' }); // 금액·주문번호는 서버가 정함
      if (order.amount !== this.PRICE) await this.widgets.setAmount({ currency: 'KRW', value: order.amount });
      const back = location.origin + location.pathname;
      await this.widgets.requestPayment({
        orderId: order.orderId, orderName: order.orderName,
        successUrl: `${back}?pay=success`, failUrl: `${back}?pay=fail`,
        customerName: State.settings.name || undefined,
      });
    } catch (e) {
      if (e && e.code !== 'USER_CANCEL') U.toast('결제하지 못했어요: ' + (e.message || e.code || '알 수 없는 오류'));
      if (btn) btn.disabled = false;
    }
  },

  /** 토스 결제창에서 돌아온 경우 (?pay=success&paymentKey&orderId&amount / ?pay=fail&code&message) */
  async consumeReturn() {
    const q = new URLSearchParams(location.search);
    const pay = q.get('pay');
    if (!pay) return false;
    const info = { paymentKey: q.get('paymentKey'), orderId: q.get('orderId'), amount: Number(q.get('amount')), code: q.get('code'), message: q.get('message') };
    ['pay', 'paymentKey', 'orderId', 'amount', 'code', 'message', 'paymentType'].forEach(k => q.delete(k));
    history.replaceState(null, document.title, location.pathname + (q.toString() ? '?' + q : '') + location.hash);
    if (pay === 'fail') {
      if (info.code !== 'PAY_PROCESS_CANCELED' && info.code !== 'USER_CANCEL') U.toast('결제가 안 됐어요' + (info.message ? ': ' + info.message : ''));
      return 'pro';
    }
    if (!info.paymentKey || !info.orderId) return 'pro';
    try {
      const r = await this.call({ action: 'confirm', paymentKey: info.paymentKey, orderId: info.orderId, amount: info.amount });
      if (r.status === 'DONE') U.toast(`PRO가 시작됐어요 · ${this.until(r.periodEnd)}까지`);
      else U.toast('입금을 기다리고 있어요');
    } catch (e) { U.toast('결제 확인 실패: ' + e.message); }
    return 'pro';
  },

  /* ---------- 앱: 애플·구글 구독 (RevenueCat) ---------- */
  async purchases() {
    if (this.rc) return this.rc;
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases;
    const apiKey = Routes.key(this.platform() === 'ios' ? 'REVENUECAT_IOS_KEY' : 'REVENUECAT_ANDROID_KEY');
    if (!P || !apiKey) return null;
    // RevenueCat 사용자 번호 = 마이플래너(Supabase) 사용자 id → 서버가 같은 번호로 구독을 확인
    await P.configure({ apiKey, appUserID: Cloud.userId() || undefined });
    this.rc = P;
    return P;
  },

  async buyApp() {
    if (!Cloud.isSignedIn()) return U.toast('먼저 카카오로 로그인해 주세요');
    try {
      const P = await this.purchases();
      if (!P) return U.toast('앱 결제는 아직 준비 중이에요. 다음 업데이트에서 열릴 거예요');
      if (P.logIn) await P.logIn({ appUserID: Cloud.userId() });
      const off = await P.getOfferings();
      const pkg = off && off.current && (off.current.monthly || (off.current.availablePackages || [])[0]);
      if (!pkg) return U.toast('구독 상품을 찾지 못했어요. 잠시 뒤 다시 해 주세요');
      const r = await P.purchasePackage({ aPackage: pkg });
      const ent = r && r.customerInfo && r.customerInfo.entitlements && r.customerInfo.entitlements.active[this.ENTITLEMENT];
      U.toast(ent ? 'PRO가 시작됐어요' : '결제를 확인하고 있어요');
      await this.refresh(); this.paint();
    } catch (e) {
      if (e && (e.userCancelled || e.code === '1' || /cancel/i.test(e.message || ''))) return;
      U.toast('구독하지 못했어요: ' + (e.message || e));
    }
  },

  async restore() {
    try {
      const P = await this.purchases();
      if (!P) return U.toast('앱 결제는 아직 준비 중이에요');
      await P.restorePurchases();
      await this.refresh(); this.paint();
      U.toast(this.status && this.status.pro ? 'PRO를 되찾았어요' : '복원할 구독이 없어요');
    } catch (e) { U.toast('복원하지 못했어요: ' + (e.message || e)); }
  },

  manage() {
    const url = this.platform() === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';
    window.open(url, '_blank');
  },
};
