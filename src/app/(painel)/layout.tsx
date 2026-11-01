import { Sidebar } from "@/components/Sidebar";

export default function PainelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-5 py-8 md:px-10">{children}</main>
    </div>
  );
}
