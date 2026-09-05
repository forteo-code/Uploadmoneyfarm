"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error && err.message === "invalid_credentials"
        ? "That email and password do not match."
        : "Could not sign in. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <Nav />
      <main className="container narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0 }}>Sign in</h1>
          <form onSubmit={submit}>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} required autoComplete="email"
                     onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} required autoComplete="current-password"
                     onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-lg" type="submit" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="muted" style={{ marginBottom: 0 }}>
            No account? <Link href="/register">Create one</Link>
          </p>
        </div>
      </main>
    </>
  );
}
