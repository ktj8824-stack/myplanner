// 문자 해석 확인: node test/parse.test.js  (기준일 2026-11-03 화요일)
const Parse = require('../js/parse.js');
const assert = require('assert');
const now = new Date(2026, 10, 3, 10, 0);
let fails = 0;
const check = (name, text, expect) => {
  const r = Parse.parse(text, now);
  const got = {};
  for (const k of Object.keys(expect)) got[k] = k.includes('.') ? k.split('.').reduce((o, p) => o && o[p], r) : r[k];
  try { assert.deepStrictEqual(got, expect); console.log('✓', name, '|', r.found.join(' · '), r.missing.length ? '| 빠짐: ' + r.missing.join(',') : ''); }
  catch (e) { fails++; console.log('✗', name, '\n  기대', JSON.stringify(expect), '\n  결과', JSON.stringify(got), '\n  전체', JSON.stringify(r)); }
};

check('KTX 코레일', '[Web발신]\n[코레일] 승차권 발권 안내\n11월 5일(목) KTX 101열차\n서울(08:00)→부산(10:40)\n5호차 12A석',
  { kind: 'train', date: '2026-11-05', 'trip.number': 'KTX 101', 'trip.from': '서울역', 'trip.to': '부산역', 'trip.departTime': '08:00', 'trip.arriveTime': '10:40', 'trip.seat': '5호차 12A' });
check('SRT', '[SRT] 예매완료 2026.11.07(토) SRT 305 수서 09:30 → 동대구 11:20 3호차 7B',
  { kind: 'train', date: '2026-11-07', 'trip.number': 'SRT 305', 'trip.from': '수서역', 'trip.to': '동대구역', 'trip.departTime': '09:30', 'trip.arriveTime': '11:20' });
check('KTX 물결표', '11/12(목) KTX-산천 223 용산→광주송정 07:10~09:05',
  { kind: 'train', date: '2026-11-12', 'trip.from': '용산역', 'trip.to': '광주송정역', 'trip.departTime': '07:10', 'trip.arriveTime': '09:05' });
check('국내선', '[대한항공] 예약확정 KE1203 11/10(화) 김포 07:30 → 제주 08:40 탑승수속 마감 출발 20분 전',
  { kind: 'flight', date: '2026-11-10', 'trip.number': 'KE1203', 'trip.from': '김포공항', 'trip.to': '제주공항', 'trip.departTime': '07:30', 'trip.arriveTime': '08:40', 'trip.international': false });
check('국제선', '아시아나 OZ102 2026-12-01 ICN 10:15 → NRT 12:40',
  { kind: 'flight', date: '2026-12-01', 'trip.number': 'OZ102', 'trip.from': '인천공항 제1터미널', 'trip.departTime': '10:15', 'trip.international': true });
check('병원 예약', '[강남세브란스병원] 김민지님 11월 6일(목) 오후 2시 30분 정형외과 진료 예약되었습니다. 진료 15분 전까지 내원 바랍니다.',
  { kind: 'event', date: '2026-11-06', time: '14:30', place: '강남세브란스병원', title: '강남세브란스병원 정형외과 진료', bufferMin: 15 });
check('카톡 미팅', '내일 오전 10시 판교역 2번 출구 앞에서 미팅',
  { kind: 'event', date: '2026-11-04', time: '10:00', place: '판교역 2번 출구', title: '미팅' });
check('다음주 약속', '다음주 화요일 저녁 7시 홍대입구역 근처 카페에서 봐요',
  { kind: 'event', date: '2026-11-10', time: '19:00', place: '홍대입구역', title: '홍대입구역 약속' });
check('회의 안내', '회의 안내\n일시: 2026년 11월 12일 14:00\n장소: 서울 중구 세종대로 110 서울시청',
  { kind: 'event', date: '2026-11-12', time: '14:00', place: '서울 중구 세종대로 110 서울시청', title: '회의' });
check('시 반·오전 없음', '목요일 2시 반 치과 예약 [연세미소치과]',
  { kind: 'event', date: '2026-11-05', time: '14:30', place: '연세미소치과' });
check('면접', '[OO전자] 11.20(금) 09:30 면접 안내드립니다. 장소: 수원 삼성디지털시티 정문',
  { kind: 'event', date: '2026-11-20', time: '09:30', title: 'OO전자 면접', place: '수원 삼성디지털시티 정문' });
check('지난 달 → 내년', '1월 8일 오후 3시 결혼식 더채플앳청담',
  { date: '2027-01-08', time: '15:00', title: '결혼식' });
check('빈 문자', '안녕하세요 반갑습니다', { kind: 'event', date: '', time: '' });

if (fails) { console.log(`\n${fails}개 실패`); process.exit(1); }
console.log('\n문자 해석 확인 완료');
