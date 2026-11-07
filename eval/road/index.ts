// =====================================================================
// 로드플래너 AI 비서 — Supabase Edge Function (배포 이름: roadplanner-ai, 버디플래너 프로젝트에 배포)
//
// 앱 → 이 함수 → Claude API. API 키는 서버 비밀값으로만 보관합니다. (버디플래너 ai-chat 구조)
//  1) 로그인 확인: 로드플래너 서버(gohxflsyhogyxantnlig)에 사용자 토큰을 물어봄
//  2) 요금제 확인: 로드플래너 payments 함수(status)로 PRO·회사 요금제 사용 여부 확인
//  3) 하루 사용량: rp_ai_try_use (무료 맛보기 / 유료 넉넉히)
//  4) Claude는 스케줄 등록을 '제안'(propose_schedule)만 하고, 저장은 앱에서 사용자가 확인 카드로 승인
//     현장 주변 식당·카페·주차장은 서버가 카카오 장소 검색으로 찾은 실제 장소만 보여줌
//
// 비밀값 (이 프로젝트에 이미 있음): ANTHROPIC_API_KEY, MANAGER_KAKAO_REST_KEY (없으면 KAKAO_REST_API_KEY)
// 선택: RP_AI_ALLOW_ALL=true (출시 전 시험: 모두 유료 취급), RP_AI_FREE_DAILY(10), RP_AI_PAID_DAILY(60),
//       RP_AI_FREE_IMAGE(3), RP_AI_PAID_IMAGE(15)
// 자동 제공: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================

// deno-lint-ignore no-explicit-any
type Json = any;
type Env = Record<string, string | undefined>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const RP_URL = "https://gohxflsyhogyxantnlig.supabase.co";
const RP_PUBLISHABLE = "sb_publishable_4BiVB8PhD5kk1Dvtvf6Hkw_8YZL0Mwa"; // 로드플래너 공개 키 (앱 코드에도 있는 값)

export const CHAT_MODEL = "claude-haiku-5-5";    // 일반 대화: 빠르고 저렴
export const VISION_MODEL = "claude-sonnet-5-5"; // 스케줄표·콜시트 사진 읽기: 정확도 우선
const MAX_ROUNDS = 4;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

export const CATEGORIES = ["music_show", "broadcast", "shooting", "event", "fansign", "recording", "overseas", "meeting"];

export const TOOLS = [
  {
    name: "propose_schedule",
    description: "새 스케줄 등록을 제안합니다. 앱에 확인 카드가 뜨고, 사용자가 버튼을 누르면 스케줄 등록 창이 내용이 채워진 채로 열립니다. 저장과 동선(출발·샵·도착 시각) 계산은 앱이 합니다.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "짧은 스케줄명 (예: 뮤직뱅크 사전녹화, OO 화보 촬영, 대학 축제)" },
        artist: { type: "string", description: "아티스트 이름. 사용자 정보의 아티스트 목록에 있는 이름 그대로. 전원이면 '전체'. 모르면 생략" },
        category: { type: "string", enum: CATEGORIES, description: "music_show=음악방송, broadcast=예능·라디오·인터뷰, shooting=화보·촬영·광고, event=행사·콘서트·축제, fansign=팬미팅·팬사인회, recording=녹음·연습, overseas=해외·출국, meeting=미팅·기타" },
        date: { type: "string", description: "YYYY-MM-DD. 아래 [날짜표]에서 찾아 씀" },
        start: { type: "string", description: "HH:MM 24시간. 현장 도착(콜) 또는 시작 시각" },
        end: { type: "string", description: "HH:MM 끝나는 시각 (말한 경우만)" },
        place: { type: "string", description: "행사장·촬영 장소 이름 (예: KBS 신관, 상암 MBC)" },
        address: { type: "string", description: "주소를 말했거나 사진에 있으면 그대로" },
        departure: { type: "string", description: "출발지(숙소·사옥 등)를 말한 경우만" },
        shop_name: { type: "string", description: "헤어·메이크업 샵을 들렀다 가면 샵 이름" },
        shop_address: { type: "string" },
        memo: { type: "string" },
      },
      required: ["title", "date", "start", "place"],
    },
  },
  {
    name: "search_nearby",
    description: "현장(또는 샵·출발지) 주변의 실제 장소를 카카오 장소 검색으로 찾습니다. 식당·카페·주차장·편의점·약국 등을 추천할 때는 반드시 이 결과에 있는 곳만 말하세요.",
    input_schema: {
      type: "object",
      properties: {
        near: { type: "string", description: "기준 장소 이름이나 주소 (예: KBS 신관, 상암 MBC)" },
        kind: { type: "string", enum: ["food", "cafe", "parking", "convenience", "pharmacy", "hospital", "other"], description: "찾을 종류" },
        keyword: { type: "string", description: "종류를 더 좁히는 말 (예: 국밥, 도시락, 24시). 없으면 생략" },
      },
      required: ["near", "kind"],
    },
  },
];

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** 오늘부터 3주 날짜표 — 요일·날짜 계산 실수를 막으려고 서버가 미리 계산 (주는 월~일) */
export function calendarTable(today: string): string {
  if (!/^20\d\d-\d\d-\d\d$/.test(today || "")) return "";
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const mondayOffset = (base.getUTCDay() + 6) % 7;
  const rel: Record<number, string> = { 0: "오늘", 1: "내일", 2: "모레", 3: "글피" };
  const lines: string[] = [];
  for (let i = 0; i < 21; i++) {
    const t = new Date(base.getTime() + i * 86400000);
    const w = DOW[t.getUTCDay()];
    const week = Math.floor((i + mondayOffset) / 7);
    const tags = [rel[i], ["이번 주", "다음 주", "다다음 주"][week] + " " + w + "요일"].filter(Boolean);
    lines.push(`${t.toISOString().slice(0, 10)}(${w}) ${tags.join(", ")}`);
  }
  return lines.join("\n");
}

export function systemPrompt(ctx: Json): string {
  return `당신은 연예인 매니저용 스케줄·이동 앱 '로드플래너'의 AI 비서 '로디'입니다. 사용자는 현장 매니저와 본사 관리자입니다.

[말투]
- 존댓말로 짧고 또렷하게 (보통 1~5문장). 현장에서 운전·대기 중에 읽으므로 핵심부터 말합니다.
- 시각은 "오후 2시 30분"처럼 말합니다. 마크다운은 **굵게**와 줄바꿈만 씁니다.

[할 수 있는 일]
- 스케줄 등록: "내일 2시 KBS 뮤뱅 사녹" 같은 말을 propose_schedule로 제안합니다. 날짜는 직접 계산하지 말고 [날짜표]에서 찾습니다.
  한 번에 여러 스케줄을 말하면 스케줄마다 따로, 시간 순서대로 제안합니다.
- 스케줄표·콜시트·공문 사진: 날짜, 콜(도착) 시각, 장소, 주소, 아티스트를 읽어 줄마다 propose_schedule로 제안합니다. 흐리거나 애매한 값은 지어내지 말고 확인을 부탁합니다.
- 현장 주변 밥집·카페·주차장·편의점·약국: search_nearby 결과에 있는 곳만 말합니다. 결과에 없는 가게 이름, 평점, 영업시간을 지어내지 않습니다. 영업시간은 방문 전 확인을 권합니다.
  대기 중 식사는 빨리 나오는 국밥·백반·분식·도시락을, 단체 식사는 넓은 한식·고깃집을 먼저 고려합니다.
- 스케줄 질문("내일 몇 시 출발이야?", "이번 주 일정")은 아래 스케줄 목록 값으로 답합니다. 목록에 없는 시각을 지어내지 않습니다. 출발 시각이 목록에 없으면 "등록 후 앱이 동선을 계산해요"라고 말합니다.
- 매니저 업무 상식(방송국 출입, 사전녹화 흐름, 이동 동선 팁, 비 오는 날 대비 등)은 간단히 답합니다.
- 저장은 사용자가 카드 버튼을 눌러야 됩니다. "등록했어요"가 아니라 "아래 카드에서 확인해 주세요"라고 말합니다. 출발·기상 시각은 앱이 경로를 찾아 계산하므로 미리 말하지 않습니다.
- 꼭 필요한 정보(날짜, 시각, 장소)가 없으면 추측하지 말고 한 가지만 짧게 물어봅니다. 아티스트·분류·종료 시각은 모르면 묻지 말고 생략합니다(사용자가 창에서 고름).
- 업무와 무관한 요청(투자, 정치, 숙제, 코딩 등)은 "저는 스케줄과 이동을 돕는 비서라서요"처럼 정중히 짧게 돌려 말합니다. 아티스트 사생활·연락처 같은 민감한 정보는 다루지 않습니다.

[시각 알아듣기]
- start는 24시간 HH:MM. "반"은 30분. 오전/오후를 말하지 않으면 7~11시는 오전, 12시는 낮 12시, 1~6시는 오후로 보되, 새벽 이동·출국·사전녹화처럼 이른 일정은 문맥으로 판단하고 애매하면 물어봅니다.
- "콜 1시", "1시까지 도착"은 start=13:00. 날짜 없이 시각만 말하면 아직 안 지났으면 오늘, 지났으면 내일.

[분류 고르기]
- 음악방송(뮤뱅·음중·인가·엠카·쇼챔 등, 사녹 포함)=music_show, 예능·라디오·인터뷰=broadcast, 화보·광고·뮤비·촬영=shooting, 행사·축제·콘서트=event, 팬미팅·팬싸=fansign, 녹음·연습·레슨=recording, 출국·해외=overseas, 그 밖=meeting.

[예시] (실제로는 날짜표의 날짜를 씀)
- "내일 오후 2시 KBS 뮤뱅 사녹, 샵은 정샘물 청담" → propose_schedule {title:"뮤직뱅크 사전녹화", category:"music_show", date:내일, start:"14:00", place:"KBS 신관", shop_name:"정샘물 청담"}
- "토요일 6시 한양대 축제" → propose_schedule {title:"한양대 축제", category:"event", date:이번 주 토요일, start:"18:00", place:"한양대학교"}
- "상암 MBC 근처 빨리 먹을 데" → search_nearby {near:"상암 MBC", kind:"food", keyword:"국밥"}
- "3시에 촬영 있어" → 어디인지 모르므로 "어디서 촬영하나요?"라고 한 가지만 물음

[사용자 정보]
- 지금: ${ctx.today || ""} (${ctx.weekday || ""}) ${ctx.now || ""}
- 이름: ${ctx.userName || ""} / 역할: ${ctx.role === "manager" ? "현장 매니저" : (ctx.role ? "본사 관리자" : "")} / 기본 출발지: ${ctx.departure || "미등록"}
- 아티스트: ${JSON.stringify(ctx.artists || [])}
- 앞으로 2주 스케줄(계산된 출발 시각 포함): ${JSON.stringify(ctx.upcoming || [])}

[날짜표] (오늘부터 3주, 주는 월~일)
${calendarTable(ctx.today)}`;
}

// ── 외부 서비스 ────────────────────────────────────────────────────────
async function getUser(auth: string, f: Fetch) {
  const res = await f(`${RP_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: RP_PUBLISHABLE } });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u && u.id ? u : null;
}

/** 로드플래너 결제 서버에 '이 사람 유료인가'를 물어봄 (PRO 개인 결제 또는 회사 요금제 사용 중) */
async function isPaid(env: Env, auth: string, f: Fetch): Promise<boolean> {
  if (env.RP_AI_ALLOW_ALL === "true") return true;
  try {
    const res = await f(`${RP_URL}/functions/v1/payments`, {
      method: "POST",
      headers: { Authorization: auth, apikey: RP_PUBLISHABLE, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status" }),
    });
    if (!res.ok) return false;
    const s = await res.json();
    const pro = s?.proUntil && Date.parse(s.proUntil) > Date.now();
    return !!(pro || s?.company?.active);
  } catch { return false; }
}

async function tryUse(env: Env, userId: string, kind: string, limit: number, f: Fetch): Promise<number> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const res = await f(`${env.SUPABASE_URL}/rest/v1/rpc/rp_ai_try_use`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_user: userId, p_kind: kind, p_limit: limit }),
  });
  if (!res.ok) throw new Error(`usage ${res.status}`);
  return Number(await res.json());
}

function kakaoKey(env: Env) { return (env.MANAGER_KAKAO_REST_KEY || env.KAKAO_REST_API_KEY || "").trim(); }

async function kakao(env: Env, params: Record<string, string>, f: Fetch) {
  const res = await f(`https://dapi.kakao.com/v2/local/search/keyword.json?${new URLSearchParams(params)}`, {
    headers: { Authorization: `KakaoAK ${kakaoKey(env)}` },
  });
  if (!res.ok) throw new Error(`카카오 검색 실패 (${res.status})`);
  return (await res.json()).documents || [];
}

async function kakaoAddress(env: Env, q: string, f: Fetch) {
  const res = await f(`https://dapi.kakao.com/v2/local/search/address.json?${new URLSearchParams({ query: q, size: "1" })}`, {
    headers: { Authorization: `KakaoAK ${kakaoKey(env)}` },
  });
  if (!res.ok) return null;
  const d = ((await res.json()).documents || [])[0];
  return d ? { name: q, addr: d.road_address?.address_name || d.address_name || q, lat: parseFloat(d.y), lng: parseFloat(d.x) } : null;
}

/** 장소 이름 → 위치 (스케줄 제안 카드에 주소를 붙이고, 주변 검색의 기준점으로 씀) */
export async function findPlace(env: Env, name: string, f: Fetch) {
  const q = String(name || "").trim().slice(0, 80);
  if (!q) return null;
  const docs = await kakao(env, { query: q, size: "1" }, f).catch(() => []);
  if (docs.length) {
    const d = docs[0];
    return { name: d.place_name, addr: d.road_address_name || d.address_name || "", lat: parseFloat(d.y), lng: parseFloat(d.x) };
  }
  return await kakaoAddress(env, q, f);
}

const KIND: Record<string, { code?: string; word: string }> = {
  food: { code: "FD6", word: "맛집" }, cafe: { code: "CE7", word: "카페" }, parking: { code: "PK6", word: "주차장" },
  convenience: { code: "CS2", word: "편의점" }, pharmacy: { code: "PM9", word: "약국" }, hospital: { code: "HP8", word: "병원" },
  other: { word: "" },
};

export async function searchNearby(env: Env, input: Json, f: Fetch) {
  const base = await findPlace(env, String(input.near || ""), f);
  if (!base) return { error: `'${input.near}' 위치를 찾지 못했어요.` };
  const k = KIND[String(input.kind)] || KIND.other;
  const kw = String(input.keyword || "").trim().slice(0, 30);
  const params: Record<string, string> = { query: kw || k.word || "맛집", x: String(base.lng), y: String(base.lat), radius: "1500", sort: "distance", size: "8" };
  if (k.code) params.category_group_code = k.code;
  let docs = await kakao(env, params, f);
  if (!docs.length && kw && k.word) docs = await kakao(env, { ...params, query: k.word }, f); // 키워드로 안 나오면 종류로
  const places = docs.slice(0, 6).map((d: Json) => ({
    id: String(d.id || ""), name: d.place_name, category: String(d.category_name || "").split(" > ").slice(-1)[0],
    address: d.road_address_name || d.address_name || "", phone: d.phone || "", url: d.place_url || "",
    distance_m: d.distance ? Number(d.distance) : null, lat: parseFloat(d.y), lng: parseFloat(d.x),
  }));
  return { near: base.name, near_addr: base.addr, places };
}

async function callClaude(env: Env, body: Json, f: Fetch) {
  const res = await f("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": (env.ANTHROPIC_API_KEY || "").trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status} ${data?.error?.message || ""}`);
  return data;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/, YMD = /^20\d\d-\d\d-\d\d$/;
function realDate(s: string): boolean {
  if (!YMD.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** AI 제안이 앱에서 쓸 수 있는 형태인지 확인 (이상하면 AI가 다시 고치게 함) */
export function checkSchedule(input: Json, ctx: Json, fromPhoto: boolean): string | null {
  if (!input.title || !String(input.place || "").trim()) return "title과 place(장소)가 필요합니다. 모르면 사용자에게 물어보세요";
  if (!realDate(input.date || "")) return "date는 달력에 있는 YYYY-MM-DD여야 합니다. 날짜표에서 고르세요";
  if (!HM.test(input.start || "")) return "start는 HH:MM(24시간)";
  if (input.end && !HM.test(input.end)) return "end는 HH:MM";
  if (input.category && !CATEGORIES.includes(input.category)) return "category는 정해진 값만";
  // 사진(지난 공문 등)은 지난 날짜도 기록용으로 허용, 말로 한 새 일정은 지난 날짜 거름
  if (!fromPhoto && YMD.test(ctx.today || "") && input.date < ctx.today) return `${input.date}는 이미 지난 날짜입니다. 날짜표에서 다시 고르세요`;
  return null;
}

// ── 요청 처리 ──────────────────────────────────────────────────────────
export async function handle(req: Request, env: Env, f: Fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const auth = req.headers.get("Authorization") || "";
  const user = auth.startsWith("Bearer ") ? await getUser(auth, f) : null;
  if (!user) return json(401, { error: "login_required", message: "로그인이 필요해요. 앱에서 다시 로그인해 주세요." });

  let body: Json;
  try {
    const raw = await req.text();
    if (raw.length > 3_200_000) return json(413, { error: "too_large", message: "사진 용량이 너무 커요." });
    body = JSON.parse(raw);
  } catch { return json(400, { error: "bad_request" }); }

  const paid = await isPaid(env, auth, f);
  if (body && body.probe === true) return json(200, { ok: true, paid });

  const text = String(body.message || "").trim().slice(0, 1500);
  const image = body.image && typeof body.image.data === "string" ? body.image : null;
  if (!text && !image) return json(400, { error: "empty_message" });
  if (image && image.data.length > 2_800_000) return json(413, { error: "image_too_large", message: "사진 용량이 너무 커요." });
  const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(image?.media_type) ? image.media_type : "image/jpeg";

  const n = (k: string, d: number) => { const v = parseInt(env[k] || "", 10); return Number.isFinite(v) && v > 0 ? v : d; };
  const chatLimit = paid ? n("RP_AI_PAID_DAILY", 60) : n("RP_AI_FREE_DAILY", 10);
  const imageLimit = paid ? n("RP_AI_PAID_IMAGE", 15) : n("RP_AI_FREE_IMAGE", 3);
  let remaining: number;
  try {
    remaining = await tryUse(env, user.id, "chat", chatLimit, f);
    if (remaining < 0) {
      return json(429, { error: "daily_limit", paid, message: paid ? `오늘 AI 비서를 ${chatLimit}번 모두 쓰셨어요. 내일 다시 이용해 주세요.`
        : `무료로는 하루 ${chatLimit}번까지 쓸 수 있어요. PRO나 회사 요금제를 쓰면 하루 ${n("RP_AI_PAID_DAILY", 60)}번까지 대화할 수 있어요.` });
    }
    if (image && (await tryUse(env, user.id, "image", imageLimit, f)) < 0) {
      return json(429, { error: "daily_limit", paid, message: `오늘 사진 읽기 한도(${imageLimit}장)를 모두 썼어요.` });
    }
  } catch { return json(503, { error: "server_not_ready", message: "AI 비서 서버를 준비하고 있어요. 잠시 후 다시 써 주세요." }); }

  // 대화 기록 (최근 12개, 글만) + 이번 말
  const messages: Json[] = [];
  for (const m of (Array.isArray(body.history) ? body.history.slice(-12) : [])) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = String(m.content || "").slice(0, 1500);
    if (!content) continue;
    if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += "\n" + content;
    else messages.push({ role, content });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (messages.length && messages[messages.length - 1].role === "user") messages.pop();
  const userContent: Json[] = [];
  if (image) userContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: image.data } });
  userContent.push({ type: "text", text: text || "이 스케줄표를 읽고 스케줄로 등록해 줘." });
  messages.push({ role: "user", content: userContent });

  // 프롬프트에 넣는 정보는 크기 제한 (요금 남용 방지)
  const c0 = body.context && typeof body.context === "object" ? body.context : {};
  const ctx: Json = {
    today: String(c0.today || "").slice(0, 10), weekday: String(c0.weekday || "").slice(0, 3), now: String(c0.now || "").slice(0, 5),
    userName: String(c0.userName || "").slice(0, 30), role: String(c0.role || "").slice(0, 20), departure: String(c0.departure || "").slice(0, 80),
    artists: Array.isArray(c0.artists) ? c0.artists.slice(0, 40).map((x: Json) => String(x).slice(0, 30)) : [],
    upcoming: Array.isArray(c0.upcoming) ? c0.upcoming.slice(0, 30) : [],
  };

  const actions: Json[] = [];
  const places: Json[] = [];
  const seen: Record<string, boolean> = {};
  let reply = "";
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await callClaude(env, { model: image ? VISION_MODEL : CHAT_MODEL, max_tokens: 1200, system: systemPrompt(ctx), tools: TOOLS, messages }, f);
      const blocks: Json[] = resp.content || [];
      const said = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (said) reply = said;
      const uses = blocks.filter((b) => b.type === "tool_use");
      if (resp.stop_reason !== "tool_use" || !uses.length) break;
      messages.push({ role: "assistant", content: blocks });
      const results: Json[] = [];
      for (const u of uses) {
        const input = u.input || {};
        try {
          if (u.name === "propose_schedule") {
            const problem = checkSchedule(input, ctx, !!image);
            if (problem) { results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: problem }); continue; }
            const act: Json = { type: "schedule", ...input };
            if (!input.address) { try { act.found = await findPlace(env, input.place, f); } catch { act.found = null; } }
            actions.push(act);
            results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify({ shown_to_user: true, found_address: act.found?.addr || input.address || null, note: "확인 카드를 보여 줬습니다. 사용자가 버튼을 눌러야 저장됩니다." }) });
          } else if (u.name === "search_nearby") {
            const r = await searchNearby(env, input, f);
            for (const p of r.places || []) if (!seen[p.id]) { seen[p.id] = true; places.push(p); }
            results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(r) });
          } else results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "알 수 없는 도구" });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: (e as Error).message });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error("roadplanner-ai failed", (e as Error).message);
    return json(502, { error: "ai_failed", message: "AI가 잠시 대답하지 못했어요. 조금 뒤에 다시 말씀해 주세요." });
  }
  return json(200, { reply: reply || (actions.length ? "아래 카드에서 확인해 주세요." : "다시 한 번 말씀해 주시겠어요?"), actions, places: places.slice(0, 8), remaining, paid });
}

// Supabase Edge Runtime(Deno)에서 실행
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
