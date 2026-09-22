#!/usr/bin/env node
/**
 * One-time / resumable builder for photo-seed.json.
 *
 * Queries the Unsplash Search API once per built-in dictionary word and
 * saves the result (photo url + attribution) into photo-seed.json at the
 * repo root, so every visitor gets a shared, pre-picked photo for common
 * answers without spending their own rate limit or needing a key at all.
 * The image itself is never downloaded/stored -- only its Unsplash CDN
 * url and attribution metadata are saved, so this stays within Unsplash's
 * hotlinking rules (photos are always served live from images.unsplash.com).
 *
 * Usage:
 *   UNSPLASH_ACCESS_KEY=your_access_key node scripts/build-photo-seed.js
 *
 * Safe to re-run: words already present in photo-seed.json are skipped,
 * so if you hit Unsplash's demo-tier rate limit (50 req/hour) partway
 * through, wait about an hour and run the same command again to pick up
 * where it left off.
 *
 * Requires Node 18+ (uses the built-in fetch).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
if (!ACCESS_KEY) {
  console.error(
    'Set UNSPLASH_ACCESS_KEY first, e.g.:\n' +
    '  UNSPLASH_ACCESS_KEY=your_access_key node scripts/build-photo-seed.js'
  );
  process.exit(1);
}

const OUT_PATH = path.join(__dirname, '..', 'photo-seed.json');

// Keep this in sync with KO_EN_MAP in index.html.
const KO_EN_MAP = {
  // flowers
  '장미': 'rose', '해바라기': 'sunflower', '튤립': 'tulip', '벚꽃': 'cherry blossom',
  '코스모스': 'cosmos flower', '국화': 'chrysanthemum', '백합': 'lily', '데이지': 'daisy',
  '라벤더': 'lavender', '수국': 'hydrangea', '민들레': 'dandelion', '카네이션': 'carnation',
  '무궁화': 'hibiscus', '난초': 'orchid', '목련': 'magnolia', '진달래': 'azalea',
  // colors
  '빨강': 'red', '빨간색': 'red', '파랑': 'blue', '파란색': 'blue', '노랑': 'yellow',
  '노란색': 'yellow', '초록': 'green', '초록색': 'green', '보라': 'purple', '보라색': 'purple',
  '분홍': 'pink', '분홍색': 'pink', '주황': 'orange', '주황색': 'orange', '하양': 'white',
  '하얀색': 'white', '검정': 'black', '검은색': 'black', '회색': 'gray', '갈색': 'brown',
  '하늘색': 'sky blue', '민트': 'mint green', '금색': 'gold', '은색': 'silver', '베이지': 'beige',
  // weather
  '맑음': 'sunny sky', '흐림': 'cloudy sky', '비': 'rainy day', '눈': 'snowy day',
  '바람': 'windy', '폭풍': 'storm', '안개': 'foggy', '무지개': 'rainbow',
  '포근함': 'warm weather', '화창함': 'sunny weather', '쌀쌀함': 'chilly weather', '따뜻함': 'warm sunlight',
  // foods
  '라면': 'ramen', '김치': 'kimchi', '떡볶이': 'tteokbokki', '피자': 'pizza',
  '치킨': 'fried chicken', '초콜릿': 'chocolate', '아이스크림': 'ice cream', '커피': 'coffee',
  '케이크': 'cake', '빵': 'bread', '과일': 'fruit', '수박': 'watermelon', '딸기': 'strawberry',
  '포도': 'grapes', '사과': 'apple', '바나나': 'banana', '파스타': 'pasta', '초밥': 'sushi',
  '삼겹살': 'grilled pork belly', '떡': 'rice cake',
  // animals
  '강아지': 'puppy', '고양이': 'cat', '토끼': 'rabbit', '곰': 'bear', '사자': 'lion',
  '호랑이': 'tiger', '여우': 'fox', '판다': 'panda', '다람쥐': 'squirrel', '고래': 'whale',
  '돌고래': 'dolphin', '부엉이': 'owl', '나비': 'butterfly', '공룡': 'dinosaur', '사슴': 'deer',
  '펭귄': 'penguin', '코알라': 'koala', '늑대': 'wolf', '거북이': 'turtle', '햄스터': 'hamster',
  // traits / feelings
  '다정함': 'kindness', '성실함': 'diligence', '긍정적': 'positivity', '게으름': 'laziness',
  '예민함': 'sensitivity', '소심함': 'shyness', '자유로움': 'freedom', '따뜻함': 'warmth',
  '행복': 'happiness', '평온함': 'calm', '설렘': 'excitement', '그리움': 'longing',
  '편안함': 'comfort', '신비로움': 'mystery', '몽환적': 'dreamy', '솔직함': 'honesty',
};

const WORDS = Object.keys(KO_EN_MAP);

function withReferral(href) {
  try {
    const u = new URL(href);
    if (!u.searchParams.has('utm_source')) u.searchParams.set('utm_source', 'nine_pieces_of_me');
    if (!u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'referral');
    return u.toString();
  } catch { return href; }
}

function loadExisting() {
  try { return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8')); } catch { return {}; }
}

function save(seed) {
  const ordered = {};
  for (const w of WORDS) if (seed[w]) ordered[w] = seed[w];
  fs.writeFileSync(OUT_PATH, JSON.stringify(ordered, null, 2) + '\n');
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchOne(word) {
  const enWord = KO_EN_MAP[word];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(enWord)}&per_page=1&orientation=squarish`;
  const res = await fetch(url, { headers: { Authorization: `Client-ID ${ACCESS_KEY}` } });
  if (res.status === 403) {
    const err = new Error('rate_limited');
    err.rateLimited = true;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for "${word}"`);
  const data = await res.json();
  const pick = data.results && data.results[0];
  if (!pick) return null;
  return {
    kind: 'photo',
    url: pick.urls.small,
    credit: `Photo by ${pick.user.name} on Unsplash`,
    creditHref: withReferral(pick.user.links.html),
    unsplashHref: withReferral('https://unsplash.com/?utm_source=nine_pieces_of_me&utm_medium=referral'),
    downloadLocation: (pick.links && pick.links.download_location) || null,
  };
}

async function main() {
  const seed = loadExisting();
  const todo = WORDS.filter((w) => !seed[w]);
  console.log(`${WORDS.length} words total, ${WORDS.length - todo.length} already seeded, ${todo.length} to fetch.`);
  if (!todo.length) {
    console.log('Nothing to do -- photo-seed.json is already complete.');
    return;
  }

  let fetched = 0;
  for (const word of todo) {
    try {
      const result = await fetchOne(word);
      if (result) {
        seed[word] = result;
        fetched++;
        console.log(`  ✓ ${word} -> ${KO_EN_MAP[word]}`);
      } else {
        console.log(`  · ${word}: no result, skipping`);
      }
      save(seed);
      await sleep(300);
    } catch (e) {
      if (e.rateLimited) {
        console.log(`\nHit Unsplash's rate limit after ${fetched} new word(s) this run.`);
        console.log(`${todo.length - fetched} word(s) left. Wait about an hour, then re-run the same command.`);
        break;
      }
      console.warn(`  ! ${word}: ${e.message} -- skipping for now`);
    }
  }
  save(seed);
  console.log(`\nSaved ${path.relative(process.cwd(), OUT_PATH)} (${Object.keys(seed).length}/${WORDS.length} words).`);
}

main();
