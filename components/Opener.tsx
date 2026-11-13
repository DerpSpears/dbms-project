"use client";
// Home page opening: a comic cover split by a lightning crack. Two heroes stand back to back
// and shove the halves apart as you scroll. The scroll position is never reset, so the same
// gesture carries straight on into the page. ?intro=1 replays it.
import { useEffect, useRef } from "react";
import Link from "next/link";

function Hero({ cape, accent, cowl }: { cape: string; accent: string; cowl: boolean }) {
  return (
    <svg className="op-hero" viewBox="0 0 440 470" aria-hidden="true">
      <g strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M214,150 C262,96 338,138 432,84 C408,150 436,206 414,286 C386,258 352,274 318,300 L236,206 Z" fill={cape} stroke="#111" strokeWidth="7" />
        <path d="M262,150 C310,170 352,160 392,140 M290,214 C330,214 366,222 398,236" stroke="#111" strokeWidth="4" opacity=".45" />
        <g stroke="#111">
          <path d="M296,306 L352,372 L410,436" strokeWidth="44" /><path d="M410,438 L378,446" strokeWidth="30" />
          <path d="M178,178 L236,158 L318,286 L262,322 Z" fill="#111" strokeWidth="22" />
          <path d="M276,306 L198,352 L214,438" strokeWidth="46" /><path d="M214,440 L166,442" strokeWidth="30" />
          <path d="M200,176 L62,160" strokeWidth="34" /><path d="M204,204 L64,214" strokeWidth="34" />
          <circle cx="204" cy="128" r="35" fill="#111" strokeWidth="4" />
          {cowl && <path d="M186,104 L176,62 L206,92 Z M214,94 L232,56 L238,104 Z" fill="#111" strokeWidth="6" />}
        </g>
        <path d="M36,138 L58,140 L58,182 L36,184 Z M38,194 L60,194 L60,234 L38,236 Z" fill={accent} stroke="#111" strokeWidth="6" />
        <path d="M256,326 L322,284" stroke={accent} strokeWidth="11" />
        <path d="M200,440 L160,442 M398,444 L378,448" stroke={accent} strokeWidth="12" />
        <path d="M172,122 L192,116 L190,128 Z" fill="#fff" />
        <path d="M214,214 L236,244 L226,246 L244,272" stroke={accent} strokeWidth="7" />
      </g>
    </svg>
  );
}

function Door({ side, word, cape, accent, cowl }: { side: string; word: string; cape: string; accent: string; cowl: boolean }) {
  return (
    <div className={`op-door op-${side}`}>
      <div className="op-panel">
        <div className="op-rays" />
        <div className="op-word">{word}</div>
        <div className="op-medal">
          <svg viewBox="0 0 240 240"><text textLength="640" lengthAdjust="spacing"><textPath href="#op-ring">SCROLL TO OPEN ★ INKPOW! COMICS ★ ISSUE No.1 ★ COMICS, MANGA &amp; FIGURES ★</textPath></text></svg>
        </div>
        <svg className="op-crack" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline points="52,0 47,18 53,36 46,54 54,72 48,100" /><polyline points="52,0 47,18 53,36 46,54 54,72 48,100" />
        </svg>
      </div>
      <Hero cape={cape} accent={accent} cowl={cowl} />
    </div>
  );
}

export default function Opener() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!, frame = document.querySelector<HTMLElement>(".frame");
    const force = /[?&]intro=1/.test(location.search);
    let seen = false;
    try { seen = sessionStorage.getItem("inkpow-opened") === "1"; } catch {}
    if (!frame || (!force && (seen || matchMedia("(prefers-reduced-motion: reduce)").matches))) { el.style.display = "none"; return; }

    const space = document.createElement("div");
    space.className = "opener-space";
    document.body.appendChild(space);
    document.documentElement.classList.add("opening");
    el.removeAttribute("aria-hidden");
    if (force) scrollTo(0, 0);

    let ticking = false, saved = false;
    const draw = () => {
      ticking = false;
      const len = space.offsetHeight, p = Math.min(1, Math.max(0, scrollY / len));
      const strain = Math.min(1, p / 0.12);
      const open = Math.pow(Math.max(0, (p - 0.12) / 0.88), 1.5);
      el.style.setProperty("--s", String(strain));
      el.style.setProperty("--p", String(open));
      frame.style.transform = `translateY(${Math.min(scrollY, len)}px)`;
      el.style.visibility = p >= 1 ? "hidden" : "";
      document.documentElement.classList.toggle("opened", p >= 1);
      if (p >= 1 && !saved) { saved = true; try { sessionStorage.setItem("inkpow-opened", "1"); } catch {} }
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(draw); } };
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    const go = () => scrollTo({ top: space.offsetHeight + 2, behavior: "smooth" });
    document.getElementById("opener-go")?.addEventListener("click", go);
    draw();
    return () => {
      removeEventListener("scroll", onScroll); removeEventListener("resize", onScroll);
      space.remove(); frame.style.transform = "";
      document.documentElement.classList.remove("opening", "opened");
    };
  }, []);

  return (
    <div className="opener" id="opener" ref={ref} aria-hidden="true">
      <svg width="0" height="0" style={{ position: "absolute" }}><defs><path id="op-ring" d="M120,120 m-103,0 a103,103 0 1,1 206,0 a103,103 0 1,1 -206,0" /></defs></svg>
      <svg className="op-boom" viewBox="0 0 200 140">
        <polygon points="100,4 118,30 150,10 150,40 190,34 166,62 196,84 160,90 172,128 136,108 118,138 100,110 78,136 66,106 28,126 42,90 4,84 36,62 10,32 52,40 52,8 84,30" fill="#FFD21F" stroke="#111" strokeWidth="5" strokeLinejoin="round" />
        <text x="100" y="84" textAnchor="middle" fontSize="36" fill="#F23A3A" stroke="#111" strokeWidth="4" paintOrder="stroke" transform="rotate(-8 100 70)">KRAKOOM!</text>
      </svg>
      <Door side="l" word="INK" cape="#FFD21F" accent="#1E9BE9" cowl={false} />
      <Door side="r" word="POW!" cape="#F23A3A" accent="#18B67A" cowl />
      <div className="op-ui">
        <span className="op-tag">INKPOW! COMICS PRESENTS</span>
        <span className="op-issue"><b>No.1</b>NOV</span>
        <div className="op-foot">
          <p>Two heroes. One very stuck door. <b>Scroll</b> and they will shove it open.</p>
          <button type="button" className="btn btn-orange" id="opener-go">Open the shop</button>
          <Link className="btn btn-white" href="/database">See the database</Link>
        </div>
        <div className="op-hint">Scroll to open ↓</div>
      </div>
    </div>
  );
}
