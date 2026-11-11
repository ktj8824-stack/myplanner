/* =========================================
   MyPlanner — AI 비서 (프리미엄 핵심 기능)
   말·글로 부탁 → 서버(myplanner-ai, Claude)가 '제안' → 앱 계산 엔진이 경로·기상·출발을 계산한
   큰 확인 카드 → 사용자가 [저장]을 눌러야 저장. AI가 시각을 직접 정하지 않음.
   40~60대를 위해: 큰 글씨, 마이크 버튼, 대답 소리로 읽기, "회사"·"엄마 집" 같은 말 기억
   ========================================= */

const Voice = {
  Rec: window.SpeechRecognition || window.webkitSpeechRecognition,
  canListen() { return !!this.Rec; },
  canSpeak() { return 'speechSynthesis' in window; },

  speak(text) {
    if (!this.canSpeak() || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/[🚌🚗🚕🚶🚄✈️⏰🚪🌧⛈❄️📍🎯✅👨‍👩‍👧]/gu, ''));
      u.lang = 'ko-KR'; u.rate = 0.95;
      const ko = speechSynthesis.getVoices().find(v => /ko/i.test(v.lang));
      if (ko) u.voice = ko;
      speechSynthesis.speak(u);
    } catch (e) {}
  },
  stop() { try { speechSynthesis.cancel(); } catch (e) {} },

  /** 말 듣기: 중간 결과는 onText, 끝나면 onDone(최종 문장) */
  listen(onText, onDone, onEnd) {
    if (!this.Rec) return null;
    const r = new this.Rec();
    r.lang = 'ko-KR'; r.interimResults = true; r.maxAlternatives = 1;
    let final = '';
    r.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      onText((final + interim).trim());
    };
    r.onerror = e => { if (e.error === 'not-allowed') U.toast('마이크 권한을 허용해 주세요'); };
    r.onend = () => { onEnd && onEnd(); if (final.trim()) onDone(final.trim()); };
    try { r.start(); } catch (e) { return null; }
    return r;
  }
};

const Assistant = {
  KEY: 'mp_ai_history',
  msgs: [],          // [{ role, content, actions?, cards? }]
  idxMap: [],        // 서버에 보낸 일정 목록 idx → occId
  busy: false,
  rec: null,
  speakOn: true,

  SUGGEST: ['내일 일정 알려 줘', '내일 오전 10시 서울아산병원 가야 돼', '평일 9시까지 회사 출근', '이번 주 일정 뭐 있어?'],
  ALIASES: ['회사', '직장', '사무실', '학교', '엄마 집', '아빠 집', '부모님 집', '본가', '시댁', '처가', '친정', '교회', '성당', '병원', '헬스장', '어린이집', '유치원', '학원'],

  load() {
    try { this.msgs = JSON.parse(localStorage.getItem(this.KEY) || '[]'); } catch (e) { this.msgs = []; }
    try { this.speakOn = localStorage.getItem('mp_ai_speak') !== 'off'; } catch (e) {}
  },
  persist() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.msgs.slice(-40).map(m => ({ role: m.role, content: m.content, cards: m.cards, ai: m.ai, reported: m.reported })))); } catch (e) {}
  },

  render() {
    if (!this.msgs.length) this.load();
    App.setMain(`
      <header class="subhead"><button class="back" onclick="Voice.stop();App.navigate('home')" aria-label="뒤로"></button><h1>AI 비서</h1>
        <button class="side btn small" style="padding:6px 10px" onclick="Assistant.toggleSpeak()" id="aiSpeakBtn" aria-label="소리">${this.speakOn ? '🔊' : '🔇'}</button></header>
      <div class="muted small center" id="aiQuota" style="margin:-4px 0 6px">${this.quotaLabel()}</div>
      <div id="aiLog" class="ai-log">${this.msgs.length ? this.msgs.map((m, i) => this.bubble(m, i)).join('') : this.welcome()}</div>
      <div class="ai-suggest" id="aiSuggest">${this.SUGGEST.map(s => `<button class="chip" onclick="Assistant.send(${JSON.stringify(s).replace(/"/g, '&quot;')})">${U.esc(s)}</button>`).join('')}</div>
      <div class="ai-input">
        ${Voice.canListen() ? `<button class="ai-mic" id="aiMic" onclick="Assistant.mic()" aria-label="말하기">${App.micSvg()}</button>` : ''}
        <input id="aiText" class="input" placeholder="${Voice.canListen() ? '말하거나 여기에 쓰세요' : '여기에 쓰세요'}"
          enterkeyhint="send" onkeydown="if(event.key==='Enter'){Assistant.send()}">
        <button class="btn primary" onclick="Assistant.send()">보내기</button>
      </div>`);
    // 아래 메뉴는 그대로 보임 (입력창은 메뉴 위에 떠 있음)
    this.scroll();
    // 지난 대화의 카드는 다시 계산해서 보여 줌
    this.msgs.forEach((m, i) => (m.cards || []).forEach((c, j) => { if (c.state === 'ready' || c.state === 'pending') this.prepare(i, j); }));
  },

  welcome() {
    const name = State.settings.name ? `${U.esc(State.settings.name)}님, ` : '';
    return `<div class="ai-msg bot"><div class="ai-bubble">${name}안녕하세요. 일정을 말로 부탁하시면 출발·기상 시간을 계산해서 알람까지 맞춰 드려요.<br><br>
      예) "내일 오전 10시 아산병원 가야 돼"<br>예) "다음 주 화요일 KTX 8시 서울역에서 부산"<br>예) "내일 출근 몇 시에 나가야 돼?"</div></div>`;
  },

  quotaLabel() {
    const q = this.quota;
    if (!q) return Cloud.isSignedIn() ? '말로 일정을 만들고 물어보세요' : '카카오 로그인 후 쓸 수 있어요';
    return q.pro ? `프리미엄 · 오늘 ${q.remaining}번 남음` : q.promo ? `출시 기념 무료 · 오늘 ${q.remaining}번 남음` : `오늘 ${q.remaining}번 남음`;
  },

  toggleSpeak() {
    this.speakOn = !this.speakOn;
    try { localStorage.setItem('mp_ai_speak', this.speakOn ? 'on' : 'off'); } catch (e) {}
    if (!this.speakOn) Voice.stop();
    document.getElementById('aiSpeakBtn').textContent = this.speakOn ? '🔊' : '🔇';
  },

  mic() {
    const btn = document.getElementById('aiMic'), input = document.getElementById('aiText');
    if (this.rec) { try { this.rec.stop(); } catch (e) {} return; }
    Voice.stop();
    btn.classList.add('on');
    input.placeholder = '듣고 있어요… 말씀하세요';
    this.rec = Voice.listen(t => { input.value = t; }, t => this.send(t), () => {
      this.rec = null; btn.classList.remove('on'); input.placeholder = '말하거나 여기에 쓰세요';
    });
    if (!this.rec) { btn.classList.remove('on'); U.toast('이 기기에서는 말하기를 쓸 수 없어요. 키보드의 마이크 버튼을 써 주세요'); }
  },

  bubble(m, i) {
    const cls = m.role === 'user' ? 'me' : 'bot';
    const cards = (m.cards || []).map((c, j) => `<div class="ai-card" id="aiCard_${i}_${j}">${this.cardHtml(c, i, j)}</div>`).join('');
    // AI가 만든 답변에는 신고 버튼 (구글 플레이 생성형 AI 정책)
    const report = m.role !== 'user' && m.ai ? (m.reported ? '<span class="ai-report done">신고했어요</span>' : `<button class="ai-report" onclick="Assistant.report(${i})">답변 신고</button>`) : '';
    return `<div class="ai-msg ${cls}"><div class="ai-bubble">${U.esc(m.content).replace(/\n/g, '<br>')}</div>${cards}${report}</div>`;
  },

  /* ---------- 답변 신고 ---------- */
  REPORT_REASONS: [['wrong', '틀린 정보예요'], ['inappropriate', '부적절하거나 불쾌해요'], ['unsafe', '위험한 내용이에요'], ['other', '기타']],

  report(i) {
    const m = this.msgs[i];
    if (!m) return;
    Sheet.open(`
      <div class="sheet-head"><b>이 답변 신고하기</b><button class="x" onclick="Sheet.close()">✕</button></div>
      <div class="ai-report-quote">${U.esc(m.content).slice(0, 300)}</div>
      <label class="lbl">어떤 문제가 있나요?</label>
      <div class="report-reasons">${this.REPORT_REASONS.map(([k, l], n) => `
        <label class="report-reason"><input type="radio" name="rpReason" value="${k}" ${n === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <label class="lbl">더 알려 주실 내용 <small class="muted">(선택)</small></label>
      <textarea id="rpNote" class="input" rows="2" maxlength="300" placeholder="예: 날짜를 다르게 알아들었어요"></textarea>
      <button class="btn primary big" style="margin-top:16px" onclick="Assistant.sendReport(${i})">신고 보내기</button>
      <p class="muted small center">신고한 답변과 바로 앞의 질문이 운영자에게 전달돼 AI 비서를 고치는 데 쓰여요.</p>`);
  },

  async sendReport(i) {
    const m = this.msgs[i];
    const prev = this.msgs.slice(0, i).reverse().find(x => x.role === 'user');
    const reason = (document.querySelector('input[name="rpReason"]:checked') || {}).value || 'other';
    const note = (document.getElementById('rpNote').value || '').trim().slice(0, 300) || null;
    try {
      await Cloud._api('rest/v1/mp_ai_reports', { method: 'POST', headers: { Prefer: 'return=minimal' },
        body: { question: prev ? String(prev.content).slice(0, 2000) : null, answer: String(m.content).slice(0, 4000), reason, note } });
      m.reported = true;
      this.persist();
      this.redraw();
      Sheet.close();
      U.toast('신고했어요. 더 나은 답변을 하도록 고칠게요');
    } catch (e) {
      U.toast(Cloud.isSignedIn() ? '신고를 보내지 못했어요. 잠시 후 다시 해 주세요' : '로그인한 뒤 신고할 수 있어요');
    }
  },

  scroll() { setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 50); },

  /* ---------- 서버에 보낼 내 정보 ---------- */
  context() {
    const now = new Date();
    const up = State.upcoming(14).filter(x => !x.plan.invalid).slice(0, 25);
    this.idxMap = up.map(x => x.s.occId || x.s.id);
    const places = Object.keys(State.settings.places || {});
    const family = typeof Cloud !== 'undefined' && Cloud.isSignedIn() ? Cloud.familyPeople().map(p => p.display_name).filter(Boolean) : [];
    return {
      today: U.today(), weekday: U.DOW[now.getDay()] + '요일', now: U.hm(now),
      userName: State.settings.name || '', home: State.settings.home ? State.settings.home.name : '',
      defaultMode: Planner.MODES[State.settings.defaultMode || 'transit'].label, prepMin: State.settings.prepMin || 60,
      places: places.slice(0, 30).map(p => String(p).slice(0, 30)), family: family.slice(0, 20).map(f => String(f).slice(0, 20)),
      upcoming: up.map(({ s, plan }, idx) => ({
        idx, title: String(s.title || '').slice(0, 60), date: s.date, weekday: U.DOW[Planner.at(s.date, '12:00').getDay()],
        kind: Planner.isTrip(s.mode) ? s.mode : 'event',
        time: Planner.isTrip(s.mode) ? s.trip.departTime + ' 출발' : s.arriveBy + ' 도착', end: s.endBy || undefined,
        wake: U.hm(plan.wakeAt), depart: U.hm(plan.departAt), mode: Planner.MODES[s.mode].label,
        to: s.dest ? s.dest.name : (s.trip && s.trip.departStation ? s.trip.departStation.name : ''),
        repeat: Recur.isRepeating(s) ? Recur.label(s) : undefined, weather: plan.weather ? plan.weather.label : undefined,
        shared_from: s._shared ? s._shared.from : undefined
      }))
    };
  },

  /* ---------- 보내기 ---------- */
  async send(text) {
    const input = document.getElementById('aiText');
    text = (text != null ? text : (input ? input.value : '')).trim();
    if (!text || this.busy) return;
    if (input) input.value = '';
    Voice.stop();
    document.getElementById('aiSuggest')?.classList.add('hide');
    this.push({ role: 'user', content: text });

    // 로그인·서버 없이도 되는 것: 브리핑
    if (/^(오늘|내일)?\s*(아침\s*)?브리핑/.test(text)) {
      const day = /내일/.test(text) ? Recur.shift(U.today(), 1) : U.today();
      return this.reply(Briefing.text(day));
    }
    if (!Cloud.isConfigured()) return this.reply('AI 비서를 쓰려면 서버 연결이 필요해요. 설정 > 개발자 설정을 확인해 주세요.');
    if (!Cloud.isSignedIn()) {
      return this.reply('AI 비서는 카카오로 로그인한 뒤 쓸 수 있어요. 로그인하면 폰을 바꿔도 일정이 그대로예요.', [{ kind: 'login', state: 'ready' }]);
    }

    this.busy = true;
    const typing = this.push({ role: 'assistant', content: '…', typing: true });
    try {
      const history = this.msgs.filter(m => !m.typing && !m.local).slice(-11, -1).map(m => ({ role: m.role, content: m.content }));
      const res = await this.call({ message: text, history, context: this.context() });
      this.msgs.splice(this.msgs.indexOf(typing), 1);
      if (res.remaining != null) this.quota = { remaining: res.remaining, pro: res.pro, promo: res.promo };
      const q = document.getElementById('aiQuota'); if (q) q.textContent = this.quotaLabel();
      // 변경 제안은 지금 번호표로 바로 일정 id를 정해 둠 (나중에 목록이 바뀌어도 엉뚱한 일정을 바꾸지 않게)
      const cards = (res.actions || []).map(a => {
        if (a.type === 'update' && a.occId == null && a.idx != null) a.occId = this.idxMap[a.idx] || null;
        return { kind: a.type, action: a, state: 'pending' };
      });
      this.reply(res.reply, cards, false, true); // AI가 만든 답변 → 신고 가능
    } catch (e) {
      this.msgs.splice(this.msgs.indexOf(typing), 1);
      const cards = e.code === 'daily_limit' && !e.pro ? [{ kind: 'pro', state: 'ready' }] : e.code === 'login_required' ? [{ kind: 'login', state: 'ready' }] : [];
      const msg = e.name === 'AbortError' ? '답이 너무 늦어지고 있어요. 조금 뒤에 다시 말씀해 주세요.'
        : e instanceof TypeError ? '인터넷 연결을 확인한 뒤 다시 말씀해 주세요.'
        : (e.message || '잠시 연결이 안 돼요. 조금 뒤에 다시 말씀해 주세요.');
      this.reply(msg, cards, true);
    }
    this.busy = false;
  },

  async call(body) {
    const { url, key } = Cloud.cfg();
    const res = await U.fetchT(`${url}/functions/v1/myplanner-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${await Cloud._token()}` },
      body: JSON.stringify(body)
    }, 30000);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.message || `연결 오류 (${res.status})`); e.code = data.error; e.pro = data.pro || data.promo; throw e; }
    return data;
  },

  push(m) {
    this.msgs.push(m);
    this.redraw();
    return m;
  },

  reply(text, cards = [], local, ai) {
    const m = { role: 'assistant', content: text, cards, local, ai: !!ai };
    this.msgs.push(m);
    this.persist();
    this.redraw();
    if (this.speakOn) Voice.speak(text);
    const i = this.msgs.length - 1;
    (async () => { for (let j = 0; j < cards.length; j++) if (cards[j].state === 'pending') await this.prepare(i, j); })();
  },

  redraw() {
    const log = document.getElementById('aiLog');
    if (!log) return;
    log.innerHTML = this.msgs.map((m, i) => m.typing ? `<div class="ai-msg bot"><div class="ai-bubble typing"><i></i><i></i><i></i></div></div>` : this.bubble(m, i)).join('');
    this.scroll();
  },

  card(i, j) { return (this.msgs[i].cards || [])[j]; },
  paintCard(i, j) {
    const el = document.getElementById(`aiCard_${i}_${j}`);
    if (el) el.innerHTML = this.cardHtml(this.card(i, j), i, j);
    this.persist();
  },

  /* ---------- 장소 찾기: "집" · 기억한 이름 · 전에 간 곳 · 검색 ---------- */
  /** 말로 한 장소 이름 다듬기: "엄마네로" → "엄마 집", "우리 회사에" → "회사" */
  normalizePlace(q) {
    const orig = String(q || '').trim().replace(/\s+/g, ' ');
    // 조사 떼기 — '로'는 '종로'·'을지로' 같은 지명이 있어 '집·회사' 같은 말에서만 뗌
    q = orig.replace(/(으로|에서|에|까지)$/, '').trim();
    const noRo = q.replace(/로$/, '');
    if (/(네|댁|집|회사|직장|사무실|학교|본가|시댁|처가|친정)$/.test(noRo)) q = noRo;
    q = q.replace(/^(우리|저희)\s*/, '').trim() || q;
    const who = '(엄마|어머니|어머님|아빠|아버지|아버님|부모님|할머니|할아버지|이모|고모|삼촌|언니|누나|형|오빠|동생|딸|아들)';
    const m = q.match(new RegExp('^' + who + '\\s*(네|댁|집|네 집)$'));
    if (m) {
      const n = { 어머니: '엄마', 어머님: '엄마', 아버지: '아빠', 아버님: '아빠' }[m[1]] || m[1];
      return n + ' 집';
    }
    if (/^(직장|사무실|회사)$/.test(q)) return '회사';
    return q;
  },

  async resolvePlace(q) {
    q = this.normalizePlace(q);
    if (!q) return null;
    const st = State.settings;
    if (/^(home|집|우리\s*집|자택)$/i.test(q)) return st.home ? { ...st.home } : null;
    const saved = st.places || {};
    const key = Object.keys(saved).find(k => k === q || q.includes(k) || k.includes(q));
    if (key) return { ...saved[key] };
    const prev = State.schedules.map(s => s.dest).filter(Boolean).find(d => d.name === q || (q.length >= 3 && d.name.includes(q)));
    if (prev) return { ...prev };
    if (this.ALIASES.some(a => q === a) || / 집$/.test(q)) return null; // "회사" 같은 말은 검색하면 엉뚱한 곳이 나와서 직접 고르게 함
    const list = await Routes.searchPlace(q);
    return list && list[0] ? list[0] : null;
  },

  rememberPlace(name, place) {
    if (!name || !place || /^(home|집)$/i.test(name)) return;
    State.settings.places = State.settings.places || {};
    State.settings.places[name] = { name: place.name, address: place.address || '', lat: place.lat, lng: place.lng };
    State.save();
  },

  /* ---------- 제안 → 실제 일정 초안 (경로·시각 계산) ---------- */
  async prepare(i, j) {
    const c = this.card(i, j);
    if (!c) return;
    c.state = 'pending'; this.paintCard(i, j);
    try {
      if (c.kind === 'schedule') await this.prepareSchedule(c);
      else if (c.kind === 'update') this.prepareUpdate(c);
      else c.state = 'ready';
    } catch (e) { c.state = 'error'; c.error = e.message; }
    this.paintCard(i, j);
  },

  async prepareSchedule(c) {
    const a = c.action, st = State.settings;
    // 이미 저장한 초안(수정 화면에서 저장 포함)은 다시 만들지 않음
    if (c.draft && State.get(c.draft.id)) { c.savedId = c.savedId || c.draft.id; c.state = 'saved'; return; }
    const bad = this.badAction(a);
    if (bad) throw new Error(bad);
    const isTrip = a.kind === 'train' || a.kind === 'flight';
    const mode = isTrip ? a.kind : (a.mode || st.defaultMode || 'transit');
    const d = c.draft || {
      id: U.uid(), title: a.title, date: a.date, arriveBy: isTrip ? '' : a.time, mode,
      origin: null, dest: null, prepMin: a.prep_min ?? st.prepMin ?? 60, bufferMin: a.buffer_min ?? st.bufferMin ?? 10,
      route: null, accessRoute: null, egressRoute: null, memo: a.memo || '', endBy: /^\d\d:\d\d$/.test(a.end_time || '') && !isTrip ? a.end_time : '',
      trip: { accessMode: isTrip ? (a.mode || 'transit') : 'transit', egressMode: 'transit', departTime: isTrip ? a.time : '08:00',
        arriveTime: a.arrive_time || '', number: a.number || '', international: !!a.international },
      repeat: { type: a.repeat && a.repeat !== 'none' ? a.repeat : 'none', days: a.repeat_days || [], until: '', skipHolidays: true },
      alarm: { ...st.alarm }, skips: [], overrides: {}
    };
    c.draft = d;
    if (!d.origin) {
      const o = await this.resolvePlace(a.origin || 'home');
      if (!o) { c.state = 'need'; c.need = { field: 'origin', q: a.origin && a.origin !== 'home' ? this.normalizePlace(a.origin) : '' , label: a.origin && a.origin !== 'home' ? `'${a.origin}'` : '출발지(집)' }; return; }
      d.origin = o;
    }
    if (isTrip) {
      if (!d.trip.departStation) {
        const p = await this.resolvePlace(a.from_station);
        if (!p) { c.state = 'need'; c.need = { field: 'departStation', q: a.from_station, label: `'${a.from_station}'` }; return; }
        d.trip.departStation = p;
      }
      if (a.to_station && !d.trip.arriveStation) d.trip.arriveStation = await this.resolvePlace(a.to_station);
      if (!d.accessRoute) d.accessRoute = (await Routes.options(d.origin, d.trip.departStation, d.trip.accessMode, Planner.at(d.date, d.trip.departTime)))[0] || null;
    } else {
      if (!d.dest) {
        const p = await this.resolvePlace(a.place);
        if (!p) { c.state = 'need'; c.need = { field: 'dest', q: this.normalizePlace(a.place), label: `'${a.place}'` }; return; }
        d.dest = p;
      }
      // 같은 날 앞 약속(저장된 것 + 이번 대화의 앞 카드)이 끝나고 바로면 그 장소에서 출발
      if (!c.chainChecked && (!a.origin || a.origin === 'home') && typeof DayPlan !== 'undefined') {
        c.chainChecked = true;
        const siblings = this.siblingDrafts(c);
        const prev = DayPlan.applyAuto(d, siblings);
        if (prev) c.chainNote = `'${prev.s.title}' 끝나고 ${prev.place.name}에서 바로 출발`;
      }
      if (!d.route) d.route = (await Routes.options(d.origin, d.dest, d.mode, Planner.at(d.date, d.arriveBy)))[0] || null;
    }
    if (isTrip ? !d.accessRoute : !d.route) throw new Error('경로를 찾지 못했어요');
    c.plan = this.planSummary(d);
    c.state = 'ready';
  },

  /** AI가 준 날짜·시각이 말이 되는지 (서버에서도 막지만 한 번 더) */
  badAction(a) {
    const isTrip = a.kind === 'train' || a.kind === 'flight';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '') || U.ymd(Planner.at(a.date, '12:00')) !== a.date) return '날짜를 알아듣지 못했어요. 다시 말씀해 주세요';
    if (!/^\d{2}:\d{2}$/.test(a.time || '') || +a.time.slice(0, 2) > 23 || +a.time.slice(3) > 59) return '시간을 알아듣지 못했어요. 몇 시인지 다시 말씀해 주세요';
    const repeating = a.repeat && a.repeat !== 'none';
    if (!repeating && Planner.at(a.date, a.time).getTime() < Date.now()) return '이미 지난 시간이에요. 날짜나 시간을 다시 말씀해 주세요';
    ['prep_min', 'buffer_min'].forEach(k => { if (a[k] != null) a[k] = Math.max(0, Math.min(300, Math.round(+a[k] || 0))); });
    if (isTrip && a.arrive_time && !/^\d{2}:\d{2}$/.test(a.arrive_time)) a.arrive_time = '';
    if (a.end_time && !/^\d{2}:\d{2}$/.test(a.end_time)) a.end_time = '';
    return '';
  },

  /** 같은 답변의 다른 일정 카드 초안 (아직 저장 전) */
  siblingDrafts(c) {
    const msg = this.msgs.find(m => (m.cards || []).includes(c));
    return msg ? msg.cards.filter(x => x !== c && x.kind === 'schedule' && x.draft && x.state !== 'dismissed' && !State.get(x.draft.id)).map(x => x.draft) : [];
  },

  planSummary(d) {
    // 아직 저장 전인 앞 카드에서 이어서 가는 경우도 미리 '이어서 출발'로 계산
    const p = Planner.compute(d.chained && !State.get(d.chained.from) ? { ...d, _chainPreview: true } : d);
    if (p.chained) return { wake: '바로', chained: true, depart: U.hm(p.departAt), end: Planner.isTrip(d.mode) ? d.trip.departTime : d.arriveBy,
      endLabel: Planner.isTrip(d.mode) ? '탑승' : '약속', warn: p.warnings.filter(w => !/어림|추정/.test(w))[0] || '', estimate: p.warnings.some(w => /어림|추정/.test(w)),
      weather: p.weather ? `${p.weather.icon} ${p.weather.label} — ${p.weather.tip}` : '' };
    return { wake: U.hmRel(p.wakeAt, d.date), depart: U.hm(p.departAt), end: Planner.isTrip(d.mode) ? d.trip.departTime : d.arriveBy,
      endLabel: Planner.isTrip(d.mode) ? '탑승' : '약속', warn: p.warnings.filter(w => !/추정한 시간/.test(w))[0] || '',
      estimate: p.warnings.some(w => /추정한 시간/.test(w)), weather: p.weather ? `${p.weather.icon} ${p.weather.label} — ${p.weather.tip}` : '' };
  },

  /** 못 찾은 장소: 검색창을 열고, 고른 곳을 그 이름으로 기억 */
  pickNeed(i, j) {
    const c = this.card(i, j);
    const need = c.need;
    PlacePicker.open(`${need.label} 고르기`, p => {
      const d = c.draft;
      if (need.field === 'departStation') d.trip.departStation = p; else d[need.field] = p;
      if (need.q && (this.ALIASES.includes(need.q) || / 집$/.test(need.q))) { this.rememberPlace(need.q, p); U.toast(`다음부터 '${need.q}'라고만 말씀하셔도 돼요`); }
      this.prepare(i, j);
    }, { query: need.q && !this.ALIASES.includes(need.q) && !/ 집$/.test(need.q) ? need.q : '', allowHome: need.field === 'origin' });
  },

  async save(i, j) {
    const c = this.card(i, j);
    if (!c || c.state !== 'ready') return;
    const d = c.draft;
    if (State.get(d.id)) { c.savedId = d.id; c.state = 'saved'; this.paintCard(i, j); return U.toast('이미 저장한 일정이에요'); }
    c.state = 'saving'; this.paintCard(i, j);
    if (!d.chained && (!c.action.origin || c.action.origin === 'home') && typeof DayPlan !== 'undefined' && DayPlan.applyAuto(d)) {
      try { d.route = (await Routes.options(d.origin, d.dest, d.mode, Planner.at(d.date, d.arriveBy)))[0] || d.route; } catch (e) {}
    }
    State.upsert(d);
    if (typeof DayPlan !== 'undefined') { try { const n = await DayPlan.rechainNext(d); if (n) c.rechained = n; } catch (e) {} }
    await U.quickWeather();
    await Alarm.rescheduleAll();
    const saved = Recur.isRepeating(d) ? (State.upcoming(14).find(x => x.s.baseId === d.id) || {}).s : d;
    c.savedId = saved ? (saved.occId || saved.id) : d.id;
    c.plan = this.planSummary(saved || d);
    // 가족에게도 보내기
    const names = c.action.share_with || [];
    if (names.length && Cloud.isSignedIn()) {
      const people = Cloud.familyPeople();
      const ids = people.filter(p => names.some(n => (p.display_name || '').includes(n) || n.includes(p.display_name || '~'))).map(p => p.user_id);
      try { if (ids.length) { await Cloud.setShares(d.id, ids); c.shared = people.filter(p => ids.includes(p.user_id)).map(p => p.display_name); } }
      catch (e) { c.shareError = true; }
    }
    c.state = 'saved';
    this.paintCard(i, j);
    const msg = (c.plan.chained ? `저장했어요. ${c.plan.depart}에 출발 알람을 울려 드릴게요.` : `저장했어요. ${c.plan.wake.replace('전날 ', '전날 ')}에 깨워 드리고, ${c.plan.depart}에 출발 알람을 울려 드릴게요.`)
      + (c.rechained ? ` '${c.rechained}'도 여기서 바로 출발로 바꿨어요.` : '') + (c.shared ? ` ${c.shared.join(', ')}님 폰에도 알람을 보냈어요.` : '');
    if (this.speakOn) Voice.speak(msg);
  },

  /** 한 답변의 일정 여러 개를 시간 순서대로 저장 (앞 약속부터 → 뒤 약속이 앞 장소에서 출발) */
  async saveAll(i) {
    const m = this.msgs[i];
    if (!m) return;
    const order = m.cards.map((c, j) => ({ c, j })).filter(x => x.c.kind === 'schedule' && x.c.state === 'ready' && x.c.draft)
      .sort((x, y) => (x.c.draft.date + (x.c.draft.arriveBy || x.c.draft.trip.departTime)).localeCompare(y.c.draft.date + (y.c.draft.arriveBy || y.c.draft.trip.departTime)));
    for (const x of order) await this.save(i, x.j);
  },

  edit(i, j) {
    const c = this.card(i, j);
    if (!c || !c.draft) return;
    App.navigate('register', { draft: c.draft });
  },

  /* ---------- 변경 제안 ---------- */
  prepareUpdate(c) {
    const a = c.action;
    const occId = a.occId || (a.idx != null ? this.idxMap[a.idx] : null);
    const cur = occId && Recur.resolve(occId);
    if (!cur) throw new Error('그 일정을 찾지 못했어요');
    if (cur._shared) throw new Error('가족이 공유한 일정은 보낸 사람만 바꿀 수 있어요');
    const before = Planner.compute(cur);
    const next = JSON.parse(JSON.stringify(cur));
    const rep = Recur.isRepeating(cur);
    if (a.skip) { c.summary = { title: cur.title, date: cur.date, skip: true, rep }; c.occId = occId; c.state = 'ready'; return; }
    if (a.new_time) { if (Planner.isTrip(cur.mode)) next.trip.departTime = a.new_time; else next.arriveBy = a.new_time; }
    if (a.new_date && !rep) next.date = a.new_date;
    if (a.new_time && !/^\d{2}:\d{2}$/.test(a.new_time)) throw new Error('바꿀 시간을 알아듣지 못했어요');
    if (a.new_date && (!/^\d{4}-\d{2}-\d{2}$/.test(a.new_date) || a.new_date < U.today())) throw new Error('바꿀 날짜를 알아듣지 못했어요');
    ['prep_min', 'buffer_min'].forEach(k => { if (a[k] != null) a[k] = Math.max(0, Math.min(300, Math.round(+a[k] || 0))); });
    if (a.prep_min != null) next.prepMin = a.prep_min;
    if (a.buffer_min != null) next.bufferMin = a.buffer_min;
    const after = Planner.compute(next);
    c.occId = occId;
    c.summary = { title: cur.title, date: next.date, rep, oldDate: cur.date,
      before: { wake: U.hm(before.wakeAt), depart: U.hm(before.departAt), time: Planner.isTrip(cur.mode) ? cur.trip.departTime : cur.arriveBy },
      after: { wake: U.hm(after.wakeAt), depart: U.hm(after.departAt), time: Planner.isTrip(next.mode) ? next.trip.departTime : next.arriveBy } };
    c.change = { new_time: a.new_time, new_date: rep ? null : a.new_date, prep_min: a.prep_min, buffer_min: a.buffer_min,
      end_time: /^\d\d:\d\d$/.test(a.new_end_time || '') ? a.new_end_time : '' };
    if (c.change.end_time) c.summary.endTime = c.change.end_time;
    c.state = 'ready';
  },

  async applyUpdate(i, j) {
    const c = this.card(i, j);
    if (!c || c.state !== 'ready') return;
    const cur = Recur.resolve(c.occId);
    const base = State.get(cur.baseId || cur.id);
    if (c.summary.skip) {
      base.skips = [...new Set([...(base.skips || []), cur.date])];
    } else if (Recur.isRepeating(base)) {
      // 반복 일정은 그날만 바꿈
      const ov = { ...(base.overrides || {})[cur.date] };
      if (c.change.new_time) { if (Planner.isTrip(base.mode)) ov.trip = { ...base.trip, departTime: c.change.new_time }; else ov.arriveBy = c.change.new_time; }
      if (c.change.prep_min != null) ov.prepMin = c.change.prep_min;
      if (c.change.buffer_min != null) ov.bufferMin = c.change.buffer_min;
      if (c.change.end_time) ov.endBy = c.change.end_time;
      base.overrides = { ...(base.overrides || {}), [cur.date]: ov };
    } else {
      if (c.change.new_time) { if (Planner.isTrip(base.mode)) base.trip.departTime = c.change.new_time; else base.arriveBy = c.change.new_time; }
      if (c.change.new_date) base.date = c.change.new_date;
      if (c.change.prep_min != null) base.prepMin = c.change.prep_min;
      if (c.change.buffer_min != null) base.bufferMin = c.change.buffer_min;
      if (c.change.end_time) base.endBy = c.change.end_time;
      if (c.change.new_date || c.change.new_time) { base.live = {}; }
    }
    // 시간·날짜를 바꿔 앞 일정보다 이르게 됐으면 '이어서 출발'을 풀고 집에서 출발로
    if (!c.summary.skip && typeof DayPlan !== 'undefined') {
      const occ = Recur.isRepeating(base) ? Recur.instance(base, cur.date) : base;
      if (occ.chained && DayPlan.chainBroken(occ)) {
        const patch = await DayPlan.unchainPatch(occ);
        if (Recur.isRepeating(base)) base.overrides[cur.date] = { ...base.overrides[cur.date], ...patch };
        else { Object.assign(base, patch); delete base.chained; base.alarm = { ...(base.alarm || {}), wake: State.settings.alarm.wake, nightBefore: State.settings.alarm.nightBefore }; }
      }
    }
    State.upsert(base);
    if (c.change && c.change.end_time && typeof DayPlan !== 'undefined') { try { await DayPlan.rechainNext(Recur.resolve(c.occId) || base); } catch (e) {} }
    await U.quickWeather();
    await Alarm.rescheduleAll();
    c.state = 'saved';
    this.paintCard(i, j);
    if (this.speakOn) Voice.speak(c.summary.skip ? '그날은 건너뛸게요. 알람도 꺼 뒀어요.' : `바꿨어요. 이제 ${c.summary.after.wake}에 깨워 드릴게요.`);
  },

  dismiss(i, j) { const c = this.card(i, j); c.state = 'dismissed'; this.paintCard(i, j); },

  /* ---------- 카드 그리기 ---------- */
  cardHtml(c, i, j) {
    if (!c) return '';
    if (c.kind === 'login') return `<div class="ai-c-body">카카오로 로그인하면 바로 쓸 수 있어요.</div><button class="btn kakao big" onclick="Cloud.signInKakao()">카카오로 시작하기</button>`;
    if (c.kind === 'pro') return `<div class="ai-c-title">오늘 무료 횟수를 다 썼어요</div><div class="ai-c-body">프리미엄(월 4,900원)은 하루 60번까지 쓸 수 있어요. 지금 이용권은 내일 다시 5번이에요.</div>
      <button class="btn primary" onclick="App.navigate('pro')">프리미엄 알아보기</button>
      <button class="btn ghost" onclick="App.navigate('register')">＋ 일정 추가</button>`;
    if (c.state === 'dismissed') return `<div class="muted small">취소했어요</div>`;
    if (c.state === 'error') return `<div class="ai-c-body">⚠️ ${U.esc(c.error || '처리하지 못했어요')}</div>`;
    if (c.state === 'pending' || c.state === 'saving') return `<div class="ai-c-body muted">🔎 ${c.state === 'saving' ? '알람 맞추는 중…' : '경로를 찾아 시간을 계산하는 중…'}</div>`;

    if (c.kind === 'schedule') {
      const d = c.draft || {}, a = c.action, m = Planner.MODES[d.mode || 'transit'];
      const head = `<div class="ai-c-title">${U.esc(a.title)}</div>
        <div class="ai-c-sub">${U.dateLabel(a.date)} · ${m.label}${d.repeat && d.repeat.type !== 'none' ? ' · 🔁 ' + U.esc(Recur.label(d)) : ''}</div>
        <div class="ai-c-sub">${U.modeIcon(d.mode)} ${d.origin ? U.esc(d.origin.name) : ''}${d.dest ? ' → ' + U.esc(d.dest.name) : d.trip && d.trip.departStation ? ' → ' + U.esc(d.trip.departStation.name) : ''}</div>`;
      if (c.state === 'need') return head + `<div class="ai-c-body">${U.esc(c.need.label)}이(가) 어디인지 골라 주세요.</div>
        <button class="btn primary big" onclick="Assistant.pickNeed(${i},${j})">📍 장소 고르기</button>
        <button class="link" onclick="Assistant.dismiss(${i},${j})">취소</button>`;
      const p = c.plan;
      const times = `${c.chainNote ? `<div class="ai-c-note">📍 ${U.esc(c.chainNote)}</div>` : ''}<div class="ai-times"><div><small>${p.chained ? '기상 없이' : '기상'}</small><b>${p.wake}</b></div><div><small>출발</small><b>${p.depart}</b></div><div><small>${p.endLabel}</small><b>${p.end}</b></div></div>
        ${p.weather ? `<div class="ai-c-note">${U.esc(p.weather)}</div>` : ''}${p.warn ? `<div class="ai-c-note warn">⚠️ ${U.esc(p.warn)}</div>` : ''}
        ${p.estimate ? `<div class="ai-c-note">거리로 추정한 시간이에요</div>` : ''}`;
      if (c.state === 'saved') return head + times + `<div class="ai-c-done">✅ 저장했어요 · 알람을 맞췄어요${c.rechained ? ` · '${U.esc(c.rechained)}'도 여기서 출발로 바꿨어요` : ''}${c.shared ? ` · ${U.esc(c.shared.join(', '))}님께도 보냈어요` : ''}</div>
        <div class="ai-c-row"><button class="btn ghost" onclick="App.navigate('timeline',{id:'${U.esc(c.savedId)}'})">일정 보기</button>${State.byDate(a.date).length > 1 ? `<button class="btn ghost" onclick="App.navigate('day',{date:'${U.esc(a.date)}',from:'home'})">하루 동선 보기</button>` : ''}</div>`;
      const shareNote = (a.share_with || []).length ? `<div class="ai-c-note">👨‍👩‍👧 ${U.esc(a.share_with.join(', '))}님 폰에도 알람을 보내요</div>` : '';
      const msgCards = (this.msgs[i] && this.msgs[i].cards) || [];
      const readyN = msgCards.filter(x => x.kind === 'schedule' && x.state === 'ready').length;
      const allBtn = readyN > 1 && msgCards.findIndex(x => x.kind === 'schedule' && x.state === 'ready') === j
        ? `<button class="btn primary big" onclick="Assistant.saveAll(${i})">✓ ${readyN}개 일정 한 번에 저장</button>` : '';
      return head + times + shareNote + allBtn + `<button class="btn ${allBtn ? 'ghost' : 'primary big'}" onclick="Assistant.save(${i},${j})">✓ ${allBtn ? '이것만 저장' : '이대로 저장하고 알람 켜기'}</button>
        <div class="ai-c-row"><button class="link" onclick="Assistant.edit(${i},${j})">고쳐서 저장</button><button class="link" onclick="Assistant.dismiss(${i},${j})">취소</button></div>`;
    }

    if (c.kind === 'update') {
      const s = c.summary;
      if (!s) return '';
      const head = `<div class="ai-c-title">${U.esc(s.title)}</div><div class="ai-c-sub">${U.dateLabel(s.oldDate || s.date)}${s.rep && !s.skip ? ' · 이 날만 바꿔요' : ''}</div>`;
      if (s.skip) {
        return head + (c.state === 'saved' ? `<div class="ai-c-done">✅ 이 날은 건너뛰어요 (알람 꺼짐)</div>`
          : `<div class="ai-c-body">이 날 하루만 건너뛸까요? 알람이 울리지 않아요.</div><button class="btn primary big" onclick="Assistant.applyUpdate(${i},${j})">✓ 건너뛰기</button><button class="link" onclick="Assistant.dismiss(${i},${j})">취소</button>`);
      }
      const row = (k, label) => s.before[k] !== s.after[k] ? `<div class="ai-diff"><span>${label}</span><s>${s.before[k]}</s> → <b>${s.after[k]}</b></div>` : '';
      return head + `${s.oldDate && s.date !== s.oldDate ? `<div class="ai-diff"><span>날짜</span><s>${U.dateLabel(s.oldDate).split(' · ')[0]}</s> → <b>${U.dateLabel(s.date).split(' · ')[0]}</b></div>` : ''}
        ${row('time', '약속')}${row('wake', '기상')}${row('depart', '출발')}${s.endTime ? `<div class="ai-diff"><span>끝나는 시간</span><b>${U.esc(s.endTime)}</b></div>` : ''}`
        + (c.state === 'saved' ? `<div class="ai-c-done">✅ 바꿨어요 · 알람도 다시 맞췄어요</div>`
          : `<button class="btn primary big" onclick="Assistant.applyUpdate(${i},${j})">✓ 이렇게 바꾸기</button><button class="link" onclick="Assistant.dismiss(${i},${j})">취소</button>`);
    }
    return '';
  }
};

/* =========================================
   아침 브리핑 — AI 비용 없이 계산 엔진이 만든 문장 (무료)
   ========================================= */
const Briefing = {
  /** 받침에 맞게 '으로/로' */
  ro(w) {
    const c = String(w).charCodeAt(String(w).length - 1);
    if (c >= 0xAC00 && c <= 0xD7A3) { const b = (c - 0xAC00) % 28; return w + (b === 0 || b === 8 ? '로' : '으로'); }
    return w + '로';
  },
  ampm(hm) {
    const [h, m] = hm.split(':').map(Number);
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${m ? ' ' + m + '분' : ''}`;
  },

  text(day) {
    const list = Recur.between(State.schedules, day, day).filter(s => !s.alarmOff || s._shared)
      .map(s => ({ s, plan: Planner.compute(s) })).filter(x => !x.plan.invalid).sort((a, b) => a.plan.departAt - b.plan.departAt);
    const isToday = day === U.today();
    const when = isToday ? '오늘' : '내일';
    if (!list.length) return `${when}은 예정된 일정이 없어요. 편안한 하루 보내세요.`;
    const now = Date.now();
    const parts = list.map(({ s, plan }, n) => {
      const m = Planner.MODES[s.mode];
      const how = Planner.isTrip(s.mode)
        ? `${this.ro(Planner.MODES[s.trip.accessMode || 'transit'].label)} ${s.trip.departStation ? this.ro(s.trip.departStation.name) + ' ' : ''}`
        : `${this.ro(m.label)} `;
      const go = plan.departAt.getTime() < now && isToday ? '이미 출발 시간이 지났어요' : `${this.ampm(U.hm(plan.departAt))}에 ${how}출발하세요`;
      const what = Planner.isTrip(s.mode) ? `${this.ampm(s.trip.departTime)} ${s.trip.number || m.label}` : `${this.ampm(s.arriveBy)} ${s.title}`;
      const wake = !isToday && n === 0 ? ` ${this.ampm(U.hm(plan.wakeAt))}에 깨워 드릴게요.` : '';
      const wx = plan.weather ? ` ${plan.weather.label}가 있으니 ${plan.weather.tip}.` : '';
      const live = plan.live ? ` 지금 교통 상황을 반영했어요.` : '';
      return `${n === 0 ? '' : '그다음 '}${what}${Planner.isTrip(s.mode) ? '' : (s.dest ? ', ' + s.dest.name : '')}. ${go}.${wake}${wx}${live}`;
    });
    const hello = isToday ? (new Date().getHours() < 11 ? '좋은 아침이에요. ' : '') : '';
    return `${hello}${when} 일정은 ${list.length}개예요. ${parts.join(' ')}`.replace(/\s+/g, ' ').trim();
  },

  /** 홈 카드: 저녁 6시 이후면 내일 브리핑 */
  card() {
    const evening = new Date().getHours() >= 18;
    const day = evening ? Recur.shift(U.today(), 1) : U.today();
    const has = Recur.between(State.schedules, day, day).length > 0;
    if (!has) return '';
    const t = this.text(day);
    return `<div class="card brief">
      <div class="row-between"><b>${evening ? '🌙 내일 브리핑' : '☀️ 오늘 브리핑'}</b>
        ${Voice.canSpeak() ? `<button class="btn small" onclick="Voice.speak(Briefing.text('${day}'))">🔊 듣기</button>` : ''}</div>
      <p>${U.esc(t)}</p></div>`;
  }
};
