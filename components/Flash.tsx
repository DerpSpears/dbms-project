"use client";
import { useEffect, useState } from "react";

/** Shows the one-time message an API route left in the "flash" cookie, then clears it. */
export default function Flash({ initial }: { initial: string | null }) {
  const [msg, setMsg] = useState(initial);
  useEffect(() => {
    document.cookie = "flash=; Max-Age=0; path=/";
    setMsg(initial);
  }, [initial]);
  if (!msg) return null;
  return <div className="flashes"><div className="bubble" role="status">{msg}</div></div>;
}
