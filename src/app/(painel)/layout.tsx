import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { supabaseConfigurado } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

/** Confere o usuário logado (lê cookies, por isso fica dentro de um Suspense). */
async function SidebarComUsuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <Sidebar email={user.email ?? null} />;
}

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {supabaseConfigurado ? (
        <Suspense fallback={<Sidebar email={null} />}>
          <SidebarComUsuario />
        </Suspense>
      ) : (
        <Sidebar email={null} />
      )}
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-5 py-8 md:px-10">
        {!supabaseConfigurado && (
          <p className="rounded-xl border border-[#5a4220] bg-[#241b0e] px-4 py-3 text-sm text-laranja">
            Supabase ainda não configurado: o painel está aberto sem login. Cadastre as chaves na Vercel (veja o
            README).
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
