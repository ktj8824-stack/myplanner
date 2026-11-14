/* =========================================
   MyPlanner — 포인트 · 출석 체크 (버디플래너 방식)
   - 포인트는 서버 장부(mp_point_ledger) 합계만 인정. 기기에는 화면 표시용 숫자만 저장하고
     적립·사용은 모두 서버 함수가 처리 (앱이 숫자를 바꿀 수 없음)
   - 포인트는 무료로만 쌓임: 출석 체크, 광고 끝까지 보기(하루 10번), 새 일정 등록, 가족 공유·연결
     → 럭키드로우 응모에 씀. 돈으로 팔지 않음
   - 새 일정·가족 공유·가족 연결 포인트는 서버가 자동으로 적립 (앱은 늘어난 것만 알려 줌)
   ========================================= */
const Points = {
  CACHE: 'mp_points', META: 'mp_points_meta',
  history: null,

  available() { return typeof Cloud !== 'undefined' && Cloud.isSignedIn(); },
  balance() { try { return parseInt(localStorage.getItem(this.CACHE) || '0', 10) || 0; } catch (e) { return 0; } },
  today() { return new Date().toLocaleDateString('ko-KR'); },

  meta() {
    let m = {};
    try { m = JSON.parse(localStorage.getItem(this.META) || '{}') || {}; } catch (e) { m = {}; }
    const fresh = m.day === this.today();
    const rules = Object.assign({ attend: 3, streak_days: 7, streak_bonus: 10, schedule: 5, schedule_limit: 2, share: 5, share_limit: 2, family: 20, expire_days: 365 }, m.rules || {});
    return { ad_today: fresh ? m.ad_today || 0 : 0, ad_limit: m.ad_limit || 10, ad_points: m.ad_points || 10,
      attended_today: fresh && !!m.attended_today, streak: m.streak || 0, expiring_soon: m.expiring_soon || 0, rules };
  },

  /** 서버 응답으로 표시용 값 갱신 */
  apply(r) {
    if (!r || typeof r !== 'object') return;
    try {
      if (typeof r.balance === 'number') localStorage.setItem(this.CACHE, String(r.balance));
      let m = {};
      try { m = JSON.parse(localStorage.getItem(this.META) || '{}') || {}; } catch (e) { m = {}; }
      if (m.day !== this.today()) { m.ad_today = 0; m.attended_today = false; }
      ['ad_today', 'ad_limit', 'ad_points', 'attended_today', 'streak', 'expiring_soon', 'rules'].forEach(k => { if (r[k] != null) m[k] = r[k]; });
      m.day = this.today();
      localStorage.setItem(this.META, JSON.stringify(m));
    } catch (e) {}
    this.updateUI();
  },

  /** 화면의 숫자 갱신 (data-points, data-ad-count) */
  updateUI() {
    const b = this.balance().toLocaleString(), m = this.meta();
    document.querySelectorAll('[data-points]').forEach(el => { el.textContent = b; });
    document.querySelectorAll('[data-ad-count]').forEach(el => { el.textContent = `${m.ad_today}/${m.ad_limit}`; });
  },

  rpc(fn, body) { return Cloud.rpc(fn, body || {}); },

  async refresh() {
    if (!this.available()) return null;
    try { const r = await this.rpc('mp_my_points'); this.apply(r); return r; }
    catch (e) { console.warn('[Points] 조회 실패', e.message); return null; }
  },

  async loadHistory() {
    if (!this.available()) return;
    try { this.history = await this.rpc('mp_point_history') || []; } catch (e) { this.history = this.history || []; }
  },

  /** 로그인 안 했으면 안내하고 false */
  requireLogin(what = '포인트') {
    if (this.available()) return true;
    Sheet.open(`<div class="sheet-head"><b>로그인이 필요해요</b><button class="x" aria-label="닫기" onclick="Sheet.close()">✕</button></div>
      <p class="muted" style="margin:0 0 14px">${what}는 계정에 안전하게 보관돼요. 폰을 바꿔도 그대로 이어져요.</p>
      <button class="btn kakao big" onclick="Sheet.close();Cloud.signInKakao()">카카오로 로그인</button>
      <button class="btn ghost" onclick="Sheet.close()">나중에</button>`);
    return false;
  },

  /** 출석 체크 (하루 1번, 연속 출석 보너스는 서버가 계산) */
  async checkIn() {
    if (!this.requireLogin()) return;
    if (this._busy) return;
    this._busy = true;
    try {
      const r = await this.rpc('mp_check_in');
      if (r && r.ok) {
        this.apply({ balance: r.balance, attended_today: true, streak: r.streak });
        U.toast(r.bonus ? `${r.streak}일 연속 출석! ${r.earned}P 받았어요` : `출석 완료 · ${r.earned}P 받았어요 (연속 ${r.streak}일)`);
      } else if (r && r.error === 'already') {
        this.apply({ balance: r.balance, attended_today: true });
        U.toast('오늘은 이미 출석했어요. 내일 또 만나요');
      }
    } catch (e) { U.toast('출석하지 못했어요. 인터넷 연결을 확인해 주세요'); }
    this._busy = false;
    await this.loadHistory();
    this.repaint();
  },

  /** 광고 보기 전 확인 (하루 한도는 서버가 최종 판단) */
  canWatchAd() {
    if (!this.requireLogin()) return false;
    const m = this.meta();
    if (m.ad_today >= m.ad_limit) { U.toast(`오늘은 광고 포인트를 다 받았어요 (${m.ad_limit}번). 내일 다시 받아 주세요`); return false; }
    return true;
  },

  /** 광고를 끝까지 봤을 때 (Ads가 부름) */
  async onAdRewarded() {
    if (!this.available() || this._adBusy) return;
    this._adBusy = true;
    const before = this.balance();
    try {
      const r = await this.rpc('mp_earn_ad_points');
      this.apply(r);
      if (r && r.ok) U.toast(`${r.earned}P 받았어요 (오늘 ${r.ad_today}/${r.ad_limit}번)`);
      else if (r && r.error === 'daily_limit') U.toast('오늘은 광고 포인트를 다 받았어요. 내일 다시 받아 주세요');
      else if (r && r.error === 'use_ssv') {
        U.toast('적립을 확인하고 있어요…');
        for (const wait of [2500, 5000, 10000]) {
          await new Promise(res => setTimeout(res, wait));
          const now = await this.refresh();
          if (now && now.balance > before) { U.toast(`${now.balance - before}P 받았어요`); break; }
        }
      }
    } catch (e) { U.toast('포인트를 받지 못했어요. 잠시 뒤 다시 확인해 주세요'); }
    this._adBusy = false;
    await this.loadHistory();
    this.repaint();
  },

  /** 서버가 자동으로 준 포인트(새 일정·가족 공유)가 늘었으면 알려 줌 */
  async noticeEarned(label) {
    if (!this.available()) return;
    const before = this.balance();
    const r = await this.refresh();
    if (r && typeof r.balance === 'number' && r.balance > before) U.toast(`${label} · ${r.balance - before}P 받았어요`);
  },

  repaint() { if (App.current === 'points') PointsView.paint(); if (App.current === 'home' && typeof Home !== 'undefined') Home.render(); if (App.current === 'raffle' && typeof Raffle !== 'undefined') Raffle.paint(); this.updateUI(); },

  REASON: { ad: '광고 보기', attend: '출석 체크', schedule: '새 일정 등록', share: '가족에게 일정 공유', family: '가족 연결',
    raffle_entry: '럭키드로우 응모', raffle_refund: '럭키드로우 취소 · 돌려받음', admin: '운영자 지급', event: '이벤트', expire: '기간 지나 사라짐' },
};

/* ---------- 포인트 화면 ---------- */
const PointsView = {
  render() {
    this.paint();
    if (!Points.available()) return;
    Promise.all([Points.refresh(), Points.loadHistory()]).then(() => { if (App.current === 'points') this.paint(); });
  },

  /** 7일 출석 도장: 이번 묶음에서 며칠째인지 */
  stamps(m) {
    const every = m.rules.streak_days || 7;
    const done = m.streak ? ((m.streak - 1) % every) + 1 : 0;
    const filled = m.attended_today ? done : (m.streak % every);
    let h = '';
    for (let i = 1; i <= every; i++) {
      const on = i <= filled, last = i === every;
      h += `<li class="${on ? 'on' : ''} ${last ? 'bonus' : ''}"><span>${on ? '✓' : last ? `+${m.rules.streak_bonus}` : i}</span><small>${i}일</small></li>`;
    }
    return h;
  },

  paint() {
    const signed = Points.available(), m = Points.meta(), R = m.rules;
    const adLeft = Math.max(0, m.ad_limit - m.ad_today);
    const native = Ads.native && Ads.native();
    const head = `<header class="subhead"><button class="back" onclick="App.navigate('home')" aria-label="뒤로"></button><h1>포인트</h1><span></span></header>`;
    if (!signed) {
      App.setMain(`${head}
        <div class="pt-hero"><small>내 포인트</small><div class="pt-bal pt-bal-off">로그인하면 쌓여요</div>
          <p>출석 체크, 광고 보기, 일정 등록으로 포인트를 모아 럭키드로우에 응모해요.</p></div>
        <div class="card"><p class="muted small" style="margin:0 0 10px">포인트는 계정에 보관돼요. 카카오로 로그인하면 바로 출석 체크할 수 있어요.</p>
          <button class="btn kakao big" onclick="Cloud.signInKakao()">카카오로 로그인</button></div>
        ${this.howCard(m)}`);
      return;
    }
    const hist = Points.history;
    const rows = hist == null ? '<p class="muted small" style="margin:0">불러오는 중…</p>'
      : !hist.length ? '<p class="muted small" style="margin:0">아직 내역이 없어요. 오늘 출석 체크부터 해 보세요.</p>'
      : hist.slice(0, 30).map(h => {
          const d = new Date(h.created_at);
          return `<div class="pt-row"><span>${U.esc(Points.REASON[h.reason] || h.reason)}<small>${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</small></span><b class="${h.delta > 0 ? 'plus' : 'minus'}">${h.delta > 0 ? '+' : ''}${Number(h.delta).toLocaleString()}P</b></div>`;
        }).join('');
    App.setMain(`${head}
      <div class="pt-hero">
        <small>내 포인트</small>
        <div class="pt-bal"><b data-points>${Points.balance().toLocaleString()}</b><span>P</span></div>
        ${m.expiring_soon ? `<p class="pt-exp">30일 안에 ${m.expiring_soon.toLocaleString()}P가 사라져요</p>` : ''}
        <button class="pt-raffle" onclick="App.navigate('raffle')"><span>럭키드로우 응모하기</span><small>모은 포인트로 경품 응모</small></button>
      </div>

      <div class="card pt-attend">
        <div class="pt-attend-top">
          <div><b>출석 체크</b><small>${m.streak ? `${m.streak}일 연속 출석 중` : '오늘부터 연속 출석을 시작해요'} · ${R.streak_days}일 연속이면 +${R.streak_bonus}P</small></div>
        </div>
        <ol class="pt-stamps">${this.stamps(m)}</ol>
        <button class="btn primary big" onclick="Points.checkIn()" ${m.attended_today ? 'disabled' : ''}>${m.attended_today ? '오늘 출석 완료' : `출석하고 ${R.attend}P 받기`}</button>
      </div>

      <div class="card pt-ad">
        <div><b>광고 보고 ${m.ad_points}P</b><small>하루 ${m.ad_limit}번 · 오늘 <span data-ad-count>${m.ad_today}/${m.ad_limit}</span></small></div>
        <button class="btn small ${adLeft ? 'primary' : ''}" onclick="Ads.reward()" ${adLeft ? '' : 'disabled'}>${adLeft ? (native ? '광고 보기' : '앱에서 보기') : '내일 다시'}</button>
      </div>

      ${this.howCard(m)}

      <div class="card"><div class="lbl" style="margin-top:0">포인트 내역</div>${rows}</div>
      <p class="muted small" style="padding:0 6px">포인트는 무료로만 쌓이고 돈으로 팔지 않아요. 쌓인 날부터 ${Math.round(R.expire_days / 365) || 1}년이 지나면 사라지고, 현금으로 바꾸거나 다른 사람에게 줄 수 없어요.</p>`);
  },

  howCard(m) {
    const R = m.rules;
    return `<details class="card pt-how"><summary class="lbl">포인트 모으는 방법</summary>
      <ul>
        <li><b>출석 체크</b><span>${R.attend}P · ${R.streak_days}일 연속이면 +${R.streak_bonus}P</span></li>
        <li><b>광고 끝까지 보기</b><span>${m.ad_points}P · 하루 ${m.ad_limit}번</span></li>
        <li><b>새 일정 등록</b><span>${R.schedule}P · 하루 ${R.schedule_limit}번</span></li>
        <li><b>가족에게 일정 공유</b><span>${R.share}P · 하루 ${R.share_limit}번</span></li>
        <li><b>가족 연결</b><span>${R.family}P · 새 가족마다 한 번 (초대한 사람·들어온 사람 모두)</span></li>
      </ul></details>`;
  },
};

/** 홈 화면 한 줄: 오늘 출석 안 했으면 출석 체크, 했으면 포인트·럭키드로우 */
Points.homeStrip = function () {
  const m = this.meta(), signed = this.available();
  const done = signed && m.attended_today;
  return `<button class="pt-strip ${done ? 'done' : ''}" onclick="${done ? "App.navigate('points')" : signed ? 'Points.checkIn()' : "App.navigate('points')"}">
    <img src="img/icons/raffle.png" alt="">
    <span><b>${done ? `내 포인트 <span data-points>${this.balance().toLocaleString()}</span>P` : `오늘 출석 체크하고 ${m.rules.attend}P 받기`}</b><small>${done ? '럭키드로우에 응모해 보세요' : m.streak ? `${m.streak}일 연속 출석 중 · ${m.rules.streak_days}일 연속이면 +${m.rules.streak_bonus}P` : `포인트를 모아 럭키드로우에 응모해요`}</small></span>
    <i aria-hidden="true"></i></button>`;
};
