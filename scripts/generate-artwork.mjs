import { mkdirSync, writeFileSync } from "node:fs";
// Original, deterministic vector studies. These are project artwork, not audio analysis.
const out = new URL("../src/assets/artwork/", import.meta.url);
mkdirSync(out, { recursive: true });
const f = (n) => Number(n.toFixed(2));
const circle = (x, y, r, fill, extra = "") =>
  `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${fill}" ${extra}/>`;
const path = (d, stroke, width = 1, extra = "") =>
  `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" ${extra}/>`;
const line = (x, y, x2, y2, c, w = 1, extra = "") =>
  path(`M${f(x)} ${f(y)}L${f(x2)} ${f(y2)}`, c, w, extra);
const rect = (x, y, w, h, c, extra = "") =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${c}" ${extra}/>`;
function frame(id, label, bg, ink, content, width = 1600, height = 1000) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".11"/></feComponentTransfer></filter><clipPath id="crop"><rect width="${width}" height="${height}"/></clipPath></defs>${rect(0, 0, width, height, bg)}<g clip-path="url(#crop)">${content}</g><rect width="${width}" height="${height}" opacity=".3" filter="url(#grain)"/><g fill="${ink}" font-family="monospace" font-size="22" letter-spacing="3"><text x="54" y="65">WSA / ${id}</text><text x="${width - 54}" y="65" text-anchor="end">${label}</text></g>${line(54, height - 66, width - 54, height - 66, ink, 1, 'opacity=".4"')}<g fill="${ink}" font-family="monospace" font-size="18" letter-spacing="2"><text x="54" y="${height - 32}">GENERATIVE SCORE / ORIGINAL ARTWORK</text><text x="${width - 54}" y="${height - 32}" text-anchor="end">WING SOUND ACADEMY</text></g></svg>`;
}
// P00 — a short motif, repeated with omissions and small changes.
let p00 = "";
for (let row = 0; row < 4; row++)
  for (let col = 0; col < 5; col++) {
    const x = 125 + col * 330,
      y = 220 + row * 175;
    const missing = (row === 1 && col === 3) || (row === 3 && col === 1);
    const d = `M${x - 110} ${y + 26}C${x - 58} ${y + 26} ${x - 65} ${y - 57} ${x} ${y - 57}S${x + 62} ${y + 26} ${x + 116} ${y + 26}`;
    if (!missing)
      p00 += path(
        d,
        col === row ? "#174bfa" : "#252e2b",
        23,
        'stroke-linecap="butt"',
      );
    p00 += path(
      `M${x - 110} ${y + 52}L${x + 116} ${y + 52}`,
      "#252e2b",
      1,
      'opacity=".25"',
    );
    p00 += rect(x + 101, y - 74, 6, 11, "#a13e23");
  }
p00 += rect(1120, 590, 310, 110, "#ede7dc");
p00 += line(1160, 640, 1405, 640, "#174bfa", 24);
writeFileSync(
  new URL("P00.svg", out),
  frame("P00", "MOTIF / REPEAT", "#ede7dc", "#282c2a", p00),
);
// P01 — phase rotation, concentric sequences and a displaced pulse.
let p01 = "";
for (let i = 0; i < 32; i++) {
  const r = 65 + i * 15,
    start = (i % 5) * 0.22,
    end = Math.PI * (1.25 + (i % 7) * 0.08);
  const x = 855 + Math.cos(start) * r,
    y = 510 + Math.sin(start) * r;
  p01 += path(
    `M${f(x)} ${f(y)}A${r} ${r} 0 1 1 ${f(855 + Math.cos(end) * r)} ${f(510 + Math.sin(end) * r)}`,
    i % 5 === 0 ? "#dae1dc" : "#637d9a",
    i % 5 === 0 ? 3 : 1,
    'opacity=".8"',
  );
}
for (let i = 0; i < 64; i++) {
  const a = (i / 64) * Math.PI * 2,
    r = 375 + (i % 4) * 16,
    x = 855 + Math.cos(a) * r,
    y = 510 + Math.sin(a) * r;
  p01 += circle(
    x,
    y,
    i % 4 === 0 ? 11 : 3,
    i % 4 === 0 ? "#e9a068" : "#dee4e3",
  );
}
for (let r = 0; r < 4; r++)
  for (let c = 0; c < 12; c++)
    p01 += rect(
      85 + c * 37,
      310 + r * 41,
      24,
      24,
      (c + r * 3) % 5 === 0
        ? "#e9a068"
        : (c + r) % 3 === 0
          ? "#174bfa"
          : "#303f50",
    );
p01 +=
  line(85, 625, 510, 625, "#e9a068", 4) + line(85, 640, 300, 640, "#a1b1bf", 1);
writeFileSync(
  new URL("P01.svg", out),
  frame("P01", "PHASE / SEQUENCE", "#142335", "#dae1dc", p01),
);
// P02 — a spectral material changing from a regular mesh to granular dispersion.
let p02 = "";
for (let i = 0; i < 65; i++) {
  const y = 100 + i * 13;
  p02 += path(
    `M-100 ${y}C300 ${y - 130} 420 ${y + 190} 780 ${y + 25}S1210 ${y - 170} 1720 ${y + 120}`,
    "#476456",
    i % 7 === 0 ? 2.3 : 0.7,
    `opacity="${i % 7 === 0 ? 0.7 : 0.28}"`,
  );
}
for (let row = 0; row < 34; row++)
  for (let col = 0; col < 60; col++) {
    const x = 90 + col * 24,
      y = 120 + row * 23;
    const phase = Math.sin(col * 0.17 + row * 0.27),
      density = Math.sin(col * 0.11 - row * 0.19);
    if (density > -0.15)
      p02 += circle(
        x + phase * 22,
        y + Math.sin(col * 0.3) * 42,
        1.5 + (density + 1) * 2.2,
        col < 32 ? "#233d33" : "#b24c27",
        `opacity="${0.4 + (phase + 1) * 0.25}"`,
      );
  }
p02 += `<g transform="translate(890 485) rotate(-22)">${rect(-110, -310, 220, 620, "#d9e966", 'opacity=".9"')}${line(-98, -298, 98, 298, "#233d33", 1)}${line(98, -298, -98, 298, "#233d33", 1)}</g>`;
writeFileSync(
  new URL("P02.svg", out),
  frame("P02", "MATTER / TRANSFORM", "#dbe4d9", "#233d33", p02),
);
// P03 — layered musical lines, interruptions and a long-form score.
let p03 =
  rect(1040, 110, 335, 740, "#d8d8ce") + rect(165, 440, 450, 316, "#d0d8db");
for (let band = 0; band < 4; band++) {
  for (let i = 0; i < 24; i++) {
    const y = 150 + band * 170 + i * 4.8;
    const d = `M-100 ${f(y)} C180 ${f(y - 220)} 260 ${f(y + 235)} 490 ${f(y + 35)} S810 ${f(y - 160)} 1010 ${f(y + 90)} S1390 ${f(y + 280 - band * 60)} 1710 ${f(y - 140)}`;
    p03 += path(
      d,
      band === 1 ? "#174bfa" : band === 2 ? "#9d492e" : "#2a3a35",
      i % 8 === 0 ? 2.8 : 1.1,
      'opacity=".8"',
    );
  }
}
for (let i = 0; i < 17; i++) {
  const x = 110 + i * 85;
  p03 += line(x, 108, x, 851, "#2a3a35", 0.7, 'opacity=".28"');
  p03 += rect(x, 790 - (i % 5) * 19, 6, 8, "#174bfa");
}
p03 +=
  circle(1135, 309, 64, "#edeae0") +
  circle(1135, 309, 48, "none", 'stroke="#9d492e" stroke-width="2"');
writeFileSync(
  new URL("P03.svg", out),
  frame("P03", "LAYERS / LONG FORM", "#edeae0", "#2a3a35", p03),
);
// P04 — an open score: a frame with multiple possible planes and no closed centre.
let p04 = "";
for (let i = 0; i < 40; i++) {
  const inset = i * 8;
  p04 += path(
    `M${170 + inset} ${150 + inset * 0.35}L${1360 - inset * 0.4} ${155 + inset * 0.1}L${1290 - inset * 0.6} ${820 - inset * 0.6}L${220 + inset * 0.7} ${810 - inset * 0.2}`,
    i % 6 === 0 ? "#bfc5c5" : "#58656c",
    i % 6 === 0 ? 2 : 1,
    'opacity=".7"',
  );
}
p04 += rect(625, 218, 320, 566, "#174bfa");
for (let i = 0; i < 27; i++) {
  const y = 230 + i * 19;
  p04 += path(
    `M360 ${y}C640 ${y - 150} 890 ${y + 170} 1260 ${y - 50}`,
    "#d5ddda",
    i % 6 === 0 ? 2 : 1,
    'opacity=".75"',
  );
}
p04 += rect(994, 418, 390, 166, "#20292b");
p04 +=
  line(1080, 467, 1255, 467, "#d8e686", 4) +
  line(1167, 380, 1167, 555, "#d8e686", 4);
writeFileSync(
  new URL("P04.svg", out),
  frame("P04", "OPEN / INDEPENDENT", "#20292b", "#d9e0dc", p04),
);
// Homepage — a woven, nonlinear sound-density field; no relationship to a recording.
let hero = rect(40, 80, 1390, 530, "#dce3d8");
for (let i = 0; i < 90; i++) {
  const y = 102 + i * 6.6;
  hero += path(
    `M-100 ${f(y)}C260 ${f(y - 190)} 490 ${f(910 - y * 0.5)} 770 ${f(y - 60)}S1230 ${f(y - 240)} 1710 ${f(y + 90)}`,
    i % 9 === 0 ? "#9f4027" : i % 3 === 0 ? "#174bfa" : "#223c36",
    i % 9 === 0 ? 2.8 : 1,
    'opacity=".65"',
  );
}
for (let i = 0; i < 620; i++) {
  const x = 90 + ((i * 89) % 1420),
    y = 100 + ((i * 137) % 520),
    wave = Math.sin(x * 0.009) * Math.cos(y * 0.007);
  if (wave > 0.12)
    hero += circle(
      x,
      y,
      1.2 + wave * 3.5,
      i % 4 === 0 ? "#174bfa" : "#223c36",
      'opacity=".6"',
    );
}
hero +=
  circle(1185, 330, 118, "#e8ebda") +
  circle(1185, 330, 94, "none", 'stroke="#174bfa" stroke-width="2"');
for (let i = 0; i < 25; i++)
  hero += line(
    1090 + i * 8,
    220,
    1090 + i * 8,
    440,
    "#174bfa",
    1,
    'opacity=".65"',
  );
hero +=
  rect(68, 532, 335, 54, "#174bfa") + line(88, 559, 379, 559, "#e8ebda", 1);
writeFileSync(
  new URL("studio-field.svg", out),
  frame("STUDIO 01", "DENSITY / TIME", "#e8ebdf", "#223c36", hero, 1600, 730),
);
console.log("Generated six original SVG artworks.");
