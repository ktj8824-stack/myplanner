/* =========================================
   MyPlanner — 받은 문자·카톡에서 일정 뽑기
   KTX·SRT 승차권, 항공권, 병원 예약, 일반 약속 문자를 읽어
   { kind, date, time, title, place, trip, bufferMin } 으로 돌려줍니다.
   서버 없이 폰 안에서만 해석 (문자 내용이 밖으로 나가지 않음)
   ========================================= */

const Parse = {
  AIRLINES: { KE: '대한항공', OZ: '아시아나', '7C': '제주항공', LJ: '진에어', TW: '티웨이', BX: '에어부산',
    ZE: '이스타항공', RS: '에어서울', RF: '에어로케이', YP: '에어프레미아', '4V': '플라이강원' },
  AIRPORT_CODES: { GMP: '김포', ICN: '인천', CJU: '제주', PUS: '김해', TAE: '대구', CJJ: '청주', KWJ: '광주',
    RSU: '여수', USN: '울산', MWX: '무안', YNY: '양양', KPO: '포항경주', HIN: '사천', WJU: '원주', KUV: '군산' },
  DOMESTIC: ['김포', '인천', '제주', '김해', '부산', '대구', '청주', '광주', '여수', '울산', '무안', '양양', '포항', '포항경주', '사천', '원주', '군산'],
  DOW: { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 },
  PLACE_SUFFIX: '역|역사|병원|의원|치과|한의원|클리닉|센터|빌딩|타워|호텔|카페|점|학교|대학교|청|시청|구청|공항|터미널|출구|광장|공원|교회|성당|은행|회관|아트홀|극장|컨벤션|스타디움|경기장',

  pad: n => String(n).padStart(2, '0'),

  normalize(text) {
    return String(text || '')
      .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // 전각 → 반각
      .replace(/\r/g, '')
      .replace(/(?:->|=>|⇒|➡️?|▶|▷|〉|>)/g, '→')
      .replace(/[～〜]/g, '~')
      .replace(/\[Web발신\]|\(광고\)/g, ' ')
      .replace(/[ \t]+/g, ' ');
  },

  /* ---------- 날짜 ---------- */
  findDate(t, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const mk = (y, m, d) => {
      const dt = new Date(y, m - 1, d);
      return dt.getMonth() === m - 1 ? dt : null;
    };
    const guessYear = (m, d) => {
      // 연도가 없으면 올해, 이미 한 달 넘게 지난 날짜면 내년
      const dt = mk(now.getFullYear(), m, d);
      if (dt && today - dt > 31 * 86400000) return mk(now.getFullYear() + 1, m, d);
      return dt;
    };
    let m;
    if ((m = t.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/))) return mk(+m[1], +m[2], +m[3]);
    if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) return guessYear(+m[1], +m[2]);
    // 11/5(수), 11.05(화) — 시간·소수와 헷갈리지 않게 요일 괄호나 공백이 뒤따를 때만
    if ((m = t.match(/(?:^|[^\d.:/])(\d{1,2})\s*[./]\s*(\d{1,2})(?=\s*\(\s*[일월화수목금토]|\s+[^\d:]|\s+\d{1,2}\s*(?::|시)|\s*$)/))) {
      const mo = +m[1], d = +m[2];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return guessYear(mo, d);
    }
    const rel = { 오늘: 0, 금일: 0, 내일: 1, 명일: 1, 모레: 2, 내일모레: 2, 글피: 3 };
    if ((m = t.match(/(내일모레|오늘|금일|내일|명일|모레|글피)/))) {
      const dt = new Date(today); dt.setDate(dt.getDate() + rel[m[1]]); return dt;
    }
    if ((m = t.match(/(다음\s*주|담주|차주|이번\s*주|금주|이번)?\s*([일월화수목금토])요일/))) {
      const target = this.DOW[m[2]];
      const dt = new Date(today);
      if (m[1] && /다음|담|차/.test(m[1])) {
        // 다음 주 (월요일 시작 기준)
        const mondayNext = new Date(today);
        mondayNext.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
        dt.setTime(mondayNext.getTime());
        dt.setDate(dt.getDate() + ((target + 6) % 7));
      } else if (m[1] && /이번|금주/.test(m[1])) {
        // 이번 주 (월요일 시작) — 이미 지난 요일이어도 이번 주 그날
        dt.setDate(today.getDate() - ((today.getDay() + 6) % 7) + ((target + 6) % 7));
      } else {
        let add = (target - today.getDay() + 7) % 7;
        if (add === 0 && !(m[1])) add = 0; // "수요일" 당일이면 오늘
        dt.setDate(dt.getDate() + add);
      }
      return dt;
    }
    return null;
  },

  /* ---------- 시간 (문자 속 모든 시각, 등장 순서대로) ---------- */
  findTimes(t) {
    const out = [];
    t = t.replace(/자정/g, '밤 12시').replace(/정오/g, '낮 12시');
    // '1시간 전까지'의 1시는 시각이 아님 → 시(?!간)
    const re = /(오전|오후|아침|낮|저녁|밤|새벽|AM|PM|am|pm)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시(?!간)\s*(?:(\d{1,2})\s*분|(반))?)/g;
    let m;
    while ((m = re.exec(t))) {
      // 숫자 바로 앞 글자로 판단 (공백으로 시작하는 경우 날짜 뒤 '2026.11.05 14:00'도 시각으로)
      const di = m.index + m[0].indexOf(m[2], m[1] ? m[1].length : 0);
      const before = t.slice(Math.max(0, di - 1), di);
      if (!m[1] && /[\d.]/.test(before)) continue; // 날짜·번호 일부
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (/^\s*분/.test(after) && !m[3]) continue;
      let h = +m[2];
      const min = m[3] != null ? +m[3] : m[4] != null ? +m[4] : m[5] ? 30 : 0;
      const isColon = m[3] != null;
      if (h > 24 || min > 59) continue;
      if (!isColon && !/시/.test(m[0])) continue;
      const ap = m[1] || '';
      let nextDay = false;
      if (/밤|새벽/.test(ap) && h === 12) { h = 0; nextDay = true; } // 밤 12시 = 그날 자정 → 다음 날 0시
      else if (/오후|저녁|밤|PM|pm/.test(ap) && h < 12) h += 12;
      else if (/낮/.test(ap) && h < 6) h += 12;
      else if (/오전|아침|새벽|AM|am/.test(ap) && h === 12) h = 0;
      else if (!ap && !isColon && h >= 1 && h <= 6) h += 12; // "2시 진료" → 오후 2시
      if (h === 24) h = 0;
      out.push({ hm: `${this.pad(h)}:${this.pad(min)}`, index: m.index, end: m.index + m[0].length, raw: m[0].trim(), nextDay });
    }
    return out;
  },

  stationName(s) {
    s = s.replace(/\s/g, '');
    if (/역$/.test(s)) return s;
    return s + '역';
  },

  airportName(s) {
    s = s.toUpperCase() in this.AIRPORT_CODES ? this.AIRPORT_CODES[s.toUpperCase()] : s;
    if (/공항|터미널/.test(s)) return s;
    if (s === '부산') s = '김해';
    if (s === '인천') return '인천공항 제1터미널';
    return s + '공항';
  },

  /* ---------- 기차 ---------- */
  parseTrain(t, times) {
    const trainRe = /(KTX(?:-?산천|-?이음|-?청룡)?|SRT|ITX-?(?:새마을|청춘|마음)?|새마을호?|무궁화호?|누리로)\s*-?\s*(\d{1,4})?\s*(?:열차|호(?!차))?/gi;
    const all = [...t.matchAll(trainRe)];
    const train = all.find(x => x[2]) || all[0]; // "[SRT] … SRT 305"처럼 번호가 붙은 쪽 우선
    let number = '';
    if (train) number = (train[1].toUpperCase().replace(/호$/, '') + (train[2] ? ' ' + train[2] : '')).trim();
    else {
      const n = t.match(/(\d{2,4})\s*열차/);
      if (n) number = '열차 ' + n[1];
    }
    // 서울(08:00)→부산(10:40) / 수서 09:30 → 동대구 11:20 / 서울→부산 08:00~10:40
    const st = t.match(/([가-힣]{1,6}?)(?:역)?\s*\(?\s*(\d{1,2}:\d{2})?\s*\)?\s*(?:출발)?\s*[→~\-]\s*([가-힣]{1,6}?)(?:역)?\s*\(?\s*(\d{1,2}:\d{2})?\s*\)?(?=[\s,]|도착|$)/);
    let from = '', to = '', dep = '', arr = '';
    if (st && !/^\d/.test(st[1])) {
      from = st[1]; to = st[3]; dep = st[2] || ''; arr = st[4] || '';
    }
    const colon = times.filter(x => /:/.test(x.raw)).map(x => x.hm);
    if (!dep) dep = colon[0] || (times[0] && times[0].hm) || '';
    if (!arr) arr = colon.find(x => x !== dep && x > dep) || '';
    const depLbl = t.match(/(\d{1,2}:\d{2})\s*출발/), arrLbl = t.match(/(\d{1,2}:\d{2})\s*도착/);
    if (depLbl) dep = this.fixHm(depLbl[1]);
    if (arrLbl) arr = this.fixHm(arrLbl[1]);
    const seat = t.match(/(\d{1,2})\s*호차\s*(\d{1,3}\s*[A-Da-d])?/);
    return {
      kind: 'train',
      number,
      from: from ? this.stationName(from) : '',
      to: to ? this.stationName(to) : '',
      departTime: this.fixHm(dep), arriveTime: this.fixHm(arr),
      seat: seat ? `${seat[1]}호차${seat[2] ? ' ' + seat[2].replace(/\s/g, '').toUpperCase() : ''}` : ''
    };
  },

  /* ---------- 비행기 ---------- */
  parseFlight(t, times) {
    const codes = Object.keys(this.AIRLINES).join('|');
    const fl = t.match(new RegExp(`(?:^|[^A-Z0-9])(${codes})\\s?(\\d{2,4})(?![\\d:])`));
    const number = fl ? fl[1] + fl[2] : '';
    const ap = `[A-Z]{3}|${this.DOMESTIC.join('|')}|[가-힣]{2,6}공항`;
    const route = t.match(new RegExp(`(${ap})(?:공항)?\\s*\\(?\\s*(\\d{1,2}:\\d{2})?\\s*\\)?\\s*(?:출발)?\\s*[→~\\-]\\s*(${ap})(?:공항)?\\s*\\(?\\s*(\\d{1,2}:\\d{2})?`));
    let from = '', to = '', dep = '', arr = '';
    if (route) { from = route[1]; to = route[3]; dep = route[2] || ''; arr = route[4] || ''; }
    const colon = times.filter(x => /:/.test(x.raw)).map(x => x.hm);
    if (!dep) dep = colon[0] || (times[0] && times[0].hm) || '';
    if (!arr) arr = colon.find(x => x !== dep) || '';
    const depLbl = t.match(/(\d{1,2}:\d{2})\s*출발/), arrLbl = t.match(/(\d{1,2}:\d{2})\s*도착/);
    if (depLbl) dep = this.fixHm(depLbl[1]);
    if (arrLbl) arr = this.fixHm(arrLbl[1]);
    const intlCode = /ICN|NRT|HND|KIX|FUK|PVG|PEK|TPE|HKG|BKK|SGN|DAD|MNL|CEB|SIN|LAX|JFK|CDG|LHR|FRA/;
    const international = /국제선|인천/.test(t) || intlCode.test(from + to)
      || (!!from && !!to && /^[A-Z]{3}$/.test(to) && !(to in this.AIRPORT_CODES));
    return {
      kind: 'flight', number, airline: fl ? this.AIRLINES[fl[1]] : '',
      from: from ? this.airportName(from) : '',
      to: to ? (to in this.AIRPORT_CODES || this.DOMESTIC.includes(to) ? this.airportName(to) : to) : '',
      departTime: this.fixHm(dep), arriveTime: this.fixHm(arr), international
    };
  },

  fixHm(s) {
    if (!s) return '';
    const [h, m] = s.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return '';
    return `${this.pad(h % 24)}:${this.pad(m)}`;
  },

  /* ---------- 일반 약속·예약 ---------- */
  findPlace(t) {
    let m;
    // 장소: / 위치: / 주소: 줄
    if ((m = t.match(/(?:장\s*소|위\s*치|주\s*소|만나는\s*곳|미팅\s*장소|오시는\s*길|place)\s*[:：]\s*([^\n]+)/i))) {
      return m[1].replace(/\s*\(.*?\)\s*$/, '').trim().slice(0, 40);
    }
    // [강남세브란스병원] 같은 대괄호 상호
    if ((m = t.match(new RegExp(`\\[([^\\]]{2,20}(?:${this.PLACE_SUFFIX}))\\]`)))) return m[1].trim();
    // "판교역 2번 출구", "홍대입구역 근처 카페"
    if ((m = t.match(/([가-힣A-Za-z0-9]{1,12}역)(?:\s*(\d{1,2})\s*번\s*출구)?/))) return m[1] + (m[2] ? ` ${m[2]}번 출구` : '');
    if ((m = t.match(new RegExp(`([가-힣A-Za-z0-9]{2,15}(?:${this.PLACE_SUFFIX}))(?=에서|으로|로|에|\\s|$|[,.])`)))) return m[1];
    if ((m = t.match(/([가-힣A-Za-z0-9 ]{2,15}?)\s*에서\s/))) return m[1].trim();
    return '';
  },

  findTitle(t, place, kind) {
    const words = [['면접', '면접'], ['진료|외래|검진|검사|접종|내원|치료', '진료'], ['미팅', '미팅'], ['회의', '회의'],
      ['수업|강의|레슨', '수업'], ['상담', '상담'], ['예배|미사', '예배'], ['결혼식|웨딩', '결혼식'], ['돌잔치', '돌잔치'],
      ['장례|발인|조문', '조문'], ['시험', '시험'], ['출근', '출근'], ['약속|봐요|만나|보자', '약속'], ['예약', '예약']];
    const bracket = (t.match(/\[([^\]]{2,20})\]/) || [])[1];
    const brand = bracket && !/코레일|SRT|대한항공|아시아나|항공|Web발신|광고|알림|안내/.test(bracket) ? bracket.trim() : '';
    const dept = (t.match(/([가-힣]{2,6}(?:내과|외과|과|센터))\s*(?:진료|외래)/) || [])[1];
    for (const [re, w] of words) {
      if (new RegExp(re).test(t)) {
        if (w === '진료') return `${brand || place || '병원'}${dept ? ' ' + dept : ''} 진료`.trim();
        if (w === '약속' || w === '예약') return brand ? `${brand} ${w}` : place ? `${place.replace(/\s*\d+번 출구/, '')} ${w}` : w;
        return brand ? `${brand} ${w}` : w;
      }
    }
    return brand || (place ? `${place} 약속` : '');
  },

  /** 메인: 문자 → 일정 정보 */
  parse(text, now = new Date()) {
    const t = this.normalize(text);
    const times = this.findTimes(t);
    const dateObj = this.findDate(t, now);
    if (dateObj && times[0] && times[0].nextDay) dateObj.setDate(dateObj.getDate() + 1); // '내일 밤 12시' → 모레 0시
    const date = dateObj ? `${dateObj.getFullYear()}-${this.pad(dateObj.getMonth() + 1)}-${this.pad(dateObj.getDate())}` : '';
    const isTrain = /KTX|SRT|ITX|새마을|무궁화|누리로|코레일|승차권|열차|호차/i.test(t);
    const airline = new RegExp(`(?:^|[^A-Z0-9])(${Object.keys(this.AIRLINES).join('|')})\\s?\\d{2,4}(?![\\d:])`).test(t);
    const isFlight = !isTrain && (airline || /항공권|탑승권|탑승\s*수속|항공편|출국|공항/.test(t));
    const out = { kind: 'event', date, time: '', title: '', place: '', bufferMin: null, trip: null, found: [], missing: [] };

    if (isTrain || isFlight) {
      const trip = isTrain ? this.parseTrain(t, times) : this.parseFlight(t, times);
      out.kind = trip.kind;
      out.trip = trip;
      out.time = trip.departTime;
      out.title = isTrain
        ? `${trip.to ? trip.to.replace(/역$/, '') + ' ' : ''}${(trip.number || '기차').split(' ')[0]}`
        : `${trip.to ? trip.to.replace(/공항.*$/, '') + ' ' : ''}비행기`;
      if (trip.number) out.found.push(`${isTrain ? '열차' : '항공편'} ${trip.number}`);
      if (trip.from || trip.to) out.found.push(`${trip.from || '?'} → ${trip.to || '?'}`);
      if (trip.departTime) out.found.push(`${trip.departTime} 출발${trip.arriveTime ? ' · ' + trip.arriveTime + ' 도착' : ''}`);
      if (trip.seat) out.found.push(trip.seat);
      if (isFlight && trip.international) out.found.push('국제선');
      if (!trip.from) out.missing.push(isTrain ? '출발역' : '출발 공항');
      if (!trip.departTime) out.missing.push('출발 시각');
    } else {
      out.time = times[0] ? times[0].hm : '';
      out.place = this.findPlace(t);
      out.title = this.findTitle(t, out.place, 'event') || '일정';
      const early = t.match(/(\d{1,2})\s*분\s*(?:전|일찍)\s*(?:까지)?\s*(?:도착|내원|방문|와|오|입실|입장)/);
      if (early) out.bufferMin = Math.min(60, +early[1]);
      if (out.place) out.found.push(`장소 ${out.place}`);
      if (out.time) out.found.push(`${out.time} 도착`);
      if (out.bufferMin) out.found.push(`${out.bufferMin}분 일찍 도착`);
      if (!out.place) out.missing.push('장소');
      if (!out.time) out.missing.push('시간');
    }
    if (date) out.found.unshift(date);
    else out.missing.push('날짜');
    return out;
  }
};

if (typeof module !== 'undefined') module.exports = Parse;
