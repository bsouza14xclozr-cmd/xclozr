"use client";

import { useEffect } from "react";

type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
declare global {
  interface Window {
    __xclozrInstalar?: EventoInstalar | null;
  }
}

/** Registra o service worker (notificações) e guarda o convite de instalação do app. */
export function RegistrarApp() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => null);
    const guardar = (e: Event) => {
      e.preventDefault();
      window.__xclozrInstalar = e as EventoInstalar;
      window.dispatchEvent(new Event("xclozr-instalavel"));
    };
    window.addEventListener("beforeinstallprompt", guardar);
    return () => window.removeEventListener("beforeinstallprompt", guardar);
  }, []);
  return null;
}
