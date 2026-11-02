/* =========================================
   MyPlanner — 장소 검색 · 경로 시간 조회
   - 버스·지하철: ODsay 대중교통 API
   - 자가용·택시·도보: 티맵(SK open API)
   - 키가 없거나 실패하면 거리 기반 추정치로 대체
   ========================================= */

const Routes = {
  key(name) {
    // 설정 > 개발자 설정에서 넣은 값이 우선 (테스트용), 없으면 config.js
    return (localStorage.getItem('mp_key_' + name) || (window.APP_CONFIG && window.APP_CONFIG[name]) || '').trim();
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
  async searchPlace(keyword) {
    keyword = (keyword || '').trim();
    if (!keyword) return [];
    const tmap = this.key('TMAP_APP_KEY');
    if (tmap) {
      try {
        const url = 'https://apis.openapi.sk.com/tmap/pois?version=1&count=15&resCoordType=WGS84GEO&reqCoordType=WGS84GEO'
          + '&searchKeyword=' + encodeURIComponent(keyword) + '&appKey=' + tmap;
        const res = await fetch(url);
        if (res.ok && res.status !== 204) {
          const data = await res.json();
          const pois = data?.searchPoiInfo?.pois?.poi || [];
          return pois.map(p => ({
            name: p.name,
            address: [p.upperAddrName, p.middleAddrName, p.lowerAddrName, p.roadName, p.firstBuildNo].filter(Boolean).join(' '),
            lat: parseFloat(p.frontLat || p.noorLat), lng: parseFloat(p.frontLon || p.noorLon)
          }));
        }
        if (res.status === 204) return [];
      } catch (e) { console.warn('티맵 장소 검색 실패', e); }
    }
    const kakao = this.key('KAKAO_REST_KEY');
    if (kakao) {
      try {
        const res = await fetch('https://dapi.kakao.com/v2/local/search/keyword.json?size=15&query=' + encodeURIComponent(keyword),
          { headers: { Authorization: 'KakaoAK ' + kakao } });
        if (res.ok) {
          const data = await res.json();
          return (data.documents || []).map(d => ({ name: d.place_name, address: d.road_address_name || d.address_name, lat: +d.y, lng: +d.x }));
        }
      } catch (e) { console.warn('카카오 장소 검색 실패', e); }
    }
    return this.SAMPLE_PLACES.filter(p => p.name.includes(keyword) || keyword.includes(p.name.replace(/역|공항.*$/, '')));
  },

  /* ---------- 거리 기반 추정 (키 없음/실패 시) ---------- */
  distanceKm(a, b) {
    const R = 6371, rad = x => x * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  },

  estimate(origin, dest, mode) {
    const km = this.distanceKm(origin, dest) * 1.3; // 직선거리 → 실제 도로 보정
    let min, steps;
    if (mode === 'walk') {
      min = Math.max(1, Math.round(km / 4.5 * 60));
      steps = [{ type: 'walk', label: '도보', to: dest.name, min }];
    } else if (mode === 'transit') {
      const ride = Math.max(5, Math.round(km / 22 * 60));
      steps = [
        { type: 'walk', label: '도보', to: '가까운 정류장', min: 6 },
        { type: km > 8 ? 'subway' : 'bus', label: km > 8 ? '지하철 (추정)' : '버스 (추정)', from: origin.name, to: dest.name, min: ride },
        { type: 'walk', label: '도보', to: dest.name, min: 5 }
      ];
      min = ride + 11;
    } else {
      min = Math.max(3, Math.round(km / 32 * 60) + 3);
      steps = [{ type: mode === 'taxi' ? 'taxi' : 'car', label: mode === 'taxi' ? '택시' : '자가용', from: origin.name, to: dest.name, min }];
    }
    return { travelMin: min, steps, source: 'estimate', summary: `약 ${km.toFixed(1)}km` };
  },

  /* ---------- 버스·지하철 (ODsay) — 여러 경로 후보를 돌려줌 ---------- */
  async transitOptions(origin, dest) {
    const key = this.key('ODSAY_API_KEY');
    if (key) {
      try {
        const url = `https://api.odsay.com/v1/api/searchPubTransPathT?lang=0&SX=${origin.lng}&SY=${origin.lat}&EX=${dest.lng}&EY=${dest.lat}&apiKey=${encodeURIComponent(key)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) {
          const msg = Array.isArray(data.error) ? data.error[0]?.message : data.error.msg || data.error.message;
          // 700m 이내는 ODsay가 경로를 주지 않음 → 도보로 안내
          if (String(data.error.code || data.error[0]?.code) === '-98') return [{ ...await this.walk(origin, dest), summary: '가까운 거리 — 도보 추천' }];
          throw new Error(msg || 'ODsay 오류');
        }
        return (data.result?.path || []).slice(0, 5).map(p => this.parseOdsayPath(p, dest));
      } catch (e) { console.warn('ODsay 조회 실패, 추정치 사용', e); }
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
          way: sp.way // 지하철 방면
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

  /* ---------- 자가용·택시 (티맵, 도착 시각 기준 예측) ---------- */
  async drive(origin, dest, mode, arriveAt) {
    const key = this.key('TMAP_APP_KEY');
    const label = mode === 'taxi' ? '택시' : '자가용';
    if (key) {
      try {
        let min = null;
        if (arriveAt && arriveAt.getTime() > Date.now()) min = await this.tmapPredict(origin, dest, arriveAt, key);
        if (min == null) {
          const qs = `version=1&startX=${origin.lng}&startY=${origin.lat}&endX=${dest.lng}&endY=${dest.lat}&reqCoordType=WGS84GEO&resCoordType=WGS84GEO&searchOption=0&trafficInfo=Y&appKey=${key}`;
          const res = await fetch('https://apis.openapi.sk.com/tmap/routes?' + qs);
          if (res.ok) {
            const d = await res.json();
            const p = d?.features?.[0]?.properties;
            if (p) min = Math.ceil(p.totalTime / 60);
          }
        }
        if (min != null) {
          return { travelMin: min, source: 'tmap', summary: `티맵 ${min}분`,
            steps: [{ type: mode === 'taxi' ? 'taxi' : 'car', label, from: origin.name, to: dest.name, min }] };
        }
      } catch (e) { console.warn('티맵 경로 실패, 추정치 사용', e); }
    }
    return this.estimate(origin, dest, mode);
  },

  async tmapPredict(origin, dest, arriveAt, key) {
    const pad = n => String(n).padStart(2, '0');
    const d = arriveAt;
    const predictionTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00+0900`;
    const body = {
      routesInfo: {
        departure: { name: origin.name || '출발', lon: String(origin.lng), lat: String(origin.lat) },
        destination: { name: dest.name || '도착', lon: String(dest.lng), lat: String(dest.lat) },
        predictionType: 'arrival', predictionTime
      }
    };
    const res = await fetch('https://apis.openapi.sk.com/tmap/routes/prediction?version=1&resCoordType=WGS84GEO&reqCoordType=WGS84GEO&sort=index', {
      method: 'POST', headers: { 'Content-Type': 'application/json', appKey: key }, body: JSON.stringify(body)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.features?.[0]?.properties;
    return p && p.totalTime ? Math.ceil(p.totalTime / 60) : null;
  },

  /* ---------- 도보 (티맵 보행자 경로) ---------- */
  async walk(origin, dest) {
    const key = this.key('TMAP_APP_KEY');
    if (key) {
      try {
        const res = await fetch('https://apis.openapi.sk.com/tmap/routes/pedestrian?version=1', {
          method: 'POST', headers: { 'Content-Type': 'application/json', appKey: key },
          body: JSON.stringify({ startX: origin.lng, startY: origin.lat, endX: dest.lng, endY: dest.lat,
            startName: origin.name || '출발', endName: dest.name || '도착', reqCoordType: 'WGS84GEO', resCoordType: 'WGS84GEO' })
        });
        if (res.ok) {
          const d = await res.json();
          const p = d?.features?.[0]?.properties;
          if (p) {
            const min = Math.ceil(p.totalTime / 60);
            return { travelMin: min, source: 'tmap', summary: `도보 ${min}분 · ${(p.totalDistance / 1000).toFixed(1)}km`,
              steps: [{ type: 'walk', label: '도보', to: dest.name, min }] };
          }
        }
      } catch (e) { console.warn('티맵 도보 실패, 추정치 사용', e); }
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
  openNav(app, mode, origin, dest) {
    if (!dest) return;
    const by = { transit: 'PUBLICTRANS', walk: 'FOOT' }[mode] || 'CAR';
    let url;
    if (app === 'tmap') {
      url = `tmap://route?goalname=${encodeURIComponent(dest.name)}&goalx=${dest.lng}&goaly=${dest.lat}`
        + (origin ? `&startname=${encodeURIComponent(origin.name)}&startx=${origin.lng}&starty=${origin.lat}` : '');
    } else if (app === 'kakaomap') {
      url = `kakaomap://route?ep=${dest.lat},${dest.lng}&by=${by}` + (origin ? `&sp=${origin.lat},${origin.lng}` : '');
    } else if (app === 'kakaot') {
      url = 'kakaot://taxi';
    }
    const fallback = `https://map.kakao.com/link/to/${encodeURIComponent(dest.name)},${dest.lat},${dest.lng}`;
    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (isNative) {
      window.location.href = url;
    } else {
      window.open(app === 'kakaot' ? 'https://www.kakaomobility.com/service-ride' : fallback, '_blank');
    }
  }
};
