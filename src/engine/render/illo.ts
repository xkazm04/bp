// Stylised line art, one per domain (ported from A/1). Used faintly in room headers on the plan, in
// hover cards and in the feature sheet. Colour is passed in so both themes work.

function gear(cx: number, cy: number, r: number, n: number): string {
  let p = '';
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n, rr = i % 2 ? r : r + 7, a2 = a + (Math.PI / n) * 0.5;
    p += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1) + 'L' + (cx + rr * Math.cos(a2)).toFixed(1) + ' ' + (cy + rr * Math.sin(a2)).toFixed(1);
  }
  return '<path d="' + p + 'Z"/><circle cx="' + cx + '" cy="' + cy + '" r="' + r * 0.38 + '"/>';
}

const ILLO: Record<string, string> = {
  IAM: '<circle cx="78" cy="88" r="32"/><circle cx="78" cy="88" r="11"/><path d="M110 82 H206 V94 H110 M176 94 v14 h8 v-8 h8 v12 h8 V94"/><path class="f" d="M60 40 h40 M80 30 v18"/>',
  STU: '<path d="M50 140 V60 H190 V140 Z M40 60 L120 26 L200 60"/><path d="M50 60 q10 12 20 0 q10 12 20 0 q10 12 20 0 q10 12 20 0 q10 12 20 0 q10 12 20 0 q10 12 20 0"/><rect x="104" y="96" width="32" height="44"/><rect x="62" y="88" width="30" height="26"/><rect x="148" y="88" width="30" height="26"/><path class="f" d="M70 46 h100"/>',
  SCH: '<rect x="30" y="40" width="150" height="100"/><path d="M30 60 H180 M67 40 V140 M105 40 V140 M142 40 V140 M30 87 H180 M30 113 H180"/><rect class="s" x="70" y="63" width="32" height="21"/><rect class="s" x="108" y="90" width="31" height="20"/><circle cx="190" cy="48" r="28"/><path d="M190 48 V30 M190 48 L203 56"/>',
  BKG: '<path d="M40 50 H200 V78 a12 12 0 0 0 0 24 V130 H40 V102 a12 12 0 0 0 0 -24 Z"/><path class="f" d="M150 52 V128"/><path d="M70 90 l14 14 l28 -30"/><path class="f" d="M165 70 h22 M165 84 h22 M165 98 h16"/>',
  PAY: '<rect x="30" y="44" width="130" height="84" rx="8"/><path d="M30 64 H160"/><rect x="44" y="82" width="22" height="16" rx="2"/><path class="f" d="M44 112 h60"/><ellipse cx="190" cy="120" rx="26" ry="8"/><path d="M164 120 v-10 M216 120 v-10"/><ellipse cx="190" cy="110" rx="26" ry="8"/><path d="M164 110 v-10 M216 110 v-10"/><ellipse cx="190" cy="100" rx="26" ry="8"/>',
  MEM: '<rect x="88" y="16" width="66" height="128" rx="10"/><rect x="95" y="30" width="52" height="96"/><path d="M112 136 h18"/><path class="f" d="M101 44 h40 M101 58 h30 M101 72 h40 M101 86 h24"/><rect class="s" x="101" y="98" width="40" height="16"/><path d="M40 70 q20 -20 40 0 M180 70 q20 -20 40 0" opacity=".6"/>',
  INS: '<circle cx="110" cy="92" r="44"/><circle cx="110" cy="92" r="36"/><path d="M104 40 h12 v8 h-12z M110 92 L110 64 M110 92 L130 102"/><path d="M146 54 l8 -8"/><path class="f" d="M110 50 v6 M110 128 v6 M68 92 h6 M146 92 h6"/><path d="M170 120 q20 -6 34 6 q-6 16 -24 10 z"/>',
  COM: '<rect x="34" y="50" width="140" height="90"/><path d="M34 50 L104 102 L174 50 M34 140 L88 92 M174 140 L120 92"/><path d="M150 30 h66 v40 h-40 l-14 12 v-12 h-12 z"/><path class="f" d="M162 44 h42 M162 56 h30"/>',
  GRO: '<path d="M80 140 H160 L170 104 H70 Z"/><path d="M120 104 V50"/><path d="M120 76 q-34 -2 -40 -30 q34 0 40 30 M120 62 q30 -4 38 -30 q-32 2 -38 30"/><path class="f" d="M180 120 L210 60 M210 60 l-10 4 M210 60 l2 10"/>',
  ANA: '<path d="M36 26 V140 H210"/><rect x="56" y="100" width="20" height="40"/><rect x="88" y="80" width="20" height="60"/><rect x="120" y="90" width="20" height="50"/><rect class="s" x="152" y="56" width="20" height="84"/><path d="M50 96 L90 66 L130 78 L180 36" class="f"/><circle cx="180" cy="36" r="4"/>',
  INT: '<rect x="54" y="62" width="56" height="44" rx="6"/><path d="M110 74 h22 M110 94 h22 M54 84 H40 q-20 0 -20 30 V140"/><rect x="150" y="56" width="50" height="56" rx="6"/><path d="M150 72 h-10 M150 96 h-10"/><path class="f" d="M175 56 V36 M175 112 v20"/>',
  AIA: '<path d="M110 30 Q116 76 156 84 Q116 92 110 138 Q104 92 64 84 Q104 76 110 30 Z"/><path d="M176 40 q3 12 12 14 q-9 2 -12 14 q-3 -12 -12 -14 q9 -2 12 -14z"/><path d="M52 116 q2 8 8 10 q-6 2 -8 10 q-2 -8 -8 -10 q6 -2 8 -10z"/><ellipse class="f" cx="110" cy="84" rx="92" ry="36"/>',
  PLT: gear(96, 70, 30, 10) + gear(158, 92, 18, 8) + '<path d="M28 132 H212 M28 132 v14 h184 v-14"/><path class="f" d="M40 146 l10 -14 M60 146 l10 -14 M80 146 l10 -14 M100 146 l10 -14 M120 146 l10 -14 M140 146 l10 -14 M160 146 l10 -14 M180 146 l10 -14 M200 146 l10 -14"/>',
};

export function illoSVG(base: string, col: string, sw = 1.7): string {
  const inner = (ILLO[base] || ILLO.PLT)
    .replace(/class="f"/g, 'stroke-width="1" stroke-dasharray="3 3" opacity=".7"')
    .replace(/class="s"/g, 'fill="' + col + '" fill-opacity=".25"');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160"><g fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">' + inner + '</g><path d="M14 150 H226 M14 146 v8 M226 146 v8" stroke="' + col + '" stroke-width=".7" opacity=".5"/></svg>';
}

export const ILLO_KEYS = Object.keys(ILLO);

/** Raster images of the art in one colour, for the canvas. `onload` asks for a redraw. */
export function loadArt(col: string, onload: () => void): Record<string, HTMLImageElement> {
  const out: Record<string, HTMLImageElement> = {};
  for (const k of ILLO_KEYS) {
    const im = new Image();
    im.onload = onload;
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(illoSVG(k, col, 3));
    out[k] = im;
  }
  return out;
}
