"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  ArrowLeft,
  Package,
  ChevronLeft,
  ChevronRight,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  Pencil,
  Calendar,
} from "lucide-react";
import {
  getMovimientosPaginated,
  type MovimientosPaginadosResult,
} from "@/lib/inventario/storage";
import type {
  MovimientoInventario,
  TipoMovimiento,
  OrigenMovimiento,
} from "@/lib/inventario/types";

// Badges con paleta del sistema (turquesa + colores semanticos suaves)
const tipoBadge: Record<TipoMovimiento, string> = {
  ENTRADA: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  SALIDA: "bg-red-50 text-red-700 border border-red-200",
  AJUSTE: "bg-amber-50 text-amber-700 border border-amber-200",
};
const TipoIcon = {
  ENTRADA: ArrowDownToLine,
  SALIDA: ArrowUpFromLine,
  AJUSTE: Pencil,
} as const;

const origenLabel: Record<OrigenMovimiento, string> = {
  compra: "Compra",
  venta: "Venta",
  ajuste_manual: "Ajuste manual",
  inventario_inicial: "Inventario inicial",
  devolucion_venta: "Devolución venta",
};
const origenBadge: Record<OrigenMovimiento, string> = {
  compra: "bg-sky-50 text-sky-700 border border-sky-200",
  venta: "bg-violet-50 text-violet-700 border border-violet-200",
  ajuste_manual: "bg-slate-100 text-slate-600 border border-slate-200",
  inventario_inicial: "bg-orange-50 text-orange-700 border border-orange-200",
  devolucion_venta: "bg-amber-50 text-amber-800 border border-amber-200",
};

function formatGs(valor: number) {
  return `Gs. ${valor.toLocaleString("es-PY")}`;
}
function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} · ${hh}:${min}`;
  } catch {
    return iso;
  }
}

// Paleta turquesa
const TURQ = "#4FAEB2";

const PAGE_SIZE = 25;

export default function MovimientosPage() {
  // Datos
  const [items, setItems] = useState<MovimientoInventario[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Filtros
  const [busqueda, setBusqueda] = useState("");
  const [busquedaDebounced, setBusquedaDebounced] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoMovimiento | "">("");
  const [filtroOrigen, setFiltroOrigen] = useState<OrigenMovimiento | "">("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");

  // Paginacion
  const [page, setPage] = useState(1);

  // Debounce de busqueda (350ms)
  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(busqueda), 350);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Reset a pagina 1 cuando cambian filtros
  useEffect(() => {
    setPage(1);
  }, [busquedaDebounced, filtroTipo, filtroOrigen, fechaDesde, fechaHasta]);

  // Fetch
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMovimientosPaginated({
      page,
      pageSize: PAGE_SIZE,
      q: busquedaDebounced,
      tipo: filtroTipo || undefined,
      origen: filtroOrigen || undefined,
      fechaDesde: fechaDesde || undefined,
      fechaHasta: fechaHasta || undefined,
    }).then((res: MovimientosPaginadosResult) => {
      if (cancelled) return;
      setItems(res.movimientos);
      setTotal(res.total);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [page, busquedaDebounced, filtroTipo, filtroOrigen, fechaDesde, fechaHasta]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  const hayFiltros = useMemo(
    () => !!(busqueda || filtroTipo || filtroOrigen || fechaDesde || fechaHasta),
    [busqueda, filtroTipo, filtroOrigen, fechaDesde, fechaHasta]
  );

  function clearFiltros() {
    setBusqueda("");
    setFiltroTipo("");
    setFiltroOrigen("");
    setFechaDesde("");
    setFechaHasta("");
  }

  // Estilo unico para los inputs/selects de filtro
  const inputClass =
    "h-10 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm outline-none transition-all hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div className="w-full py-8 px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#4FAEB2]/8 border border-[#4FAEB2]/30 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#3F8E91] mb-3">
            <Package className="h-3 w-3 text-[#4FAEB2]" />
            Inventario · Historial
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight leading-tight">
            Movimientos de inventario
          </h1>
          <p className="text-[14px] text-slate-500 mt-1.5">
            Registro de entradas, salidas y ajustes de stock
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/inventario"
            className="group inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-[#4FAEB2] hover:bg-[#4FAEB2]/5 hover:text-[#3F8E91]"
          >
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
            <span>Inventario</span>
          </Link>
        </div>
      </header>

      {/* Card principal */}
      <section className="bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
        {/* Toolbar superior */}
        <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-bold text-slate-800 leading-none">
              Historial
            </h2>
            <span className="inline-flex items-center justify-center px-2 h-[22px] rounded-full bg-[#4FAEB2] text-white text-[11px] font-bold tabular-nums">
              {total} {total === 1 ? "registro" : "registros"}
            </span>
          </div>
          <p className="text-[11.5px] text-slate-500">
            Los movimientos se generan automáticamente desde{" "}
            <span className="font-semibold text-[#3F8E91]">Compras</span> y{" "}
            <span className="font-semibold text-[#3F8E91]">Caja</span>.
          </p>
        </div>

        {/* Filtros */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/40">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            {/* Busqueda */}
            <div className="md:col-span-5 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por producto o SKU..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className={`${inputClass} w-full pl-9 pr-9`}
              />
              {busqueda && (
                <button
                  onClick={() => setBusqueda("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {/* Tipo */}
            <select
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value as TipoMovimiento | "")}
              className={`${inputClass} md:col-span-3`}
            >
              <option value="">Todos los tipos</option>
              <option value="ENTRADA">Entradas</option>
              <option value="SALIDA">Salidas</option>
              <option value="AJUSTE">Ajustes</option>
            </select>
            {/* Origen */}
            <select
              value={filtroOrigen}
              onChange={(e) => setFiltroOrigen(e.target.value as OrigenMovimiento | "")}
              className={`${inputClass} md:col-span-4`}
            >
              <option value="">Todos los orígenes</option>
              <option value="compra">Compra</option>
              <option value="venta">Venta</option>
              <option value="ajuste_manual">Ajuste manual</option>
              <option value="inventario_inicial">Inventario inicial</option>
            </select>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            <div className="md:col-span-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
              <input
                type="date"
                value={fechaDesde}
                onChange={(e) => setFechaDesde(e.target.value)}
                max={fechaHasta || undefined}
                className={`${inputClass} w-full`}
              />
            </div>
            <span className="hidden md:flex md:col-span-1 justify-center text-xs text-slate-400 font-medium">
              hasta
            </span>
            <div className="md:col-span-4 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0 md:hidden" />
              <input
                type="date"
                value={fechaHasta}
                onChange={(e) => setFechaHasta(e.target.value)}
                min={fechaDesde || undefined}
                className={`${inputClass} w-full`}
              />
            </div>
            <div className="md:col-span-3 flex justify-end">
              {hayFiltros && (
                <button
                  onClick={clearFiltros}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-[#3F8E91] hover:bg-[#4FAEB2]/8 rounded-lg px-3 py-2 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabla */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] sm:min-w-0 text-left text-sm">
            <thead className="bg-slate-50/70 text-slate-500 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 font-semibold">Producto</th>
                <th className="hidden md:table-cell px-3 py-3 font-semibold">SKU</th>
                <th className="px-3 py-3 font-semibold">Tipo</th>
                <th className="px-3 py-3 font-semibold text-right">Cantidad</th>
                <th className="hidden lg:table-cell px-3 py-3 font-semibold text-right">
                  Costo unit.
                </th>
                <th className="hidden md:table-cell px-3 py-3 font-semibold">Origen</th>
                <th className="hidden lg:table-cell px-3 py-3 font-semibold">Usuario</th>
                <th className="px-3 py-3 font-semibold">Fecha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 text-sm">
                    Cargando...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#4FAEB2]/8 border border-[#4FAEB2]/20 mb-3">
                      <Package className="h-6 w-6 text-[#4FAEB2]" />
                    </div>
                    <p className="text-sm font-semibold text-slate-700">
                      {hayFiltros
                        ? "Ningún movimiento coincide con los filtros"
                        : "No hay movimientos registrados"}
                    </p>
                    {hayFiltros && (
                      <button
                        onClick={clearFiltros}
                        className="mt-2 text-xs font-semibold text-[#3F8E91] hover:underline"
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </td>
                </tr>
              ) : (
                items.map((m) => {
                  const Icon = TipoIcon[m.tipo];
                  const signo =
                    m.tipo === "ENTRADA"
                      ? "+"
                      : m.tipo === "SALIDA"
                      ? "−"
                      : m.cantidad >= 0
                      ? "+"
                      : "−";
                  const cantidadColor =
                    m.tipo === "ENTRADA"
                      ? "text-emerald-700"
                      : m.tipo === "SALIDA"
                      ? "text-red-600"
                      : "text-amber-700";

                  return (
                    <tr key={m.id} className="hover:bg-[#4FAEB2]/3 transition-colors">
                      <td className="px-5 py-3.5 font-semibold text-slate-800">
                        {m.producto_nombre}
                      </td>
                      <td className="hidden md:table-cell px-3 py-3.5 font-mono text-xs text-slate-500">
                        {m.producto_sku}
                      </td>
                      <td className="px-3 py-3.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold ${tipoBadge[m.tipo]}`}
                        >
                          <Icon className="h-3 w-3" strokeWidth={2.5} />
                          {m.tipo}
                        </span>
                      </td>
                      <td
                        className={`px-3 py-3.5 text-right font-bold tabular-nums ${cantidadColor}`}
                      >
                        {signo}
                        {Math.abs(m.cantidad)}
                      </td>
                      <td className="hidden lg:table-cell px-3 py-3.5 text-right tabular-nums text-slate-700 text-xs">
                        {formatGs(m.costo_unitario)}
                      </td>
                      <td className="hidden md:table-cell px-3 py-3.5">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-md text-[11px] font-semibold ${origenBadge[m.origen]}`}
                        >
                          {origenLabel[m.origen]}
                        </span>
                      </td>
                      <td className="hidden lg:table-cell px-3 py-3.5 text-slate-600 text-xs">
                        {m.usuario_nombre ?? (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-slate-500 text-xs tabular-nums whitespace-nowrap">
                        {formatFecha(m.fecha)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paginacion */}
        {total > 0 && (
          <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/40 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Mostrando <span className="font-semibold text-slate-700">{from}</span>–
              <span className="font-semibold text-slate-700">{to}</span> de{" "}
              <span className="font-semibold text-slate-700">{total}</span>{" "}
              {total === 1 ? "movimiento" : "movimientos"}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:text-slate-700"
                style={{ borderColor: page > 1 && !loading ? undefined : undefined }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Anterior
              </button>
              <span className="px-3 py-1.5 text-xs font-semibold text-slate-700 tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Suprimir warning si TURQ no se usa fuera del jsx */}
      <span style={{ display: "none" }}>{TURQ}</span>
    </div>
  );
}
