"use client";

import { API_URL } from "./api";

const TOKEN_KEY = "dr_access_token";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private browsing: the refresh cookie still carries the session */
  }
}

/**
 * Authenticated fetch with one transparent refresh.
 *
 * Access tokens are short-lived by design; the refresh token lives in an
 * httpOnly cookie the page cannot read. On a 401 this retries once against
 * /auth/refresh, so a user mid-upload is not thrown out when their access
 * token ages out.
 */
export async function authFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");

  const res = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include" });
  if (res.status !== 401 || !retry) return res;

  const refreshed = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include" });
  if (!refreshed.ok) {
    setToken(null);
    return res;
  }
  const { accessToken } = await refreshed.json();
  setToken(accessToken);
  return authFetch(path, init, false);
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "login_failed");
  setToken(body.accessToken);
  return body.user;
}

export async function register(email: string, password: string, referralCode?: string) {
  const res = await fetch(`${API_URL}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password, referralCode: referralCode || undefined }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "register_failed");
  setToken(body.accessToken);
  return body.user;
}

export async function logout() {
  await authFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  setToken(null);
}

/** Money is transported as integer-micro strings; format only at the edge. */
export function formatMicros(micros: string | bigint, currency = "$"): string {
  const value = typeof micros === "string" ? BigInt(micros) : micros;
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = abs / 1_000_000n;
  const cents = ((abs % 1_000_000n) + 5000n) / 10_000n;
  const carry = cents >= 100n ? 1n : 0n;
  const shown = cents >= 100n ? 0n : cents;
  return `${neg ? "-" : ""}${currency}${whole + carry}.${shown.toString().padStart(2, "0")}`;
}

/** Sub-cent amounts are normal here; show enough digits to be meaningful. */
export function formatMicrosPrecise(micros: string | bigint): string {
  const value = typeof micros === "string" ? BigInt(micros) : micros;
  const usd = Number(value) / 1_000_000;
  if (usd === 0) return "$0.00";
  if (Math.abs(usd) < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(2)}`;
}
