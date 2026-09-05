"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { authFetch, logout } from "@/lib/auth";

export function Nav() {
  const [user, setUser] = useState<{ email: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    authFetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setUser(body?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <Link href="/" className="brand">drop<span>reel</span></Link>
        <div className="spacer" />
        {ready && user ? (
          <>
            <Link href="/dashboard" className="muted">Dashboard</Link>
            <button className="btn-ghost" onClick={() => logout().then(() => window.location.assign("/"))}>
              Sign out
            </button>
          </>
        ) : ready ? (
          <Link href="/login" className="muted">Sign in</Link>
        ) : null}
        <Link href="/upload"><button className="btn">Upload</button></Link>
      </div>
    </nav>
  );
}
