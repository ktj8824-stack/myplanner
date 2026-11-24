/* =========================================================
   MyPlanner — 시간 고르기 (아이폰)
   아이폰 기본 시간 선택기는 바퀴를 한 번만 굴려도 값이 바로 들어가고(11-22 사용자 지적),
   버튼도 '✓'·Reset 이라 알아보기 어려움 → 아이폰에서는 우리 바퀴 창으로 바꿔
   '선택'을 눌렀을 때만 값이 들어가게 함. 안드로이드·컴퓨터는 기본 선택기(확인 버튼이 있음) 그대로.
   화면에 있는 모든 <input type="time"> 에 자동으로 붙음 (각 화면 코드를 고칠 필요 없음).
   ========================================================= */
const TimePick = {
  ROW: 44,          // 바퀴 한 칸 높이(px)
  _input: null,

  on() {
    const C = window.Capacitor;
    if (C && C.getPlatform && C.getPlatform() === 'ios') return true;
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  },

  init() {
    if (!this.on() || this._inited) return;
    this._inited = true;
    // 기본 선택기가 뜨지 않게 읽기 전용으로 바꾸고, 누르면 우리 창을 엶
    const mark = root => (root.querySelectorAll ? root.querySelectorAll('input[type="time"]:not([data-tp])') : []).forEach(el => {
      el.setAttribute('data-tp', '1');
      el.readOnly = true;
      el.setAttribute('inputmode', 'none');
    });
    mark(document);
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) mark(n); }))).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', e => {
      const el = e.target && e.target.closest && e.target.closest('input[type="time"][data-tp]');
      if (!el || el.disabled) return;
      e.preventDefault();
      el.blur();
      this.open(el);
    }, true);
  },

  /** 이 칸이 비워 둘 수 있는 칸인지 (라벨에 '선택'이 붙은 칸) */
  _optional(el) {
    const box = el.parentElement;
    const lbl = box && box.querySelector('label');
    return !!(lbl && /선택/.test(lbl.textContent || ''));
  },
  _label(el) {
    const box = el.parentElement;
    const lbl = box && box.querySelector('label');
    return lbl ? lbl.textContent.replace(/\s*\(선택\)\s*/, '').trim() : '시간';
  },

  /** 어떤 칸인지: 'arrive'(도착 시간) · 'end'(끝나는 시간) · '' */
  _kind(el) {
    const oc = (el.getAttribute && el.getAttribute('onchange')) || '';
    if (/Register\.set\('arriveBy'/.test(oc)) return 'arrive';
    if (/Register\.setEnd\(/.test(oc)) return 'end';
    return '';
  },

  /**
   * 바퀴가 처음 가리킬 시각 [시, 분] (값은 바꾸지 않음 — '선택'을 눌러야 들어감).
   * 새 일정의 도착 시간이 비었거나 기본값 09:00이면 지금+2시간(정시로 반올림),
   * 끝나는 시간이 비었으면 도착+1시간 (11-23 점검: 낮에 열면 매번 09:00에서 굴려야 했음)
   */
  startAt({ value = '', kind = '', arrive = '', fresh = true, now = new Date() } = {}) {
    const ok = t => /^\d{1,2}:\d{2}/.test(t || '');
    const hm = t => [+t.split(':')[0], +t.split(':')[1].slice(0, 2)];
    if (kind === 'arrive' && fresh && (!ok(value) || value.slice(0, 5) === '09:00')) {
      const t = new Date(now.getTime() + 2 * 3600000);
      return [(t.getHours() + (t.getMinutes() >= 30 ? 1 : 0)) % 24, 0];
    }
    if (kind === 'end' && !ok(value) && ok(arrive)) {
      const [h, m] = hm(arrive);
      return [(h + 1) % 24, m];
    }
    return ok(value) ? hm(value) : [9, 0];
  },

  open(el) {
    this._input = el;
    const v = /^\d{1,2}:\d{2}/.test(el.value || '') ? el.value : '';
    const kind = this._kind(el);
    const R = typeof Register !== 'undefined' ? Register : null;
    const arrIn = kind === 'end' ? document.querySelector('input[onchange^="Register.set(\'arriveBy\'"]') : null;
    const [h, m] = this.startAt({ value: v, kind, arrive: (arrIn && arrIn.value) || (R && R.d && R.d.arriveBy) || '', fresh: !(R && R.editing) });
    const ap = h < 12 ? 0 : 1, h12 = (h % 12) || 12;
    const col = (id, items, sel) => `<div class="tp-col" id="${id}">
        <div class="tp-pad"></div>${items.map(t => `<div class="tp-item">${t}</div>`).join('')}<div class="tp-pad"></div>
      </div>`;
    const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
    const mins = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
    let box = document.getElementById('tpick');
    if (!box) { box = document.createElement('div'); box.id = 'tpick'; document.body.appendChild(box); }
    box.innerHTML = `<div class="tp-bg" onclick="TimePick.close()"></div>
      <div class="tp-panel" role="dialog" aria-label="${U.esc(this._label(el))} 고르기">
        <div class="tp-head"><b>${U.esc(this._label(el))}</b>${v ? `<small>지금 ${U.esc(v)}</small>` : ''}</div>
        <div class="tp-wheels">
          <div class="tp-band"></div>
          ${col('tpAp', ['오전', '오후'])}${col('tpH', hours)}<div class="tp-colon">:</div>${col('tpM', mins)}
        </div>
        <div class="tp-btns">
          ${this._optional(el) && v ? '<button class="btn" onclick="TimePick.clear()">지우기</button>' : '<button class="btn" onclick="TimePick.close()">취소</button>'}
          <button class="btn primary" onclick="TimePick.pick()">선택</button>
        </div>
      </div>`;
    box.classList.add('show');
    const set = (id, idx) => { const c = document.getElementById(id); c.scrollTop = idx * this.ROW; };
    set('tpAp', ap); set('tpH', h12 - 1); set('tpM', m);
    // 숫자를 눌러도 그 칸으로 이동 (굴리기만 해서는 값이 들어가지 않음 — '선택'을 눌러야 들어감)
    box.querySelectorAll('.tp-col').forEach(c => c.querySelectorAll('.tp-item').forEach((it, i) => {
      it.onclick = () => c.scrollTo({ top: i * this.ROW, behavior: 'smooth' });
    }));
  },

  /* ---------- 날짜+시간 한 번에 (일정 추가의 '도착 일시' 칸, 11-24 사용자 시안) ----------
     연도 없이 '11월 25일 (수)', 오늘·내일은 앞에 표시. 분은 5분 단위(원래 값이 5분 단위가 아니면 그 값도 넣음).
     '선택'을 눌러야 onPick({date, time}) 호출. dateOnly면 시간 바퀴 없이 날짜만 */
  WD: ['일', '월', '화', '수', '목', '금', '토'],
  ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
  dayLabel(ymd, today = this.ymd(new Date())) {
    const [y, m, d] = ymd.split('-').map(Number), dt = new Date(y, m - 1, d);
    const base = `${m}월 ${d}일 (${this.WD[dt.getDay()]})`;
    const t = new Date(today + 'T00:00:00'), diff = Math.round((dt - t) / 86400000);
    return diff === 0 ? `오늘 · ${base}` : diff === 1 ? `내일 · ${base}` : diff === 2 ? `모레 · ${base}` : base;
  },
  /** 칸에 보이는 글자: '내일 · 11월 25일 (수) 오전 9:00' */
  whenLabel(date, time) {
    if (!date) return '';
    let s = this.dayLabel(date);
    if (/^\d{1,2}:\d{2}/.test(time || '')) {
      const h = +time.slice(0, 2), m = time.slice(3, 5);
      s += ` ${h < 12 ? '오전' : '오후'} ${(h % 12) || 12}:${m}`;
    }
    return s;
  },
  openWhen({ date, time = '', dateOnly = false, title = '도착 일시', fresh = false, onPick } = {}) {
    const today = this.ymd(new Date());
    const start = new Date(today + 'T00:00:00'); start.setDate(start.getDate() - 1);
    if (date && date < this.ymd(start)) { const [y, m, d] = date.split('-').map(Number); start.setTime(new Date(y, m - 1, d).getTime()); }
    const days = [];
    for (let i = 0; i < 400; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(this.ymd(d)); }
    // 새 일정(기본값 그대로)이면 바퀴는 '지금+2시간'이 있는 날에서 시작 (낮에 열면 오늘, 밤 10시 넘으면 내일)
    const freshDefault = fresh && (!time || time.slice(0, 5) === '09:00');
    const startDay = freshDefault ? this.ymd(new Date(Date.now() + 2.5 * 3600000)) : (date || today);
    const di = Math.max(0, days.indexOf(startDay));
    const [h, m] = this.startAt({ value: time, kind: 'arrive', fresh });
    const mins = []; for (let i = 0; i < 60; i += 5) mins.push(i);
    if (!mins.includes(m)) { mins.push(m); mins.sort((a, b) => a - b); }
    this._when = { days, mins, dateOnly, onPick };
    const col = (id, items, w) => `<div class="tp-col" id="${id}"${w ? ` style="width:${w}px"` : ''}>
        <div class="tp-pad"></div>${items.map(t => `<div class="tp-item">${t}</div>`).join('')}<div class="tp-pad"></div>
      </div>`;
    let box = document.getElementById('tpick');
    if (!box) { box = document.createElement('div'); box.id = 'tpick'; document.body.appendChild(box); }
    box.innerHTML = `<div class="tp-bg" onclick="TimePick.close()"></div>
      <div class="tp-panel" role="dialog" aria-label="${U.esc(title)} 고르기">
        <div class="tp-head"><b>${U.esc(title)}</b></div>
        <div class="tp-wheels tp-when">
          <div class="tp-band"></div>
          ${col('tpD', days.map(v => { const l = this.dayLabel(v, today); return l.includes(' · ') ? `<em>${l.split(' · ')[0]}</em> ${l.split(' · ')[1]}` : l; }), dateOnly ? 230 : 168)}
          ${dateOnly ? '' : col('tpAp', ['오전', '오후'], 52) + col('tpH', Array.from({ length: 12 }, (_, i) => String(i + 1)), 40) + '<div class="tp-colon">:</div>' + col('tpM', mins.map(x => String(x).padStart(2, '0')), 46)}
        </div>
        <div class="tp-btns">
          <button class="btn" onclick="TimePick.close()">취소</button>
          <button class="btn primary" onclick="TimePick.pickWhen()">선택</button>
        </div>
      </div>`;
    box.classList.add('show');
    const set = (id, idx) => { const c = document.getElementById(id); if (c) c.scrollTop = idx * this.ROW; };
    set('tpD', di);
    if (!dateOnly) { set('tpAp', h < 12 ? 0 : 1); set('tpH', ((h % 12) || 12) - 1); set('tpM', mins.indexOf(m)); }
    box.querySelectorAll('.tp-col').forEach(c => c.querySelectorAll('.tp-item').forEach((it, i) => {
      it.onclick = () => c.scrollTo({ top: i * this.ROW, behavior: 'smooth' });
    }));
  },
  pickWhen() {
    const w = this._when;
    if (!w) return this.close();
    const date = w.days[this._idx('tpD', w.days.length - 1)];
    let time = '';
    if (!w.dateOnly) {
      const ap = this._idx('tpAp', 1), h12 = this._idx('tpH', 11) + 1, m = w.mins[this._idx('tpM', w.mins.length - 1)];
      time = `${String((h12 % 12) + (ap ? 12 : 0)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    this.close();
    this._when = null;
    if (w.onPick) w.onPick({ date, time });
  },

  _idx(id, max) {
    const c = document.getElementById(id);
    return Math.max(0, Math.min(max, Math.round(c.scrollTop / this.ROW)));
  },

  /** '선택'을 눌렀을 때만 값이 들어감 */
  pick() {
    const el = this._input;
    if (!el) return this.close();
    const ap = this._idx('tpAp', 1), h12 = this._idx('tpH', 11) + 1, m = this._idx('tpM', 59);
    const h = (h12 % 12) + (ap ? 12 : 0);
    this._apply(el, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  },
  clear() { if (this._input) this._apply(this._input, ''); },
  _apply(el, val) {
    this.close();
    if (el.value === val) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
  close() {
    const box = document.getElementById('tpick');
    if (box) box.classList.remove('show');
    this._input = null;
  }
};

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => TimePick.init());
  else TimePick.init();
}

if (typeof module !== 'undefined') module.exports = TimePick;
