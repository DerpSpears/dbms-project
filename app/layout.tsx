import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { cartCount } from "@/lib/db";
import { Burst } from "@/components/ui";
import Flash from "@/components/Flash";

export const metadata: Metadata = { title: { default: "INKPOW! · Comics & Collectibles", template: "%s · INKPOW!" } };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const count = user ? await cartCount(user.customer_id) : 0;
  const raw = (await cookies()).get("flash")?.value;
  const flash = raw ? decodeURIComponent(raw) : null;
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Bangers&family=Archivo:wght@400;600;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="stickers" aria-hidden="true">
          <Burst text="POW!" fill="#fff" color="#FF9A1F" className="s1" />
          <Burst text="BOOM!" fill="#fff" color="#F23A3A" className="s2" />
          <Burst text="OUCH" fill="#FFD21F" color="#fff" className="s3" />
        </div>
        <div className="frame">
          <header className="nav">
            <Link className="logo" href="/">INK<span>POW!</span></Link>
            <input type="checkbox" id="menu" className="menu-toggle" />
            <label htmlFor="menu" className="menu-btn" aria-label="Menu">☰</label>
            <nav>
              <Link href="/">Home</Link>
              <Link href="/shop">Shop</Link>
              {user?.role === "admin"
                ? <Link href="/admin">Admin</Link>
                : <><Link href="/wishlist">Wishlist</Link><Link href="/orders">Orders</Link></>}
              <Link href="/database">Database</Link>
              {user?.role !== "admin" && <Link href="/cart">Cart{count ? <> <b className="pill">{count}</b></> : null}</Link>}
              {user ? (
                <form method="post" action="/api/auth/logout">
                  <button className="btn btn-small">Log out {user.first_name}{user.role === "admin" ? " (admin)" : ""}</button>
                </form>
              ) : <Link className="btn btn-small" href="/login">Log in</Link>}
            </nav>
          </header>
          <Flash initial={flash} />
          <main>{children}</main>
          <footer>
            <span className="logo small">INK<span>POW!</span></span>
            <p>DBMS project · Next.js + MariaDB + MongoDB · 14 tables, plain SQL, no ORM.</p>
            <a href="/?intro=1">Replay the opening</a>
            <Link href="/database">Explore the database →</Link>
          </footer>
        </div>
      </body>
    </html>
  );
}
