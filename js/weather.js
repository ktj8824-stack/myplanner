/* =========================================
   MyPlanner — 날씨 예보 반영
   출발지의 '출발 시각 전후' 시간별 예보(Open-Meteo, 키 불필요)를 보고
   비·많은 비·눈이면 이동 시간에 여유를 더합니다 (Planner.WEATHER 규칙).
   결과는 원본 일정의 s.weather['YYYY-MM-DD']에 저장 → 그날 회차에만 적용.

   ※ Open-Meteo 무료 API는 비상업용입니다. 유료(PRO) 출시 전에는
     Open-Meteo 상업 요금제 또는 기상청 단기예보(공공데이터포털)로 바꾸세요.
   ========================================= */

const Weather = {
  DAYS: 7,              // 앞으로 7일 일정까지 확인
  STALE_H: 3,           // 3시간 지나면 다시 확인
  checking: false,

  /** 시간별 예보 → { kind, prob, mm, temp } (비/눈 없으면 kind: 'clear') */
  classify(hours) {
    let prob = 0, mm = 0, snow = 0, temp = null, code = 0;
    hours.forEach(h => {
      prob = Math.max(prob, h.prob || 0);
      mm = Math.max(mm, h.mm || 0);
      snow = Math.max(snow, h.snow || 0);
      if (temp == null) temp = h.temp;
      if ((h.code || 0) > code) code = h.code;
    });
    const snowCode = (code >= 71 && code <= 77) || code === 85 || code === 86;
    const heavyCode = code === 65 || code === 82 || code >= 95;
    let kind = 'clear';
    if (snow >= 0.2 || (snowCode && prob >= 50)) kind = 'snow';
    else if (mm >= 5 || (heavyCode && prob >= 60)) kind = 'heavy';
    else if (prob >= 60 || mm >= 0.5) kind = 'rain';
    return { kind, prob: Math.round(prob), mm: Math.round(mm * 10) / 10, temp: temp == null ? null : Math.round(temp) };
  },

  async fetchHourly(lat, lng) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3)
      + '&hourly=temperature_2m,precipitation_probability,precipitation,snowfall,weather_code'
      + '&timezone=Asia%2FSeoul&forecast_days=' + (this.DAYS + 1);
    const res = await fetch(url);
    if (!res.ok) throw new Error('날씨 응답 실패 ' + res.status);
    const h = (await res.json()).hourly || {};
    const map = {};
    (h.time || []).forEach((t, i) => {
      map[t] = { prob: h.precipitation_probability?.[i], mm: h.precipitation?.[i], snow: h.snowfall?.[i],
        code: h.weather_code?.[i], temp: h.temperature_2m?.[i] };
    });
    return map; // 'YYYY-MM-DDTHH:00' → 값
  },

  /** 앞으로 7일 일정의 출발 시각 날씨를 확인해 저장. 바뀐 일정 수 반환 */
  async refresh() {
    if (this.checking) return 0;
    this.checking = true;
    let changed = 0;
    try {
      const now = Date.now();
      const todo = State.upcoming(this.DAYS).filter(({ s }) => {
        const o = s.origin;
        if (!o || o.lat == null) return false;
        const w = Planner.weatherFor(s);
        return !w || now - w.checkedAt > this.STALE_H * 3600000;
      });
      // 출발지가 같으면 한 번만 조회
      const cache = {};
      for (const { s, plan } of todo) {
        const key = s.origin.lat.toFixed(2) + ',' + s.origin.lng.toFixed(2);
        try {
          cache[key] = cache[key] || await this.fetchHourly(s.origin.lat, s.origin.lng);
        } catch (e) { console.warn('날씨 조회 실패', e); continue; }
        const d = plan.departAt;
        const hourKey = t => `${U.ymd(t)}T${U.pad(t.getHours())}:00`;
        const next = new Date(d.getTime() + 3600000);
        const hours = [cache[key][hourKey(d)], cache[key][hourKey(next)]].filter(Boolean);
        if (!hours.length) continue;
        const w = this.classify(hours);
        const base = State.get(s.baseId || s.id);
        if (!base) continue;
        base.weather = base.weather || {};
        const prev = base.weather[s.date];
        base.weather[s.date] = { ...w, checkedAt: now };
        if (!prev || prev.kind !== w.kind) changed++;
        const cut = Recur.shift(U.today(), -2);
        Object.keys(base.weather).forEach(k => { if (k < cut) delete base.weather[k]; });
      }
      if (todo.length) State.save();
    } catch (e) { console.warn('날씨 반영 실패', e); }
    this.checking = false;
    return changed;
  },

  /** 타임라인·홈 표시용 한 줄 */
  label(plan) {
    const w = plan && plan.weather;
    if (!w) return '';
    return `${w.icon} 출발 시간 ${w.label} (강수확률 ${w.prob}%${w.temp != null ? ' · ' + w.temp + '°' : ''}) — 이동 여유 +${w.extraMin}분, ${w.tip}`;
  }
};

if (typeof module !== 'undefined') module.exports = Weather;
