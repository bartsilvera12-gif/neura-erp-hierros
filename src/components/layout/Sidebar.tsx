"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  FileText,
  UserCog,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Star,
  Sparkles,
  Search,
  Receipt,
  Megaphone,
  Ticket,
  SendHorizontal,
  MessageCircle,
  History,
  Activity,
  ScrollText,
  ChefHat,
  Utensils,
  BarChart3,
  Banknote,
  HandCoins,
  ArrowLeftRight,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getCurrentUser } from "@/lib/auth";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/super-admin-bootstrap-email";
import { supabase } from "@/lib/supabase";
import type { ModuloEmpresa } from "@/lib/empresas/actions";
import { getFavoritos, toggleFavorito } from "@/lib/favorites";
import { canAccessSidebarSlug } from "@/lib/modulos/route-slug-map";
import { useBoot } from "@/components/BootContext";
import { getModuleAccessCached, peekModuleAccessCache } from "@/lib/modulos/module-access-cache";

type MenuItem = {
  key: string;
  slug: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { label: string; href: string; exactMatch?: boolean }[];
  showWhen?: string;
};

function menuChildPathActive(path: string, childHref: string, exactMatch?: boolean): boolean {
  if (path === childHref) return true;
  if (exactMatch) return false;
  return path.startsWith(`${childHref}/`);
}

/** Normaliza texto para búsqueda en el menú (sin acentos, minúsculas). */
function normalizeMenuSearch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function menuItemMatchesQuery(item: MenuItem, queryRaw: string): boolean {
  const q = normalizeMenuSearch(queryRaw);
  if (!q) return true;
  if (normalizeMenuSearch(item.label).includes(q)) return true;
  return item.children?.some((c) => normalizeMenuSearch(c.label).includes(q)) ?? false;
}

function adminEmpresasMatchesQuery(queryRaw: string): boolean {
  const q = normalizeMenuSearch(queryRaw);
  if (!q) return true;
  const label = normalizeMenuSearch("Admin Empresas");
  return label.includes(q) || normalizeMenuSearch("empresas").includes(q);
}

const MENU_STRUCTURE: MenuItem[] = [
  { key: "dashboard", slug: "dashboard", label: "Dashboard", href: "/", icon: LayoutDashboard },
  { key: "clientes", slug: "clientes", label: "Clientes", href: "/clientes", icon: Users },
  { key: "ventas", slug: "ventas", label: "Ventas", href: "/ventas", icon: ShoppingCart },
  { key: "cobros", slug: "cobros", label: "Cobranzas", href: "/cobros", icon: HandCoins },
  { key: "presupuestos", slug: "presupuestos", label: "Presupuestos", href: "/presupuestos", icon: FileText },
  { key: "inventario", slug: "inventario", label: "Inventario", href: "/inventario", icon: Package, children: [
    { label: "Productos", href: "/inventario" },
    { label: "Categorías", href: "/inventario/categorias" },
  ]},
  { key: "movimientos", slug: "inventario", label: "Movimientos", href: "/inventario/movimientos", icon: ArrowLeftRight },
  { key: "compras", slug: "compras", label: "Compras", href: "/compras", icon: Package, children: [
    { label: "Órdenes", href: "/compras" },
    { label: "Proveedores", href: "/proveedores" },
  ]},
  { key: "pagos", slug: "pagos", label: "Pagos", href: "/pagos", icon: Banknote },
  { key: "gastos", slug: "gastos", label: "Gastos", href: "/gastos", icon: Receipt },
  { key: "notas_credito", slug: "notas_credito", label: "Notas de crédito", href: "/notas-credito", icon: ScrollText },
  { key: "reportes", slug: "reportes", label: "Reportes", href: "/reportes", icon: BarChart3 },
  { key: "usuarios", slug: "usuarios", label: "Usuarios", href: "/usuarios", icon: UserCog },
];

/**
 * Agrupamiento VISUAL del menú por familias. Solo reordena/agrupa lo que ya existe en
 * MENU_STRUCTURE; no cambia slugs, rutas, acceso ni permisos. Cada `keys` referencia
 * `MenuItem.key`. Los ítems sin familia caen en "Otros" (no se ocultan).
 */
const MENU_FAMILIES: { id: string; titulo: string; keys: string[] }[] = [
  { id: "inicio", titulo: "Inicio", keys: ["dashboard"] },
  { id: "comercial", titulo: "Comercial", keys: ["clientes", "ventas", "cobros", "presupuestos"] },
  { id: "finanzas", titulo: "Finanzas", keys: ["pagos", "gastos", "notas_credito", "reportes"] },
  { id: "operaciones", titulo: "Operaciones", keys: ["inventario", "movimientos", "compras"] },
  { id: "administracion", titulo: "Administración", keys: ["usuarios"] },
];

function modulosSyntheticFromMenu(): ModuloEmpresa[] {
  return MENU_STRUCTURE.map((item) => ({
    id: item.slug,
    nombre: item.label,
    slug: item.slug,
  }));
}

function NavItem({
  item,
  itemId,
  isActive,
  isFavorito,
  onToggleFavorito,
  hasAccess,
  collapsed,
  expanded,
  onToggleExpand,
}: {
  item: MenuItem;
  itemId: string;
  isActive: boolean;
  isFavorito: boolean;
  onToggleFavorito: (id: string) => void;
  hasAccess: boolean;
  collapsed: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const Icon = item.icon;
  const p = usePathname() ?? "";
  const router = useRouter();

  if (!hasAccess) return null;

  const childActive = item.children?.some((c) => menuChildPathActive(p, c.href, c.exactMatch));

  if (item.children) {
    const rowTone =
      isActive || childActive
        ? "bg-[color:var(--zentra-sidebar-active)] text-white shadow-[inset_3px_0_0_var(--zentra-sidebar-accent)]"
        : "text-slate-200 hover:bg-[color:var(--zentra-sidebar-hover)]";
    return (
      <div className="space-y-0.5">
        <div className={`flex items-center gap-0.5 rounded-lg text-sm font-medium transition-colors ${rowTone}`}>
          <Link
            href={item.href}
            prefetch={false}
            onMouseEnter={() => router.prefetch(item.href)}
            className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5"
            title={item.label}
          >
            <Icon className={`h-5 w-5 shrink-0 ${isActive || childActive ? "text-white" : "text-slate-400"}`} />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          </Link>
          {!collapsed && (
            <>
              <button
                type="button"
                onClick={() => onToggleFavorito(itemId)}
                className={`shrink-0 rounded p-0.5 ${isFavorito ? "text-amber-300" : "text-slate-500 hover:text-amber-300"}`}
                aria-label="Favorito"
              >
                <Star className={`h-4 w-4 ${isFavorito ? "fill-current" : ""}`} />
              </button>
              <button
                type="button"
                onClick={() => onToggleExpand()}
                className="shrink-0 rounded p-1 text-current hover:opacity-90"
                aria-expanded={expanded}
                aria-label={expanded ? "Contraer submenú" : "Expandir submenú"}
              >
                {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
        <AnimatePresence>
          {expanded && !collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden pl-4 space-y-0.5"
            >
              {item.children.map((c) => (
                <Link
                  key={c.href}
                  href={c.href}
                  prefetch={false}
                  onMouseEnter={() => router.prefetch(c.href)}
                  className={`block rounded-lg px-3 py-2 text-sm transition-all ${
                    menuChildPathActive(p, c.href, c.exactMatch)
                      ? "bg-[color:var(--zentra-sidebar-active)] text-white font-medium shadow-[inset_3px_0_0_var(--zentra-sidebar-accent)]"
                      : "text-slate-300 hover:bg-[color:var(--zentra-sidebar-hover)]"
                  }`}
                >
                  {c.label}
                </Link>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      prefetch={false}
      onMouseEnter={() => router.prefetch(item.href)}
      className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
        isActive
          ? "bg-[color:var(--zentra-sidebar-active)] text-white shadow-[inset_3px_0_0_var(--zentra-sidebar-accent)]"
          : "text-slate-200 hover:bg-[color:var(--zentra-sidebar-hover)]"
      }`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${isActive ? "text-white" : "text-slate-400"}`} />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onToggleFavorito(itemId); }}
            className={`rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${
              isFavorito ? "opacity-100 text-amber-300" : "text-slate-500 hover:text-amber-300"
            }`}
          >
            <Star className={`h-4 w-4 ${isFavorito ? "fill-current" : ""}`} />
          </button>
        </>
      )}
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const navScrollRef = useRef<HTMLElement | null>(null);
  const navContentRef = useRef<HTMLDivElement | null>(null);
  const [scrollIndicator, setScrollIndicator] = useState({
    visible: false,
    thumbHeight: 0,
    thumbTop: 0,
  });
  // ── Hidratación SÍNCRONA desde cache (localStorage) ───────────────────────
  // Si hay cache válido del último login, arrancamos con módulos + cargando=false.
  // Esto elimina el flash "Cargando…" cuando Chrome descarta la pestaña en
  // background y la remonta al volver (tab discarding).
  // El refetch en el useEffect de abajo sigue ocurriendo en background como
  // stale-while-revalidate, pero sin ocultar el menú.
  const cachedAccess = peekModuleAccessCache();
  const [modulos, setModulos] = useState<ModuloEmpresa[]>(() =>
    Array.isArray(cachedAccess?.modulos) ? cachedAccess!.modulos! : [],
  );
  const [inactiveSlugsList, setInactiveSlugsList] = useState<string[]>(() =>
    Array.isArray(cachedAccess?.inactiveSlugs) ? cachedAccess!.inactiveSlugs! : [],
  );
  const [strictAllowlist, setStrictAllowlist] = useState<boolean>(
    !!cachedAccess?.strictAllowlist,
  );
  const [favoritos, setFavoritos] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({
    inventario: true,
    sorteos: true,
    compras: true,
  });
  // Familias del menú colapsables (agrupamiento visual). Abiertas por defecto.
  const [expandedFamilies, setExpandedFamilies] = useState<Record<string, boolean>>({});
  // cargando arranca en false si ya hidratamos desde cache; el spinner solo
  // aparece en el primer login real, no al volver a la pestaña.
  const [cargando, setCargando] = useState<boolean>(
    !(cachedAccess && (cachedAccess.modulos?.length || cachedAccess.slugs?.length)),
  );
  const [esSuperAdmin, setEsSuperAdmin] = useState<boolean>(!!cachedAccess?.superAdmin);
  /** Filtro visual del menú (no altera permisos ni rutas). */
  const [menuSearchQuery, setMenuSearchQuery] = useState("");
  const { setSidebarReady, mobileSidebarOpen, setMobileSidebarOpen } = useBoot();

  const updateScrollIndicator = useCallback(() => {
    const el = navScrollRef.current;
    if (!el) return;

    const scrollable = el.scrollHeight > el.clientHeight + 1;
    if (!scrollable) {
      setScrollIndicator((prev) =>
        prev.visible ? { visible: false, thumbHeight: 0, thumbTop: 0 } : prev
      );
      return;
    }

    const trackHeight = Math.max(el.clientHeight - 20, 1);
    const thumbHeight = Math.max(36, (el.clientHeight / el.scrollHeight) * trackHeight);
    const maxThumbTop = Math.max(trackHeight - thumbHeight, 0);
    const maxScrollTop = Math.max(el.scrollHeight - el.clientHeight, 1);
    const thumbTop = (el.scrollTop / maxScrollTop) * maxThumbTop;

    setScrollIndicator((prev) => {
      const next = { visible: true, thumbHeight, thumbTop };
      if (
        prev.visible === next.visible &&
        Math.abs(prev.thumbHeight - next.thumbHeight) < 0.5 &&
        Math.abs(prev.thumbTop - next.thumbTop) < 0.5
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  /** Cerrar el drawer mobile al cambiar de ruta. */
  useEffect(() => {
    if (mobileSidebarOpen) setMobileSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  /** Reporta al BootContext cuándo el sidebar tiene sus módulos cargados.
   *  Sticky: solo va false → true, nunca true → false. Esto evita que el
   *  ZentraLoader vuelva a aparecer entre navegaciones cuando Supabase
   *  dispara onAuthStateChange (token refresh) y reinicia "cargando". */
  useEffect(() => {
    if (!cargando) {
      setSidebarReady(true);
    }
  }, [cargando, setSidebarReady]);

  useEffect(() => {
    setFavoritos(getFavoritos());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function cargarMenuDesdeSesion(
      session: Session | null,
      opts?: { forceRefresh?: boolean },
    ) {
      try {
        // Stale-while-revalidate: solo mostramos "Cargando…" si NO tenemos
        // módulos en estado. Si ya hay módulos (hidratados del cache o de un
        // fetch previo), refrescamos en background sin ocultar el menú.
        // Esto evita el flash de loader al volver a la pestaña o ante eventos
        // SIGNED_IN/USER_UPDATED de Supabase que en realidad no cambian nada.
        setCargando((prev) => (modulos.length === 0 ? true : prev));
        if (cancelled) return;
        if (!session?.user) {
          setModulos([]);
          setEsSuperAdmin(false);
          return;
        }

        const { ok, data: body } = await getModuleAccessCached({
          forceRefresh: opts?.forceRefresh,
        });
        if (cancelled) return;

        let superA = false;
        let modList: ModuloEmpresa[] = [];
        const bootstrapSuper = isBootstrapSuperAdminEmail(session.user.email ?? null);

        let inactiveList: string[] = [];
        let strict = false;
        if (ok) {
          superA = !!body.superAdmin || bootstrapSuper;
          modList = Array.isArray(body.modulos) ? body.modulos : [];
          inactiveList = Array.isArray(body.inactiveSlugs) ? body.inactiveSlugs : [];
          strict = !!body.strictAllowlist;
        } else {
          superA = bootstrapSuper;
        }

        if (!superA) {
          try {
            const cu = await getCurrentUser();
            if ((cu?.rol ?? "").trim() === "super_admin") {
              superA = true;
              const mr = await fetchWithSupabaseSession("/api/admin/modulos", { cache: "no-store" });
              if (mr.ok) {
                const raw = (await mr.json()) as { id?: string; nombre?: string; slug?: string }[];
                if (Array.isArray(raw) && raw.length > 0) {
                  modList = raw.map((m) => ({
                    id: m.id ?? "",
                    nombre: m.nombre ?? "",
                    slug: m.slug ?? "",
                  }));
                }
              }
            }
          } catch {
            /* getCurrentUser puede fallar si RLS; el servidor ya intentó */
          }
        }

        if (superA && modList.length === 0) {
          modList = modulosSyntheticFromMenu();
        }

        if (cancelled) return;
        setEsSuperAdmin(superA);
        setModulos(modList);
        setInactiveSlugsList(inactiveList);
        setStrictAllowlist(strict);
      } catch {
        if (!cancelled) {
          setModulos([]);
          setEsSuperAdmin(false);
          setInactiveSlugsList([]);
          setStrictAllowlist(false);
        }
      } finally {
        if (!cancelled) setCargando(false);
      }
    }

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) void cargarMenuDesdeSesion(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      // Skip eventos que NO cambian que modulos tiene el user:
      //  - INITIAL_SESSION: ya cargado por el getSession() de arriba (duplicado).
      //  - TOKEN_REFRESHED: Supabase refresca el JWT cada ~1h Y cuando la pestana
      //    vuelve a estar visible. Los modulos del user no cambian por esto;
      //    re-fetchear hace que el sidebar muestre "Cargando..." sin motivo
      //    cada vez que el usuario vuelve a la tab del ERP.
      // Eventos que SI re-cargan: SIGNED_IN, SIGNED_OUT, USER_UPDATED.
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      // SIGNED_IN puede significar usuario nuevo (sesión cambió) — forzamos
      // refresh del cache para no servir módulos del usuario anterior.
      // USER_UPDATED: cambió el JWT del mismo user (raro), también refrescamos.
      const forceRefresh = event === "SIGNED_IN" || event === "USER_UPDATED";
      void cargarMenuDesdeSesion(session, { forceRefresh });
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleToggleFavorito = (id: string) => {
    setFavoritos(toggleFavorito(id));
  };

  const modulosSlugs = new Set(modulos.map((m) => m.slug));
  const inactiveSlugsSet = useMemo(() => new Set(inactiveSlugsList), [inactiveSlugsList]);
  const hasAccess = (slug: string) =>
    canAccessSidebarSlug(slug, modulosSlugs, esSuperAdmin, inactiveSlugsSet, {
      strict: strictAllowlist,
    });

  const isActive = (slug: string, href: string) => {
    const p = pathname ?? "";
    if (slug === "dashboard") return p === "/";
    return p === href || p.startsWith(href + "/");
  };

  const toggleExpand = (menuKey: string) => {
    setExpandedItems((prev) => ({ ...prev, [menuKey]: !prev[menuKey] }));
  };

  const slugToId = (slug: string) => modulos.find((m) => m.slug === slug)?.id ?? slug;

  const favoritosItemsFiltered = useMemo(() => {
    const slugs = new Set(modulos.map((m) => m.slug));
    const idForSlug = (slug: string) => modulos.find((m) => m.slug === slug)?.id ?? slug;
    const access = (slug: string) =>
      canAccessSidebarSlug(slug, slugs, esSuperAdmin, inactiveSlugsSet, { strict: strictAllowlist });
    return MENU_STRUCTURE.filter(
      (item) =>
        favoritos.includes(idForSlug(item.slug)) &&
        access(item.slug) &&
        menuItemMatchesQuery(item, menuSearchQuery)
    );
  }, [favoritos, menuSearchQuery, modulos, esSuperAdmin, inactiveSlugsSet, strictAllowlist]);

  const mainItemsFiltered = useMemo(() => {
    const slugs = new Set(modulos.map((m) => m.slug));
    const idForSlug = (slug: string) => modulos.find((m) => m.slug === slug)?.id ?? slug;
    const access = (slug: string) =>
      canAccessSidebarSlug(slug, slugs, esSuperAdmin, inactiveSlugsSet, { strict: strictAllowlist });
    return MENU_STRUCTURE.filter(
      (item) =>
        !favoritos.includes(idForSlug(item.slug)) &&
        access(item.slug) &&
        menuItemMatchesQuery(item, menuSearchQuery)
    );
  }, [favoritos, menuSearchQuery, modulos, esSuperAdmin, inactiveSlugsSet, strictAllowlist]);

  // Agrupar los ítems visibles del menú principal por familias (solo visual).
  const seccionesMenu = useMemo(() => {
    const byKey = new Map(mainItemsFiltered.map((it) => [it.key, it]));
    const usados = new Set<string>();
    const secciones: { id: string; titulo: string; items: MenuItem[] }[] = [];
    for (const fam of MENU_FAMILIES) {
      const items = fam.keys
        .map((k) => byKey.get(k))
        .filter((it): it is MenuItem => it !== undefined);
      items.forEach((it) => usados.add(it.key));
      if (items.length > 0) secciones.push({ id: fam.id, titulo: fam.titulo, items });
    }
    const otros = mainItemsFiltered.filter((it) => !usados.has(it.key));
    if (otros.length > 0) secciones.push({ id: "otros", titulo: "Otros", items: otros });
    return secciones;
  }, [mainItemsFiltered]);

  const familiaExpandida = (id: string) => expandedFamilies[id] ?? true; // abiertas por defecto
  const toggleFamilia = (id: string) =>
    setExpandedFamilies((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  const forzarExpandirFamilias = normalizeMenuSearch(menuSearchQuery).length > 0;

  const anyMenuVisible =
    favoritosItemsFiltered.length > 0 ||
    mainItemsFiltered.length > 0 ||
    (esSuperAdmin && adminEmpresasMatchesQuery(menuSearchQuery));

  const showMenuNoResults =
    !cargando && normalizeMenuSearch(menuSearchQuery).length > 0 && !anyMenuVisible;

  useEffect(() => {
    const q = menuSearchQuery.trim();
    if (!q) return;
    const n = normalizeMenuSearch(q);
    setExpandedItems((prev) => {
      const next = { ...prev };
      for (const item of MENU_STRUCTURE) {
        if (item.children?.some((c) => normalizeMenuSearch(c.label).includes(n))) {
          next[item.key] = true;
        }
      }
      return next;
    });
  }, [menuSearchQuery]);

  useEffect(() => {
    const el = navScrollRef.current;
    if (!el) return;

    updateScrollIndicator();
    const observer = new ResizeObserver(updateScrollIndicator);
    observer.observe(el);
    if (navContentRef.current) observer.observe(navContentRef.current);
    el.addEventListener("scroll", updateScrollIndicator, { passive: true });

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateScrollIndicator);
    };
  }, [updateScrollIndicator]);

  useEffect(() => {
    const raf = window.requestAnimationFrame(updateScrollIndicator);
    return () => window.cancelAnimationFrame(raf);
  });

  return (
    <>
      {/* Backdrop mobile: cubre el contenido cuando el drawer esta abierto */}
      {mobileSidebarOpen ? (
        <button
          type="button"
          aria-label="Cerrar menú"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-900/55 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <aside
        id="neura-sidebar"
        // Ancho animado por CSS puro (sin framer-motion para no cargar la lib
        // en el bundle del shell). motion-safe respeta prefers-reduced-motion.
        style={{ width: collapsed ? 80 : 260 }}
        className={`zentra-sidebar-bg flex h-svh min-h-0 shrink-0 flex-col border-r border-[color:var(--zentra-sidebar-border)] motion-safe:transition-[width] motion-safe:duration-200 lg:relative lg:z-auto lg:translate-x-0 lg:shadow-none ${
          mobileSidebarOpen
            ? "fixed inset-y-0 left-0 z-50 translate-x-0 shadow-2xl transition-transform duration-200"
            : "fixed inset-y-0 left-0 z-50 -translate-x-full lg:translate-x-0 transition-transform duration-200"
        }`}
      >
      {/* Logo: dos assets distintos segun estado.
          - Expandido: /brand/zentra-logo-official.png (logo + texto ZENTRA)
          - Colapsado: /brand/zentralogo.png (solo icono Z) -> queda nitido en 44x44
          Header con justify-center porque el toggle ahora es una pestania
          flotante en el borde derecho (estilo Coolify/acai-house). */}
      <div className="flex h-[7.25rem] shrink-0 items-center justify-center gap-2 border-b border-[color:var(--zentra-sidebar-border)] bg-[color:var(--zentra-sidebar-elevated)]/35 px-3 py-2.5">
        <Link href="/" className="flex items-center justify-center min-w-0 flex-1 overflow-hidden">
          <div
            className={`relative flex items-center justify-center ${collapsed ? "h-11 w-11" : "h-[4.5rem] w-full max-w-[200px]"}`}
          >
            <Image
              src={collapsed ? "/brand/zentralogo.png" : "/brand/zentra-logo-official.png"}
              alt="ZENTRA"
              width={400}
              height={220}
              sizes={collapsed ? "44px" : "200px"}
              className="h-full w-full object-contain object-center"
              priority
            />
          </div>
        </Link>
      </div>

      {/* Toggle flotante estilo Coolify: pestaña circular en el borde derecho
          del sidebar. Solo en desktop (lg+), donde el colapso a 80px aplica;
          en mobile el sidebar es un drawer y no necesita pestaña. */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
        title={collapsed ? "Expandir" : "Colapsar"}
        style={{ backgroundColor: "#104A4E" }}
        className="absolute top-[8rem] -right-3 z-50 hidden h-7 w-7 items-center justify-center rounded-full border border-[color:var(--zentra-sidebar-border)] text-white shadow-[0_4px_10px_rgba(0,0,0,0.35)] transition-transform hover:scale-105 lg:flex"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>

      {!collapsed && (
        <div className="shrink-0 border-b border-[color:var(--zentra-sidebar-border)] px-3 py-2.5">
          <label htmlFor="sidebar-menu-search" className="sr-only">
            Buscar en el menú
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              id="sidebar-menu-search"
              type="search"
              autoComplete="off"
              placeholder="Buscar en el menú…"
              value={menuSearchQuery}
              onChange={(e) => setMenuSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-white/10 py-2 pl-8 pr-2.5 text-xs text-white outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-sky-400/45 focus:ring-2 focus:ring-sky-400/35"
            />
          </div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
      <nav
        ref={navScrollRef}
        className="zentra-sidebar-scroll h-full min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain p-3"
      >
        <div ref={navContentRef}>
        {showMenuNoResults ? (
          <p className="px-2 py-6 text-center text-xs text-slate-400">Sin resultados</p>
        ) : null}

        {/* Favoritos */}
        {favoritosItemsFiltered.length > 0 && !collapsed && (
          <div className="mb-4">
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">★ Favoritos</p>
            <div className="space-y-0.5">
              {favoritosItemsFiltered.map((item) => (
                <NavItem
                  key={item.key}
                  item={item}
                  itemId={slugToId(item.slug)}
                  isActive={isActive(item.slug, item.href)}
                  isFavorito={true}
                  onToggleFavorito={handleToggleFavorito}
                  hasAccess={hasAccess(item.slug)}
                  collapsed={collapsed}
                  expanded={expandedItems[item.key] ?? false}
                  onToggleExpand={() => toggleExpand(item.key)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Menú principal agrupado por familias (solo visual) */}
        {cargando ? (
          <div className="px-3 py-2 text-sm text-slate-500 animate-pulse">Cargando…</div>
        ) : collapsed ? (
          // Colapsado (solo iconos): lista plana, sin títulos de familia.
          <div className="space-y-0.5">
            {mainItemsFiltered.map((item) => (
              <NavItem
                key={item.key}
                item={item}
                itemId={slugToId(item.slug)}
                isActive={isActive(item.slug, item.href)}
                isFavorito={favoritos.includes(slugToId(item.slug))}
                onToggleFavorito={handleToggleFavorito}
                hasAccess={hasAccess(item.slug)}
                collapsed={collapsed}
                expanded={expandedItems[item.key] ?? false}
                onToggleExpand={() => toggleExpand(item.key)}
              />
            ))}
          </div>
        ) : (
          seccionesMenu.map((seccion) => {
            const abierta = familiaExpandida(seccion.id) || forzarExpandirFamilias;
            return (
              <div key={seccion.id} className="mb-3">
                <button
                  type="button"
                  onClick={() => toggleFamilia(seccion.id)}
                  className="mb-1.5 flex w-full items-center justify-between rounded px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-slate-100 transition-colors hover:text-white"
                >
                  <span>{seccion.titulo}</span>
                  {abierta ? <ChevronDown className="h-4 w-4 text-slate-300" /> : <ChevronRight className="h-4 w-4 text-slate-300" />}
                </button>
                {abierta && (
                  <div className="space-y-0.5">
                    {seccion.items.map((item) => (
                      <NavItem
                        key={item.key}
                        item={item}
                        itemId={slugToId(item.slug)}
                        isActive={isActive(item.slug, item.href)}
                        isFavorito={favoritos.includes(slugToId(item.slug))}
                        onToggleFavorito={handleToggleFavorito}
                        hasAccess={hasAccess(item.slug)}
                        collapsed={collapsed}
                        expanded={expandedItems[item.key] ?? false}
                        onToggleExpand={() => toggleExpand(item.key)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Admin */}
        {esSuperAdmin && adminEmpresasMatchesQuery(menuSearchQuery) && (
          <div className="mt-6 pt-4 border-t border-[color:var(--zentra-sidebar-border)]">
            {!collapsed && (
              <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Admin</p>
            )}
            <Link
              href="/admin/empresas"
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                (pathname ?? "").startsWith("/admin/empresas")
                  ? "bg-[color:var(--zentra-sidebar-active)] text-amber-100 shadow-[inset_3px_0_0_var(--zentra-sidebar-accent)]"
                  : "text-amber-300/95 hover:bg-[color:var(--zentra-sidebar-hover)]"
              }`}
            >
              <Building2 className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="truncate">Admin Empresas</span>}
            </Link>
          </div>
        )}
        </div>
      </nav>

        {scrollIndicator.visible ? (
          <div className="pointer-events-none absolute inset-y-2.5 right-1.5 w-1 rounded-full bg-white/[0.035]">
            <motion.span
              className="absolute left-0 top-0 block w-full rounded-full bg-[#4FAEB2]/55 shadow-[0_0_10px_rgba(79,174,178,0.32)]"
              animate={{ height: scrollIndicator.thumbHeight, y: scrollIndicator.thumbTop }}
              transition={{ type: "spring", stiffness: 420, damping: 38, mass: 0.35 }}
            />
          </div>
        ) : null}
      </div>
      </aside>
    </>
  );
}
