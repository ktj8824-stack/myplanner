// 마이플래너 계정 삭제 (서버) — 구글 플레이 '앱 안에서 계정 삭제' 요건
// 카카오 로그인(Supabase 계정)은 버디·로드·CEO 플래너와 함께 쓰므로 로그인 자체는 지우지 않고,
// 마이플래너가 가진 이 사람의 정보를 모두 지움.
// 남기는 것: 이용권 결제 기록(전자상거래법 5년) · 럭키드로우 추첨 기록(이름은 '탈퇴한 회원'으로, 배송 정보는 지움)

// rest(path, init) → 응답 본문. DELETE/PATCH 만 씀
export async function deleteAccount(uid: string, rest: (path: string, init?: RequestInit) => Promise<unknown>) {
  if (!/^[0-9a-f-]{36}$/i.test(uid)) throw new Error("bad user id");
  const del = (path: string) => rest(path, { method: "DELETE" });
  const patch = (path: string, body: unknown) => rest(path, { method: "PATCH", body: JSON.stringify(body) });
  const done: string[] = [];

  // 1) 일정 공유 (내가 보낸 것·받은 것) → 일정
  await del(`mp_schedule_shares?owner_id=eq.${uid}`);
  await del(`mp_schedule_shares?target_id=eq.${uid}`);
  await del(`mp_schedules?owner_id=eq.${uid}`); done.push("일정·공유");

  // 2) 가족: 내 참여를 빼고, 아무도 안 남은 가족은 지움. 남은 가족의 '만든 사람'은 비움
  const mine = (await rest(`mp_family_members?user_id=eq.${uid}&select=family_id`)) as { family_id: string }[] || [];
  await del(`mp_family_members?user_id=eq.${uid}`);
  for (const { family_id } of mine) {
    const left = (await rest(`mp_family_members?family_id=eq.${family_id}&select=user_id&limit=1`)) as unknown[] || [];
    if (!left.length) await del(`mp_families?id=eq.${family_id}`);
  }
  await patch(`mp_families?created_by=eq.${uid}`, { created_by: null }); done.push("가족");

  // 3) 포인트·응모
  await del(`mp_point_ledger?user_id=eq.${uid}`);
  await del(`mp_raffle_entries?user_id=eq.${uid}`); done.push("포인트·응모");

  // 4) 당첨 기록: 추첨 결과는 남기되 이름은 가리고, 아직 안 보낸 경품은 포기 처리, 배송 정보는 지움
  await patch(`mp_raffle_winners?user_id=eq.${uid}&shipped_at=is.null`, { forfeited: true });
  await patch(`mp_raffle_winners?user_id=eq.${uid}`, { display_name: "탈퇴한 회원", ship_name: null, ship_phone: null, ship_addr: null }); done.push("당첨 정보");

  // 5) AI 비서 사용 횟수·신고, 프로필
  await del(`mp_ai_usage?user_id=eq.${uid}`);
  await del(`mp_ai_reports?user_id=eq.${uid}`);
  await del(`mp_profiles?user_id=eq.${uid}`); done.push("AI 기록·프로필");

  return { ok: true, deleted: done, kept: ["이용권 결제 기록 (법에 따라 5년)"] };
}
