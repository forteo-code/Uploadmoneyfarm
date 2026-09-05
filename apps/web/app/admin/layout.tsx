"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/dmca", label: "Takedowns" },
  { href: "/admin/payouts", label: "Payouts" },
  { href: "/admin/networks", label: "Ad networks" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/config", label: "Policy" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    authFetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => setAllowed(body?.user?.role === "ADMIN"))
      .catch(() => setAllowed(false));
  }, []);

  if (allowed === null) return <main className="container"><p className="muted">Checking access…</p></main>;
  if (!allowed) {
    return (
      <main className="container narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0 }}>Admin only</h1>
          <p className="muted">This area requires an administrator account.</p>
          <button className="btn" onClick={() => router.push("/login")}>Sign in</button>
        </div>
      </main>
    );
  }

  return (
    <>
      <nav className="nav">
        <div className="container nav-inner">
          <Link href="/" className="brand">drop<span>reel</span></Link>
          <span className="admin-badge">admin</span>
          <div className="spacer" />
          <Link href="/dashboard" className="muted">Back to dashboard</Link>
        </div>
      </nav>
      <div className="container">
        <div className="tabs">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={`tab${pathname === t.href ? " tab-active" : ""}`}>
              {t.label}
            </Link>
          ))}
        </div>
        {children}
      </div>
    </>
  );
}
