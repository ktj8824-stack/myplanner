/* =========================================
   MyPlanner — 챙길 것 (자동 체크리스트)
   - 일정 이름·이동수단·날씨를 보고 챙길 것을 알아서 제안
   - 사용자가 더 넣거나(add) 자동 항목을 빼거나(removed) 체크(done)할 수 있음
   - 저장: 원본 일정 s.pack = { add: [], removed: [] }, 체크는 날짜별 s.packDone = { 'YYYY-MM-DD': [이름] }
     → 반복 일정(매일 출근)은 날마다 체크가 새로 시작
   - 화면과 무관한 계산만 (테스트: test/pack.test.js)
   ========================================= */

const Pack = {
  /** [일정 이름에 들어 있는 말, 챙길 것들] — 위에서부터 맞는 것 모두 */
  RULES: [
    [/건강\s*검진|종합\s*검진|내시경|검진/, ['신분증', '금식 여부 확인', '복용 중인 약 목록']],
    [/병원|의원|진료|치과|한의원|안과|피부과|정형외과|내과|외래|재활|수술|입원/, ['신분증', '진료카드·예약 문자', '복용 중인 약 목록']],
    [/입원/, ['세면도구', '갈아입을 옷', '휴대폰 충전기']],
    [/면접/, ['이력서·포트폴리오', '신분증']],
    [/결혼식|웨딩|예식/, ['축의금 봉투']],
    [/돌잔치|돌찬치|백일/, ['축하금 봉투']],
    [/장례|조문|빈소|발인/, ['조의금 봉투', '어두운 옷']],
    [/미팅|회의|거래처|상담|계약|PT|발표/i, ['명함', '노트북·충전기']],
    [/계약/, ['도장', '신분증']],
    [/출장/, ['명함', '노트북·충전기', '휴대폰 충전기']],
    [/은행|관공서|주민센터|구청|시청|등기소|법원|세무서|동사무소/, ['신분증', '도장']],
    [/시험|고사|자격증/, ['수험표', '신분증', '필기구']],
    [/여행|캠핑|휴가/, ['휴대폰 충전기', '세면도구']],
    [/등산|산행|둘레길/, ['물', '등산화']],
    [/골프|라운딩/, ['골프화', '장갑']],
    [/헬스|운동|수영|필라테스|요가/, ['운동복', '수건']],
    [/어린이집|유치원|등원/, ['아이 가방·물통']]
  ],

  /** 자동으로 제안하는 챙길 것 (중복 없이) */
  auto(s, plan) {
    const out = [];
    const add = list => list.forEach(x => { if (!out.includes(x)) out.push(x); });
    const text = `${s.title || ''} ${(s.dest && s.dest.name) || ''}`;
    if (s.mode === 'flight') add(s.trip && s.trip.international ? ['여권', '탑승권(모바일)', '해외 결제 카드', '로밍·유심', '휴대폰 충전기'] : ['신분증', '탑승권(모바일)', '휴대폰 충전기']);
    if (s.mode === 'train') add(['승차권(코레일톡·SRT 앱)', '휴대폰 충전기']);
    this.RULES.forEach(([re, list]) => { if (re.test(text)) add(list); });
    const w = plan && plan.weather;
    if (w && (w.kind === 'rain' || w.kind === 'heavy')) add(['우산']);
    if (w && w.kind === 'heavy') add(['여벌 양말·신발']);
    if (w && w.kind === 'snow') add(['우산', '미끄럽지 않은 신발']);
    if (w && typeof w.temp === 'number' && w.temp <= 2) add(['두꺼운 겉옷·장갑']);
    return out;
  },

  /** 화면에 보여 줄 전체 목록 [{ name, auto, done }] */
  list(s, plan) {
    const p = s.pack || {};
    const removed = p.removed || [];
    const done = (s.packDone && s.packDone[s.date]) || [];
    const auto = this.auto(s, plan).filter(n => !removed.includes(n));
    const mine = (p.add || []).filter(n => !auto.includes(n));
    return [...auto.map(name => ({ name, auto: true })), ...mine.map(name => ({ name, auto: false }))]
      .map(x => ({ ...x, done: done.includes(x.name) }));
  },

  /** 아직 안 챙긴 것 이름들 (알림 문구용) */
  left(s, plan) { return this.list(s, plan).filter(x => !x.done).map(x => x.name); },

  /** 알림에 붙일 짧은 문구: " 챙길 것: 신분증, 우산 외 1개" */
  line(s, plan, max = 3) {
    const l = this.left(s, plan);
    if (!l.length) return '';
    return ` 챙길 것: ${l.slice(0, max).join(', ')}${l.length > max ? ` 외 ${l.length - max}개` : ''}.`;
  },

  /* ---------- 바꾸기 (원본 일정 base, 그날 날짜 date) ---------- */
  toggle(base, date, name) {
    base.packDone = base.packDone || {};
    const arr = base.packDone[date] || [];
    base.packDone[date] = arr.includes(name) ? arr.filter(x => x !== name) : [...arr, name];
    // 지난 날 체크 기록은 정리
    const cut = new Date(); cut.setDate(cut.getDate() - 7);
    const cutY = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}-${String(cut.getDate()).padStart(2, '0')}`;
    Object.keys(base.packDone).forEach(k => { if (k < cutY) delete base.packDone[k]; });
  },
  addItem(base, name) {
    name = String(name || '').trim().slice(0, 30);
    if (!name) return false;
    base.pack = base.pack || { add: [], removed: [] };
    base.pack.removed = (base.pack.removed || []).filter(x => x !== name);
    if (!(base.pack.add || []).includes(name)) base.pack.add = [...(base.pack.add || []), name];
    return true;
  },
  removeItem(base, name, wasAuto) {
    base.pack = base.pack || { add: [], removed: [] };
    if (wasAuto) { if (!(base.pack.removed || []).includes(name)) base.pack.removed = [...(base.pack.removed || []), name]; }
    else base.pack.add = (base.pack.add || []).filter(x => x !== name);
  }
};

if (typeof module !== 'undefined') module.exports = Pack;
