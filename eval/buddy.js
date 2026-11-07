const CURATE_MODEL = 'claude-haiku-5-5';
const RADIUS_M = 10000;
const PER_CATEGORY = 5;
const CATEGORIES = {
    before: [
        {
            key: 'haejang',
            label: '해장국·국밥',
            emoji: '🍲',
            query: '해장국',
            words: [
                '해장국',
                '국밥',
                '순대',
                '설렁탕',
                '곰탕',
                '감자탕',
                '뼈해장',
                '선지',
                '콩나물',
                '추어',
                '내장탕',
                '육개장'
            ]
        },
        {
            key: 'baekban',
            label: '백반·한식',
            emoji: '🍚',
            query: '백반',
            words: [
                '백반',
                '가정식',
                '기사식당',
                '쌈밥',
                '두부',
                '한정식',
                '보리밥',
                '청국장',
                '정식',
                '비빔밥',
                '죽'
            ]
        },
        {
            key: 'cafe',
            label: '카페·간단식',
            emoji: '☕',
            query: '김밥',
            words: [
                '카페',
                '커피',
                '베이커리',
                '제과',
                '샌드위치',
                '브런치',
                '김밥',
                '분식',
                '토스트',
                '도넛'
            ]
        }
    ],
    after: [
        {
            key: 'meat',
            label: '고기·한우',
            emoji: '🥩',
            query: '한우',
            words: [
                '육류',
                '고기',
                '한우',
                '갈비',
                '삼겹살',
                '곱창',
                '막창',
                '불고기',
                '숯불',
                '정육',
                '돼지',
                '소고기',
                '양고기'
            ]
        },
        {
            key: 'sea',
            label: '회·해산물',
            emoji: '🐟',
            query: '횟집',
            words: [
                '회',
                '횟집',
                '해물',
                '생선',
                '조개',
                '아구',
                '대게',
                '꽃게',
                '해산물',
                '복어',
                '물회',
                '매운탕',
                '초밥'
            ]
        },
        {
            key: 'stamina',
            label: '장어·보양',
            emoji: '💪',
            query: '장어',
            words: [
                '장어',
                '삼계탕',
                '보양',
                '오리',
                '백숙',
                '흑염소',
                '닭볶음탕'
            ]
        },
        {
            key: 'chinese',
            label: '중식',
            emoji: '🥟',
            query: '중식',
            words: [
                '중식',
                '중국',
                '짬뽕',
                '짜장',
                '양꼬치',
                '마라'
            ]
        },
        {
            key: 'etc',
            label: '일식·기타',
            emoji: '🍱',
            query: '일식',
            words: [
                '일식',
                '돈까스',
                '돈가스',
                '우동',
                '라멘',
                '소바',
                '양식',
                '파스타',
                '스테이크',
                '이탈리안',
                '레스토랑'
            ]
        }
    ]
};
const ALL_CATS = [
    ...CATEGORIES.before.map((c)=>({
            ...c,
            timing: 'before'
        })),
    ...CATEGORIES.after.map((c)=>({
            ...c,
            timing: 'after'
        }))
];
const MATCH_ORDER = [
    'stamina',
    'haejang',
    'chinese',
    'sea',
    'meat',
    'etc',
    'cafe',
    'baekban'
];
function classify(categoryName, placeName = '') {
    const tail = String(categoryName || '').split('>').slice(1).join(' ').replace(/\s+/g, '');
    const name = String(placeName || '').replace(/\s+/g, '');
    for (const key of MATCH_ORDER){
        const c = ALL_CATS.find((x)=>x.key === key);
        if (c.words.some((w)=>tail.includes(w))) return key;
    }
    for (const key of MATCH_ORDER){
        const c = ALL_CATS.find((x)=>x.key === key);
        if (c.words.some((w)=>w.length > 1 && name.includes(w))) return key;
    }
    if (/한식$/.test(String(categoryName || '').trim())) return 'baekban';
    return null;
}
function catInfo(key) {
    return ALL_CATS.find((c)=>c.key === key) || null;
}
async function kakao(env, path, params, f) {
    const q = new URLSearchParams(params).toString();
    const res = await f(`https://dapi.kakao.com/v2/local/search/${path}.json?${q}`, {
        headers: {
            Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}`
        }
    });
    if (!res.ok) throw new Error(`카카오 검색 실패 (${res.status})`);
    return (await res.json()).documents || [];
}
async function resolveCourse(env, name, lat, lng, f) {
    let q = String(name || '').trim();
    if (!q && !(lat && lng)) return null;
    const golfQ = q ? q.includes('골프') || q.toLowerCase().includes('cc') ? q : q + ' 골프장' : '골프장';
    const params = {
        query: golfQ,
        size: '1'
    };
    if (lat && lng) Object.assign(params, {
        x: String(lng),
        y: String(lat),
        radius: '3000',
        sort: 'distance'
    });
    let docs = await kakao(env, 'keyword', params, f);
    if (!docs.length && lat && lng && q) docs = await kakao(env, 'keyword', {
        query: golfQ,
        size: '1'
    }, f);
    if (!docs.length) return lat && lng ? {
        id: '',
        name: q || '선택한 골프장',
        addr: '',
        lat,
        lng
    } : null;
    const d = docs[0];
    return {
        id: String(d.id || ''),
        name: d.place_name,
        addr: d.road_address_name || d.address_name || '',
        lat: parseFloat(d.y),
        lng: parseFloat(d.x)
    };
}
const TYPE_WORDS = new Set(ALL_CATS.flatMap((c)=>c.words));
function typeLabel(categoryName, placeName = '') {
    const parts = String(categoryName || '').split('>').map((x)=>x.trim()).filter(Boolean);
    const name = String(placeName || '').replace(/\s+/g, '');
    while(parts.length > 2){
        const last = parts[parts.length - 1].replace(/\s+/g, '');
        const generic = last.split(',').some((w)=>TYPE_WORDS.has(w));
        if (last && !generic && name.includes(last)) parts.pop();
        else break;
    }
    return parts[parts.length - 1] || '';
}
function toPlace(d, rank) {
    return {
        id: String(d.id),
        name: String(d.place_name || ''),
        kakao_category: String(d.category_name || ''),
        category: typeLabel(d.category_name, d.place_name),
        address: d.road_address_name || d.address_name || '',
        distance_km: d.distance ? Math.round(Number(d.distance) / 100) / 10 : null,
        phone: d.phone || '',
        url: d.place_url || '',
        lat: parseFloat(d.y),
        lng: parseFloat(d.x),
        _rank: rank
    };
}
async function searchCandidates(env, lat, lng, f) {
    const base = {
        x: String(lng),
        y: String(lat),
        radius: String(RADIUS_M),
        size: '15'
    };
    const calls = [];
    for (const c of ALL_CATS){
        calls.push(kakao(env, 'keyword', {
            ...base,
            query: c.query,
            category_group_code: 'FD6',
            sort: 'accuracy'
        }, f).catch(()=>[]));
    }
    calls.push(kakao(env, 'category', {
        ...base,
        category_group_code: 'CE7',
        sort: 'accuracy'
    }, f).catch(()=>[]));
    calls.push(kakao(env, 'category', {
        ...base,
        category_group_code: 'FD6',
        sort: 'accuracy',
        page: '1'
    }, f).catch(()=>[]));
    calls.push(kakao(env, 'category', {
        ...base,
        category_group_code: 'FD6',
        sort: 'accuracy',
        page: '2'
    }, f).catch(()=>[]));
    const lists = await Promise.all(calls);
    const page2 = lists.length - 1;
    const byId = {};
    lists.forEach((list, li)=>{
        const offset = li === page2 ? 15 : 0;
        list.forEach((d, i)=>{
            if (!d || !d.id) return;
            const rank = i + offset;
            const prev = byId[d.id];
            if (!prev || rank < prev._rank) byId[d.id] = toPlace(d, rank);
        });
    });
    return Object.values(byId);
}
function groupByRule(cands) {
    const buckets = {};
    for (const p of cands){
        const key = classify(p.kakao_category, p.name);
        if (!key) continue;
        (buckets[key] = buckets[key] || []).push({
            ...p,
            cat: key
        });
    }
    const out = {
        before: [],
        after: []
    };
    for (const timing of [
        'before',
        'after'
    ]){
        for (const c of CATEGORIES[timing]){
            const list = (buckets[c.key] || []).map((p)=>({
                    ...p,
                    _score: p._rank / 15 * 0.6 + (p.distance_km ?? RADIUS_M / 1000) / (RADIUS_M / 1000) * 0.4
                })).sort((a, b)=>a._score - b._score).slice(0, PER_CATEGORY);
            out[timing].push({
                key: c.key,
                label: c.label,
                emoji: c.emoji,
                items: list
            });
        }
    }
    return out;
}
async function curateWithAI(env, groups, courseName, f) {
    if (!env.ANTHROPIC_API_KEY) return {
        groups,
        by: 'rule'
    };
    const compact = {};
    for (const timing of [
        'before',
        'after'
    ]){
        for (const g of groups[timing]){
            if (!g.items.length) continue;
            compact[g.key] = g.items.map((p)=>({
                    id: p.id,
                    name: p.name,
                    type: p.category,
                    km: p.distance_km
                }));
        }
    }
    if (!Object.keys(compact).length) return {
        groups,
        by: 'rule'
    };
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
            headers: {
                'x-api-key': env.ANTHROPIC_API_KEY || '',
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: CURATE_MODEL,
                max_tokens: 1500,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            })
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const text = (data.content || []).filter((b)=>b.type === 'text').map((b)=>b.text).join('');
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('no json');
        const parsed = JSON.parse(m[0]);
        const out = {
            before: [],
            after: []
        };
        for (const timing of [
            'before',
            'after'
        ]){
            for (const g of groups[timing]){
                const order = Array.isArray(parsed[g.key]) ? parsed[g.key] : [];
                const byId = {};
                g.items.forEach((p)=>{
                    byId[p.id] = p;
                });
                const used = new Set();
                const items = [];
                for (const o of order){
                    const p = byId[String(o && o.id)];
                    if (!p || used.has(p.id)) continue;
                    used.add(p.id);
                    const why = String(o.why || '').replace(/[<>]/g, '').trim().slice(0, 24);
                    items.push(why ? {
                        ...p,
                        why
                    } : p);
                }
                for (const p of g.items)if (!used.has(p.id)) items.push(p);
                out[timing].push({
                    ...g,
                    items
                });
            }
        }
        return {
            groups: out,
            by: 'ai'
        };
    } catch (_) {
        return {
            groups,
            by: 'rule'
        };
    }
}
function placeKey(name) {
    return 'n:' + String(name || '').replace(/\s+/g, '').toLowerCase().slice(0, 100);
}
function publicPlace(p) {
    const { _rank, _score, kakao_category, ...rest } = p;
    return rest;
}


const CHAT_MODEL = 'claude-haiku-5-5';
const VISION_MODEL = 'claude-sonnet-5-5';
const MAX_TOOL_ROUNDS = 4;
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
function json(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            ...CORS,
            'Content-Type': 'application/json'
        }
    });
}
const TOOLS = [
    {
        name: 'search_restaurants',
        description: '골프장 주변의 실제 식당을 카카오 장소 검색으로 찾습니다. 맛집을 추천할 때는 반드시 이 도구 결과에 있는 식당만 추천하세요. 결과에는 BuddyPlanner 회원 평균 별점(buddy_rating)이 있을 수 있습니다.',
        input_schema: {
            type: 'object',
            properties: {
                course_name: {
                    type: 'string',
                    description: '골프장 이름 (예: 남서울 CC)'
                },
                near_lat: {
                    type: 'number',
                    description: '알고 있다면 골프장 위도'
                },
                near_lng: {
                    type: 'number',
                    description: '알고 있다면 골프장 경도'
                },
                keyword: {
                    type: 'string',
                    description: '음식 종류나 키워드 (예: 해장국, 한우, 장어). 없으면 생략'
                },
                timing: {
                    type: 'string',
                    enum: [
                        'before',
                        'after',
                        'any'
                    ],
                    description: 'before=라운딩 전 식사, after=라운딩 후 식사'
                }
            },
            required: [
                'course_name'
            ]
        }
    },
    {
        name: 'propose_schedule',
        description: '새 라운딩 일정 등록을 제안합니다. 사용자 화면에 확인 카드가 뜨고, 사용자가 버튼을 눌러야 일정 등록 화면이 채워진 채로 열립니다.',
        input_schema: {
            type: 'object',
            properties: {
                course_name: {
                    type: 'string'
                },
                date: {
                    type: 'string',
                    description: 'YYYY-MM-DD'
                },
                tee_off: {
                    type: 'string',
                    description: 'HH:MM (24시간)'
                },
                companions_count: {
                    type: 'integer',
                    description: '본인 제외 동반자 수 (모르면 생략)'
                },
                memo: {
                    type: 'string'
                }
            },
            required: [
                'course_name',
                'date',
                'tee_off'
            ]
        }
    },
    {
        name: 'propose_score_record',
        description: '라운딩 스코어 기록 저장을 제안합니다. 스코어카드 사진이 있으면 사진에서 읽은 값을 넣으세요. 사용자가 확인 카드에서 승인해야 저장됩니다.',
        input_schema: {
            type: 'object',
            properties: {
                date: {
                    type: 'string',
                    description: 'YYYY-MM-DD'
                },
                course_name: {
                    type: 'string'
                },
                total_score: {
                    type: 'integer',
                    description: '총 타수'
                },
                holes: {
                    type: 'array',
                    items: {
                        type: 'integer'
                    },
                    description: '1번~18번 홀 타수 (읽을 수 있을 때만)'
                },
                putts_total: {
                    type: 'integer'
                },
                memo: {
                    type: 'string',
                    description: '한 줄 라운딩 메모'
                }
            },
            required: [
                'date',
                'course_name',
                'total_score'
            ]
        }
    },
    {
        name: 'propose_meal',
        description: '이미 등록된 일정에 식사 장소를 넣도록 제안합니다. restaurant_id는 search_restaurants 결과의 id여야 합니다.',
        input_schema: {
            type: 'object',
            properties: {
                schedule_index: {
                    type: 'integer',
                    description: '사용자 컨텍스트의 upcoming 목록에 있는 idx'
                },
                timing: {
                    type: 'string',
                    enum: [
                        'before',
                        'after'
                    ]
                },
                restaurant_id: {
                    type: 'string'
                }
            },
            required: [
                'schedule_index',
                'timing',
                'restaurant_id'
            ]
        }
    }
];
function withWhen(ctx) {
    const list = Array.isArray(ctx.upcoming) ? ctx.upcoming : [];
    const today = String(ctx.today || '').slice(0, 10);
    const t0 = Date.parse(today + 'T00:00:00Z');
    return list.map((u)=>{
        const d = Date.parse(String(u && u.date || '').slice(0, 10) + 'T00:00:00Z');
        if (isNaN(t0) || isNaN(d)) return u;
        const n = Math.round((d - t0) / 86400000);
        const when = n === 0 ? '오늘' : n === 1 ? '내일' : n === 2 ? '모레' : n > 0 ? `${n}일 뒤` : `${-n}일 전`;
        return {
            ...u,
            when
        };
    });
}
function systemPrompt(ctx) {
    return `당신은 골프 일정 앱 'BuddyPlanner'의 AI 비서 '버디'입니다. 한국어로 친근하고 간결하게 답하세요.

[역할과 범위]
- 골프에 관한 것이면 무엇이든 자유롭게 대화합니다: 라운딩 일정, 스코어, 골프장, 날씨, 준비물, 룰·에티켓, 스윙 고민, 골프장 주변 맛집.
- 골프와 무관한 요청(코딩, 숙제, 정치, 투자 등)은 "저는 골프 비서라 골프 관련 이야기를 도와드릴게요"처럼 짧고 정중하게 돌려 말합니다.
- 모바일 화면이므로 답변은 짧게(보통 3~6문장). 목록은 간단히. 마크다운은 **굵게**와 줄바꿈 정도만 씁니다.

[도구 사용 원칙]
- 맛집 추천은 반드시 search_restaurants 결과에 있는 식당만 언급합니다. 결과에 없는 식당 이름, 평점, 리뷰, 영업시간을 지어내지 마세요. buddy_rating이 있으면 "버디 회원 평균 ★4.3(12명)"처럼 소개하고, 없으면 평점을 말하지 않습니다.
- 라운딩 전 식사는 새벽 영업 가능성이 높은 해장국·국밥·백반을, 라운딩 후에는 고기·한정식·장어 등을 우선 고려합니다. 영업시간은 확인할 수 없으니 방문 전 확인을 권하세요.
- 일정 등록·스코어 저장·식사 추가는 propose_* 도구로 '제안'만 합니다. 저장은 사용자가 카드의 버튼을 눌러야 완료되므로 "등록했어요"가 아니라 "아래 카드에서 확인해 주세요"라고 말합니다.
- "○일 라운딩 끝나고 여기 가게 일정에 넣어줘"처럼 식당을 일정에 넣어 달라고 하면, 다가오는 일정 목록에서 날짜·골프장이 맞는 일정의 idx로 propose_meal을 씁니다. 라운딩 전 식사면 timing=before, 끝나고 가면 after입니다. 그 날짜에 일정이 없으면 없다고 말하고 일정 등록(propose_schedule)부터 제안합니다. 식당은 이번 대화에서 search_restaurants로 찾은 곳이어야 하니, 아직 검색하지 않았다면 먼저 검색합니다.
- 필수 정보(골프장, 날짜, 티오프 시간)가 빠지면 추측하지 말고 짧게 물어봅니다. 날짜는 오늘 기준으로 계산합니다.
- 다가오는 일정을 말할 때는 각 일정의 when 값(오늘·내일·N일 뒤)과 date를 그대로 씁니다. '내일', '이번 주' 같은 말을 직접 계산해 붙이지 마세요.
- 스코어카드 사진: 골프장 이름, 날짜, 사용자 본인의 홀별 타수와 합계를 읽어 propose_score_record로 제안합니다. 동반자 줄이 여러 개면 사용자 이름(${ctx.userName || '사용자'})과 가장 가까운 줄을 쓰고, 애매하면 어느 줄인지 물어봅니다. 잘 안 보이는 값은 지어내지 말고 확인을 요청합니다.

[사용자 정보]
- 오늘: ${ctx.today || ''}
- 닉네임: ${ctx.userName || ''}
- 다가오는 일정: ${JSON.stringify(withWhen(ctx))}
- 스코어 요약: ${JSON.stringify(ctx.records || {})}`;
}
async function getUser(env, authHeader, f) {
    const res = await f(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
            Authorization: authHeader,
            apikey: env.SUPABASE_ANON_KEY || ''
        }
    });
    if (!res.ok) return null;
    const u = await res.json();
    return u && u.id ? u : null;
}
async function isPro(env, userId, f) {
    if (env.AI_ALLOW_ALL_USERS === 'true') return true;
    if (!env.REVENUECAT_SECRET_KEY) return false;
    const res = await f(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
        headers: {
            Authorization: `Bearer ${env.REVENUECAT_SECRET_KEY}`
        }
    });
    if (!res.ok) return false;
    const data = await res.json();
    const ent = data?.subscriber?.entitlements?.pro;
    if (!ent) return false;
    return !ent.expires_date || Date.parse(ent.expires_date) > Date.now();
}
async function rpc(env, fn, body, f) {
    const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
    const res = await f(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`rpc ${fn} 실패 (${res.status})`);
    return res.json();
}

async function kakao(env, path, params, f) {
    const q = new URLSearchParams(params).toString();
    const res = await f(`https://dapi.kakao.com/v2/local/search/${path}.json?${q}`, {
        headers: {
            Authorization: `KakaoAK ${env.KAKAO_REST_API_KEY}`
        }
    });
    if (!res.ok) throw new Error(`카카오 검색 실패 (${res.status})`);
    return (await res.json()).documents || [];
}
async function findCourse(env, name, f) {
    let q = String(name || '').trim();
    if (!q) return null;
    if (!q.includes('골프') && !q.toLowerCase().includes('cc')) q += ' 골프장';
    const docs = await kakao(env, 'keyword', {
        query: q,
        size: '1'
    }, f);
    if (!docs.length) return null;
    const d = docs[0];
    return {
        id: String(d.id || ''),
        name: d.place_name,
        addr: d.road_address_name || d.address_name || '',
        lat: parseFloat(d.y),
        lng: parseFloat(d.x)
    };
}
async function searchRestaurants(env, input, f) {
    let lat = Number(input.near_lat), lng = Number(input.near_lng);
    const hasPos = isFinite(lat) && isFinite(lng) && !!lat && !!lng;
    const course = await resolveCourse(env, String(input.course_name || ''), hasPos ? lat : null, hasPos ? lng : null, f);
    if (!course) return {
        error: `'${input.course_name}' 골프장 위치를 찾지 못했어요.`
    };
    const cands = await searchCandidates(env, course.lat, course.lng, f);
    const groups = groupByRule(cands);
    const timing = input.timing === 'before' || input.timing === 'after' ? input.timing : null;
    const kw = String(input.keyword || '').replace(/\s+/g, '');
    let pool = [];
    for (const t of timing ? [
        timing
    ] : [
        'before',
        'after'
    ])for (const g of groups[t])pool.push(...g.items.map((p)=>({
            ...p,
            timing: t,
            group: g.label
        })));
    if (kw) {
        const hit = pool.filter((p)=>(p.kakao_category + p.name + p.group).replace(/\s+/g, '').includes(kw));
        if (hit.length) pool = hit;
    }
    const byGroup = {};
    pool.forEach((p)=>{
        (byGroup[p.group] = byGroup[p.group] || []).push(p);
    });
    const picked = [];
    for(let i = 0; picked.length < 8 && i < 5; i++)for (const g of Object.keys(byGroup))if (byGroup[g][i] && picked.length < 8) picked.push(byGroup[g][i]);
    const list = picked.map((p)=>({
            ...publicPlace(p),
            timing: p.timing,
            group: p.group
        }));
    if (list.length) {
        try {
            const rows = await rpc(env, 'get_place_ratings', {
                keys: list.map((r)=>placeKey(r.name))
            }, f);
            const map = {};
            for (const r of rows || [])map[r.place_key] = r;
            for (const r of list){
                const m = map[placeKey(r.name)];
                if (m) {
                    r.buddy_rating = Number(m.avg_rating);
                    r.buddy_count = m.review_count;
                }
            }
        } catch (_) {}
    }
    return {
        course: course.name,
        course_lat: course.lat,
        course_lng: course.lng,
        restaurants: list
    };
}
async function callClaude(env, body, f) {
    const res = await f('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': env.ANTHROPIC_API_KEY || '',
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok) throw new Error(`Claude API 오류 (${res.status}) ${data?.error?.message || ''}`);
    return data;
}
async function handle(req, env, f = fetch) {
    if (req.method === 'OPTIONS') return new Response('ok', {
        headers: CORS
    });
    if (req.method !== 'POST') return json(405, {
        error: 'method_not_allowed'
    });
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return json(401, {
        error: 'login_required',
        message: '로그인이 필요해요.'
    });
    const user = await getUser(env, auth, f);
    if (!user) return json(401, {
        error: 'login_required',
        message: '로그인이 만료됐어요. 다시 로그인해 주세요.'
    });
    if (!await isPro(env, user.id, f)) {
        return json(403, {
            error: 'pro_required',
            message: 'AI 비서는 PRO 회원 전용 기능이에요.'
        });
    }
    let body;
    try {
        body = await req.json();
    } catch (_) {
        return json(400, {
            error: 'bad_request'
        });
    }
    if (body && body.probe === true) return json(200, {
        ok: true,
        allowed: true
    });
    const text = String(body.message || '').slice(0, 2000);
    const image = body.image && typeof body.image.data === 'string' ? body.image : null;
    if (!text && !image) return json(400, {
        error: 'empty_message'
    });
    if (image && image.data.length > 2_800_000) return json(413, {
        error: 'image_too_large',
        message: '사진 용량이 너무 커요.'
    });
    const chatLimit = parseInt(env.AI_DAILY_CHAT_LIMIT || '60', 10);
    const imageLimit = parseInt(env.AI_DAILY_IMAGE_LIMIT || '15', 10);
    try {
        if (!await rpc(env, 'ai_try_use', {
            p_user: user.id,
            p_kind: 'chat',
            p_limit: chatLimit
        }, f)) {
            return json(429, {
                error: 'daily_limit',
                message: `오늘 AI 비서 사용 한도(${chatLimit}회)를 모두 썼어요. 내일 다시 이용해 주세요.`
            });
        }
        if (image && !await rpc(env, 'ai_try_use', {
            p_user: user.id,
            p_kind: 'image',
            p_limit: imageLimit
        }, f)) {
            return json(429, {
                error: 'daily_limit',
                message: `오늘 사진 분석 한도(${imageLimit}장)를 모두 썼어요.`
            });
        }
    } catch (e) {
        return json(500, {
            error: 'usage_check_failed',
            message: '잠시 후 다시 시도해 주세요.'
        });
    }
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const messages = [];
    for (const m of history){
        const role = m.role === 'assistant' ? 'assistant' : 'user';
        const content = String(m.content || '').slice(0, 2000);
        if (!content) continue;
        if (messages.length && messages[messages.length - 1].role === role) {
            messages[messages.length - 1].content += '\n' + content;
        } else messages.push({
            role,
            content
        });
    }
    while(messages.length && messages[0].role !== 'user')messages.shift();
    const userContent = [];
    if (image) userContent.push({
        type: 'image',
        source: {
            type: 'base64',
            media_type: image.media_type || 'image/jpeg',
            data: image.data
        }
    });
    userContent.push({
        type: 'text',
        text: text || '이 스코어카드를 기록해 줘.'
    });
    if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
    messages.push({
        role: 'user',
        content: userContent
    });
    const ctx = body.context || {};
    const actions = [];
    const restaurants = [];
    const knownRestaurants = {};
    let reply = '';
    try {
        for(let round = 0; round < MAX_TOOL_ROUNDS; round++){
            const resp = await callClaude(env, {
                model: image ? VISION_MODEL : CHAT_MODEL,
                max_tokens: 1024,
                system: systemPrompt(ctx),
                tools: TOOLS,
                messages
            }, f);
            const blocks = resp.content || [];
            const texts = blocks.filter((b)=>b.type === 'text').map((b)=>b.text).join('\n').trim();
            if (texts) reply = texts;
            const uses = blocks.filter((b)=>b.type === 'tool_use');
            if (resp.stop_reason !== 'tool_use' || !uses.length) break;
            messages.push({
                role: 'assistant',
                content: blocks
            });
            const results = [];
            for (const u of uses){
                let result;
                try {
                    if (u.name === 'search_restaurants') {
                        result = await searchRestaurants(env, u.input || {}, f);
                        for (const r of result.restaurants || []){
                            if (!knownRestaurants[r.id]) {
                                knownRestaurants[r.id] = r;
                                restaurants.push(r);
                            }
                        }
                    } else if (u.name === 'propose_schedule' || u.name === 'propose_score_record') {
                        const act = {
                            type: u.name.replace('propose_', ''),
                            ...u.input
                        };
                        if (u.name === 'propose_schedule') {
                            try {
                                act.course = await findCourse(env, u.input?.course_name, f);
                            } catch (_) {
                                act.course = null;
                            }
                        }
                        actions.push(act);
                        result = {
                            shown_to_user: true,
                            note: '사용자 화면에 확인 카드를 표시했습니다. 사용자가 버튼을 눌러야 저장됩니다.'
                        };
                    } else if (u.name === 'propose_meal') {
                        const r = knownRestaurants[String(u.input?.restaurant_id)];
                        if (!r) result = {
                            error: 'search_restaurants 결과에 있는 restaurant_id만 사용할 수 있습니다.'
                        };
                        else {
                            actions.push({
                                type: 'meal',
                                schedule_index: u.input.schedule_index,
                                timing: u.input.timing,
                                restaurant: r
                            });
                            result = {
                                shown_to_user: true,
                                note: '확인 카드를 표시했습니다.'
                            };
                        }
                    } else result = {
                        error: '알 수 없는 도구'
                    };
                } catch (e) {
                    result = {
                        error: e.message
                    };
                }
                results.push({
                    type: 'tool_result',
                    tool_use_id: u.id,
                    content: JSON.stringify(result)
                });
            }
            messages.push({
                role: 'user',
                content: results
            });
        }
    } catch (e) {
        console.error(e);
        return json(502, {
            error: 'ai_failed',
            message: 'AI 응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.'
        });
    }
    return json(200, {
        reply: reply || '확인해 주세요.',
        actions,
        restaurants: restaurants.slice(0, 8)
    });
}

return {CHAT_MODEL,TOOLS,systemPrompt};