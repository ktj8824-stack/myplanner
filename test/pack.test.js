// 챙길 것 확인: node test/pack.test.js
const assert = require('assert');
const Pack = require('../js/pack.js');
// 날짜는 오늘 기준 (지난 날 체크는 7일 뒤 지워지므로 고정 날짜를 쓰면 시간이 지나 실패함)
const ymd = t => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
const d = ymd(new Date(Date.now() + 86400000)), d2 = ymd(new Date(Date.now() + 2 * 86400000));
const hospital = { title: '서울아산병원 정기검진', mode: 'transit', date: d };

// 1) 병원·검진 + 비 예보 → 신분증·진료카드·우산 (중복 없이)
let a = Pack.auto(hospital, { weather: { kind: 'rain', temp: 9 } });
['신분증', '진료카드·예약 문자', '금식 여부 확인', '우산'].forEach(x => assert.ok(a.includes(x), x));
assert.strictEqual(a.filter(x => x === '신분증').length, 1);
console.log('✓ 병원·검진·비 예보 → 신분증·진료카드·우산');

// 2) 비행기: 국내선 신분증 / 국제선 여권, 기차 승차권, 결혼식 축의금, 추위
assert.ok(Pack.auto({ title: '제주 여행', mode: 'flight', trip: {} }).includes('신분증'));
const intl = Pack.auto({ title: '오사카', mode: 'flight', trip: { international: true } });
assert.ok(intl.includes('여권') && !intl.includes('신분증'));
assert.ok(Pack.auto({ title: '부산 출장', mode: 'train' }).includes('승차권(코레일톡·SRT 앱)'));
assert.ok(Pack.auto({ title: '강남 결혼식', mode: 'car' }).includes('축의금 봉투'));
assert.ok(Pack.auto({ title: '출근', mode: 'car' }, { weather: { kind: 'snow', temp: -3 } }).includes('두꺼운 겉옷·장갑'));
assert.deepStrictEqual(Pack.auto({ title: '출근', mode: 'transit' }, {}), []);
console.log('✓ 비행기(국내·국제)·기차·결혼식·추위');

// 3) 직접 추가·자동 빼기·체크는 날짜별 (반복 일정은 날마다 새로)
const base = { ...hospital };
Pack.addItem(base, '  검사 결과지 ');
Pack.removeItem(base, '금식 여부 확인', true);
Pack.toggle(base, d, '신분증');
let l = Pack.list({ ...base, date: d }, { weather: { kind: 'rain' } });
assert.ok(l.find(x => x.name === '검사 결과지' && !x.auto));
assert.ok(!l.find(x => x.name === '금식 여부 확인'));
assert.ok(l.find(x => x.name === '신분증').done);
assert.ok(!Pack.list({ ...base, date: d2 }, {}).find(x => x.name === '신분증').done);
Pack.toggle(base, d, '신분증');
assert.ok(!Pack.list({ ...base, date: d }, {}).find(x => x.name === '신분증').done);
Pack.addItem(base, '금식 여부 확인'); // 뺐던 자동 항목을 다시 적으면 돌아옴
assert.ok(Pack.list({ ...base, date: d }, {}).find(x => x.name === '금식 여부 확인'));
console.log('✓ 직접 추가 · 자동 항목 빼기 · 날짜별 체크');

// 4) 알림 문구: 안 챙긴 것만, 3개 넘으면 '외 N개'
const line = Pack.line({ ...base, date: d }, { weather: { kind: 'rain' } });
assert.ok(line.startsWith(' 챙길 것: ') && line.includes('외 '));
assert.strictEqual(Pack.line({ title: '출근', mode: 'transit', date: d }, {}), '');
console.log('✓ 알림 문구');
console.log('\n챙길 것 확인 완료');
