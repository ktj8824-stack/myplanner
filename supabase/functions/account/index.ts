// 마이플래너 계정 삭제 (Supabase Edge Function: myplanner-account, verify_jwt=true)
// POST { action: "delete" } — 로그인한 본인의 마이플래너 정보를 모두 지움 (logic.ts 참고)
import { deleteAccount } from "./logic.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// deno-lint-ignore no-explicit-any
const D = (globalThis as any).Deno;
D.serve(async (req: Request) => {
  const h = { ...CORS, "Content-Type": "application/json; charset=utf-8" };
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: h });
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") return reply(405, { error: { message: "POST로 보내 주세요" } });
    const env = D.env.toObject();
    const url = env.SUPABASE_URL, svc = env.SUPABASE_SERVICE_ROLE_KEY, anon = env.SUPABASE_ANON_KEY;
    const ur = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: req.headers.get("authorization") || "", apikey: anon || svc } });
    const user = ur.ok ? await ur.json() : null;
    if (!user || !user.id) return reply(401, { error: { message: "로그인한 뒤 지울 수 있어요." } });
    const body = await req.json().catch(() => ({}));
    if (body.action !== "delete") return reply(400, { error: { message: "알 수 없는 요청이에요." } });
    const rest = async (path: string, init: RequestInit = {}) => {
      const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json", ...(init.headers || {}) } });
      if (!r.ok) { console.error("db", path.split("?")[0], r.status, await r.text()); throw new Error("db"); }
      return r.status === 204 || init.method ? null : r.json();
    };
    return reply(200, await deleteAccount(user.id, rest));
  } catch (e) {
    console.error("account error", e instanceof Error ? e.message : e);
    return reply(500, { error: { message: "지우는 중에 오류가 났어요. 잠시 뒤 다시 해 주세요." } });
  }
});
