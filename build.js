// 웹 파일을 www 폴더로 복사 (Capacitor가 앱에 넣는 폴더) — 버디플래너와 같은 방식
const fs = require('fs');
const path = require('path');

const src = __dirname;
const dest = path.join(__dirname, 'www');
const include = ['index.html', 'privacy.html', 'terms.html', 'autonav-guide.html', 'manifest.json', 'sw.js', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'css', 'js', 'img', 'fonts'];
const skip = ['config.example.js'];

if (!fs.existsSync(path.join(src, 'js', 'config.js'))) {
  console.warn('⚠️  js/config.js가 없습니다. js/defaults.js의 서버 함수로 검색·경로를 조회합니다.');
}

function copy(from, to) {
  if (skip.includes(path.basename(from))) return;
  const st = fs.statSync(from);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(f => copy(path.join(from, f), path.join(to, f)));
  } else fs.copyFileSync(from, to);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest);
include.forEach(item => { if (fs.existsSync(path.join(src, item))) copy(path.join(src, item), path.join(dest, item)); });
console.log('✅ www 폴더 준비 완료');
