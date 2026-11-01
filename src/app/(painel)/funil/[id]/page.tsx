import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorCarregado } from "./EditorCarregado";

export const metadata: Metadata = { title: "Editor de funil" };

export default function EditorFunilPage() {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-suave">Carregando funil…</p>}>
      <EditorCarregado />
    </Suspense>
  );
}
