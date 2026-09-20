/**
 * MobileTavern logo v5 — refined rustic tankard (proper mug handle), medallion
 * charm, barrel-hoop Momo, and two honest boot-screen layouts drawn at real
 * CSS pixel scale (390×844).
 *   cd ~/.cache/logo && node gen5.mjs
 */
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const FONTS = ['PlayfairDisplay', 'Cinzel', 'Inter'].map((f) => `/data/data/com.termux/files/home/.cache/logo/fonts/${f}.ttf`);
const OUT = '/data/data/com.termux/files/home/.cache/logo/out';
const GOLD = '#e8b563';
const CREAM = '#f4ead9';
const AMBER = '#c98a3c';

const render = (svg, file, width) => {
    const png = new Resvg(svg, {
        font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Playfair Display' },
        fitTo: { mode: 'width', value: width },
    }).render().asPng();
    fs.writeFileSync(path.join(OUT, file), png);
    console.log(file, '->', (png.length / 1024).toFixed(0) + ' KB');
};

const WOODDEFS = `
  <linearGradient id="wood" x1="0" y1="0" x2="1" y2="0.2">
    <stop offset="0%" stop-color="#6d4227"/><stop offset="35%" stop-color="#9a6540"/>
    <stop offset="65%" stop-color="#84532f"/><stop offset="100%" stop-color="#5d371f"/>
  </linearGradient>
  <linearGradient id="woodLight" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#a9714a"/><stop offset="100%" stop-color="#7c4c2c"/>
  </linearGradient>
  <linearGradient id="iron" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#6f645b"/><stop offset="45%" stop-color="#4a423c"/>
    <stop offset="100%" stop-color="#332d29"/>
  </linearGradient>
  <linearGradient id="foam" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#fff8ea"/><stop offset="100%" stop-color="#eadfc8"/>
  </linearGradient>`;

// ---------------------------------------------------- rustic tankard (v2)
const RUSTIC = `
<g stroke-linecap="round" stroke-linejoin="round">
  <!-- chunky wrought-iron handle -->
  <path d="M156 132 C214 126 226 166 208 186 C196 200 176 202 158 196" fill="none" stroke="url(#iron)" stroke-width="17"/>
  <path d="M156 132 C214 126 226 166 208 186 C196 200 176 202 158 196" fill="none" stroke="#8b7f74" stroke-width="4" opacity="0.5"/>
  <rect x="148" y="124" width="16" height="15" rx="4" fill="#3b342f"/>
  <rect x="150" y="189" width="16" height="15" rx="4" fill="#3b342f"/>
  <!-- staves -->
  <path d="M76 104 L164 104 L157 194 Q155 205 145 205 L95 205 Q85 205 83 194 Z" fill="url(#wood)"/>
  <g stroke="#4d2f1c" stroke-width="2.2" opacity="0.5" fill="none">
    <path d="M104 106 L107 203"/><path d="M136 106 L133 203"/>
  </g>
  <g stroke="#4d2f1c" stroke-width="1.6" opacity="0.28" fill="none">
    <path d="M92 122 C98 131 90 141 96 151"/><path d="M121 118 C127 128 119 138 125 148"/>
    <path d="M146 126 C152 134 144 144 150 154"/><path d="M97 166 C103 174 95 182 101 190"/>
    <path d="M141 168 C147 176 139 184 145 192"/>
  </g>
  <path d="M76 104 L164 104 L157 194 Q155 205 145 205 L95 205 Q85 205 83 194 Z" fill="none" stroke="#3f2617" stroke-width="3.6"/>
  <!-- hoops -->
  <rect x="72" y="120" width="98" height="15" rx="6" fill="url(#iron)"/>
  <rect x="75" y="170" width="92" height="14" rx="6" fill="url(#iron)"/>
  <g fill="#b9a89b" opacity="0.72">
    <circle cx="88" cy="127.5" r="2.7"/><circle cx="121" cy="127.5" r="2.7"/><circle cx="154" cy="127.5" r="2.7"/>
    <circle cx="91" cy="177" r="2.6"/><circle cx="121" cy="177" r="2.6"/><circle cx="151" cy="177" r="2.6"/>
  </g>
  <!-- rim -->
  <rect x="70" y="98" width="102" height="16" rx="7" fill="url(#woodLight)" stroke="#3f2617" stroke-width="3.2"/>
  <!-- foamy head doubling as a speech bubble -->
  <g fill="url(#foam)" stroke="#d8c9ac" stroke-width="2">
    <path d="M66 96 C50 96 40 87 41 77 C42 66 54 60 66 63 C71 50 87 44 100 51 C109 39 130 39 138 52 C152 46 167 53 170 66 C182 63 193 70 192 81 C191 91 181 98 166 97 Z"/>
    <path d="M95 92 L70 116 L118 95 Z"/>
  </g>
  <g fill="${AMBER}" opacity="0.9">
    <circle cx="92" cy="79" r="6"/><circle cx="120" cy="73" r="6"/><circle cx="147" cy="80" r="6"/>
  </g>
  <path d="M150 100 C154 108 152 116 147 118 C141 119 139 111 141 103 Z" fill="url(#foam)"/>
</g>`;

// ------------------------------------------- Momo medallion (+ optional charm)
const medallion = (b64, { charm = false, p = 'mc' } = {}) => `
<g>
  <defs>
    <clipPath id="${p}Clip"><circle cx="120" cy="120" r="86"/></clipPath>
    <radialGradient id="${p}Warm" cx="50%" cy="112%" r="72%">
      <stop offset="0%" stop-color="#ffb457" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#ffb457" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${p}Vig" cx="50%" cy="45%" r="70%">
      <stop offset="60%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#0d0810" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <circle cx="120" cy="120" r="100" fill="#1d1425"/>
  <image href="data:image/png;base64,${b64}" x="-12" y="-8" width="264" height="335" preserveAspectRatio="xMidYMin slice" clip-path="url(#${p}Clip)"/>
  <circle cx="120" cy="120" r="86" fill="url(#${p}Warm)" clip-path="url(#${p}Clip)"/>
  <circle cx="120" cy="120" r="86" fill="url(#${p}Vig)" clip-path="url(#${p}Clip)"/>
  <circle cx="120" cy="120" r="86" fill="none" stroke="${GOLD}" stroke-width="7"/>
  <circle cx="120" cy="120" r="96" fill="none" stroke="${GOLD}" stroke-width="3" opacity="0.7"/>
  <circle cx="120" cy="120" r="104" fill="none" stroke="${GOLD}" stroke-width="1.5" opacity="0.4"/>
  ${charm ? `
  <g transform="translate(148 200)">
    <circle cx="11" cy="4" r="4.6" fill="none" stroke="#6f645b" stroke-width="3.2"/>
    <path d="M11 9 L11 16" stroke="#6f645b" stroke-width="3.2"/>
    <g transform="translate(11 42) scale(0.31) translate(-120 -120)">${RUSTIC}</g>
  </g>` : ''}
</g>`;

// ------------------------------------------------ barrel-hoop Momo (rustic)
const barrelMomo = (b64) => `
<g>
  <defs>
    <clipPath id="bmClip"><circle cx="120" cy="120" r="78"/></clipPath>
    <radialGradient id="bmWarm" cx="50%" cy="112%" r="72%">
      <stop offset="0%" stop-color="#ffb457" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#ffb457" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="120" cy="120" r="104" fill="url(#wood)"/>
  <g stroke="#4d2f1c" stroke-width="2" opacity="0.42" fill="none">
    <path d="M120 16 L120 224"/><path d="M80 24 L86 216"/><path d="M160 24 L154 216"/>
  </g>
  <circle cx="120" cy="120" r="104" fill="none" stroke="#3f2617" stroke-width="4"/>
  <circle cx="120" cy="120" r="101" fill="none" stroke="url(#iron)" stroke-width="14"/>
  <g fill="#b9a89b" opacity="0.68">
    <circle cx="120" cy="21" r="3"/><circle cx="178" cy="50" r="3"/><circle cx="62" cy="50" r="3"/>
    <circle cx="199" cy="120" r="3"/><circle cx="41" cy="120" r="3"/>
    <circle cx="178" cy="190" r="3"/><circle cx="62" cy="190" r="3"/><circle cx="120" cy="219" r="3"/>
  </g>
  <circle cx="120" cy="120" r="92" fill="#1d1425"/>
  <image href="data:image/png;base64,${b64}" x="-10" y="-6" width="260" height="330" preserveAspectRatio="xMidYMin slice" clip-path="url(#bmClip)"/>
  <circle cx="120" cy="120" r="78" fill="url(#bmWarm)" clip-path="url(#bmClip)"/>
  <circle cx="120" cy="120" r="78" fill="none" stroke="${GOLD}" stroke-width="5"/>
  <circle cx="120" cy="120" r="85" fill="none" stroke="${GOLD}" stroke-width="2" opacity="0.5"/>
</g>`;

const BG = `
<defs>
  <radialGradient id="bg" cx="40%" cy="26%" r="88%">
    <stop offset="0%" stop-color="#2e2036"/><stop offset="55%" stop-color="#1a1220"/><stop offset="100%" stop-color="#0f0b14"/>
  </radialGradient>
</defs>`;

const b64 = fs.readFileSync('/data/data/com.termux/files/home/ST-Fork/public/img/mascot.png').toString('base64');
const marks = {
    rustic: WOODDEFS + RUSTIC,
    momoCharm: WOODDEFS + medallion(b64, { charm: true, p: 'a' }),
    barrel: WOODDEFS + barrelMomo(b64),
    momoClean: WOODDEFS + medallion(b64, { charm: false, p: 'c' }),
};

// ------------------------------------------------------------- sheet
const cols = [
    ['rustic tankard', marks.rustic],
    ['Momo + tankard charm', marks.momoCharm],
    ['barrel-hoop Momo', marks.barrel],
];
const colW = 540;
let body = '';
cols.forEach(([label, mark], i) => {
    const x = 70 + i * colW;
    body += `
  <g transform="translate(${x} 96) scale(1.02)">${mark}</g>
  <text x="${x}" y="418" font-family="Inter" font-size="21" fill="${GOLD}" opacity="0.85" letter-spacing="1.4">${label}</text>
  <g transform="translate(${x} 448) scale(0.28)">${mark}</g>
  <g transform="translate(${x + 96} 468) scale(0.175)">${mark}</g>
  <g transform="translate(${x + 158} 482) scale(0.09)">${mark}</g>
  <g font-family="Playfair Display">
    <text x="${x}" y="628" font-size="52" font-weight="800" fill="${CREAM}">Mobile</text>
    <text x="${x}" y="686" font-size="52" font-weight="800" font-style="italic" fill="${GOLD}">Tavern</text>
  </g>
  <text x="${x + 3}" y="724" font-family="Inter" font-size="19" fill="${CREAM}" opacity="0.62">Your stories are waiting.</text>
  <line x1="${x - 16}" y1="782" x2="${x + 460}" y2="782" stroke="${GOLD}" stroke-opacity="0.14" stroke-width="1"/>`;
});
const sheet = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1740" height="880" viewBox="0 0 1740 880">
${BG}
<rect width="1740" height="880" rx="30" fill="url(#bg)"/>
<rect x="1" y="1" width="1738" height="878" rx="29" fill="none" stroke="${GOLD}" stroke-opacity="0.15"/>
<text x="70" y="52" font-family="Inter" font-size="19" fill="${CREAM}" opacity="0.45" letter-spacing="2.6">MOBILETAVERN — RUSTIC PASS v2</text>
${body}
</svg>`;

// --------------------------------------------------- boot screen at 1:1 CSS px
const PHONE_DEFS = `
<defs>
  <radialGradient id="screen" cx="50%" cy="20%" r="85%">
    <stop offset="0%" stop-color="#3a2740"/><stop offset="45%" stop-color="#1d1425"/><stop offset="100%" stop-color="#0d0912"/>
  </radialGradient>
  <radialGradient id="lantern" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#ffb457" stop-opacity="0.32"/>
    <stop offset="70%" stop-color="#ffb457" stop-opacity="0.06"/>
    <stop offset="100%" stop-color="#ffb457" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${GOLD}" stop-opacity="0.15"/>
    <stop offset="42%" stop-color="${GOLD}" stop-opacity="0.9"/>
    <stop offset="62%" stop-color="#ffe0a8" stop-opacity="1"/>
    <stop offset="100%" stop-color="${GOLD}" stop-opacity="0.15"/>
  </linearGradient>
  <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#0d0912" stop-opacity="0"/>
    <stop offset="100%" stop-color="#0b0710" stop-opacity="0.8"/>
  </linearGradient>
  <clipPath id="sc"><rect x="14" y="14" width="390" height="844" rx="30"/></clipPath>
</defs>`;

const phone = (x, y, content, label) => `
<text x="${x}" y="${y - 16}" font-family="Inter" font-size="19" fill="${CREAM}" opacity="0.5" letter-spacing="2.2">${label}</text>
<g transform="translate(${x} ${y})">
  <rect x="12" y="12" width="394" height="848" rx="32" fill="none" stroke="${GOLD}" stroke-opacity="0.25" stroke-width="2"/>
  <g clip-path="url(#sc)">
    <rect x="14" y="14" width="390" height="844" fill="url(#screen)"/>
    ${content}
  </g>
  <rect x="14" y="14" width="390" height="844" rx="30" fill="none" stroke="${GOLD}" stroke-opacity="0.2" stroke-width="1.5"/>
</g>`;

// content drawn in CSS px relative to the phone's top-left (0,0 = screen origin)
const blockClean = `
  <ellipse cx="209" cy="250" rx="175" ry="185" fill="url(#lantern)"/>
  <g transform="translate(209 232) scale(0.62) translate(-120 -120)">${marks.momoCharm}</g>
  <g font-family="Playfair Display" text-anchor="middle">
    <text x="209" y="412" font-size="31" font-weight="800" fill="${CREAM}">Mobile<tspan font-style="italic" fill="${GOLD}">Tavern</tspan></text>
  </g>
  <text x="209" y="436" font-family="Inter" font-size="13" fill="${CREAM}" opacity="0.7" text-anchor="middle">Your stories are waiting.</text>
  <text x="209" y="500" font-family="Inter" font-size="13" fill="${GOLD}" text-anchor="middle" letter-spacing="0.4">Warming the hearth…</text>
  <rect x="139" y="514" width="140" height="3.4" rx="2" fill="${GOLD}" opacity="0.15"/>
  <rect x="139" y="514" width="74" height="3.4" rx="2" fill="url(#bar)"/>
  <text x="209" y="544" font-family="Inter" font-size="10" fill="${CREAM}" opacity="0.3" text-anchor="middle" letter-spacing="0.8">first run takes a few minutes</text>`;

const blockMomo = `
  <ellipse cx="209" cy="196" rx="175" ry="175" fill="url(#lantern)"/>
  <g transform="translate(209 178) scale(0.55) translate(-120 -120)">${marks.momoCharm}</g>
  <g font-family="Playfair Display" text-anchor="middle">
    <text x="209" y="338" font-size="28" font-weight="800" fill="${CREAM}">Mobile<tspan font-style="italic" fill="${GOLD}">Tavern</tspan></text>
  </g>
  <text x="209" y="360" font-family="Inter" font-size="12.5" fill="${CREAM}" opacity="0.7" text-anchor="middle">Your stories are waiting.</text>
  <text x="209" y="410" font-family="Inter" font-size="12.5" fill="${GOLD}" text-anchor="middle" letter-spacing="0.4">Warming the hearth…</text>
  <rect x="139" y="424" width="140" height="3.4" rx="2" fill="${GOLD}" opacity="0.15"/>
  <rect x="139" y="424" width="74" height="3.4" rx="2" fill="url(#bar)"/>
  <image href="data:image/png;base64,${b64}" x="86" y="512" width="246" height="373" preserveAspectRatio="xMidYMin slice"/>
  <rect x="14" y="700" width="390" height="158" fill="url(#floor)"/>`;

const splashOptions = () => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="920" viewBox="0 0 900 920">
${BG}
${PHONE_DEFS}
<rect width="900" height="920" rx="28" fill="url(#bg)"/>
<rect x="1" y="1" width="898" height="918" rx="27" fill="none" stroke="${GOLD}" stroke-opacity="0.14"/>
<text x="34" y="42" font-family="Inter" font-size="18" fill="${CREAM}" opacity="0.45" letter-spacing="2.4">BOOT SCREEN — DRAWN AT REAL CSS PIXELS (390 × 844)</text>
${phone(30, 78, blockClean, 'A · CLEAN')}
${phone(470, 78, blockMomo, 'B · WITH MOMO AT THE BAR')}
</svg>`;

render(sheet(), 'hero-rustic2.png', 1740);
render(splashOptions(), 'boot-options.png', 1500);
fs.writeFileSync(path.join(OUT, 'mark-rustic.svg'), RUSTIC);
