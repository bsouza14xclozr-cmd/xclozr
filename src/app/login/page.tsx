import type { Metadata } from "next";
import Image from "next/image";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-5">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-2xl border border-borda bg-cartao p-8">
        <div className="flex flex-col gap-2">
          <Image src="/xclozr-logo.png" alt="XClozr" width={667} height={245} priority className="h-16 w-auto self-start" />
          <span className="text-xs font-medium text-suave">Assistente de Vendas &amp; Anúncios</span>
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
