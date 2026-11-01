import type { Metadata } from "next";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-borda bg-cartao p-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[9px] bg-limao font-titulo text-xl font-bold text-fundo">
            X
          </div>
          <span className="font-titulo text-[21px] font-bold tracking-tight">XClozr</span>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">Entrar no painel</h1>
          <p className="text-sm text-suave">Use o e-mail e a senha cadastrados no Supabase.</p>
        </div>
        {supabaseConfigurado ? (
          <LoginForm />
        ) : (
          <p className="text-sm text-laranja">Supabase ainda não configurado. Veja o README.</p>
        )}
      </div>
    </main>
  );
}
