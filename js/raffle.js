/* =========================================
   MyPlanner — 럭키드로우 (버디플래너와 같은 방식)
   - 응모·추첨·환불은 모두 서버 함수(mp_enter_raffle, mp_get_raffles …)가 처리. 앱은 결과만 보여 줌
   - 무료로 모은 포인트로만 응모 (포인트는 판매하지 않음 → 사행성 아님)
   - 스토어 정책에 맞춰 공식 규칙(당첨자 수·마감·발표·추첨 방식·확률)을 앱 안에 공개
   - 운영자(mp_admins)에게는 회차 만들기·추첨·발송 관리가 같은 화면 아래에 보임
   ========================================= */
const Raffle = {
  list: [], loading: false, error: null, admin: false,

  render() { this.paint(); this.load(); },

  async load() {
    this.loading = true; this.error = null;
    try {
      // 로그인 안 했어도 목록은 볼 수 있음 (공개 키로 부름)
      if (Cloud.isSignedIn()) this.list = await Cloud.rpc('mp_get_raffles') || [];
      else {
        const { url, key } = Cloud.cfg();
        const res = await U.fetchT(`${url}/rest/v1/rpc/mp_get_raffles`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' });
        if (!res.ok) throw new Error(String(res.status));
        this.list = await res.json() || [];
      }
    } catch (e) { this.error = navigator.onLine === false ? 'offline' : 'error'; }
    this.loading = false;
    if (Points.available()) {
      await Points.refresh();
      try { this.admin = !!(await Cloud.rpc('mp_is_admin')); } catch (e) { this.admin = false; }
      if (this.admin) await RaffleAdmin.load();
    }
    if (App.current === 'raffle') this.paint();
  },

  find(id) { return this.list.find(r => String(r.id) === String(id)); },
  fmtDate(iso) {
    const d = new Date(iso), w = '일월화수목금토';
    return `${d.getMonth() + 1}월 ${d.getDate()}일(${w[d.getDay()]}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },
  dday(iso) {
    const ms = new Date(iso) - Date.now();
    if (ms <= 0) return '마감';
    const h = Math.floor(ms / 3600000);
    return h < 24 ? `${h}시간 남음` : `D-${Math.ceil(ms / 86400000)}`;
  },
  safeImg(url) { return /^https:\/\//.test(String(url || '')) ? url : ''; },
  odds(r) {
    if (!r.my_entries || !r.entries) return null;
    const p = Math.min(1, (r.my_entries / r.entries) * r.winners_count);
    return p >= 0.995 ? 100 : Math.max(0.1, Math.round(p * 1000) / 10);
  },

  paint() {
    const open = this.list.filter(r => r.status === 'open'), past = this.list.filter(r => r.status !== 'open');
    const signed = Points.available();
    let body;
    if (this.loading && !this.list.length) body = `<div class="card rf-empty"><b>불러오는 중…</b></div>`;
    else if (this.error) body = `<div class="card rf-empty"><b>목록을 불러오지 못했어요</b><span>${this.error === 'offline' ? '인터넷 연결을 확인해 주세요.' : '잠시 뒤 다시 해 주세요.'}</span><button class="btn small" style="margin-top:10px" onclick="Raffle.load()">다시 불러오기</button></div>`;
    else if (!this.list.length) body = `<div class="card rf-empty"><b>진행 중인 럭키드로우가 없어요</b><span>새 럭키드로우가 열리면 여기에 보여 드릴게요.<br>그동안 출석 체크로 포인트를 모아 두세요.</span></div>`;
    else body = (open.length ? open.map(r => this.cardOpen(r)).join('') : `<div class="card rf-empty"><span>지금 진행 중인 럭키드로우가 없어요.</span></div>`)
      + (past.length ? `<div class="lbl rf-sec">지난 추첨 결과</div>` + past.map(r => this.cardPast(r)).join('') : '');
    App.setMain(`
      <header class="subhead"><button class="back" onclick="App.navigate('points')" aria-label="뒤로"></button><h1>럭키드로우</h1><span></span></header>
      <button class="rf-points" onclick="App.navigate('points')">
        <span>내 포인트</span><b><span data-points>${signed ? Points.balance().toLocaleString() : '-'}</span> P</b><small>포인트 모으기</small>
      </button>
      <p class="muted small rf-note">무료로 모은 포인트로만 응모해요. 포인트는 돈으로 팔지 않아요.</p>
      ${body}
      ${this.admin ? RaffleAdmin.html() : ''}`);
  },

  cardOpen(r) {
    const goal = r.min_entries > 0 ? r.min_entries : (r.max_entries < 100000 ? r.max_entries : 0);
    const pct = goal ? Math.min(100, Math.round((r.entries / goal) * 100)) : 100;
    const need = r.min_entries > 0 ? Math.max(0, r.min_entries - r.entries) : 0;
    const img = this.safeImg(r.image_url), odds = this.odds(r), left = r.per_user_limit - r.my_entries;
    return `
      <div class="rf-card">
        <div class="rf-img">${img ? `<img src="${U.esc(img)}" alt="" onerror="this.remove()">` : ''}<span class="rf-gift" aria-hidden="true"></span><span class="rf-dday">${this.dday(r.ends_at)}</span></div>
        <div class="rf-body">
          <div class="rf-title">${U.esc(r.title)}</div>
          <div class="rf-prize">${U.esc(r.prize_name)}${r.prize_value ? ` <span>· 시가 ${Number(r.prize_value).toLocaleString()}원</span>` : ''}</div>
          ${r.description ? `<div class="rf-desc">${U.esc(r.description)}</div>` : ''}
          <div class="rf-bar"><i style="width:${pct}%"></i></div>
          <div class="rf-row"><span>응모 ${r.entries.toLocaleString()}건${need ? ` · 추첨까지 ${need.toLocaleString()}건 남음` : (r.min_entries > 0 ? ' · 추첨 확정' : '')}</span><span>마감 ${this.fmtDate(r.ends_at)}</span></div>
          ${r.extended ? `<div class="rf-ext">응모가 모자라 마감을 ${r.extend_days || 7}일 늘렸어요. 이번에도 모자라면 취소되고 포인트를 돌려드려요.</div>` : ''}
          <div class="rf-chips"><span>1회 ${r.entry_cost.toLocaleString()}P</span><span>1인 최대 ${r.per_user_limit}회</span><span>당첨 ${r.winners_count}명</span></div>
          ${r.my_entries ? `<div class="rf-mine">내 응모 ${r.my_entries}회${odds != null ? ` · 지금 기준 당첨 확률 약 ${odds}%` : ''}</div>` : ''}
          <div class="rf-actions">
            <button class="btn small" onclick="Raffle.showRules(${r.id})">공식 규칙</button>
            <button class="btn small primary" ${left <= 0 ? 'disabled' : ''} onclick="Raffle.askEnter(${r.id})">${left <= 0 ? '응모 한도 도달' : '응모하기'}</button>
          </div>
        </div>
      </div>`;
  },

  cardPast(r) {
    const me = r.me_winner;
    let mine = '';
    if (me) {
      const expired = !me.claimed && new Date(me.claim_until) < new Date();
      mine = me.shipped ? `<div class="rf-win">당첨! 경품을 보내 드렸어요.</div>`
        : me.claimed ? `<div class="rf-win">당첨! 배송지를 받았어요. 곧 보내 드릴게요.</div>`
        : expired ? `<div class="rf-win muted">당첨됐지만 배송지 입력 기한이 지났어요.</div>`
        : `<div class="rf-win">축하해요, 당첨됐어요!<button class="btn small primary" onclick="Raffle.showClaim(${r.id})">배송지 입력</button><small>${this.fmtDate(me.claim_until)}까지</small></div>`;
    } else if (r.my_entries && r.status === 'drawn') mine = `<div class="rf-mine">아쉽게도 당첨되지 않았어요. 다음에 또 도전해 주세요.</div>`;
    const result = r.status === 'cancelled'
      ? `<div class="rf-row"><span>응모가 모자라 취소됐어요. 쓴 포인트는 모두 돌려드렸어요.</span></div>`
      : `<div class="rf-row"><span>응모 ${r.entries.toLocaleString()}건 · ${this.fmtDate(r.drawn_at)} 추첨</span></div>
         <div class="rf-winners">당첨자 ${(r.winners || []).map(w => `<b>${U.esc(w.name)}</b>`).join(', ') || '-'}</div>`;
    return `<div class="rf-card past"><div class="rf-body">
        <div class="rf-title">${U.esc(r.title)} <span class="rf-badge">${r.status === 'cancelled' ? '취소' : '추첨 완료'}</span></div>
        <div class="rf-prize">${U.esc(r.prize_name)}</div>${result}${mine}
        <button class="link small" onclick="Raffle.showRules(${r.id})">공식 규칙 보기</button></div></div>`;
  },

  /* ── 응모 ── */
  askEnter(id) {
    const r = this.find(id); if (!r) return;
    if (!Points.requireLogin('럭키드로우 응모')) return;
    const bal = Points.balance();
    const max = Math.max(0, Math.min(r.per_user_limit - r.my_entries, r.max_entries - r.entries, Math.floor(bal / r.entry_cost)));
    if (max <= 0) {
      if (bal < r.entry_cost) {
        Sheet.open(`<div class="sheet-head"><b>포인트가 모자라요</b><button class="x" onclick="Sheet.close()">✕</button></div>
          <p class="muted" style="margin:0 0 14px">응모하려면 ${r.entry_cost.toLocaleString()}P가 필요해요. 지금 ${bal.toLocaleString()}P가 있어요.</p>
          <button class="btn primary big" onclick="Sheet.close();App.navigate('points')">포인트 모으러 가기</button>
          <button class="btn ghost" onclick="Sheet.close()">닫기</button>`);
      } else U.toast('더 이상 응모할 수 없어요');
      return;
    }
    this._count = 1;
    this._entering = { id: r.id, cost: r.entry_cost, bal };
    Sheet.open(`<div class="sheet-head"><b>럭키드로우 응모</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <div class="rf-enter">
        <b>${U.esc(r.prize_name)}</b>
        <p class="muted small">1회 ${r.entry_cost.toLocaleString()}P · 많이 응모할수록 당첨 확률이 올라가요</p>
        <div class="rf-stepper"><button onclick="Raffle.step(-1, ${max})" aria-label="줄이기">−</button><span id="rfCount">1</span>회<button onclick="Raffle.step(1, ${max})" aria-label="늘리기">＋</button></div>
        <p id="rfCost" class="muted small" style="text-align:center">${r.entry_cost.toLocaleString()}P 사용 · 남는 포인트 ${(bal - r.entry_cost).toLocaleString()}P</p>
        <button class="btn primary big" id="rfGo" onclick="Raffle.enter(${r.id})">응모하기</button>
        <p class="muted small" style="margin-top:12px">응모하면 <a href="#" onclick="event.preventDefault();Raffle.showRules(${r.id})">공식 규칙</a>에 동의한 것으로 봐요. 응모한 포인트는 돌려받을 수 없어요 (추첨이 취소되면 돌려드려요).</p>
      </div>`);
  },

  step(d, max) {
    this._count = Math.min(max, Math.max(1, (this._count || 1) + d));
    const e = this._entering;
    document.getElementById('rfCount').textContent = this._count;
    document.getElementById('rfCost').textContent = `${(e.cost * this._count).toLocaleString()}P 사용 · 남는 포인트 ${(e.bal - e.cost * this._count).toLocaleString()}P`;
  },

  async enter(id) {
    const btn = document.getElementById('rfGo');
    if (btn) { btn.disabled = true; btn.textContent = '응모하는 중…'; }
    const msg = { closed: '응모가 마감됐어요', full: '응모 정원이 다 찼어요', user_limit: '1인 응모 한도를 넘었어요', not_enough_points: '포인트가 모자라요',
      not_found: '럭키드로우를 찾을 수 없어요', bad_count: '응모 횟수를 확인해 주세요', admin_blocked: '운영자 계정은 응모할 수 없어요' };
    try {
      const r = await Points.rpc('mp_enter_raffle', { p_id: id, p_count: this._count || 1 });
      Sheet.close();
      if (!r || !r.ok) U.toast(msg[r && r.error] || '응모하지 못했어요');
      else {
        Points.apply({ balance: r.balance });
        if (r.drawn) {
          Sheet.open(`<div class="sheet-head"><b>${r.won ? '당첨됐어요!' : '추첨이 끝났어요'}</b><button class="x" onclick="Sheet.close()">✕</button></div>
            <p class="muted" style="margin:0 0 14px">마지막 응모로 정원이 차서 바로 추첨했어요. ${r.won ? '축하해요! 배송지를 넣어 주세요.' : '아쉽게도 이번에는 당첨되지 않았어요.'}</p>
            <button class="btn primary big" onclick="Sheet.close();${r.won ? `Raffle.showClaim(${id})` : ''}">${r.won ? '배송지 입력' : '확인'}</button>`);
        } else U.toast(`응모 완료 · 내 응모 ${r.my_entries}회`);
      }
    } catch (e) { Sheet.close(); U.toast('응모하지 못했어요. 인터넷 연결을 확인해 주세요'); }
    await this.load();
  },

  /* ── 당첨 경품 배송지 ── */
  showClaim(id) {
    const r = this.find(id);
    Sheet.open(`<div class="sheet-head"><b>경품 배송지 입력</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <div class="rf-form">
        <p class="muted small">${r ? U.esc(r.prize_name) : ''}</p>
        <input id="rfName" class="input" maxlength="30" placeholder="받는 분 이름">
        <input id="rfPhone" class="input" inputmode="tel" maxlength="13" placeholder="휴대폰 번호 (예: 010-1234-5678)">
        <textarea id="rfAddr" class="input" rows="2" maxlength="200" placeholder="주소 (동·호수까지)"></textarea>
        <label class="pro-agree"><input type="checkbox" id="rfAgree"><span>[필수] 경품 배송을 위해 이름·휴대폰 번호·주소를 받고, 발송 30일 뒤 지우는 데 동의해요</span></label>
        ${r && r.prize_value > 50000 ? `<p class="small" style="color:var(--orange-ink)">5만 원이 넘는 경품이라 제세공과금(22%) 안내를 위해 따로 연락드릴 수 있어요.</p>` : ''}
        <button class="btn primary big" id="rfClaim" onclick="Raffle.claim(${id})">보내기</button>
      </div>`);
  },

  async claim(id) {
    const v = (k) => (document.getElementById(k) || {}).value || '';
    if (!document.getElementById('rfAgree').checked) return U.toast('개인정보 수집에 동의해 주세요');
    const phone = v('rfPhone').replace(/[^0-9]/g, '');
    if (!v('rfName').trim() || !/^01[0-9]{8,9}$/.test(phone) || v('rfAddr').trim().length < 5) return U.toast('이름, 휴대폰 번호, 주소를 정확히 넣어 주세요');
    const btn = document.getElementById('rfClaim'); btn.disabled = true;
    try {
      const r = await Points.rpc('mp_claim_prize', { p_id: id, p_name: v('rfName'), p_phone: phone, p_addr: v('rfAddr') });
      if (r && r.ok) { Sheet.close(); U.toast('배송지를 받았어요. 곧 보내 드릴게요'); this.load(); return; }
      U.toast({ claim_expired: '입력 기한이 지났어요', not_winner: '당첨 정보가 없어요', already_shipped: '이미 보냈어요', invalid: '입력 내용을 확인해 주세요' }[r && r.error] || '보내지 못했어요');
    } catch (e) { U.toast('보내지 못했어요. 인터넷 연결을 확인해 주세요'); }
    btn.disabled = false;
  },

  /* ── 공식 규칙 (스토어 정책: 앱 안에 공개) ── */
  rulesText(r) {
    const tax = r.prize_value > 50000 ? '경품 시가가 5만 원을 넘어 제세공과금(22%)이 생기며, 당첨자에게 따로 안내합니다.' : '경품 시가가 5만 원 이하라 제세공과금이 없습니다.';
    return [
      ['주최', '마이플래너'],
      ['응모 자격', '마이플래너에 로그인한 만 14세 이상 회원'],
      ['응모 방법', `출석 체크·광고 보기 등으로 무료로 받은 포인트로 응모합니다. 1회 ${r.entry_cost.toLocaleString()}P, 1인 최대 ${r.per_user_limit}회. 포인트는 돈으로 팔지 않으며, 구매나 결제 없이 참여할 수 있습니다.`],
      ['기간', `${this.fmtDate(r.starts_at)} ~ ${this.fmtDate(r.ends_at)}.${r.max_entries < 100000 ? ` 응모가 ${r.max_entries.toLocaleString()}건이 되면 바로 마감합니다.` : ''}`],
      ['경품·당첨자 수', `${r.prize_name}${r.prize_value ? ` (시가 ${Number(r.prize_value).toLocaleString()}원)` : ''}, ${r.winners_count}명. 예비 당첨자도 함께 뽑아, 당첨자가 기한 안에 배송지를 넣지 않으면 예비 당첨자에게 넘어갑니다.`],
      ['추첨·발표', '마감 즉시 서버에서 무작위로 추첨하고 이 화면에 발표합니다(당첨자 이름 일부 가림). 응모를 많이 할수록 당첨 확률이 높아지고, 한 사람은 한 번만 당첨됩니다. 당첨 확률 = 내 응모 수 ÷ 전체 응모 수 × 당첨자 수(최대 100%).'],
      ...(r.min_entries ? [['연장·취소', `마감 때 응모가 ${r.min_entries.toLocaleString()}건(회차 성립 기준)보다 적으면 응모 기간을 ${r.extend_days || 7}일 한 번 늘립니다. 그래도 모자라면 추첨을 취소하고 쓴 포인트를 모두 돌려드립니다.`]] : []),
      ['경품 받기', `당첨자는 발표 후 ${r.claim_days}일 안에 앱에서 배송지를 넣어야 하며, 기한이 지나면 당첨이 취소됩니다. 경품은 현금으로 바꿔 드리지 않습니다.`],
      ['제세공과금', tax],
      ['개인정보', '경품 배송을 위해 당첨자의 이름·휴대폰 번호·주소를 받으며, 발송 30일 뒤 지웁니다.'],
      ['부정 참여', '여러 계정 사용, 앱 변조 등 부정한 방법으로 참여하면 당첨을 취소하고 포인트를 회수할 수 있습니다. 운영자와 그 가족은 응모할 수 없습니다.'],
      ['포인트', '포인트는 쌓인 날부터 1년이 지나면 사라지며, 현금·상품권으로 바꾸거나 다른 회원에게 줄 수 없습니다.'],
      ['기타', '이 이벤트는 Apple 또는 Google이 후원하거나 관련된 것이 아닙니다.'],
    ];
  },

  showRules(id) {
    const r = this.find(id); if (!r) return;
    Sheet.open(`<div class="sheet-head"><b>공식 규칙</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <div class="rf-rules"><b>${U.esc(r.title)}</b>${this.rulesText(r).map(([k, v]) => `<dl><dt>${U.esc(k)}</dt><dd>${U.esc(v)}</dd></dl>`).join('')}
      ${r.rules ? `<dl><dt>추가 안내</dt><dd style="white-space:pre-wrap">${U.esc(r.rules)}</dd></dl>` : ''}</div>
      <button class="btn primary big" onclick="Sheet.close()">확인</button>`);
  },
};

/* ---------- 운영자: 회차 만들기 · 추첨 · 발송 관리 ---------- */
const RaffleAdmin = {
  list: [], settings: {}, error: '', draft: null,
  rpc(fn, body) { return Cloud.rpc(fn, body || {}); },
  num(k, d) { const v = Number(this.settings[k]); return isFinite(v) && v > 0 ? v : d; },

  async load() {
    this.error = '';
    try {
      const [rows, st] = await Promise.all([this.rpc('mp_admin_raffle_list'), this.rpc('mp_admin_point_settings')]);
      this.list = Array.isArray(rows) ? rows : []; this.settings = st || {};
    } catch (e) { this.error = /admin_only/.test(String(e.message)) ? '운영자 계정이 아니에요' : '회차 목록을 불러오지 못했어요'; }
  },

  /** 손해 없는 회차 성립 기준(응모 횟수) */
  breakEven(prizeCost, entryCost) {
    const rev = this.num('rf_rev_per_view', 11), payout = this.num('rf_payout', 0.75), share = this.num('rf_ad_share', 0.55), adPts = this.num('ad_reward_points', 10);
    const views = Math.ceil(prizeCost / payout / rev);
    return { views, revenue: Math.round(prizeCost / payout), entries: Math.ceil(views * adPts / share / Math.max(1, entryCost)) };
  },
  fmt(iso) { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; },
  statusName(r) { return r.status === 'open' ? (r.extended ? '진행 중 (연장됨)' : '진행 중') : r.status === 'drawn' ? '추첨 완료' : '취소됨'; },

  html() {
    const body = this.error ? `<p class="muted small">${U.esc(this.error)}</p>`
      : !this.list.length ? `<p class="muted small">아직 만든 회차가 없어요. 첫 회차는 '홍보 회차'로 작게 시작해 보세요.</p>`
      : this.list.map(r => this.cardHtml(r)).join('');
    return `<div class="card adm">
      <div class="lbl" style="margin-top:0">운영자 · 럭키드로우 관리</div>
      <p class="muted small" style="margin:0 0 10px">광고 ${this.num('ad_reward_points', 10)}P · 하루 ${this.num('ad_daily_limit', 10)}번 · 광고 1번 수익 ${this.num('rf_rev_per_view', 11)}원으로 계산 · 경품 환원 ${Math.round(this.num('rf_payout', 0.75) * 100)}%</p>
      <button class="btn primary" style="width:100%" onclick="RaffleAdmin.openEditor()" ${this.error ? 'disabled' : ''}>새 회차 만들기</button>
      ${body}</div>`;
  },

  cardHtml(r) {
    const min = r.min_entries || 0, pct = min ? Math.min(100, Math.round(r.entries / min * 100)) : 100, open = r.status === 'open';
    return `<div class="adm-card">
      <div class="adm-top"><b>${U.esc(r.title)}</b><span class="adm-st ${r.status}">${this.statusName(r)}</span></div>
      <div class="adm-sub">${U.esc(r.prize_name)} · ${Number(r.prize_value || 0).toLocaleString()}원${r.sponsored ? ' · 홍보 회차' : ''}</div>
      <div class="adm-sub">${this.fmt(r.starts_at)} ~ ${this.fmt(r.ends_at)} · 응모 ${r.entry_cost}P · 1인 ${r.per_user_limit}회 · 당첨 ${r.winners_count}명 + 예비 ${r.reserve_count}명</div>
      <div class="rf-bar"><i style="width:${pct}%"></i></div>
      <div class="adm-sub">응모 ${r.entries}회 (${r.people}명)${min ? ` / 성립 기준 ${min}회` : ' · 성립 기준 없음'}</div>
      ${open ? `<div class="adm-acts">${r.entries ? '' : `<button class="btn small" onclick="RaffleAdmin.openEditor(${r.id})">고치기</button>`}
        <button class="btn small" onclick="RaffleAdmin.act(${r.id}, 'draw')">지금 추첨</button>
        <button class="btn small danger" onclick="RaffleAdmin.act(${r.id}, 'cancel')">취소·포인트 반환</button></div>` : ''}
      ${(r.winners || []).map(w => this.winnerHtml(r, w)).join('')}
    </div>`;
  },

  winnerHtml(r, w) {
    const expired = !w.claimed_at && !w.reserve && !w.forfeited && w.claim_until && new Date(w.claim_until) < new Date();
    const state = w.forfeited ? '당첨 취소' : w.reserve ? '예비' : w.shipped_at ? `보냄 ${this.fmt(w.shipped_at)}` : w.claimed_at ? '배송지 받음' : expired ? '기한 지남' : `배송지 기다림 (~${this.fmt(w.claim_until)})`;
    return `<div class="adm-w"><div><b>${w.rank}. ${U.esc(w.name)}</b> <span class="muted small">${state}</span></div>
      ${w.claimed_at && !w.forfeited ? `<div class="small">${U.esc(w.ship_name || '')} · ${U.esc(w.ship_phone || '')}<br>${U.esc(w.ship_addr || '(보낸 지 30일 뒤 자동으로 지워짐)')}</div>` : ''}
      ${w.claimed_at && !w.shipped_at && !w.forfeited ? `<button class="btn small" onclick="RaffleAdmin.act(${r.id}, 'ship', '${w.user_id}')">보냄으로 표시</button>` : ''}
      ${expired ? `<button class="btn small" onclick="RaffleAdmin.act(${r.id}, 'promote')">예비 당첨자에게 넘기기</button>` : ''}</div>`;
  },

  act(id, action, user = null) {
    const msg = { draw: '지금 추첨할까요? 성립 기준에 못 미치면 취소되고 포인트가 돌아가요.', cancel: '이 회차를 취소하고 응모 포인트를 모두 돌려줄까요?',
      ship: '보냄으로 표시할까요? 배송 정보는 30일 뒤 자동으로 지워져요.', promote: '기한 안에 배송지를 넣지 않은 당첨자를 취소하고 예비 당첨자에게 넘길까요?' }[action];
    Sheet.open(`<div class="sheet-head"><b>럭키드로우</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <p class="muted" style="margin:0 0 14px">${msg}</p>
      <button class="btn primary big" onclick="RaffleAdmin.run(${id}, '${action}', ${user ? `'${user}'` : 'null'})">확인</button>
      <button class="btn ghost" onclick="Sheet.close()">그만두기</button>`);
  },

  async run(id, action, user) {
    Sheet.close();
    try {
      const r = await this.rpc('mp_admin_raffle_action', { p_id: id, p_action: action, p_user: user });
      if (r && r.ok === false) U.toast({ not_open: '이미 끝난 회차예요', no_expired_winner: '기한이 지난 당첨자가 없어요', no_reserve: '남은 예비 당첨자가 없어요' }[r.error] || '처리하지 못했어요');
      else U.toast(action === 'promote' && r.promoted ? `${r.promoted}님에게 넘겼어요` : '처리했어요');
    } catch (e) { U.toast('처리하지 못했어요'); }
    Raffle.load();
  },

  _local(iso) {
    const d = iso ? new Date(iso) : new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  openEditor(id = null) {
    const r = id ? this.list.find(x => x.id === id) : null;
    const twoWeeks = new Date(Date.now() + 14 * 86400000); twoWeeks.setHours(21, 0, 0, 0);
    this.draft = r ? { id: r.id, minTouched: true } : { id: null, minTouched: false };
    const v = (k, d = '') => r && r[k] != null ? U.esc(String(r[k])) : d;
    const f = (lab, inner) => `<label class="adm-f"><span>${lab}</span>${inner}</label>`;
    Sheet.open(`<div class="sheet-head"><b>${id ? '회차 고치기' : '새 럭키드로우 회차'}</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <div class="adm-form">
        ${f('회차 이름', `<input id="arTitle" class="input" maxlength="80" placeholder="예: 12월 첫 럭키드로우" value="${v('title')}">`)}
        ${f('경품', `<input id="arPrize" class="input" maxlength="80" placeholder="예: 스타벅스 아메리카노" value="${v('prize_name')}">`)}
        <div class="adm-2">${f('경품 가격(원)', `<input id="arValue" class="input" inputmode="numeric" value="${v('prize_value', '5000')}" oninput="RaffleAdmin.recalc()">`)}
          ${f('배송비(원, 계산용)', `<input id="arShip" class="input" inputmode="numeric" value="0" oninput="RaffleAdmin.recalc()">`)}</div>
        ${f('경품 사진 주소 (https, 선택)', `<input id="arImg" class="input" placeholder="https://..." value="${v('image_url')}">`)}
        <div class="adm-2">${f('응모 1회 포인트', `<input id="arCost" class="input" inputmode="numeric" value="${v('entry_cost', String(this.num('rf_entry_cost', 100)))}" oninput="RaffleAdmin.recalc()">`)}
          ${f('1인 최대 응모', `<input id="arPer" class="input" inputmode="numeric" value="${v('per_user_limit', String(this.num('rf_per_user_limit', 20)))}">`)}</div>
        <div class="adm-2">${f('당첨자 수', `<input id="arWin" class="input" inputmode="numeric" value="${v('winners_count', '1')}" oninput="RaffleAdmin.recalc()">`)}
          ${f('예비 당첨자 수', `<input id="arRes" class="input" inputmode="numeric" value="${v('reserve_count', '1')}">`)}</div>
        ${f('시작', `<input id="arStart" class="input" type="datetime-local" value="${this._local(r && r.starts_at)}">`)}
        ${f('마감', `<input id="arEnd" class="input" type="datetime-local" value="${this._local(r ? r.ends_at : twoWeeks)}">`)}
        <label class="pro-agree"><input type="checkbox" id="arSponsored" ${!r || r.sponsored ? 'checked' : ''} onchange="RaffleAdmin.recalc()"><span>홍보 회차<small>성립 기준 없이 무조건 추첨해요. 경품비는 홍보비로 봐요.</small></span></label>
        ${f('회차 성립 기준 (응모 횟수)', `<input id="arMin" class="input" inputmode="numeric" value="${v('min_entries', '0')}" oninput="RaffleAdmin.draft.minTouched = true">`)}
        <p id="arCalc" class="muted small"></p>
        ${f('추가 안내 (선택)', `<textarea id="arRules" class="input" rows="2" placeholder="예: 모바일 쿠폰으로 보내 드려요">${v('rules')}</textarea>`)}
        <button class="btn primary big" onclick="RaffleAdmin.save()">${id ? '고치기 완료' : '회차 열기'}</button>
      </div>`);
    this.recalc();
  },

  recalc() {
    const val = id => Math.max(0, parseInt((document.getElementById(id) || {}).value, 10) || 0);
    const cost = (val('arValue') + val('arShip')) * Math.max(1, val('arWin'));
    const be = this.breakEven(cost, val('arCost') || 100);
    const sp = (document.getElementById('arSponsored') || {}).checked, minEl = document.getElementById('arMin');
    if (minEl) {
      if (sp) { minEl.value = '0'; minEl.disabled = true; }
      else { minEl.disabled = false; if (!this.draft.minTouched || minEl.value === '0') minEl.value = String(be.entries); }
    }
    const box = document.getElementById('arCalc');
    if (box) box.innerHTML = sp ? `홍보 회차예요. 응모가 1번이라도 있으면 마감 때 추첨해요. 경품비 ${cost.toLocaleString()}원은 광고 수익과 상관없이 나가요.`
      : `손해 없는 기준: 경품비 ${cost.toLocaleString()}원 → 광고 수익 약 ${be.revenue.toLocaleString()}원 필요 → 광고 약 ${be.views.toLocaleString()}번 → <b>응모 ${be.entries.toLocaleString()}번</b>. 못 미치면 7일 한 번 늘리고, 그래도 모자라면 취소·포인트 반환돼요.`;
  },

  async save() {
    const g = id => (document.getElementById(id) || {}).value || '', n = id => parseInt(g(id), 10);
    const title = g('arTitle').trim(), prize = g('arPrize').trim(), start = new Date(g('arStart')), end = new Date(g('arEnd'));
    if (!title || !prize) return U.toast('회차 이름과 경품을 넣어 주세요');
    if (isNaN(end) || isNaN(start) || end <= start) return U.toast('마감은 시작보다 뒤여야 해요');
    if (end < new Date()) return U.toast('마감이 이미 지났어요');
    const img = g('arImg').trim();
    if (img && !/^https:\/\//.test(img)) return U.toast('사진 주소는 https로 시작해야 해요');
    const sp = document.getElementById('arSponsored').checked;
    const p = { id: this.draft.id, title, prize_name: prize, prize_value: n('arValue') || 0, image_url: img,
      entry_cost: Math.max(1, n('arCost') || 100), per_user_limit: Math.max(1, n('arPer') || 20),
      winners_count: Math.max(1, n('arWin') || 1), reserve_count: Math.min(5, Math.max(0, n('arRes') || 0)),
      min_entries: sp ? 0 : Math.max(0, n('arMin') || 0), sponsored: sp,
      starts_at: start.toISOString(), ends_at: end.toISOString(), rules: g('arRules').trim(), claim_days: 7, extend_days: 7 };
    try {
      const r = await this.rpc('mp_admin_raffle_save', { p });
      Sheet.close();
      U.toast(r && r.limited ? '응모가 시작된 회차라 사진·안내·마감 늘리기만 바뀌었어요' : (this.draft.id ? '고쳤어요' : '회차를 열었어요'));
    } catch (e) { U.toast('저장하지 못했어요'); }
    Raffle.load();
  },
};
