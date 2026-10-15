"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { requestCode } from "@/app/auth/actions";
import { buttonClass, Card, inputClass } from "@/components/ui";

export function LoginForm({ expired = false }: { expired?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await requestCode(email);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setStep("code");
      setInfo(`Code envoyé à ${email.trim().toLowerCase()}.`);
    });
  }

  function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.replace(/\s/g, ""),
        type: "email",
      });
      if (error) {
        setError("Code invalide ou expiré. Vérifie le dernier email reçu ou redemande un code.");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <Card className="p-6">
      {step === "email" ? (
        <form onSubmit={sendCode} className="flex flex-col gap-4">
          <div>
            <h1 className="text-lg font-semibold text-text">Connexion</h1>
            <p className="mt-1 text-sm text-text-2">
              Saisis ton email : tu recevras un code de vérification. Ton appareil restera ensuite connecté.
            </p>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              className={inputClass}
              placeholder="prenom@kotcha.fr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {expired && !error && <p className="text-sm text-text-2">Session expirée après une longue inactivité : reconnecte-toi.</p>}
          {error && <p className="text-sm text-critical">{error}</p>}
          <button type="submit" disabled={pending || !email} className={buttonClass.primary}>
            {pending ? "Envoi…" : "Recevoir un code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="flex flex-col gap-4">
          <div>
            <h1 className="text-lg font-semibold text-text">Vérification</h1>
            {info && <p className="mt-1 text-sm text-text-2">{info}</p>}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-2">Code reçu par email</span>
            <input
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9 ]{6,10}"
              maxLength={10}
              className={`${inputClass} text-center text-lg tracking-[0.4em] tabular`}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-critical">{error}</p>}
          <button type="submit" disabled={pending || code.replace(/\s/g, "").length < 6} className={buttonClass.primary}>
            {pending ? "Vérification…" : "Se connecter"}
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-text-2 hover:text-text" onClick={() => setStep("email")}>
              ← Changer d&apos;email
            </button>
            <button type="button" className="text-accent hover:underline" disabled={pending} onClick={() => sendCode()}>
              Renvoyer le code
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}
