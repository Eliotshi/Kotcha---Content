import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-9" />
          <div>
            <div className="text-base font-semibold text-text">Kotcha Content</div>
            <div className="text-xs text-text-2">Veille concurrentielle et scripts vidéo</div>
          </div>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
