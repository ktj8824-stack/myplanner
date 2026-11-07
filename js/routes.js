/* =========================================
   MyPlanner — 장소 검색 · 경로 시간 조회
   - 버스·지하철: ODsay 대중교통 API
   - 자가용·택시·도보: 티맵(SK open API)
   - 출시 버전: 키를 앱에 넣지 않고 Supabase 함수(supabase/functions/route)가 대신 호출
     (config.js의 ROUTE_PROXY_URL + SUPABASE_ANON_KEY)
   - 키·서버가 없거나 실패하면 거리 기반 추정치로 대체
   ========================================= */

const Routes = {
  key(name) {
    // 설정 > 개발자 설정에서 넣은 값이 우선 (테스트용), 없으면 config.js
    // 그다음 config.js, 마지막으로 공개 기본값(js/defaults.js — 서버 함수 주소·공개 anon 키만)
    let v = '';
    try { v = localStorage.getItem('mp_key_' + name) || ''; } catch (e) {}
    return (v || (window.APP_CONFIG && window.APP_CONFIG[name]) || (window.APP_DEFAULTS && window.APP_DEFAULTS[name]) || '').trim();
  },

  /** Supabase 경로 함수 { url, anon } — 설정돼 있으면 모든 티맵·ODsay 호출을 이쪽으로 */
  proxy() {
    const url = this.key('ROUTE_PROXY_URL');
    return url ? { url, anon: this.key('SUPABASE_ANON_KEY') } : null;
  },

  /** 해당 서비스를 실제로 부를 수 있는지 (서버 함수 또는 키) */
  can(service) {
    if (this.proxy()) return true;
    return service === 'odsay' ? !!this.key('ODSAY_API_KEY') : !!this.key('TMAP_APP_KEY');
  },

  /**
   * 외부 API 호출 한 곳으로 모음. 서버 함수가 있으면 거기로, 없으면 키로 직접.
   * service: tmap_pois | tmap_route | tmap_predict | tmap_walk | odsay_transit
   * 반환: 원래 API의 JSON (서버 함수도 그대로 전달하므로 해석 코드는 같음). 실패 시 null
   */
  async api(service, p) {
    const px = this.proxy();
    try {
      if (px) {
        const res = await U.fetchT(px.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(px.anon ? { Authorization: 'Bearer ' + px.anon, apikey: px.anon } : {}) },
          body: JSON.stringify({ service, ...p })
        });
        if (res.status === 204) return {};
        return res.ok ? await res.json() : null;
      }
      const tmap = this.key('TMAP_APP_KEY');
      const geo = 'reqCoordType=WGS84GEO&resCoordType=WGS84GEO';
      let res;
      switch (service) {
        case 'tmap_pois':
          if (!tmap) return null;
          res = await U.fetchT(`https://apis.openapi.sk.com/tmap/pois?version=1&count=15&${geo}&searchKeyword=${encodeURIComponent(p.keyword)}&appKey=${tmap}`);
          break;
        case 'tmap_route':
          if (!tmap) return null;
          res = await U.fetchT(`https://apis.openapi.sk.com/tmap/routes?version=1&startX=${p.sx}&startY=${p.sy}&endX=${p.ex}&endY=${p.ey}&${geo}&searchOption=0&trafficInfo=Y&appKey=${tmap}`);
          break;
        case 'tmap_predict':
          if (!tmap) return null;
          res = await U.fetchT(`https://apis.openapi.sk.com/tmap/routes/prediction?version=1&${geo}&sort=index`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', appKey: tmap }, body: JSON.stringify(this.predictBody(p))
          });
          break;
        case 'tmap_walk':
          if (!tmap) return null;
          res = await U.fetchT('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
            method: 'POST', headers: { 'Content-Type': 'application/json', appKey: tmap },
            body: JSON.stringify({ startX: p.sx, startY: p.sy, endX: p.ex, endY: p.ey, startName: p.sname || '출발', endName: p.ename || '도착', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO' })
          });
          break;
        case 'bus_arrival': {
          const k = this.key('ODSAY_API_KEY');
          if (!k) return null;
          res = await U.fetchT(`https://api.odsay.com/v1/api/realtimeStation?lang=0&stationBase=0&stationID=${encodeURIComponent(p.stationID)}${p.routeIDs ? '&routeIDs=' + encodeURIComponent(p.routeIDs) : ''}&apiKey=${encodeURIComponent(k)}`);
          if (!res.ok) return null;
          return { arrivals: this.normalizeBus(await res.json()), source: 'odsay' };
        }
        case 'odsay_transit': {
          const k = this.key('ODSAY_API_KEY');
          if (!k) return null;
          res = await U.fetchT(`https://api.odsay.com/v1/api/searchPubTransPathT?lang=0&SX=${p.sx}&SY=${p.sy}&EX=${p.ex}&EY=${p.ey}&apiKey=${encodeURIComponent(k)}`);
          break;
        }
        default: return null;
      }
      if (res.status === 204) return {};
      return res.ok ? await res.json() : null;
    } catch (e) {
      console.warn('경로 API 호출 실패', service, e);
      return null;
    }
  },

  predictBody(p) {
    return {
      routesInfo: {
        departure: { name: p.sname || '출발', lon: String(p.sx), lat: String(p.sy) },
        destination: { name: p.ename || '도착', lon: String(p.ex), lat: String(p.ey) },
        predictionType: 'arrival', predictionTime: p.predictionTime
      }
    };
  },

  coords(origin, dest) {
    return { sx: origin.lng, sy: origin.lat, ex: dest.lng, ey: dest.lat, sname: origin.name, ename: dest.name };
  },

  // 키 없이도 화면을 확인할 수 있는 예시 장소
  SAMPLE_PLACES: [
    ['서울역', 37.5547, 126.9707], ['용산역', 37.5299, 126.9648], ['수서역', 37.4873, 127.1012],
    ['강남역', 37.4979, 127.0276], ['여의도역', 37.5216, 126.9242], ['광화문', 37.5759, 126.9768],
    ['홍대입구역', 37.5572, 126.9245], ['잠실역', 37.5133, 127.1001], ['판교역', 37.3948, 127.1112],
    ['수원역', 37.2659, 127.0002], ['대전역', 36.3324, 127.4346], ['동대구역', 35.8793, 128.6286],
    ['부산역', 35.1151, 129.0422], ['광주송정역', 35.1374, 126.7930], ['김포공항', 37.5586, 126.7944],
    ['인천공항 제1터미널', 37.4492, 126.4508], ['김해공항', 35.1796, 128.9382], ['제주공항', 33.5104, 126.4914]
  ].map(([name, lat, lng]) => ({ name, address: '', lat, lng })),

  /* ---------- 장소 검색 ---------- */
  /** 마지막 검색이 어디서 왔는지 — 'tmap' | 'kakao' | 'sample' (검색 화면 안내 문구에 씀) */
  lastSource: '',

  async searchPlace(keyword) {
    keyword = (keyword || '').trim();
    if (!keyword) return [];
    const px = this.proxy();
    // 1) 카카오 장소 검색 (한국 장소·상호 검색이 가장 정확) — 서버 함수 → 직접 키 순서
    let docs = null;
    if (px) {
      const data = await this.api('kakao_local', { keyword });
      if (data && Array.isArray(data.documents)) docs = data.documents;
    }
    const kakao = this.key('KAKAO_REST_KEY');
    if (!docs && kakao) {
      try {
        const res = await U.fetchT('https://dapi.kakao.com/v2/local/search/keyword.json?size=15&query=' + encodeURIComponent(keyword),
          { headers: { Authorization: 'KakaoAK ' + kakao } });
        if (res.ok) docs = (await res.json()).documents || [];
      } catch (e) { console.warn('카카오 장소 검색 실패', e); }
    }
    if (docs && docs.length) {
      this.lastSource = 'kakao';
      return docs.map(d => ({ name: d.place_name, address: d.road_address_name || d.address_name, lat: +d.y, lng: +d.x }));
    }
    // 2) 티맵 장소 검색 (카카오가 안 되거나 결과가 없을 때)
    if (this.can('tmap')) {
      const data = await this.api('tmap_pois', { keyword });
      const pois = data?.searchPoiInfo?.pois?.poi || [];
      if (pois.length) {
        this.lastSource = 'tmap';
        return pois.map(p => ({
          name: p.name,
          address: [p.upperAddrName, p.middleAddrName, p.lowerAddrName, p.roadName, p.firstBuildNo].filter(Boolean).join(' '),
          lat: parseFloat(p.frontLat || p.noorLat), lng: parseFloat(p.frontLon || p.noorLon)
        })).filter(p => isFinite(p.lat) && isFinite(p.lng));
      }
      if (data) { this.lastSource = 'tmap'; return []; }
    }
    if (docs) { this.lastSource = 'kakao'; return []; } // 카카오가 응답했는데 결과 없음
    // 3) 예시 장소: "강남"·"판교역 2번 출구"는 찾되, "서울아산병원"이 "서울역"으로 잘못 잡히지 않게
    // 서버가 있는데 응답이 없었으면 '준비 중'이 아니라 연결 문제
    this.lastSource = (px || kakao) ? 'offline' : 'sample';
    return this.SAMPLE_PLACES.filter(p => p.name.includes(keyword) || keyword.includes(p.name)
      || keyword.replace(/\s/g, '') === p.name.replace(/역$|공항.*$/, ''));
  },

  /* ---------- 거리 기반 추정 (키 없음/실패 시) ---------- */
  distanceKm(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  },

  NEAR_KM: 0.7,
  /** 아주 가까운 곳: 직선거리 기준 걷는 시간 (어림값이 아니라 '가까움'으로 저장 → 다시 조회하지 않음) */
  nearWalk(origin, dest) {
    const e = this.estimate(origin, dest, 'walk');
    return { ...e, source: 'near', summary: `가까운 거리 — 도보 ${e.travelMin}분` };
  },

  estimate(origin, dest, mode) {
    const km = this.distanceKm(origin, dest) * 1.3; // 직선거리 → 실제 도로 보정
    let min, steps;
    if (mode === 'walk') {
      min = Math.max(1, Math.round(km / 4.5 * 60));
      steps = [{ type: 'walk', label: '도보', to: dest.name, min }];
    } else if (mode === 'transit') {
      const ride = Math.max(5, Math.round(km / 18 * 60)); // 어림값은 늦지 않게 넉넉히
      steps = [
        { type: 'walk', label: '도보', to: '가까운 정류장', min: 6 },
        { type: km > 8 ? 'subway' : 'bus', label: km > 8 ? '지하철 (추정)' : '버스 (추정)', from: origin.name, to: dest.name, min: ride },
        { type: 'walk', label: '도보', to: dest.name, min: 5 }
      ];
      min = ride + 11;
    } else {
      min = Math.max(5, Math.round(km / 25 * 60) + 5);
      steps = [{ type: mode === 'taxi' ? 'taxi' : 'car', label: mode === 'taxi' ? '택시' : '자가용', from: origin.name, to: dest.name, min }];
    }
    return { travelMin: min, steps, source: 'estimate', summary: `약 ${km.toFixed(1)}km` };
  },

  /* ---------- 버스·지하철 (ODsay) — 여러 경로 후보를 돌려줌 ---------- */
  async transitOptions(origin, dest) {
    // 700m 안쪽은 ODsay가 경로를 주지 않음 → 부르지 않고 바로 도보로
    if (this.distanceKm(origin, dest) < this.NEAR_KM) return [this.nearWalk(origin, dest)];
    if (this.can('odsay')) {
      const data = await this.api('odsay_transit', this.coords(origin, dest));
      if (data && data.error) {
        const code = String(data.error.code || (Array.isArray(data.error) && data.error[0]?.code) || '');
        // 700m 이내는 ODsay가 경로를 주지 않음 → 도보로 안내
        if (code === '-98') return [{ ...await this.walk(origin, dest), summary: '가까운 거리 — 도보 추천' }];
        console.warn('ODsay 오류, 추정치 사용', data.error);
      } else if (data && data.result && data.result.path) {
        return data.result.path.slice(0, 5).map(p => this.parseOdsayPath(p, dest));
      }
    }
    return [this.estimate(origin, dest, 'transit')];
  },

  parseOdsayPath(p, dest) {
    const steps = [];
    (p.subPath || []).forEach((sp, i, arr) => {
      if (sp.trafficType === 3) {
        if (!sp.sectionTime) return;
        const next = arr[i + 1];
        steps.push({ type: 'walk', label: '도보', to: next ? next.startName : dest.name, min: sp.sectionTime, meters: sp.distance });
      } else {
        const lane = (sp.lane || [])[0] || {};
        const isSubway = sp.trafficType === 1;
        const name = isSubway ? (lane.name || '지하철') : `${lane.busNo || ''}번 버스`.trim();
        const others = (sp.lane || []).slice(1).map(l => l.busNo || l.name).filter(Boolean);
        steps.push({
          type: isSubway ? 'subway' : 'bus',
          label: name + (others.length ? ` (또는 ${others.slice(0, 3).join(', ')})` : ''),
          from: sp.startName, to: sp.endName, stops: sp.stationCount, min: sp.sectionTime,
          way: sp.way, // 지하철 방면
          // 실시간 버스 도착 조회용: ODsay 정류장 ID + 노선 ID(같은 정류장에서 타는 다른 노선 포함)
          ...(isSubway ? {} : {
            stationId: sp.startID, arsId: sp.startArsID,
            // 서울 버스 실시간 '타는 시간' 계산용 (탈 곳·내릴 곳 정류장 번호, 지역 노선 id)
            fromArs: sp.startArsID, toArs: sp.endArsID, busLocalBlID: lane.busLocalBlID, cityCode: lane.busCityCode,
            routeIds: (sp.lane || []).map(l => l.busID).filter(Boolean),
            routeNos: (sp.lane || []).map(l => l.busNo).filter(Boolean)
          })
        });
      }
    });
    const info = p.info || {};
    const transfers = (info.busTransitCount || 0) + (info.subwayTransitCount || 0) - 1;
    return {
      travelMin: info.totalTime, steps, source: 'odsay',
      payment: info.payment,
      summary: `${info.totalTime}분 · 환승 ${Math.max(0, transfers)}회 · ${info.payment ? info.payment.toLocaleString() + '원' : ''}`.replace(/ · $/, '')
    };
  },

  /**
   * ODsay 실시간 도착 응답 → [{ routeId, routeNm, sec, left }]
   * (응답 필드 이름이 문서마다 달라 여러 형태를 모두 받아들임 — 서버 함수와 같은 규칙)
   */
  normalizeBus(data) {
    const res = data && data.result ? data.result : {};
    let real = res.real || res.realtime || res.arrival || [];
    if (!Array.isArray(real)) real = [real];
    const out = [];
    real.forEach(r => {
      if (!r) return;
      const routeId = String(r.routeId ?? r.routeID ?? r.busID ?? '');
      const routeNm = String(r.routeNm ?? r.routeName ?? r.busNo ?? '');
      [r.arrival1, r.arrival2].forEach(a => {
        if (!a) return;
        let sec = a.arrivalSec ?? a.predictTimeSec;
        if (sec == null && a.arrivalMin != null) sec = a.arrivalMin * 60;
        if (sec == null && a.predictTime != null) sec = a.predictTime * 60;
        sec = Number(sec);
        if (!isFinite(sec) || sec < 0 || sec > 7200) return;
        out.push({ routeId, routeNm, sec, left: a.leftStation ?? a.leftStop ?? null });
      });
    });
    return out.sort((x, y) => x.sec - y.sec);
  },

  /** 서울 버스 '지금 타면 몇 분' (서버 함수 + 서울시 버스 정보). 못 구하면 null */
  async busRide(step) {
    if (!step || !this.proxy() || !step.fromArs || !step.toArs) return null;
    const busID = (step.routeIds || [])[0];
    if (!busID && !step.busLocalBlID) return null;
    const d = await this.api('seoul_bus_ride', { busID: busID ? String(busID) : '', busLocalBlID: step.busLocalBlID ? String(step.busLocalBlID) : '', fromArs: step.fromArs, toArs: step.toArs });
    return d && typeof d.ride === 'number' && d.ride > 0 ? d : null;
  },

  /** 첫 버스 정류장의 실시간 도착 (해당 노선만). 실패하면 null */
  async busArrivals(step) {
    if (!step || !step.stationId || !this.can('odsay')) return null;
    const data = await this.api('bus_arrival', { stationID: step.stationId, routeIDs: (step.routeIds || []).join(',') });
    if (!data || !Array.isArray(data.arrivals)) return null;
    const ids = (step.routeIds || []).map(String), nos = (step.routeNos || []).map(String);
    return data.arrivals.filter(a => !ids.length || ids.includes(a.routeId) || nos.includes(a.routeNm));
  },

  /**
   * 인터넷이 안 될 때 저장해서 '어림값'으로 남은 경로를, 앱을 열었을 때 조용히 실제 경로로 바꿈.
   * 앞으로 14일 안 일정만, 한 번에 최대 5개. 바뀐 게 있으면 true.
   */
  async healEstimates() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    const limit = Recur.shift(U.today(), 14);
    // 예전에 저장한 버스 경로에는 서울 버스 실시간용 정류장 번호가 없음 → 같은 경로로 다시 받아 채움
    const noArs = r => r && r.source === 'odsay' && !r.arsChecked && (r.steps || []).some(st => st.type === 'bus' && !st.fromArs);
    // 같은 일정이 계속 실패하면 6시간 동안은 다시 부르지 않음 (앱을 열 때마다 같은 실패가 반복되던 문제)
    const FAIL_KEY = 'mp_heal_fail', now = Date.now();
    let fails = {};
    try { fails = JSON.parse(localStorage.getItem(FAIL_KEY) || '{}') || {}; } catch (e) {}
    const recentFail = s => fails[s.id] && now - fails[s.id] < 6 * 3600000;
    const list = State.schedules.filter(s => !s.demo && !s._shared && !recentFail(s) && (Recur.isRepeating(s) || (s.date >= U.today() && s.date <= limit)))
      .filter(s => noArs(s.route) || noArs(s.accessRoute) || (s.route && s.route.source === 'estimate') || (s.accessRoute && s.accessRoute.source === 'estimate')
        || (s.goHome && s.goHome.on && s.goHome.route && s.goHome.route.source === 'estimate'))
      .slice(0, 5);
    let changed = false;
    for (const s of list) {
      let mine = false;
      try {
        const isTrip = Planner.isTrip(s.mode);
        if (isTrip && s.accessRoute && s.accessRoute.source === 'estimate' && s.trip && s.trip.departStation) {
          const dep = s.trip.departTime ? Planner.at(s.date, s.trip.departTime) : null;
          const r = (await this.options(s.origin, s.trip.departStation, s.trip.accessMode || 'transit', dep))[0];
          if (r && r.source !== 'estimate') { s.accessRoute = r; mine = true; }
        } else if (!isTrip && noArs(s.route) && s.dest) {
          const sig = r => (r.steps || []).map(st => st.label).join('|');
          const same = (await this.options(s.origin, s.dest, 'transit', null)).find(r => sig(r) === sig(s.route));
          // 같은 경로를 못 찾았거나 번호를 안 주면 다시 묻지 않도록 표시
          s.route = same && !noArs(same) ? same : { ...s.route, arsChecked: true };
          mine = true;
        } else if (!isTrip && s.route && s.route.source === 'estimate' && s.dest) {
          const due = s.arriveBy ? Planner.at(s.date, s.arriveBy) : null;
          const r = (await this.options(s.origin, s.dest, s.mode, due))[0];
          if (r && r.source !== 'estimate') { s.route = r; mine = true; }
        }
        const gh = s.goHome;
        if (gh && gh.on && gh.route && gh.route.source === 'estimate' && s.dest && gh.to) {
          const r = (await this.options(s.dest, gh.to, gh.mode || 'transit', null))[0];
          if (r && r.source !== 'estimate') { gh.route = r; mine = true; }
        }
      } catch (e) { /* 다음에 다시 */ }
      if (mine) { State.upsert(s); changed = true; delete fails[s.id]; } // 서버에도 올림
      else fails[s.id] = now; // 실패 기록 → 6시간 뒤에 다시
    }
    try { localStorage.setItem(FAIL_KEY, JSON.stringify(fails)); } catch (e) {}
    if (changed) { try { await Alarm.rescheduleAll(); } catch (e) {} }
    return changed;
  },

  /* ---------- 자가용·택시 (티맵, 도착 시각 기준 예측 / 없으면 실시간) ---------- */
  async drive(origin, dest, mode, arriveAt) {
    const label = mode === 'taxi' ? '택시' : '자가용';
    if (this.can('tmap')) {
      const c = this.coords(origin, dest);
      let min = null;
      if (arriveAt && arriveAt.getTime() > Date.now()) {
        const d = arriveAt, pad = n => String(n).padStart(2, '0');
        const predictionTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00+0900`;
        const data = await this.api('tmap_predict', { ...c, predictionTime });
        const pr = data?.features?.[0]?.properties;
        if (pr && pr.totalTime) min = Math.ceil(pr.totalTime / 60);
      }
      if (min == null) {
        const data = await this.api('tmap_route', c);
        const pr = data?.features?.[0]?.properties;
        if (pr && pr.totalTime) min = Math.ceil(pr.totalTime / 60);
      }
      if (min != null) {
        return { travelMin: min, source: 'tmap', summary: `티맵 ${min}분`,
          steps: [{ type: mode === 'taxi' ? 'taxi' : 'car', label, from: origin.name, to: dest.name, min }] };
      }
    }
    return this.estimate(origin, dest, mode);
  },

  /* ---------- 도보 (티맵 보행자 경로) ---------- */
  async walk(origin, dest) {
    // 700m 안쪽은 경로 API를 부르지 않고 직선거리로 걷는 시간 계산
    // (ODsay는 700m 안을 거절, 티맵 걷기는 100m 안을 거절 → 앱을 열 때마다 실패가 쌓였음)
    if (this.distanceKm(origin, dest) < this.NEAR_KM) return this.nearWalk(origin, dest);
    if (this.can('tmap')) {
      const data = await this.api('tmap_walk', this.coords(origin, dest));
      const p = data?.features?.[0]?.properties;
      if (p && p.totalTime) {
        const min = Math.ceil(p.totalTime / 60);
        return { travelMin: min, source: 'tmap', summary: `도보 ${min}분 · ${(p.totalDistance / 1000).toFixed(1)}km`,
          steps: [{ type: 'walk', label: '도보', to: dest.name, min }] };
      }
    }
    return this.estimate(origin, dest, 'walk');
  },

  /** 수단에 맞는 경로 후보 목록 */
  async options(origin, dest, mode, arriveAt) {
    if (!origin || !dest || origin.lat == null || dest.lat == null) return [];
    if (mode === 'transit') return this.transitOptions(origin, dest);
    if (mode === 'walk') return [await this.walk(origin, dest)];
    return [await this.drive(origin, dest, mode, arriveAt)];
  },

  /* ---------- 카카오맵·티맵 길안내 열기 ---------- */
  /**
   * 길안내 주소 만들기 (화면과 무관 — 테스트 가능)
   * - 카카오맵 앱: kakaomap://route?sp=위도,경도&ep=위도,경도&by=publictransit|car|foot  (카카오맵 URL Scheme 문서)
   * - 티맵 앱: tmap://route?startx·starty·startname · goalx·goaly·goalname  (x=경도, y=위도)
   * - 웹(앱이 없을 때·PC): https://map.kakao.com/link/by/traffic|car|walk/이름,위도,경도/이름,위도,경도
   */
  navUrls(app, mode, origin, dest) {
    const by = { transit: 'publictransit', walk: 'foot' }[mode] || 'car';
    const webBy = { transit: 'traffic', walk: 'walk' }[mode] || 'car';
    const ok = p => p && isFinite(p.lat) && isFinite(p.lng);
    const nm = p => encodeURIComponent(String(p.name || '목적지').replace(/[,/]/g, ' ').trim() || '목적지');
    const from = ok(origin) ? origin : null;
    const web = from
      ? `https://map.kakao.com/link/by/${webBy}/${nm(from)},${from.lat},${from.lng}/${nm(dest)},${dest.lat},${dest.lng}`
      : `https://map.kakao.com/link/to/${nm(dest)},${dest.lat},${dest.lng}`;
    let scheme;
    if (app === 'tmap') {
      scheme = `tmap://route?goalname=${nm(dest)}&goalx=${dest.lng}&goaly=${dest.lat}`
        + (from ? `&startname=${nm(from)}&startx=${from.lng}&starty=${from.lat}` : '');
    } else {
      scheme = `kakaomap://route?${from ? `sp=${from.lat},${from.lng}&` : ''}ep=${dest.lat},${dest.lng}&by=${by}`;
    }
    return { scheme, web, by };
  },

  openNav(app, mode, origin, dest) {
    const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const mobile = isNative || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    if (app === 'kakaot') {
      return mobile ? this.tryApp('kakaot://taxi', 'https://www.kakaomobility.com/service-ride', '카카오T 앱이 없어 안내 페이지를 열어요')
        : window.open('https://www.kakaomobility.com/service-ride', '_blank');
    }
    if (!dest || !isFinite(dest.lat)) return U.toast('목적지 위치가 없어요. 일정을 수정해 목적지를 다시 골라 주세요');
    const u = this.navUrls(app, mode, origin, dest);
    // PC에서는 카카오맵 웹 길찾기 (출발·도착이 채워진 상태)
    if (!mobile) return window.open(u.web, '_blank');
    // 휴대폰: 앱을 열고, 앱이 없으면 카카오맵 웹 길찾기로
    this.tryApp(u.scheme, u.web, app === 'tmap' ? '티맵 앱이 없어 카카오맵 길찾기로 열어요' : '카카오맵 앱이 없어 웹 길찾기로 열어요');
  },

  /** 앱 주소를 열어 보고, 1.6초 안에 화면이 앱으로 넘어가지 않으면 대신 웹 주소로 */
  tryApp(scheme, fallback, msg) {
    let left = false;
    const onHide = () => { if (document.hidden) left = true; };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    window.location.href = scheme;
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      if (left || document.hidden || !fallback) return;
      if (msg) U.toast(msg);
      window.location.href = fallback;
    }, 1600);
  }
};
