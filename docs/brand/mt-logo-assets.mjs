/**
 * MobileTavern asset generator — writes the real files into ~/ST-Fork/public.
 *   cd ~/.cache/logo && node gen6-assets.mjs
 *
 * Outputs
 *   public/img/logo.png              medallion, NO charm (circle-crops cleanly: home hero 56px, login 30px)
 *   public/img/mt-logo-charm.png     medallion + rustic tankard charm (boot screen)
 *   public/img/mt-tankard.png        rustic tankard alone (app icon source)
 *   public/img/apple-icon-*.png      tankard on ink, opaque (ios home screen)
 *   public/favicon.ico               16/32/48 tankard
 */
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FONTS = ['PlayfairDisplay', 'Cinzel', 'Inter'].map((f) => `/data/data/com.termux/files/home/.cache/logo/fonts/${f}.ttf`);
const PUB = '/data/data/com.termux/files/home/ST-Fork/public';
const WORK = '/data/data/com.termux/files/home/.cache/logo/icons';
fs.mkdirSync(WORK, { recursive: true });

const GOLD = '#e8b563';
const CREAM = '#f4ead9';
const AMBER = '#c98a3c';

const WOODDEFS = `
  <defs>
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
    </linearGradient>
  </defs>`;

const RUSTIC = WOODDEFS + `
<g stroke-linecap="round" stroke-linejoin="round">
  <path d="M156 132 C214 126 226 166 208 186 C196 200 176 202 158 196" fill="none" stroke="url(#iron)" stroke-width="17"/>
  <path d="M156 132 C214 126 226 166 208 186 C196 200 176 202 158 196" fill="none" stroke="#8b7f74" stroke-width="4" opacity="0.5"/>
  <rect x="148" y="124" width="16" height="15" rx="4" fill="#3b342f"/>
  <rect x="150" y="189" width="16" height="15" rx="4" fill="#3b342f"/>
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
  <rect x="72" y="120" width="98" height="15" rx="6" fill="url(#iron)"/>
  <rect x="75" y="170" width="92" height="14" rx="6" fill="url(#iron)"/>
  <g fill="#b9a89b" opacity="0.72">
    <circle cx="88" cy="127.5" r="2.7"/><circle cx="121" cy="127.5" r="2.7"/><circle cx="154" cy="127.5" r="2.7"/>
    <circle cx="91" cy="177" r="2.6"/><circle cx="121" cy="177" r="2.6"/><circle cx="151" cy="177" r="2.6"/>
  </g>
  <rect x="70" y="98" width="102" height="16" rx="7" fill="url(#woodLight)" stroke="#3f2617" stroke-width="3.2"/>
  <g fill="url(#foam)" stroke="#d8c9ac" stroke-width="2">
    <path d="M66 96 C50 96 40 87 41 77 C42 66 54 60 66 63 C71 50 87 44 100 51 C109 39 130 39 138 52 C152 46 167 53 170 66 C182 63 193 70 192 81 C191 91 181 98 166 97 Z"/>
    <path d="M97 92 L74 107 Q70 111 79 110 L114 97 Z"/>
  </g>
  <g fill="${AMBER}" opacity="0.9">
    <circle cx="92" cy="79" r="6"/><circle cx="120" cy="73" r="6"/><circle cx="147" cy="80" r="6"/>
  </g>
  <path d="M150 100 C154 108 152 116 147 118 C141 119 139 111 141 103 Z" fill="url(#foam)"/>
</g>`;

const medallion = (b64, { charm = false } = {}) => WOODDEFS + `
<g>
  <defs>
    <clipPath id="mClip"><circle cx="120" cy="120" r="86"/></clipPath>
    <radialGradient id="mWarm" cx="50%" cy="112%" r="72%">
      <stop offset="0%" stop-color="#ffb457" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="#ffb457" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="mVig" cx="50%" cy="45%" r="70%">
      <stop offset="60%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#0d0810" stop-opacity="0.55"/>
    </radialGradient>
  </defs>
  <circle cx="120" cy="120" r="100" fill="#1d1425"/>
  <image href="data:image/png;base64,${b64}" x="-12" y="-8" width="264" height="335" preserveAspectRatio="xMidYMin slice" clip-path="url(#mClip)"/>
  <circle cx="120" cy="120" r="86" fill="url(#mWarm)" clip-path="url(#mClip)"/>
  <circle cx="120" cy="120" r="86" fill="url(#mVig)" clip-path="url(#mClip)"/>
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

const svgWrap = (viewBox, body, { w, h, bg = null }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">
${bg || ''}
${body}
</svg>`;

const raster = (svg, outPath, width) => {
    const png = new Resvg(svg, {
        font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Playfair Display' },
        fitTo: { mode: 'width', value: width },
    }).render().asPng();
    fs.writeFileSync(outPath, png);
    return png.length;
};

const b64 = fs.readFileSync(`${PUB}/img/mascot.png`).toString('base64');

// 1. logo.png — medallion only, square, transparent (drops into the home hero circle + login)
//    viewBox covers the r=104 ring plus its 1.5px stroke bleed (15.25 .. 224.75).
const logoSquare = svgWrap('14.5 14.5 211 211', medallion(b64), { w: 211, h: 211 });
const logoBytes = raster(logoSquare, `${PUB}/img/logo.png`, 512);
fs.writeFileSync(path.join(WORK, 'logo.svg'), logoSquare);

// 2. mt-logo-charm.png — medallion + hanging tankard charm (boot screen)
const logoCharm = svgWrap('14 14 212 267', medallion(b64, { charm: true }), { w: 212, h: 267 });
const charmBytes = raster(logoCharm, `${PUB}/img/mt-logo-charm.png`, 424);
fs.writeFileSync(path.join(WORK, 'logo-charm.svg'), logoCharm);

// visual bbox of the RUSTIC mark including stroke bleed: x 39..234.5, y 38..210.5
// (handle stroke r 8.5 pushes the right edge out; the foam tops out at 38)
const MARK_BBOX = { x: 39, y: 38, w: 195.5, h: 172.5, cx: (39 + 234.5) / 2, cy: (38 + 210.5) / 2 };
const TANKARD_PAD = 18; // tile padding in the 200-unit icon space

// 3. mt-tankard.png — rustic tankard alone, transparent
const tankardOnly = svgWrap('34 32 206 184', RUSTIC, { w: 206, h: 184 });
const tankardBytes = raster(tankardOnly, `${PUB}/img/mt-tankard.png`, 512);

// 4. app icons — tankard on an opaque ink tile. Do NOT nest an inner <svg>: the
//    nested viewBox re-maps the coordinates and the mark lands huge and clipped.
//    Place the mark directly in its own 240-unit space instead.
const ICON_SCALE = ((200 - 2 * TANKARD_PAD) / MARK_BBOX.w).toFixed(4);
const iconSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="tile" cx="42%" cy="26%" r="90%">
      <stop offset="0%" stop-color="#3a2740"/><stop offset="52%" stop-color="#1d1425"/><stop offset="100%" stop-color="#100b16"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" rx="${(200 * 0.22).toFixed(1)}" fill="url(#tile)"/>
  <rect x="2" y="2" width="196" height="196" rx="${(196 * 0.22).toFixed(1)}" fill="none" stroke="${GOLD}" stroke-opacity="0.22" stroke-width="3"/>
  <g transform="translate(100 100) scale(${ICON_SCALE}) translate(${-MARK_BBOX.cx} ${-MARK_BBOX.cy})">${RUSTIC}</g>
</svg>`;

const appleSizes = [57, 72, 114, 144, 192, 512];
const iconFiles = [];
for (const size of appleSizes) {
    const out = `${PUB}/img/apple-icon-${size}x${size}.png`;
    raster(iconSvg(size), out, size);
    iconFiles.push(out);
    console.log(`apple-icon-${size}x${size}.png`);
}

// 5. favicon.ico — PIL downscales from a single 256px render (saving FROM the 16px
//    image would upscale and blur the 32/48 entries).
const favBase = path.join(WORK, 'fav-base.png');
raster(iconSvg(256), favBase, 256);
execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open('${favBase}').convert('RGBA')
im.save('${PUB}/favicon.ico', format='ICO', sizes=[(16,16),(32,32),(48,48)])
print('favicon.ico written')
`]);
raster(iconSvg(512), `${PUB}/img/mt-appicon-512.png`, 512);

console.log('logo.png       ', (logoBytes / 1024).toFixed(0), 'KB');
console.log('logo-charm.png ', (charmBytes / 1024).toFixed(0), 'KB');
console.log('tankard.png    ', (tankardBytes / 1024).toFixed(0), 'KB');
console.log('favicon.ico    ', (fs.statSync(`${PUB}/favicon.ico`).size / 1024).toFixed(0), 'KB');
