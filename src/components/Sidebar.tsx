"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { sair } from "@/app/login/actions";
import { Sininho } from "./Sininho";

type Item = { href: string; label: string; icon: ReactNode };

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  "aria-hidden": true,
} as const;

const itens: Item[] = [
  {
    href: "/",
    label: "Visão geral",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/numeros",
    label: "Números",
    icon: (
      <svg {...iconProps}>
        <rect x="6" y="2" width="12" height="20" rx="2.5" />
        <path d="M11 18h2" />
      </svg>
    ),
  },
  {
    href: "/conversas",
    label: "Conversas",
    icon: (
      <svg {...iconProps}>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
    ),
  },
  {
    href: "/crm",
    label: "CRM",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="4" width="5" height="16" rx="1.5" />
        <rect x="10" y="4" width="5" height="10" rx="1.5" />
        <rect x="17" y="4" width="4" height="13" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/funil",
    label: "Funil",
    icon: (
      <svg {...iconProps}>
        <path d="M3 4h18l-7 9v6l-4 2v-8z" />
      </svg>
    ),
  },
  {
    href: "/produtos",
    label: "Produtos e Pix",
    icon: (
      <svg {...iconProps}>
        <path d="M21 8l-9-5-9 5 9 5 9-5z" />
        <path d="M3 8v8l9 5 9-5V8" />
      </svg>
    ),
  },
  {
    href: "/anuncios",
    label: "Anúncios",
    icon: (
      <svg {...iconProps}>
        <path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z" />
        <path d="M17 8a5 5 0 0 1 0 8" />
      </svg>
    ),
  },
];

function Links({ pathname }: { pathname: string | null }) {
  return (
    <div className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {itens.map((item) => {
        const ativo = pathname !== null && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={ativo ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors ${
              ativo
                ? "bg-elevado font-semibold text-texto [&_svg]:text-limao"
                : "font-medium text-suave hover:bg-elevado/60 hover:text-texto"
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

/** Lê a URL atual (por isso fica dentro de um Suspense). */
function LinksComRota() {
  const pathname = usePathname();
  return <Links pathname={pathname} />;
}

export function Sidebar({ email }: { email: string | null }) {
  return (
    <nav
      aria-label="Menu principal"
      className="flex w-full flex-col gap-1 border-b border-borda bg-lateral p-4 md:min-h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0 md:px-4 md:py-6"
    >
      <div className="flex items-center justify-between gap-2 pr-1 pb-4 pl-3 md:pb-6">
        <Image src="/xclozr-logo.png" alt="XClozr" width={667} height={245} priority className="h-11 w-auto" />
        {email && <Sininho />}
      </div>

      <Suspense fallback={<Links pathname={null} />}>
        <LinksComRota />
      </Suspense>

      {email && (
        <div className="mt-2 hidden flex-col gap-2 rounded-xl border border-borda p-3.5 md:mt-auto md:flex">
          <span className="truncate text-xs text-suave" title={email}>
            {email}
          </span>
          <form action={sair}>
            <button type="submit" className="min-h-9 text-sm font-medium text-texto hover:text-limao">
              Sair
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}
