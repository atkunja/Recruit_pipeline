"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      // Full navigation so the middleware re-runs with the new cookie.
      window.location.href = params.get("next") ?? "/";
      return;
    }

    const data: unknown = await response.json().catch(() => null);
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "Something went wrong";
    setError(message);
    setPending(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="panel w-full max-w-xs p-6">
      <div className="mb-1 text-[15px] font-semibold tracking-tight">
        Recruiting Pipeline
      </div>
      <p className="mb-5 text-muted">Personal recruiting OS. One user: you.</p>

      <label htmlFor="password" className="eyebrow mb-1.5 block">
        Password
      </label>
      <input
        id="password"
        type="password"
        autoFocus
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="mb-3 w-full rounded-md border border-border bg-surface px-2.5 py-2 text-text outline-none transition-colors focus:border-accent"
      />

      {error !== null && (
        <p className="mb-3 rounded-md bg-danger-soft px-2.5 py-1.5 text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || password.length === 0}
        className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
