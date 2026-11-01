import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-titulo text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-suave">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col gap-4 rounded-2xl border border-borda bg-cartao p-6 ${className}`}>
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-borda bg-cartao p-5">
      <span className="text-[13px] text-suave">{label}</span>
      <span className="font-titulo text-[28px] font-bold">{value}</span>
      {hint && <span className="text-xs text-suave">{hint}</span>}
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-borda px-6 py-12 text-center">
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-md text-sm text-suave">{text}</p>
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  disabled,
  title,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  title?: string;
}) {
  const styles =
    variant === "primary"
      ? "bg-limao text-fundo font-bold hover:brightness-110"
      : "border border-borda bg-cartao text-texto font-medium hover:bg-elevado";
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      className={`min-h-11 rounded-[10px] px-5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" }) {
  const styles =
    tone === "warn"
      ? "border-[#5a4220] bg-[#241b0e] text-laranja"
      : "border-borda bg-elevado text-suave";
  return <span className={`rounded-full border px-2.5 py-1.5 text-xs font-semibold ${styles}`}>{children}</span>;
}
