"use client";

import { useActionState } from "react";
import { entrar, type EstadoLogin } from "./actions";

const inicial: EstadoLogin = {};

export function LoginForm() {
  const [estado, acao, enviando] = useActionState(entrar, inicial);

  return (
    <form action={acao} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-[13px] text-suave">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="senha" className="text-[13px] text-suave">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-11 rounded-[10px] border border-borda bg-fundo px-3 text-sm text-texto"
        />
      </div>

      {estado.erro && (
        <p role="alert" className="text-sm text-vermelho">
          {estado.erro}
        </p>
      )}

      <button
        type="submit"
        disabled={enviando}
        className="min-h-11 rounded-[10px] bg-limao text-sm font-bold text-fundo transition hover:brightness-110 disabled:opacity-60"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
