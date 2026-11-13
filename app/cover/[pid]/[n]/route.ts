// GET /cover/:pid/:n.svg - draws a comic cover from the product row, so the project needs no image files.
import { productForCover } from "@/lib/db";

const PALETTES = [["#F23A3A", "#FFD21F", "#1E9BE9"], ["#1E9BE9", "#FFD21F", "#F23A3A"],
  ["#FF9A1F", "#FFF6DC", "#7B2FF7"], ["#18B67A", "#FFD21F", "#F23A3A"], ["#7B2FF7", "#FFD21F", "#18B67A"]];
const GLYPHS: Record<string, string> = { Superhero: "⚡", Manga: "刀", Indie: "✎", Figures: "♜", Posters: "★" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function star(cx: number, cy: number, ro: number, ri: number, points: number, turn = 0) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? ri : ro, a = (Math.PI * i) / points + turn;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

export async function GET(_req: Request, { params }: { params: Promise<{ pid: string; n: string }> }) {
  const { pid: pidS, n: nS } = await params;
  const pid = Number(pidS), n = parseInt(nS, 10) || 1;
  const p = await productForCover(pid);
  if (!p) return new Response("Not found", { status: 404 });
  const [bg, pop, accent] = PALETTES[(pid + (n - 1) * 2) % PALETTES.length];
  const lines: string[] = [];
  let line = "";
  for (const word of String(p.name).toUpperCase().split(/\s+/)) {
    if (line && line.length + 1 + word.length > 13) { lines.push(line); line = word; }
    else line = `${line} ${word}`.trim();
  }
  lines.push(line);
  const size = Math.min(44, Math.floor(262 / (Math.max(...lines.map(l => l.length)) * 0.56)));
  const title = lines.map((l, i) => `<text x="150" y="${78 + i * (size + 4)}" font-size="${size}" text-anchor="middle" fill="${pop}" stroke="#111" stroke-width="6" paint-order="stroke" stroke-linejoin="round">${esc(l)}</text>`).join("");
  const rays = Array.from({ length: 18 }, (_, i) => i * Math.PI / 9).map(a =>
    `<polygon points="150,250 ${(150 + 420 * Math.cos(a)).toFixed(0)},${(250 + 420 * Math.sin(a)).toFixed(0)} ${(150 + 420 * Math.cos(a + 0.13)).toFixed(0)},${(250 + 420 * Math.sin(a + 0.13)).toFixed(0)}" fill="#fff" opacity=".16"/>`).join("");
  const turn = n === 1 ? 0.2 : 0.5;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420" font-family="Impact, 'Arial Black', sans-serif">
<defs><pattern id="d" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2" fill="#111" opacity=".18"/></pattern></defs>
<rect width="300" height="420" fill="${bg}"/>${rays}<rect width="300" height="420" fill="url(#d)"/>
<rect x="0" y="0" width="300" height="30" fill="#111"/>
<text x="12" y="21" font-size="15" fill="${pop}" letter-spacing="1.5">INKPOW! PRESENTS</text>
<text x="288" y="21" font-size="15" fill="#fff" text-anchor="end">${esc(String(p.category).toUpperCase())}</text>
<polygon points="${star(150, 275, 105, 68, 12, turn)}" fill="${pop}" stroke="#111" stroke-width="6" stroke-linejoin="round"/>
<polygon points="${star(150, 275, 62, 44, 9, turn + 0.3)}" fill="${accent}" stroke="#111" stroke-width="5" stroke-linejoin="round"/>
<text x="150" y="298" font-size="64" text-anchor="middle" fill="#fff" stroke="#111" stroke-width="5" paint-order="stroke">${GLYPHS[p.category] ?? "!"}</text>
${title}
<rect x="0" y="390" width="300" height="30" fill="#111"/>
<text x="150" y="411" font-size="14" fill="#fff" text-anchor="middle" letter-spacing="2">${esc(p.sku)} · ${n === 1 ? "FRONT" : "VARIANT"}</text>
<rect x="3" y="3" width="294" height="414" fill="none" stroke="#111" stroke-width="6"/>
</svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=3600" } });
}
