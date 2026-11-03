/* =========================================
   MyPlanner — 마켓 (쿠팡 파트너스 상품)
   - 상품은 BuddyPlanner 마켓 서버(Supabase market_products)를 같이 씀
   - 관리자가 '보일 앱'에 마이플래너를 체크한 상품만 보여 줌
   - 쿠팡 가격은 자주 바뀌어서 '참고 가격 + 기준 날짜'로만 표시
   ========================================= */

const MarketView = {
  APP_ID: 'myplanner',
  CATS: [
    ['all', '전체'], ['travel', '여행/이동'], ['charge', '충전/전자'], ['car', '차량용품'], ['office', '사무/문구'],
    ['life', '생활용품'], ['wear', '의류'], ['ball', '골프공'], ['glove_cap', '장갑/모자'], ['shoes', '신발'], ['club_bag', '가방'], ['etc', '기타']
  ],
  items: null,
  cat: 'all',
  loading: false,
  error: false,

  /** 마켓 서버 주소: SUPABASE_URL, 없으면 경로 함수 주소(같은 Supabase 프로젝트)에서 꺼냄 */
  server() {
    const c = window.APP_CONFIG || {};
    let url = c.MARKET_SUPABASE_URL || c.SUPABASE_URL || '';
    if (!url && c.ROUTE_PROXY_URL) { try { url = new URL(c.ROUTE_PROXY_URL).origin; } catch (e) {} }
    return { url: url.replace(/\/$/, ''), key: c.MARKET_SUPABASE_ANON_KEY || c.SUPABASE_ANON_KEY || '' };
  },

  render() {
    this.paint();
    if (this.items === null) this.load();
  },

  async load() {
    const { url, key } = this.server();
    if (!url || !key) { this.items = []; this.paint(); return; }
    this.loading = true; this.error = false; this.paint();
    try {
      const q = 'select=id,category,brand,title,image_url,link,badge,ref_price,ref_price_at,rocket'
        + `&apps=cs.%7B${this.APP_ID}%7D&order=sort.asc,id.asc`;
      const res = await fetch(`${url}/rest/v1/market_products?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!res.ok) throw new Error(res.status);
      const rows = await res.json();
      this.items = Array.isArray(rows) ? rows : [];
    } catch (e) {
      console.warn('[Market] 상품 목록 실패', e);
      this.error = true;
      if (this.items === null) this.items = [];
    }
    this.loading = false;
    if (App.current === 'market') this.paint();
  },

  setCat(c) { this.cat = c; this.paint(); },

  card(p) {
    const img = /^https:\/\//.test(String(p.image_url || '')) ? p.image_url : 'icon-192.png';
    let price = '<div class="mk-price small">쿠팡에서 가격 확인 ›</div>';
    if (typeof p.ref_price === 'number' && p.ref_price > 0) {
      const d = p.ref_price_at ? new Date(p.ref_price_at + 'T00:00:00') : null;
      const when = d && !isNaN(d) ? `${d.getMonth() + 1}/${d.getDate()} 기준` : '참고 가격';
      price = `<div class="mk-price">${p.ref_price.toLocaleString()}원</div><div class="mk-note">${when} · 쿠팡에서 확인 ›</div>`;
    }
    return `
      <button class="mk-card" onclick="MarketView.open(${Number(p.id)})">
        <div class="mk-img"><img src="${U.esc(img)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='icon-192.png'">${p.badge ? `<span class="mk-badge">${U.esc(p.badge)}</span>` : ''}</div>
        <div class="mk-info">
          ${p.rocket ? '<span class="mk-rocket">로켓배송</span>' : ''}
          ${p.brand ? `<div class="mk-brand">${U.esc(p.brand)}</div>` : ''}
          <div class="mk-title">${U.esc(p.title)}</div>
          ${price}
        </div>
      </button>`;
  },

  open(id) {
    const p = (this.items || []).find(x => Number(x.id) === id);
    if (!p || !/^https:\/\/(link\.coupang\.com|coupa\.ng|www\.coupang\.com|m\.coupang\.com)\//.test(p.link || '')) return;
    window.open(p.link, '_blank');   // 앱(Capacitor)에서는 휴대폰 브라우저로 열림
  },

  paint() {
    if (App.current !== 'market') return;
    const items = this.items || [];
    const used = new Set(items.map(p => p.category));
    const cats = this.CATS.filter(([k]) => k === 'all' || used.has(k));
    if (this.cat !== 'all' && !used.has(this.cat)) this.cat = 'all';
    const shown = this.cat === 'all' ? items : items.filter(p => p.category === this.cat);
    let body;
    if (this.items === null || (this.loading && !items.length)) body = '<div class="muted pad center">불러오는 중…</div>';
    else if (this.error && !items.length) body = `<div class="card center"><b>상품을 불러오지 못했어요</b><p class="muted small">인터넷 연결을 확인해 주세요.</p><button class="btn" onclick="MarketView.load()">다시 시도</button></div>`;
    else if (!items.length) body = '<div class="card center"><div style="font-size:34px">🛍️</div><b>곧 상품이 올라와요</b><p class="muted small">출퇴근·여행에 쓸 만한 물건을 골라 둘게요.</p></div>';
    else body = `
      ${cats.length > 2 ? `<div class="mk-cats">${cats.map(([k, l]) => `<button class="chip ${this.cat === k ? 'on' : ''}" onclick="MarketView.setCat('${k}')">${l}</button>`).join('')}</div>` : ''}
      <div class="mk-grid">${shown.map(p => this.card(p)).join('')}</div>`;
    App.setMain(`
      <header class="top"><div><div class="muted">출퇴근 · 여행 필수템</div><h1>마켓</h1></div></header>
      ${body}
      <p class="muted small center mk-disclose">이 포스팅은 쿠팡 파트너스 활동의 일환으로,<br>이에 따른 일정액의 수수료를 제공받습니다.<br>표시된 가격은 기준일의 참고 가격이며, 실제 가격은 쿠팡에서 확인해 주세요.</p>`);
  }
};
