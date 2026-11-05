/* =========================================
   MyPlanner — 쉬운 화면 · 저장 확인
   - Saved: 저장 뒤 "11월 9일 아침 7시 3분에 깨워 드릴게요" 한 문장 + [확인]
   - EasyAdd: 쉬운 화면을 켜면 새 일정을 ① 어디 ② 몇 시 ③ 확인, 세 화면으로
   - TextAsk: 처음 켤 때 "글씨를 크게 볼까요?" 한 번
   ========================================= */

/** 'Date' → '아침 7시 3분' (정각이면 '아침 7시') */
function koTime(d) {
  const h = d.getHours(), m = d.getMinutes();
  const part = h < 5 ? '새벽' : h < 12 ? '아침' : h === 12 ? '낮' : h < 18 ? '오후' : '저녁';
  return `${part} ${h % 12 || 12}시${m ? ` ${m}분` : ''}`;
}

/** 'Date' → '내일 11월 9일' / '오늘 11월 7일' / '11월 12일 (목)' */
function koDay(d) {
  const ymd = U.ymd(d), md = `${d.getMonth() + 1}월 ${d.getDate()}일`;
  const t = new Date(); t.setDate(t.getDate() + 1);
  if (ymd === U.today()) return `오늘 ${md}`;
  if (ymd === U.ymd(t)) return `내일 ${md}`;
  return `${md} (${U.DOW[d.getDay()]})`;
}

const Saved = {
  LABELS: { night: '전날 밤 안내', wake: '기상', pre: '출발 10분 전', depart: '출발', home: '집에 갈 시간', last: '막차' },

  /** 무엇이 언제 울리는지 한 문장 */
  sentence(d, mine) {
    if (d.startNow) {
      if (d.leftAt) return `지금 바로 출발하세요. ${koTime(Planner.compute(d).arriveAt)}쯤 도착해요`;
      const dep = mine.find(a => a.key === 'depart');
      return dep ? `${koDay(dep.at)} ${koTime(dep.at)}에 출발 알람을 울려 드릴게요` : '지금 바로 출발하세요';
    }
    const wake = mine.find(a => a.key === 'wake');
    if (wake) return `${koDay(wake.at)} ${koTime(wake.at)}에 깨워 드릴게요`;
    const dep = mine.find(a => a.key === 'depart') || mine.find(a => a.key === 'pre');
    if (dep) return `${koDay(dep.at)} ${koTime(dep.at)}에 출발 알람을 울려 드릴게요`;
    if (mine[0]) return `${koDay(mine[0].at)} ${koTime(mine[0].at)}에 알려 드릴게요`;
    return '저장했어요. 울릴 알람은 없어요';
  },

  show(d, list, after) {
    const mine = list.slice().sort((a, b) => a.at - b.at);
    // 반복 일정은 가장 가까운 회차의 알람만 보여 줌
    const first = mine[0];
    const occ = first ? (first.s.occId || first.s.id) : null;
    const same = mine.filter(a => (a.s.occId || a.s.id) === occ);
    const head = this.sentence(d, same);
    const rest = same.filter(a => !(head.includes('깨워') && a.key === 'wake') && !(head.includes('출발 알람') && a.key === 'depart'))
      .slice(0, 4).map(a => `${this.LABELS[a.key] || '알림'} ${U.hm(a.at)}`);
    this._after = after;
    const el = document.createElement('div');
    el.id = 'savedModal';
    el.className = 'saved-modal';
    el.setAttribute('role', 'alertdialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'savedHead');
    el.innerHTML = `<div class="saved-box">
      <div class="saved-ic">⏰</div>
      <p class="saved-head" id="savedHead">${U.esc(head)}</p>
      ${rest.length ? `<p class="saved-sub">${rest.map(U.esc).join(' · ')}</p>` : ''}
      ${Recur.isRepeating(d) ? `<p class="saved-sub">${U.esc(Recur.label(d))} 같은 시각에 계속 울려요</p>` : ''}
      <button class="btn primary big" id="savedOk" onclick="Saved.close()">확인</button>
    </div>`;
    const old = document.getElementById('savedModal');
    if (old) old.remove();
    document.body.appendChild(el);
    setTimeout(() => { const b = document.getElementById('savedOk'); if (b) b.focus(); }, 50);
  },

  close() {
    const el = document.getElementById('savedModal');
    if (el) el.remove();
    const f = this._after; this._after = null;
    if (f) f();
  }
};

/* ---------- 쉬운 화면: 세 화면으로 나눈 일정 추가 ---------- */
const EasyAdd = {
  step: 1,

  go(n) { this.step = n; Register.err = null; this.draw(); window.scrollTo(0, 0); const m = document.getElementById('main'); if (m) m.scrollTop = 0; },

  back() { if (this.step > 1) return this.go(this.step - 1); Register.back(); },

  /** 기존(자세한) 화면으로 같은 내용 그대로 */
  full() { Register.easy = false; Register.err = null; Register.draw(); if (!Register.ready()) Register.fetchRoutes(); },

  head(title) {
    return `<header class="subhead"><button class="back" onclick="EasyAdd.back()" aria-label="뒤로"></button><h1>새 일정</h1><span></span></header>
      <div class="ez-steps" aria-label="${this.step}단계 / 3단계">${[1, 2, 3].map(i => `<i class="${i <= this.step ? 'on' : ''}"></i>`).join('')}</div>
      <div class="ez-q"><small>${this.step} / 3</small>${title}</div>`;
  },

  draw() {
    const d = Register.d;
    if (Planner.isTrip(d.mode)) return this.full(); // 기차·비행기는 기존 화면이 맞음
    App.setMain(this['step' + this.step]());
  },

  refresh() { if (this.step === 3) this.draw(); },

  step1() {
    const d = Register.d;
    const recent = Register.recentPlaces();
    return `${this.head('어디 가세요?')}
      <button class="ez-search ${Register.badCls('dest')}" id="f-dest" onclick="EasyAdd.pickDest()">${U.icon('pin')} <span>${d.dest ? U.esc(d.dest.name) : '병원, 회사, 역 이름 찾기'}</span></button>
      ${Register.errLine('dest')}
      ${recent.length ? `<div class="ez-lbl">지난번에 간 곳</div>
        ${recent.map(s => `<button class="ez-big" onclick="EasyAdd.useRecent('${s.id}')">${U.modeIcon(s.mode)}<span><b>${U.esc(s.dest.name)}</b><small>${U.esc(s.title && s.title !== s.dest.name ? s.title : (s.dest.address || ''))}</small></span></button>`).join('')}` : ''}
      ${d.dest ? `<button class="btn primary big ez-next" onclick="EasyAdd.go(2)">다음</button>` : ''}
      <div class="ez-alt">
        <button class="link" onclick="PasteImport.open()">💬 받은 예약 문자로 채우기</button>
        <button class="link" onclick="EasyAdd.full()">자세히 입력하기</button>
      </div>`;
  },

  pickDest() {
    PlacePicker.open('어디 가세요?', p => {
      const d = Register.d;
      d.dest = p; d.route = null; Register.opts = [];
      Register.clearErr('dest');
      Register.fetchRoutes();
      this.go(2);
    });
  },

  useRecent(id) {
    Register.useRecent(id);
    this.go(2);
  },

  step2() {
    const d = Register.d;
    const [hh, mm] = String(d.arriveBy || '09:00').split(':').map(Number);
    const pm = hh >= 12, h12 = hh % 12 || 12;
    const days = [0, 1, 2].map(n => { const t = new Date(); t.setDate(t.getDate() + n); return [U.ymd(t), ['오늘', '내일', '모레'][n]]; });
    const other = !days.some(([y]) => y === d.date);
    const dt = Planner.at(d.date, d.arriveBy || '09:00');
    return `${this.head('몇 시까지 가요?')}
      <div class="ez-read">${U.esc(d.dest ? d.dest.name : '')}<b>${koDay(dt)} ${koTime(dt)}</b>까지</div>
      <div class="ez-lbl">날짜</div>
      <div class="ez-grid c3">${days.map(([y, l]) => `<button class="${d.date === y ? 'on' : ''}" onclick="EasyAdd.setDate('${y}')">${l}</button>`).join('')}</div>
      <label class="ez-other ${other ? 'on' : ''}"><span>다른 날 고르기</span><input type="date" id="ezDate" value="${d.date}" min="${U.today()}" onchange="EasyAdd.setDate(this.value)"></label>
      <div class="ez-lbl">시간</div>
      <div class="ez-grid c2">${[['오전', false], ['오후', true]].map(([l, v]) => `<button class="${pm === v ? 'on' : ''}" onclick="EasyAdd.setTime(${v ? 1 : 0}, ${h12}, ${mm})">${l}</button>`).join('')}</div>
      <div class="ez-grid c4">${Array.from({ length: 12 }, (_, i) => i + 1).map(h => `<button class="${h12 === h ? 'on' : ''}" onclick="EasyAdd.setTime(${pm ? 1 : 0}, ${h}, ${mm})">${h}시</button>`).join('')}</div>
      <div class="ez-grid c3">${[0, 10, 20, 30, 40, 50].map(m => `<button class="${mm === m ? 'on' : ''}" onclick="EasyAdd.setTime(${pm ? 1 : 0}, ${h12}, ${m})">${m ? m + '분' : '정각'}</button>`).join('')}</div>
      ${mm % 10 ? `<p class="muted small">지금 ${mm}분으로 되어 있어요. 다른 분을 누르면 바뀌어요.</p>` : ''}
      <button class="btn primary big ez-next" onclick="EasyAdd.go(3)">다음</button>`;
  },

  setDate(y) { if (y) Register.set('date', y); this.draw(); },

  setTime(pm, h12, m) {
    const h = (h12 % 12) + (pm ? 12 : 0);
    Register.set('arriveBy', `${U.pad(h)}:${U.pad(m)}`);
    this.draw();
  },

  step3() {
    const d = Register.d;
    const m = Planner.MODES[d.mode];
    let body;
    if (Register.loading) body = `<div class="ez-wait">🔎 가는 길을 찾고 있어요…</div>`;
    else if (!d.origin) body = '';
    else if (!Register.ready()) body = `<div class="ez-wait">가는 길을 아직 못 찾았어요.<br><button class="btn ghost" onclick="Register.fetchRoutes()">다시 찾기</button></div>`;
    else {
      const p = Planner.compute(d);
      const early = +d.bufferMin ? ` (${d.bufferMin}분 일찍)` : '';
      body = `<div class="ez-card">
          <small>${U.esc(koDay(Planner.at(d.date, '12:00')))} · ${U.esc(d.dest.name)} ${U.esc(d.arriveBy)}</small>
          ${p.chained ? `<b>${U.hm(p.departAt)} 출발</b>` : `<b>${U.hm(p.wakeAt)} 기상</b>`}
          <span>${U.hm(p.departAt)} ${U.esc(d.origin.name === '집' ? '집' : d.origin.name)}에서 출발 → ${U.hm(p.arriveAt)} 도착${early}</span>
        </div>
        <div class="ez-row"><span>${U.modeIcon(d.mode)} ${U.esc(m ? m.label : '')} ${U.durLabel(Planner.totalMin(d.route, d.mode))}</span><span>준비 ${d.prepMin ? U.durLabel(+d.prepMin) : '없음'}</span></div>
        ${p.warnings.map(w => `<div class="warn-line">⚠️ ${U.esc(w)}</div>`).join('')}`;
    }
    return `${this.head('이대로 할까요?')}
      <div class="ez-lbl">출발할 곳</div>
      <button class="ez-search small ${Register.badCls('origin')}" id="f-origin" onclick="EasyAdd.pickOrigin()">${U.icon('home')} <span>${d.origin ? U.esc(d.origin.name) : '어디서 출발하세요?'}</span><em>바꾸기</em></button>
      ${Register.errLine('origin')}
      ${body}
      ${Register.errLine('route')}
      <button class="btn primary big ez-next" id="regSave" onclick="Register.save()">⏰ 이대로 저장</button>
      <div class="ez-alt"><button class="link" onclick="EasyAdd.full()">교통·준비 시간·알림 자세히 고치기</button></div>`;
  },

  pickOrigin() {
    PlacePicker.open('출발할 곳', p => {
      const d = Register.d;
      d.origin = p; d.route = null; Register.opts = [];
      Register.unchain(); Register.clearErr('origin'); Register.clearErr('route');
      this.draw(); Register.fetchRoutes();
    });
  },

  /** 저장 검사에서 걸린 칸이 있는 단계로 */
  stepFor(field) { return field === 'dest' ? 1 : field === 'arriveBy' ? 2 : 3; }
};

/* ---------- 처음 켤 때 한 번: 글씨를 크게 볼까요? ---------- */
const TextAsk = {
  KEY: 'mp_text_asked',
  maybe() {
    let asked = true;
    try { asked = !!localStorage.getItem(this.KEY); } catch (e) {}
    if (asked) return;
    try { localStorage.setItem(this.KEY, '1'); } catch (e) {}
    Sheet.open(`
      <div class="sheet-head"><b>글씨를 크게 볼까요?</b><button class="x" onclick="TextAsk.pick('normal')" aria-label="닫기">✕</button></div>
      <p class="ta-sample">가나다 07:30 출발</p>
      <div class="ta-btns">
        <button class="btn primary big" onclick="TextAsk.pick('large')">크게 볼래요</button>
        <button class="btn primary big" onclick="TextAsk.pick('xlarge')">아주 크게 볼래요</button>
        <button class="btn ghost big" onclick="TextAsk.pick('normal')">지금 크기가 좋아요</button>
      </div>
      <p class="muted small center">나중에 마이 화면에서 언제든 바꿀 수 있어요.</p>`);
  },
  pick(k) {
    try { localStorage.setItem(this.KEY, '1'); } catch (e) {}
    State.settings.textSize = k;
    State.save();
    App.applyTextSize();
    Sheet.close();
    if (App.current === 'welcome' && typeof Welcome !== 'undefined') Welcome.render();
    else App.navigate(App.current || 'home', App.params || {});
  }
};
