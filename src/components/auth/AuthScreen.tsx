"use client";

import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { firebaseAuthMessage } from "@/lib/authErrors";

type Mode = "login" | "reset";

export function AuthScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Only allow same-site paths, so a crafted ?next=//evil.com can't redirect off-site.
  const rawNext = searchParams.get("next") || "";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/tournaments";
  const { configured, signInWithEmail, resetPassword } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const titles: Record<Mode, { heading: string; sub: string }> = {
    login: {
      heading: "Sign in",
      sub: "Use your email and password to open the tab room. Accounts are added by the site administrator in Firebase Authentication.",
    },
    reset: {
      heading: "Reset password",
      sub: "We’ll email you a link to choose a new password.",
    },
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "login") {
        await signInWithEmail(email.trim(), password);
        router.replace(next);
      } else {
        await resetPassword(email.trim());
        setInfo("Password reset email sent. Check your inbox.");
      }
    } catch (err) {
      setError(firebaseAuthMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f6f8fa] flex flex-col">
      <header className="bg-[#24292e] text-white py-4 px-6 max-sm:px-4">
        <Link href="/" className="inline-flex items-center space-x-2">
          <Image src="/crabbytab.svg" alt="" width={32} height={32} className="h-8 w-8" />
          <span className="font-bold">CrabbyTab</span>
        </Link>
      </header>

      <main className="flex-1 flex items-start justify-center px-4 py-16 max-sm:py-8">
        <div className="w-full max-w-md bg-white border border-[#d0d7de] rounded-lg shadow-xs p-6 max-sm:p-4">
          <h1 className="text-xl font-bold text-gray-900">{titles[mode].heading}</h1>
          <p className="text-sm text-gray-600 mt-1 mb-5">{titles[mode].sub}</p>

          {!configured && (
            <div className="mb-4 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-3">
              Firebase is not configured. Copy <code className="font-mono">.env.example</code> to{" "}
              <code className="font-mono">.env.local</code>, add your project keys, and enable Email/Password in
              Firebase Authentication.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-1">Email</label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {mode !== "reset" && (
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
            )}
            {info && (
              <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-3 py-2">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || !configured}
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded"
            >
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Send reset link"}
            </button>
          </form>

          <div className="mt-4 text-xs text-gray-600 space-y-1">
            {mode === "reset" && (
              <p>
                Already have an account?{" "}
                <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-blue-700 font-semibold">
                  Sign in
                </Link>
              </p>
            )}
            {mode !== "reset" && (
              <p>
                Forgot password?{" "}
                <Link href={`/forgot-password?next=${encodeURIComponent(next)}`} className="text-blue-700 font-semibold">
                  Reset it
                </Link>
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
