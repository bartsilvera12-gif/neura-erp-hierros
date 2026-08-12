"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Menu } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { signOut } from "@/lib/auth";
import { useBoot } from "@/components/BootContext";
import NotificacionesBell from "@/components/layout/NotificacionesBell";

type HeaderUsuario = {
  nombre: string | null;
  rol: string | null;
  email: string | null;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function roleLabel(rol: string | null | undefined): string {
  const r = clean(rol).toLowerCase();
  const labels: Record<string, string> = {
    admin: "Admin",
    administrador: "Admin",
    super_admin: "Super admin",
    supervisor: "Supervisor",
    vendedor: "Vendedor",
    asesor: "Asesor",
    comercial: "Comercial",
    "asesor comercial": "Asesor comercial",
    usuario: "Usuario",
  };
  if (labels[r]) return labels[r];
  if (!r) return "Usuario";
  return r
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function Header() {
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [usuario, setUsuario] = useState<HeaderUsuario | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { mobileSidebarOpen, setMobileSidebarOpen } = useBoot();

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let alive = true;
    async function loadUsuario() {
      try {
        const res = await fetchWithSupabaseSession("/api/usuarios/me", { cache: "no-store" });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const json = (await res.json()) as { usuario?: HeaderUsuario };
        if (alive) setUsuario(json.usuario ?? null);
      } catch {
        if (alive) setUsuario(null);
      }
    }
    void loadUsuario();
    return () => {
      alive = false;
    };
  }, []);

  const nombreReal = clean(usuario?.nombre);
  const fallbackEmail = clean(usuario?.email);
  const displayName = nombreReal || fallbackEmail || "Usuario";
  const dropdownName = nombreReal || "Usuario";
  const displayRole = roleLabel(usuario?.rol);

  return (
    <header
      id="neura-header"
      className="z-40 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/90 bg-white/95 px-3 sm:px-6 shadow-[inset_0_-1px_0_0_rgba(10,37,64,0.05)] backdrop-blur-sm"
    >
      {/* Boton hamburger (solo mobile) */}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen(!mobileSidebarOpen)}
        className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#3F8E91] lg:hidden"
        aria-label="Abrir menú"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Spacer en desktop para empujar el resto a la derecha */}
      <div className="hidden lg:block lg:flex-1" />

      <div className="flex items-center gap-2">
        {/* Notificaciones */}
        <NotificacionesBell />

        {/* Avatar + menú usuario */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-sm transition-all hover:border-[#4FAEB2]/60"
          >
            <div
              className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white"
              style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.25)" }}
            >
              <span className="absolute text-sm font-bold text-[#3F8E91]">VH</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/hierros-logo.png"
                alt="HIERROS VH"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                className="relative h-full w-full object-cover scale-150"
              />
            </div>
            <div className="hidden text-left sm:block">
              <p className="max-w-[180px] truncate text-sm font-semibold text-slate-900">{displayName}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3F8E91]">{displayRole}</p>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-slate-400 transition-transform ${userMenuOpen ? "rotate-180" : ""}`}
            />
          </button>

          {userMenuOpen ? (
            <div className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-[#4FAEB2]/15">
              {/* franja superior turquesa */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#4FAEB2] via-[#4FAEB2]/80 to-[#4FAEB2]/40"
              />
              <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
                  style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
                />
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Sesión</p>
              </div>
              <div className="border-b border-slate-100 px-4 pb-3">
                <p className="truncate text-sm font-semibold text-slate-900">{dropdownName}</p>
                {fallbackEmail ? (
                  <p className="truncate text-xs text-slate-500">{fallbackEmail}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={async () => {
                  await signOut();
                  router.push("/login");
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 hover:text-[#3F8E91]"
              >
                <LogOut className="h-4 w-4" />
                Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
