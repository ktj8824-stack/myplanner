/* =========================================
   MyPlanner — 선 아이콘
   - 화면 전체를 같은 굵기의 선 아이콘으로 통일 (이모지 대신)
   - Icons.svg('bus') → <svg …>
   - 화면에 들어간 글자 속 이모지(🚌 등)는 Icons.apply()가 자동으로 같은 아이콘으로 바꿈
     → 계산 엔진(planner.js)·알림 문구는 그대로 이모지를 써도 됨 (폰 알림에는 이모지가 맞음)
   ========================================= */

const Icons = {
  P: {
    home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h4.5v-5.5h4V20h4.5V9"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bag: '<path d="M5 8h14l-1.1 12.5H6.1L5 8Z"/><path d="M9 10.5V6.8a3 3 0 0 1 6 0v3.7"/>',
    settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    message: '<path d="M4 6a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 6v8.5a2.5 2.5 0 0 1-2.5 2.5H9.5L4 21V6Z"/><path d="M8 8.5h8M8 12h5"/>',
    bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 7.5h14M5 12h14M8 18v2.5M16 18v2.5"/><circle cx="8.5" cy="15" r=".9" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15" r=".9" fill="currentColor" stroke="none"/>',
    subway: '<rect x="6" y="3" width="12" height="14" rx="4"/><path d="M6 10h12M9 21l1.4-4M15 21l-1.4-4"/><circle cx="9.5" cy="13.5" r=".9" fill="currentColor" stroke="none"/><circle cx="14.5" cy="13.5" r=".9" fill="currentColor" stroke="none"/>',
    car: '<path d="M5 12 6.9 7.3A2 2 0 0 1 8.8 6h6.4a2 2 0 0 1 1.9 1.3L19 12"/><rect x="3.5" y="12" width="17" height="5" rx="1.5"/><path d="M6.5 17v2.2M17.5 17v2.2"/><circle cx="7.5" cy="14.5" r=".9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14.5" r=".9" fill="currentColor" stroke="none"/>',
    taxi: '<path d="M10 6V3.8h4V6"/><path d="M5 12 6.9 7.3A2 2 0 0 1 8.8 6h6.4a2 2 0 0 1 1.9 1.3L19 12"/><rect x="3.5" y="12" width="17" height="5" rx="1.5"/><path d="M6.5 17v2.2M17.5 17v2.2"/><circle cx="7.5" cy="14.5" r=".9" fill="currentColor" stroke="none"/><circle cx="16.5" cy="14.5" r=".9" fill="currentColor" stroke="none"/>',
    walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m10.5 21 2-6-2.5-2.5 1-4.5 3 2.5 3 1M12.5 15l2.5 2 1 4M11 8.5 8 10l-1 3.5"/>',
    train: '<path d="M6 13c0-5.2 2.6-9 6-9s6 3.8 6 9v1.5a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 6 14.5V13Z"/><path d="M8.3 9.5h7.4M8 17l-2 4M16 17l2 4M8.5 20h7"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z"/>',
    repeat: '<path d="m17 2.5 3 3-3 3"/><path d="M4 11.5V10a4.5 4.5 0 0 1 4.5-4.5H20"/><path d="m7 21.5-3-3 3-3"/><path d="M20 12.5V14a4.5 4.5 0 0 1-4.5 4.5H4"/>',
    alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M4 5l2.5-2M20 5l-2.5-2"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    belloff: '<path d="M8.5 5.6A6 6 0 0 1 18 11v4M6 11v5l-1.5 2H16"/><path d="M10 20.5a2 2 0 0 0 4 0M3.5 3.5l17 17"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z"/><circle cx="12" cy="10" r="2.3"/>',
    flag: '<path d="M5.5 21V4M5.5 4.5h12l-2.2 4 2.2 4h-12"/>',
    door: '<path d="M4 21h16M6.5 21V4.5A1.5 1.5 0 0 1 8 3h8a1.5 1.5 0 0 1 1.5 1.5V21"/><circle cx="14.3" cy="12.5" r=".9" fill="currentColor" stroke="none"/>',
    alert: '<path d="M10.3 4.2 2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4M12 17h.01"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.7 2.7L16 9.7"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.4M18 14.5a6 6 0 0 1 3 5.5"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    signal: '<circle cx="12" cy="12" r="1.6"/><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.3 5.3a9.5 9.5 0 0 0 0 13.4M18.7 5.3a9.5 9.5 0 0 1 0 13.4"/>',
    rain: '<path d="M7 15.5a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 9a3.3 3.3 0 0 1-.5 6.5H7Z"/><path d="m8.5 18.5-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>',
    storm: '<path d="M7 15.5a4.5 4.5 0 1 1 1-8.9A5.5 5.5 0 0 1 18.5 9a3.3 3.3 0 0 1-.5 6.5"/><path d="m12.5 13-2 4h3l-2 4"/>',
    snow: '<path d="M12 2.5v19M3.8 7.3l16.4 9.4M20.2 7.3 3.8 16.7"/><path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
    moon: '<path d="M19.5 14.5A7.8 7.8 0 1 1 9.5 4.5a6.2 6.2 0 0 0 10 10Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/>',
    navigation: '<path d="M12 3 19 20l-7-3.6L5 20 12 3Z"/>',
    clock: '<circle cx="12" cy="12.5" r="8"/><path d="M12 8.5v4l2.7 1.7"/>',
    skip: '<path d="M5.5 5.5 13 12l-7.5 6.5Z"/><path d="M18 5v14"/>',
    share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/>',
    hourglass: '<path d="M7 3h10M7 21h10M8 3v2.5c0 1.3.6 2.4 1.6 3.2L12 12l2.4-3.3A4 4 0 0 0 16 5.5V3M8 21v-2.5c0-1.3.6-2.4 1.6-3.2L12 12l2.4 3.3a4 4 0 0 1 1.6 3.2V21"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6l-8.4 8.4a2.1 2.1 0 0 1-3-3L18 9.6"/><path d="M9.3 17.7 3 11.4a2.1 2.1 0 0 1 0-3L5.4 6a2.1 2.1 0 0 1 3 0l1.3 1.3"/>',
    crown: '<path d="M3.5 8 7.5 12 12 5l4.5 7 4-4-1.6 10.5H5.1Z"/><path d="M5.5 21h13"/>',
    star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8Z"/>',
    sparkles: '<path d="m10 3.5 1.6 4.9 4.9 1.6-4.9 1.6L10 16.5l-1.6-4.9L3.5 10l4.9-1.6Z"/><path d="m18 14.5.8 2.2 2.2.8-2.2.8L18 20.5l-.8-2.2-2.2-.8 2.2-.8Z"/>',
    parking: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M9.5 16.5v-9h3.3a2.6 2.6 0 0 1 0 5.2H9.5"/>',
    pencil: '<path d="M15.5 4.5 19.5 8.5 8.5 19.5h-4v-4Z"/><path d="m13 7 4 4"/>',
    trash: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14"/>',
    locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5"/>',
    undo: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4.5h4.5"/>',
    arrowRight: '<path d="M4.5 12h15M13.5 6l6 6-6 6"/>',
    arrowDown: '<path d="M12 4.5v15M6 13.5l6 6 6-6"/>',
    chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    logout: '<path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16.5 14.5 12 10 7.5M14.5 12H4"/>',
    /* 브랜드 마크: 지평선 위로 떠오르는 해 + 출발 화살 */
    mark: '<path d="M3.5 16.5h17"/><path d="M6.5 16.5a5.5 5.5 0 0 1 11 0"/><path d="M12 16.5v-3.2M12 16.5l2-1.3"/><path d="M12 4.5v2M6.3 7.3l1.4 1.4M17.7 7.3l-1.4 1.4"/><path d="M8.5 20h7" opacity=".5"/>'
  },

  /** 이모지 → 아이콘 이름 */
  EMOJI: {
    '🏠': 'home', '📅': 'calendar', '🗓️': 'calendar', '🗓': 'calendar', '🛍️': 'bag', '🛍': 'bag', '⚙️': 'settings', '⚙': 'settings',
    '🎙': 'mic', '🎙️': 'mic', '🎤': 'mic', '📋': 'message', '🚌': 'bus', '🚇': 'subway', '🚗': 'car', '🚕': 'taxi', '🚶': 'walk',
    '🚄': 'train', '✈️': 'plane', '✈': 'plane', '🔁': 'repeat', '⏰': 'alarm', '🔔': 'bell', '📍': 'pin', '🎯': 'flag', '🚪': 'door',
    '⚠️': 'alert', '⚠': 'alert', '🚨': 'alert', '✅': 'checkCircle', '✔': 'check', '✓': 'check', '✕': 'x', '👨‍👩‍👧': 'users',
    '🔊': 'volume', '🔇': 'mute', '📡': 'signal', '🌧': 'rain', '🌧️': 'rain', '⛈': 'storm', '⛈️': 'storm', '❄️': 'snow', '❄': 'snow',
    '🔎': 'search', '🔍': 'search', '🌙': 'moon', '☀️': 'sun', '☀': 'sun', '🗺️': 'map', '🗺': 'map', '🧭': 'navigation', '⏱': 'clock', '⏱️': 'clock',
    '⏭': 'skip', '⏭️': 'skip', '📤': 'share', '⏳': 'hourglass', '📴': 'belloff', '🛠': 'tool', '🛠️': 'tool', '👑': 'crown', '⭐': 'star',
    '✨': 'sparkles', '🅿️': 'parking', '🅿': 'parking', '✎': 'pencil', '✏️': 'pencil', '🗑': 'trash', '🗑️': 'trash', '↻': 'refresh', '↺': 'undo',
    '➡️': 'arrowRight', '👇': 'arrowDown', '🙂': 'smile', '📱': 'phone', '🔑': 'key',
    '🎒': 'bag', '🏁': 'flag', '🔈': 'volume', '✏': 'pencil', '🔂': 'repeat'
  },

  svg(name, cls = '') {
    const p = this.P[name];
    if (!p) return '';
    return `<svg class="ic ic-${name} ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  },

  /** 이동수단 키 → 아이콘 */
  mode(m) { return { transit: 'bus', car: 'car', taxi: 'taxi', walk: 'walk', train: 'train', flight: 'plane' }[m] || 'arrowRight'; },

  _re: null,
  re() {
    if (!this._re) {
      const keys = Object.keys(this.EMOJI).sort((a, b) => b.length - a.length)
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      this._re = new RegExp('(' + keys.join('|') + ')\\uFE0F?', 'gu');
    }
    return this._re;
  },

  /** el 안의 글자 속 이모지를 선 아이콘으로 바꿈 (입력칸·스크립트는 건드리지 않음) */
  apply(el) {
    if (!el || typeof document === 'undefined') return;
    const re = this.re();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => {
        const p = n.parentNode;
        if (!p || /^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION|TITLE)$/.test(p.nodeName) || p.closest && p.closest('svg,[data-noicon]')) return NodeFilter.FILTER_REJECT;
        re.lastIndex = 0;
        return re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      const frag = document.createDocumentFragment();
      let last = 0;
      const s = n.nodeValue;
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s))) {
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        const span = document.createElement('span');
        span.className = 'ic-wrap';
        span.innerHTML = this.svg(this.EMOJI[m[1]] || this.EMOJI[m[1].replace(/️/g, '')]);
        frag.appendChild(span);
        last = m.index + m[0].length;
      }
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last).replace(/^ /, ' ')));
      n.parentNode.replaceChild(frag, n);
    });
  },

  /** 나중에 채워지는 부분(버스 카드, 알람 목록, 검색 결과 등)도 자동으로 */
  watch(el) {
    if (!el || typeof MutationObserver === 'undefined') return;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; this.apply(el); });
    }).observe(el, { childList: true, subtree: true, characterData: true });
  }
};
