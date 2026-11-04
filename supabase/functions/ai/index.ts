// =====================================================================
// MyPlanner AI 비서 — Supabase Edge Function (배포 이름: myplanner-ai)
//
// 앱 → 이 함수 → Claude API. API 키는 서버 비밀값으로만 보관합니다. (버디플래너 ai-chat 구조)
//  1) 로그인 사용자 확인  2) PRO 확인  3) 하루 사용량 (무료 맛보기 / PRO 넉넉히)
//  4) Claude가 일정 등록·변경을 '제안'(propose_*)만 하고, 저장은 앱에서 사용자가 확인 카드로 승인
//     → 시각 계산은 앱의 계산 엔진이 하므로 AI가 틀린 시각으로 알람을 맞추는 일이 없음
//
// 비밀값 (버디플래너 프로젝트와 같은 곳 — MYPLANNER_ 접두사가 우선):
//   MYPLANNER_ANTHROPIC_API_KEY (없으면 ANTHROPIC_API_KEY)
//   선택: MYPLANNER_REVENUECAT_SECRET_KEY (PRO 확인), MYPLANNER_AI_ALLOW_ALL=true (출시 전 시험용: 모두 PRO 취급)
//         MYPLANNER_AI_FREE_DAILY (기본 5), MYPLANNER_AI_PRO_DAILY (기본 60)
// 자동 제공: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// =====================================================================

// deno-lint-ignore no-explicit-any
type Json = any;
type Env = Record<string, string | undefined>;
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const MODEL = "claude-haiku-5-5";   // 빠르고 저렴 (대화·일정 이해에 충분)
const MAX_ROUNDS = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Json) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

export const TOOLS = [
  {
    name: "propose_schedule",
    description: "새 일정 등록을 제안합니다. 앱이 경로를 찾아 기상·출발 시각을 계산한 확인 카드를 보여 주고, 사용자가 버튼을 눌러야 저장됩니다.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "짧은 일정 이름 (예: 아산병원 진료, 강남 미팅, 부산 출장)" },
        date: { type: "string", description: "YYYY-MM-DD (반복이면 시작일)" },
        kind: { type: "string", enum: ["event", "train", "flight"], description: "event=약속·출근·병원 등 장소에 도착, train=기차, flight=비행기" },
        time: { type: "string", description: "HH:MM 24시간. event면 도착해야 하는 시각, train/flight면 출발(탑승) 시각" },
        place: { type: "string", description: "event의 목적지 (검색할 장소명, 예: 서울아산병원, 강남역)" },
        origin: { type: "string", description: "출발지. 집이면 'home' (기본). 다른 곳이면 장소명" },
        mode: { type: "string", enum: ["transit", "car", "taxi", "walk"], description: "event 이동수단, train/flight는 역·공항까지 가는 수단. 말 안 하면 생략(사용자 기본값)" },
        from_station: { type: "string", description: "train/flight 출발역·공항 (예: 서울역, 김포공항)" },
        to_station: { type: "string", description: "train/flight 도착역·공항" },
        number: { type: "string", description: "열차·편명 (예: KTX 101, KE1203)" },
        arrive_time: { type: "string", description: "train/flight 도착 시각 HH:MM (알면)" },
        international: { type: "boolean", description: "국제선이면 true" },
        repeat: { type: "string", enum: ["none", "daily", "weekdays", "weekly"], description: "반복. 출근·등교는 보통 weekdays" },
        repeat_days: { type: "array", items: { type: "integer" }, description: "weekly일 때 요일 0=일~6=토" },
        prep_min: { type: "integer", description: "일어나서 나가기까지 준비 시간(분), 말한 경우만" },
        buffer_min: { type: "integer", description: "약속보다 일찍 도착할 여유(분), 말한 경우만 (예: 15분 전까지 오라고 하면 15)" },
        memo: { type: "string" },
        share_with: { type: "array", items: { type: "string" }, description: "이 일정 알람을 같이 보낼 가족 이름 (사용자 정보의 가족 목록에 있는 이름만)" },
      },
      required: ["title", "date", "kind", "time"],
    },
  },
  {
    name: "propose_update",
    description: "이미 있는 일정의 시간·날짜 변경이나 하루 건너뛰기를 제안합니다. idx는 사용자 정보의 일정 목록 idx. 사용자가 확인 카드에서 승인해야 바뀝니다.",
    input_schema: {
      type: "object",
      properties: {
        idx: { type: "integer" },
        new_time: { type: "string", description: "HH:MM (도착 시각, 기차·비행기는 출발 시각)" },
        new_date: { type: "string", description: "YYYY-MM-DD (반복 일정에는 쓰지 않음)" },
        prep_min: { type: "integer" },
        buffer_min: { type: "integer" },
        skip: { type: "boolean", description: "반복 일정의 그날 하루만 건너뛰기" },
      },
      required: ["idx"],
    },
  },
];

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 오늘부터 3주 날짜표 — AI가 요일·날짜 계산을 틀리지 않도록 서버가 미리 계산해 줌
 * 주는 월요일~일요일. "이번 주 X요일" = 오늘이 속한 주, "다음 주 X요일" = 그다음 주.
 */
export function calendarTable(today: string): string {
  if (!/^20\d\d-\d\d-\d\d$/.test(today || "")) return "";
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const mondayOffset = (base.getUTCDay() + 6) % 7; // 이번 주 월요일까지 며칠 전
  const rel: Record<number, string> = { 0: "오늘", 1: "내일", 2: "모레", 3: "글피" };
  const lines: string[] = [];
  for (let i = 0; i < 21; i++) {
    const t = new Date(base.getTime() + i * 86400000);
    const ymd = t.toISOString().slice(0, 10);
    const w = DOW[t.getUTCDay()];
    const week = Math.floor((i + mondayOffset) / 7); // 0=이번 주, 1=다음 주, 2=다다음 주
    const tags = [rel[i], ["이번 주", "다음 주", "다다음 주"][week] + " " + w + "요일"].filter(Boolean);
    if (week === 0 && (w === "토" || w === "일")) tags.push("이번 주말");
    if (week === 1 && (w === "토" || w === "일")) tags.push("다음 주말");
    lines.push(`${ymd}(${w}) ${tags.join(", ")}`);
  }
  return lines.join("\n");
}

export function systemPrompt(ctx: Json): string {
  return `당신은 일정·이동 알람 앱 '마이플래너'의 AI 비서입니다. 사용자는 40~60대가 많습니다.

[말투]
- 존댓말로, 짧고 쉬운 문장으로 답합니다 (보통 1~4문장). 어려운 외래어·영어·기호를 피합니다.
- 시각은 "오전 7시 40분"처럼 오전/오후를 붙여 말합니다.
- 마크다운은 쓰지 말고 줄바꿈만 씁니다.

[할 일]
- 일정 등록: "내일 10시 아산병원 가야 돼" 같은 말을 propose_schedule로 제안합니다. 날짜는 직접 계산하지 말고 아래 [날짜표]에서 그대로 찾아 씁니다.
  출근·등교처럼 매일 하는 일은 반복(weekdays)을 제안합니다. 기차·비행기는 kind를 train/flight로, time에는 출발 시각을 넣습니다.
- 꼭 필요한 정보(날짜, 시간, 어디로)가 없으면 추측하지 말고 짧게 하나만 물어봅니다. 이동수단·준비 시간은 말하지 않으면 묻지 말고 생략합니다(기본값 사용).
- 일정 질문("내일 몇 시에 나가?", "이번 주 일정")은 아래 일정 목록의 계산된 시각으로 답합니다. 목록에 없는 시각을 지어내지 않습니다.
- 변경("11시로 미뤄 줘", "내일은 출근 안 해")은 propose_update로 제안합니다.
- 저장은 사용자가 카드 버튼을 눌러야 됩니다. "등록했어요"가 아니라 "아래 카드에서 확인해 주세요"라고 말합니다.
- 기상·출발 시각은 앱이 경로를 찾아 계산합니다. 새 일정의 기상·출발 시각을 미리 말하지 마세요.
- 한 번에 여러 일정을 말하면("10시 병원 갔다가 2시에 회사") 일정마다 propose_schedule을 따로 씁니다.
- 장소는 사용자가 쓴 말 그대로 넣습니다. "회사", "엄마 집"처럼 자주 가는 곳 목록에 있는 이름이면 그 이름을 그대로 쓰면 앱이 알아서 찾습니다.
- "엄마 폰에도 알려 줘"처럼 가족에게 알람을 보내 달라고 하면 share_with에 가족 이름을 넣습니다. 가족 목록에 없는 사람이면 그렇다고 말합니다.
- 일정·이동·하루 계획과 무관한 요청(투자, 정치, 숙제, 코딩 등)은 "저는 일정과 이동을 돕는 비서라서요"처럼 정중히 짧게 돌려 말합니다. 가벼운 인사는 받아 줍니다.
- 건강·의료 판단은 하지 않습니다.

[시각 알아듣기]
- time은 24시간 HH:MM. "반"은 30분, "정오"는 12:00, "아침 8시"는 08:00, "저녁 7시"는 19:00, "밤 11시"는 23:00, "새벽 5시"는 05:00.
- 오전/오후를 말하지 않으면: 7~11시는 오전, 12시는 낮 12시, 1~6시는 오후로 봅니다. 단 출근·등교·기차·비행기·새벽 일정은 1~6시도 맥락에 맞게(예: "5시 KTX"는 문맥상 애매하면 물어봄).
- "10시까지 오래", "10시 전까지"는 time=10:00. "15분 일찍 가야 돼"는 buffer_min=15.
- "1시간 전에 깨워 줘", "준비 30분이면 돼"는 prep_min.
- 날짜를 말하지 않고 시각만 말하면: 그 시각이 아직 안 지났으면 오늘, 지났으면 내일로 봅니다.
- "매주 화목"은 repeat=weekly, repeat_days=[2,4]. "평일마다"·"매일 출근"은 weekdays. "매일"은 daily.

[이름 짓기]
- title은 짧게: 장소나 목적 + 일(예: "아산병원 진료", "강남 미팅", "부산 출장", "손주 어린이집"). "엄마 모시고 병원"처럼 사람이 있으면 "엄마 병원 동행"처럼 넣습니다.

[예시] (실제로는 아래 날짜표의 날짜를 씁니다)
- "모레 엄마 모시고 아산병원 10시" → propose_schedule {title:"엄마 아산병원 진료", kind:"event", date:모레, time:"10:00", place:"서울아산병원"}
- "다음 주 수요일 부산 내려가, KTX 8시 서울역" → propose_schedule {title:"부산 KTX", kind:"train", date:다음 주 수요일, time:"08:00", from_station:"서울역", to_station:"부산역"}
- "평일마다 9시까지 회사" → propose_schedule {title:"출근", kind:"event", date:가장 가까운 평일, time:"09:00", place:"회사", repeat:"weekdays"}
- "토요일 12시 반 강남 결혼식, 차 가지고 가" → propose_schedule {title:"강남 결혼식", kind:"event", date:이번 주 토요일(지났으면 다음 주), time:"12:30", place:"강남", mode:"car"}
- "내일 출근 안 해" → 목록의 내일 출근 idx로 propose_update {skip:true}
- "병원 11시로 미뤄 줘" → 목록의 병원 idx로 propose_update {new_time:"11:00"}
- "내일 몇 시에 일어나?" → 목록의 내일 일정 기상 시각으로 답 (도구 없음)
- "3시에 약속 있어" → 어디인지 모르므로 "어디로 가시나요?"라고 한 가지만 물음

[사용자 정보]
- 지금: ${ctx.today || ""} (${ctx.weekday || ""}) ${ctx.now || ""}
- 이름: ${ctx.userName || ""} / 집: ${ctx.home || "미등록"} / 기본 이동수단: ${ctx.defaultMode || ""} / 기본 준비 시간: ${ctx.prepMin || 60}분
- 자주 가는 곳: ${JSON.stringify(ctx.places || [])}
- 가족: ${JSON.stringify(ctx.family || [])}
- 앞으로 2주 일정(계산된 기상·출발 포함): ${JSON.stringify(ctx.upcoming || [])}

[날짜표] (오늘부터 3주, 주는 월~일)
${calendarTable(ctx.today)}`;
}

async function getUser(env: Env, auth: string, f: Fetch) {
  const res = await f(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey: env.SUPABASE_ANON_KEY || "" } });
  if (!res.ok) return null;
  const u = await res.json();
  return u && u.id ? u : null;
}

async function isPro(env: Env, userId: string, f: Fetch): Promise<boolean> {
  if (env.MYPLANNER_AI_ALLOW_ALL === "true") return true;
  const key = env.MYPLANNER_REVENUECAT_SECRET_KEY;
  if (!key) return false;
  try {
    const res = await f(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return false;
    const ent = (await res.json())?.subscriber?.entitlements?.pro;
    return !!ent && (!ent.expires_date || Date.parse(ent.expires_date) > Date.now());
  } catch { return false; }
}

/** 남은 횟수 (한도 초과면 -1). 사용량 테이블이 없으면 예외 */
async function tryUse(env: Env, userId: string, limit: number, f: Fetch): Promise<number> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
  const res = await f(`${env.SUPABASE_URL}/rest/v1/rpc/mp_ai_try_use`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_user: userId, p_limit: limit }),
  });
  if (!res.ok) throw new Error(`usage ${res.status}`);
  return Number(await res.json());
}

async function callClaude(env: Env, body: Json, f: Fetch) {
  const res = await f("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": (env.MYPLANNER_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || "").trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Claude ${res.status} ${data?.error?.message || ""}`);
  return data;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/, YMD = /^20\d\d-\d\d-\d\d$/;
/** 달력에 있는 날짜인지 (2026-11-31 같은 날 거르기) */
function realDate(s: string): boolean {
  if (!YMD.test(s || "")) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** AI가 만든 제안이 앱에서 쓸 수 있는 형태인지 확인 (이상하면 AI에게 다시 묻게 함) */
export function checkAction(name: string, input: Json, ctx: Json): string | null {
  if (name === "propose_schedule") {
    if (!input.title || !realDate(input.date || "") || !HM.test(input.time || "")) return "title, date(YYYY-MM-DD, 달력에 있는 날짜), time(HH:MM)이 필요합니다";
    for (const k of ["prep_min", "buffer_min"]) if (input[k] != null && !(Number.isFinite(input[k]) && input[k] >= 0 && input[k] <= 300)) return `${k}는 0~300분`;
    if (input.kind === "event" && !input.place) return "event에는 place(목적지)가 필요합니다. 모르면 사용자에게 물어보세요";
    if ((input.kind === "train" || input.kind === "flight") && !input.from_station) return "출발역·공항(from_station)이 필요합니다. 모르면 물어보세요";
    if (input.arrive_time && !HM.test(input.arrive_time)) return "arrive_time은 HH:MM";
    if (YMD.test(ctx.today || "") && input.date < ctx.today) return `${input.date}는 이미 지난 날짜입니다. 날짜표에서 다시 고르세요`;
    if ((!input.repeat || input.repeat === "none") && input.date === ctx.today && HM.test(ctx.now || "") && input.time <= ctx.now)
      return `오늘 ${input.time}은 이미 지났습니다(지금 ${ctx.now}). 내일인지 사용자에게 확인하세요`;
    if (input.repeat === "weekly" && !(Array.isArray(input.repeat_days) && input.repeat_days.length && input.repeat_days.every((n: Json) => Number.isInteger(n) && n >= 0 && n <= 6)))
      return "weekly 반복에는 repeat_days(0=일~6=토)가 필요합니다";
    return null;
  }
  if (name === "propose_update") {
    const n = Array.isArray(ctx.upcoming) ? ctx.upcoming.length : 0;
    if (!Number.isInteger(input.idx) || input.idx < 0 || input.idx >= n) return "목록에 있는 idx를 쓰세요";
    if (input.new_time && !HM.test(input.new_time)) return "new_time은 HH:MM";
    if (input.new_date && !realDate(input.new_date)) return "new_date는 YYYY-MM-DD (달력에 있는 날짜)";
    for (const k of ["prep_min", "buffer_min"]) if (input[k] != null && !(Number.isFinite(input[k]) && input[k] >= 0 && input[k] <= 300)) return `${k}는 0~300분`;
    if (input.new_date && YMD.test(ctx.today || "") && input.new_date < ctx.today) return "이미 지난 날짜로는 옮길 수 없습니다";
    if (!input.new_time && !input.new_date && input.prep_min == null && input.buffer_min == null && !input.skip) return "무엇을 바꿀지 하나 이상 넣으세요";
    return null;
  }
  return "알 수 없는 도구";
}

export async function handle(req: Request, env: Env, f: Fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const auth = req.headers.get("Authorization") || "";
  const user = auth.startsWith("Bearer ") ? await getUser(env, auth, f) : null;
  if (!user) return json(401, { error: "login_required", message: "AI 비서는 카카오로 로그인한 뒤 쓸 수 있어요." });

  let body: Json;
  try {
    const raw = await req.text();
    if (raw.length > 32000) return json(413, { error: "too_large", message: "요청이 너무 커요." });
    body = JSON.parse(raw);
  } catch { return json(400, { error: "bad_request" }); }
  const text = String(body.message || "").trim().slice(0, 1000);
  if (!text) return json(400, { error: "empty_message" });

  const pro = await isPro(env, user.id, f);
  const limit = pro ? parseInt(env.MYPLANNER_AI_PRO_DAILY || "60", 10) : parseInt(env.MYPLANNER_AI_FREE_DAILY || "5", 10);
  let remaining: number;
  try { remaining = await tryUse(env, user.id, limit, f); }
  catch { return json(503, { error: "server_not_ready", message: "AI 비서 서버를 준비하고 있어요. 잠시 후 다시 써 주세요." }); }
  if (remaining < 0) {
    return json(429, { error: "daily_limit", pro,
      message: pro ? `오늘 AI 비서를 ${limit}번 모두 쓰셨어요. 내일 다시 이용해 주세요.`
        : `무료로는 하루 ${limit}번까지 쓸 수 있어요. PRO로 바꾸시면 하루 ${env.MYPLANNER_AI_PRO_DAILY || 60}번까지 대화할 수 있어요.` });
  }

  // 대화 기록 (최근 10개, 글만) + 이번 말
  const messages: Json[] = [];
  for (const m of (Array.isArray(body.history) ? body.history.slice(-10) : [])) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = String(m.content || "").slice(0, 1000);
    if (!content) continue;
    if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += "\n" + content;
    else messages.push({ role, content });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (messages.length && messages[messages.length - 1].role === "user") messages.pop();
  messages.push({ role: "user", content: text });

  // 프롬프트에 넣는 내 정보는 크기를 제한 (요금 남용 방지)
  const c0 = body.context && typeof body.context === "object" ? body.context : {};
  const ctx: Json = {
    ...c0,
    places: Array.isArray(c0.places) ? c0.places.slice(0, 30).map((x: Json) => String(x).slice(0, 30)) : [],
    family: Array.isArray(c0.family) ? c0.family.slice(0, 20).map((x: Json) => String(x).slice(0, 20)) : [],
    upcoming: Array.isArray(c0.upcoming) ? c0.upcoming.slice(0, 25) : [],
    userName: String(c0.userName || "").slice(0, 30), home: String(c0.home || "").slice(0, 60),
  };
  const actions: Json[] = [];
  let reply = "";
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const resp = await callClaude(env, { model: MODEL, max_tokens: 700, system: systemPrompt(ctx), tools: TOOLS, messages }, f);
      const blocks: Json[] = resp.content || [];
      const said = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (said) reply = said;
      const uses = blocks.filter((b) => b.type === "tool_use");
      if (resp.stop_reason !== "tool_use" || !uses.length) break;
      messages.push({ role: "assistant", content: blocks });
      const results: Json[] = [];
      for (const u of uses) {
        const problem = checkAction(u.name, u.input || {}, ctx);
        if (problem) results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: problem });
        else {
          actions.push({ type: u.name === "propose_schedule" ? "schedule" : "update", ...u.input });
          results.push({ type: "tool_result", tool_use_id: u.id, content: '{"shown_to_user":true,"note":"확인 카드를 보여 줬습니다. 사용자가 버튼을 눌러야 저장됩니다."}' });
        }
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error("ai failed", (e as Error).message);
    return json(502, { error: "ai_failed", message: "AI가 잠시 대답하지 못했어요. 조금 뒤에 다시 말씀해 주세요." });
  }
  return json(200, { reply: reply || (actions.length ? "아래 카드에서 확인해 주세요." : "다시 한 번 말씀해 주시겠어요?"), actions, remaining, pro });
}

// Supabase Edge Runtime(Deno)에서 실행
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
if (D && D.serve) D.serve((req: Request) => handle(req, D.env.toObject()));
