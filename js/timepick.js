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

  open(el) {
    this._input = el;
    const v = /^\d{1,2}:\d{2}/.test(el.value || '') ? el.value : '';
    let h = 9, m = 0;
    if (v) { h = +v.slice(0, 2); m = +v.slice(3, 5); }
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
