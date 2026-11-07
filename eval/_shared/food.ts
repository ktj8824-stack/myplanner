// =====================================================================
// 골프장 주변 맛집 — 추천 맛집 메뉴(food-nearby)와 AI 비서(ai-chat)가 같이 씁니다.
//
//  · 카카오 장소 검색을 매번 실시간으로 호출합니다. (결과를 서버에 저장하지 않음 — 카카오 정책)
//  · 식당을 '라운딩 전 / 라운딩 후' 카테고리로 나누고, 카테고리마다 순위를 매깁니다.
//    - 기본: 카카오 검색 순위(많이 찾는 곳) + 골프장에서의 거리
//    - ANTHROPIC_API_KEY가 있으면: AI가 같은 후보 안에서 순서를 다듬고 한 줄 이유를 붙임
//  · AI는 후보 목록에 있는 식당만 쓸 수 있고, 없는 사실(평점·영업시간 등)은 쓰지 않습니다.
// =====================================================================

type Env = Record<string, string | undefined>;
type Json = any;

export const CURATE_MODEL = 'claude-haiku-5-5';
export const RADIUS_M = 10000;
export const PER_CATEGORY = 5;

export const CATEGORIES: Json = {
  before: [
    { key: 'haejang', label: '해장국·국밥', emoji: '🍲', query: '해장국', words: ['해장국', '국밥', '순대', '설렁탕', '곰탕', '감자탕', '뼈해장', '선지', '콩나물', '추어', '내장탕', '육개장'] },
    { key: 'baekban', label: '백반·한식', emoji: '🍚', query: '백반', words: ['백반', '가정식', '기사식당', '쌈밥', '두부', '한정식', '보리밥', '청국장', '정식', '비빔밥', '죽'] },
    { key: 'cafe', label: '카페·간단식', emoji: '☕', query: '김밥', words: ['카페', '커피', '베이커리', '제과', '샌드위치', '브런치', '김밥', '분식', '토스트', '도넛'] },
  ],
  after: [
    { key: 'meat', label: '고기·한우', emoji: '🥩', query: '한우', words: ['육류', '고기', '한우', '갈비', '삼겹살', '곱창', '막창', '불고기', '숯불', '정육', '돼지', '소고기', '양고기'] },
    { key: 'sea', label: '회·해산물', emoji: '🐟', query: '횟집', words: ['회', '횟집', '해물', '생선', '조개', '아구', '대게', '꽃게', '해산물', '복어', '물회', '매운탕', '초밥'] },
    { key: 'stamina', label: '장어·보양', emoji: '💪', query: '장어', words: ['장어', '삼계탕', '보양', '오리', '백숙', '흑염소', '닭볶음탕'] },
    { key: 'chinese', label: '중식', emoji: '🥟', query: '중식', words: ['중식', '중국', '짬뽕', '짜장', '양꼬치', '마라'] },
    { key: 'etc', label: '일식·기타', emoji: '🍱', query: '일식', words: ['일식', '돈까스', '돈가스', '우동', '라멘', '소바', '양식', '파스타', '스테이크', '이탈리안', '레스토랑'] },
  ],
};

const ALL_CATS: Json[] = [...CATEGORIES.before.map((c: Json) => ({ ...c, timing: 'before' })), ...CATEGORIES.after.map((c: Json) => ({ ...c, timing: 'after' }))];
// 카테고리 판정 순서: 구체적인 종류부터 (예: '장어'가 '회'보다 먼저, 초밥은 회·해산물, '한정식'은 백반)
const MATCH_ORDER = ['stamina', 'haejang', 'chinese', 'sea', 'meat', 'etc', 'cafe', 'baekban'];

/** 카카오 category_name(예: '음식점 > 한식 > 해장국')을 우리 카테고리로 */
export function classify(categoryName: string, placeName = ''): string | null {
  const tail = String(categoryName || '').split('>').slice(1).join(' ').replace(/\s+/g, '');
  const name = String(placeName || '').replace(/\s+/g, '');
  for (const key of MATCH_ORDER) {
    const c = ALL_CATS.find(x => x.key === key);
    if (c.words.some((w: string) => tail.includes(w))) return key;
  }
  // 종류가 '한식'뿐이면 이름으로 한 번 더
  for (const key of MATCH_ORDER) {
    const c = ALL_CATS.find(x => x.key === key);
    if (c.words.some((w: string) => w.length > 1 && name.includes(w))) return key;
  }
  if (/한식$/.test(String(categoryName || '').trim())) return 'baekban';
  return null;
}

export function catInfo(key: string): Json { return ALL_CATS.find(c => c.key === key) || null; }

async function kakao(env: Env, path: string, params: Record<string, string>, f: typeof fetch) {
  const q = new URLSearchParams(params).toString();
  const res = await f(`https://dapi.kakao.com/v2/local/search/${path}.json?${q}`, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}` },
  });
  if (!res.ok) throw new Error(`카카오 검색 실패 (${res.status})`);
  return (await res.json()).documents || [];
}

/** 골프장 찾기: 좌표가 있으면 그 근처에서, 없으면 이름으로 */
export async function resolveCourse(env: Env, name: string, lat: number | null, lng: number | null, f: typeof fetch) {
  let q = String(name || '').trim();
  if (!q && !(lat && lng)) return null;
  const golfQ = q ? (q.includes('골프') || q.toLowerCase().includes('cc') ? q : q + ' 골프장') : '골프장';
  const params: Record<string, string> = { query: golfQ, size: '1' };
  if (lat && lng) Object.assign(params, { x: String(lng), y: String(lat), radius: '3000', sort: 'distance' });
  let docs = await kakao(env, 'keyword', params, f);
  if (!docs.length && lat && lng && q) docs = await kakao(env, 'keyword', { query: golfQ, size: '1' }, f);
  if (!docs.length) return lat && lng ? { id: '', name: q || '선택한 골프장', addr: '', lat, lng } : null;
  const d = docs[0];
  return { id: String(d.id || ''), name: d.place_name, addr: d.road_address_name || d.address_name || '', lat: parseFloat(d.y), lng: parseFloat(d.x) };
}

/** 음식 종류 표시: 마지막 단계가 브랜드명(예: '스타벅스', '얌샘김밥')이면 그 앞 단계(예: '커피전문점', '분식')를 씀.
 *  '해장국'처럼 우리 분류 단어와 똑같은 일반 종류는 이름에 들어 있어도 그대로 둠 */
const TYPE_WORDS = new Set<string>(ALL_CATS.flatMap((c: Json) => c.words));
export function typeLabel(categoryName: string, placeName = ''): string {
  const parts = String(categoryName || '').split('>').map(x => x.trim()).filter(Boolean);
  const name = String(placeName || '').replace(/\s+/g, '');
  while (parts.length > 2) {
    const last = parts[parts.length - 1].replace(/\s+/g, '');
    const generic = last.split(',').some(w => TYPE_WORDS.has(w));
    if (last && !generic && name.includes(last)) parts.pop(); else break;
  }
  return parts[parts.length - 1] || '';
}

function toPlace(d: Json, rank: number) {
  return {
    id: String(d.id),
    name: String(d.place_name || ''),
    kakao_category: String(d.category_name || ''),
    category: typeLabel(d.category_name, d.place_name),
    address: d.road_address_name || d.address_name || '',
    distance_km: d.distance ? Math.round(Number(d.distance) / 100) / 10 : null,
    phone: d.phone || '',
    url: d.place_url || '',
    lat: parseFloat(d.y), lng: parseFloat(d.x),
    _rank: rank,
  };
}

/** 골프장 주변 식당 후보를 실시간으로 모읍니다 (카테고리별 키워드 + 일반 음식점 + 카페) */
export async function searchCandidates(env: Env, lat: number, lng: number, f: typeof fetch) {
  const base = { x: String(lng), y: String(lat), radius: String(RADIUS_M), size: '15' };
  const calls: Promise<Json[]>[] = [];
  for (const c of ALL_CATS) {
    calls.push(kakao(env, 'keyword', { ...base, query: c.query, category_group_code: 'FD6', sort: 'accuracy' }, f).catch(() => []));
  }
  calls.push(kakao(env, 'category', { ...base, category_group_code: 'CE7', sort: 'accuracy' }, f).catch(() => []));
  calls.push(kakao(env, 'category', { ...base, category_group_code: 'FD6', sort: 'accuracy', page: '1' }, f).catch(() => []));
  calls.push(kakao(env, 'category', { ...base, category_group_code: 'FD6', sort: 'accuracy', page: '2' }, f).catch(() => []));
  const lists = await Promise.all(calls);
  const page2 = lists.length - 1;   // 마지막 목록은 2쪽(16~30위)이라 순위를 15만큼 뒤로
  const byId: Record<string, Json> = {};
  lists.forEach((list, li) => {
    const offset = li === page2 ? 15 : 0;
    list.forEach((d: Json, i: number) => {
      if (!d || !d.id) return;
      const rank = i + offset;
      const prev = byId[d.id];
      if (!prev || rank < prev._rank) byId[d.id] = toPlace(d, rank);
    });
  });
  return Object.values(byId);
}

/** 규칙으로 정리: 카테고리 나누기 + (검색 순위 60% · 거리 40%) */
export function groupByRule(cands: Json[]) {
  const buckets: Record<string, Json[]> = {};
  for (const p of cands) {
    const key = classify(p.kakao_category, p.name);
    if (!key) continue;
    (buckets[key] = buckets[key] || []).push({ ...p, cat: key });
  }
  const out: Json = { before: [], after: [] };
  for (const timing of ['before', 'after']) {
    for (const c of CATEGORIES[timing]) {
      const list = (buckets[c.key] || []).map(p => ({
        ...p, _score: (p._rank / 15) * 0.6 + ((p.distance_km ?? RADIUS_M / 1000) / (RADIUS_M / 1000)) * 0.4,
      })).sort((a, b) => a._score - b._score).slice(0, PER_CATEGORY);
      out[timing].push({ key: c.key, label: c.label, emoji: c.emoji, items: list });
    }
  }
  return out;
}

/** AI로 다듬기: 같은 후보 안에서 순서 + 한 줄 이유. 실패하면 규칙 결과 그대로 */
export async function curateWithAI(env: Env, groups: Json, courseName: string, f: typeof fetch) {
  if (!env.ANTHROPIC_API_KEY) return { groups, by: 'rule' };
  const compact: Json = {};
  for (const timing of ['before', 'after']) {
    for (const g of groups[timing]) {
      if (!g.items.length) continue;
      compact[g.key] = g.items.map((p: Json) => ({ id: p.id, name: p.name, type: p.category, km: p.distance_km }));
    }
  }
  if (!Object.keys(compact).length) return { groups, by: 'rule' };
  const prompt = `골프장 "${courseName}" 주변 식당 후보입니다. 카테고리(key)별로 골퍼에게 추천할 순서를 정하고, 식당마다 18자 이내 한국어 추천 이유를 붙이세요.
규칙:
- 각 카테고리 안의 후보만 쓰고, 다른 카테고리로 옮기거나 새 식당을 만들지 마세요.
- 이유는 주어진 정보(음식 종류, 거리 km)만 근거로 씁니다. 평점·맛·영업시간·주차·가격처럼 주어지지 않은 사실은 쓰지 마세요.
- 라운딩 전 카테고리(haejang, baekban, cafe)는 아침 식사, 라운딩 후(meat, sea, stamina, chinese, etc)는 동반자 회식 기준입니다.
- 출력은 JSON 하나만: {"카테고리key":[{"id":"...","why":"..."}], ...}

후보: ${JSON.stringify(compact)}`;
  try {
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: CURATE_MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const text = (data.content || []).filter((b: Json) => b.type === 'text').map((b: Json) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('no json');
    const parsed = JSON.parse(m[0]);
    const out: Json = { before: [], after: [] };
    for (const timing of ['before', 'after']) {
      for (const g of groups[timing]) {
        const order = Array.isArray(parsed[g.key]) ? parsed[g.key] : [];
        const byId: Record<string, Json> = {};
        g.items.forEach((p: Json) => { byId[p.id] = p; });
        const used = new Set<string>();
        const items: Json[] = [];
        for (const o of order) {
          const p = byId[String(o && o.id)];
          if (!p || used.has(p.id)) continue;           // 후보에 없는 식당은 버림
          used.add(p.id);
          const why = String(o.why || '').replace(/[<>]/g, '').trim().slice(0, 24);
          items.push(why ? { ...p, why } : p);
        }
        for (const p of g.items) if (!used.has(p.id)) items.push(p);   // AI가 빠뜨린 후보는 뒤에
        out[timing].push({ ...g, items });
      }
    }
    return { groups: out, by: 'ai' };
  } catch (_) {
    return { groups, by: 'rule' };
  }
}

export function placeKey(name: string): string {
  return 'n:' + String(name || '').replace(/\s+/g, '').toLowerCase().slice(0, 100);
}

/** 화면에 보내기 전 정리 (내부 계산값 제거) */
export function publicPlace(p: Json) {
  const { _rank, _score, kakao_category, ...rest } = p;
  return rest;
}
