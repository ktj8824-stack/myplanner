// 계정 삭제 서버 로직 시험: 지울 것은 지우고, 결제 기록은 건드리지 않는지
import { deleteAccount } from '../supabase/functions/account/logic.ts';
const uid = '11111111-2222-3333-4444-555555555555';
const calls = [];
const rest = async (path, init = {}) => {
  calls.push(`${init.method || 'GET'} ${path}${init.body ? ' ' + init.body : ''}`);
  if (path.startsWith('mp_family_members?user_id=') && !init.method) return [{ family_id: 'f1' }, { family_id: 'f2' }];
  if (path.startsWith('mp_family_members?family_id=eq.f1')) return [];
  if (path.startsWith('mp_family_members?family_id=eq.f2')) return [{ user_id: 'x' }];
  return null;
};
const r = await deleteAccount(uid, rest);
const has = s => calls.some(c => c.startsWith(s));
const must = ['DELETE mp_schedules?owner_id=eq.', 'DELETE mp_schedule_shares?owner_id=', 'DELETE mp_schedule_shares?target_id=', 'DELETE mp_family_members?user_id=',
  'DELETE mp_families?id=eq.f1', 'PATCH mp_families?created_by=', 'DELETE mp_point_ledger', 'DELETE mp_raffle_entries', 'PATCH mp_raffle_winners?user_id=eq.' + uid + '&shipped_at=is.null',
  'DELETE mp_ai_usage', 'DELETE mp_ai_reports', 'DELETE mp_profiles'];
let fail = 0;
for (const m of must) if (!has(m)) { console.error('빠짐:', m); fail++; }
if (has('DELETE mp_families?id=eq.f2')) { console.error('다른 사람이 남은 가족을 지웠어요'); fail++; }
if (calls.some(c => c.includes('mp_payments'))) { console.error('결제 기록을 건드렸어요'); fail++; }
if (calls.some(c => c.includes('ship_phone') && !c.includes('"ship_phone":null'))) { console.error('배송 정보가 남아요'); fail++; }
let bad = false; try { await deleteAccount("1 or 1=1", rest); } catch (e) { bad = true; }
if (!bad) { console.error('잘못된 id를 막지 못했어요'); fail++; }
if (!r.ok) fail++;
console.log(fail ? `계정 삭제: ${fail}개 실패` : '계정 삭제: 모두 통과');
process.exit(fail ? 1 : 0);
