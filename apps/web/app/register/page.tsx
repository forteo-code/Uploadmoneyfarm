"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { register } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referral, setReferral] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await register(email, password, referral);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error && err.message === "email_taken"
        ? "That email is already registered."
        : "Could not create the account. Try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <Nav />
      <main className="container narrow">
        <div className="panel">
          <h1 style={{ marginTop: 0 }}>Create an account</h1>
          <form onSubmit={submit}>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} required autoComplete="email"
                     onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} required minLength={10} autoComplete="new-password"
                     onChange={(e) => setPassword(e.target.value)} />
              <small className="muted">At least 10 characters.</small>
            </label>
            <label className="field">
              <span>Referral code <span className="muted">(optional)</span></span>
              <input type="text" value={referral} maxLength={32}
                     onChange={(e) => setReferral(e.target.value.toUpperCase())} />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="btn btn-lg" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create account"}
            </button>
          </form>
          <p className="muted" style={{ marginBottom: 0 }}>
            Already have one? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </main>
    </>
  );
}
