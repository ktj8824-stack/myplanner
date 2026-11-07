// AI 비서 말 알아듣기 평가 (실제 Claude 호출): ANTHROPIC_API_KEY=sk-... node --no-warnings test/ai-eval/run.mjs
// 40~60대가 실제로 할 법한 말 30개로 서버 함수와 같은 지시문·도구를 써서 첫 응답을 검사합니다.
// 프롬프트를 고친 뒤 점수가 떨어지지 않는지 확인하는 용도 (비용: 30번 호출, Haiku 기준 몇십 원)
import fs from 'node:fs';
import { TOOLS, MODEL, systemPrompt, checkAction } from '../../supabase/functions/ai/index.ts';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.error('ANTHROPIC_API_KEY 환경 변수가 필요해요'); process.exit(1); }
const { context: ctx, cases } = JSON.parse(fs.readFileSync(new URL('./cases.json', import.meta.url)));

function check(c, blocks) {
  const uses = blocks.filter(b => b.type === 'tool_use');
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join(' ');
  const bad = [];
  if (/[\u4E00-\u9FFF]|\[\s*note/i.test(text)) bad.push('한자·내부 메모가 답에 섞임');
  if (c.tool === null) {
    if (uses.length) bad.push(`도구를 쓰면 안 됨 (${uses[0].name})`);
    if (c.ask && !/[?？]|요\s*$/.test(text)) bad.push('되묻지 않음');
    if (c.refuse && !/일정|이동|도와|의사|약사|전문/.test(text)) bad.push('범위 밖 요청을 돌리지 않음');
    for (const h of c.replyHas || []) if (!text.includes(h)) bad.push(`답에 '${h}' 없음`);
    if (c.nonEmpty && !text.trim()) bad.push('답이 비어 있음');
    if (c.noCardClaim && /카드/.test(text)) bad.push('도구 없이 카드를 말함');
    return { ok: !bad.length, bad, text };
  }
  const mine = uses.filter(u => u.name === c.tool);
  if (!mine.length) return { ok: false, bad: [`${c.tool} 안 씀`], text };
  if (c.count && mine.length !== c.count) bad.push(`${c.count}개 제안해야 하는데 ${mine.length}개`);
  const a = mine[0].input || {};
  for (const [k, v] of Object.entries(c.expect || {})) {
    if (k.endsWith('~')) { const f = k.slice(0, -1); if (!String(a[f] || '').includes(v)) bad.push(`${f}=${a[f]} (기대: ${v} 포함)`); }
    else if (JSON.stringify(a[k]) !== JSON.stringify(v)) bad.push(`${k}=${JSON.stringify(a[k])} (기대: ${JSON.stringify(v)})`);
  }
  const problem = checkAction(mine[0].name, a, ctx);
  if (problem) bad.push('서버 검사 불통과: ' + problem);
  return { ok: !bad.length, bad, text, input: a };
}

let pass = 0;
for (const [n, c] of cases.entries()) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 700, system: systemPrompt(ctx), tools: TOOLS, messages: [{ role: 'user', content: c.say }] })
  });
  const data = await res.json();
  if (!res.ok) { console.error('API 오류', data); process.exit(1); }
  const r = check(c, data.content || []);
  if (r.ok) pass++;
  console.log(`${r.ok ? '✓' : '✗'} ${String(n + 1).padStart(2)}. ${c.say}`);
  if (!r.ok) console.log(`     ${r.bad.join(' / ')}${r.input ? '\n     → ' + JSON.stringify(r.input) : r.text ? '\n     → ' + r.text.slice(0, 120) : ''}`);
}
console.log(`\n${pass}/${cases.length} 통과`);
