"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import MobileFab from "@/components/ui/MobileFab";
import { getVentas } from "@/lib/ventas/storage";
import PedidosPendientesCaja from "./PedidosPendientesCaja";
import PedidosConsultaPendientes from "./PedidosConsultaPendientes";
import CajaControlPanel from "@/components/caja/CajaControlPanel";
import DevolucionWizard from "@/components/devoluciones/DevolucionWizard";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { Venta, TipoVenta, TipoIvaVenta } from "@/lib/ventas/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d    = new Date(iso);
    const dd   = String(d.getDate()).padStart(2, "0");
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh   = String(d.getHours()).padStart(2, "0");
    const min  = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

// ── Constantes de estilo ───────────────────────────────────────────────────────

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none";

const tipoVentaBadge: Record<TipoVenta, string> = {
  CONTADO: "bg-blue-50 text-blue-700",
  CREDITO: "bg-orange-50 text-orange-700",
};

const ivaLabel: Record<TipoIvaVenta, string> = {
  EXENTA: "Exenta",
  "5%":   "IVA 5%",
  "10%":  "IVA 10%",
};


// ── Helpers de fila ───────────────────────────────────────────────────────────

/** Muestra el primer producto de la venta y un badge con el resto. */
function ResumenProductos({ v }: { v: Venta }) {
  const primero = v.items[0];
  if (!primero) {
    return (
      <span className="text-xs text-gray-400">Sin líneas cargadas</span>
    );
  }
  const extra   = v.items.length - 1;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-gray-800 leading-tight">
        {primero.producto_nombre}
      </span>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="font-mono text-xs text-gray-400">{primero.sku}</span>
        {extra > 0 && (
          <span className="bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded-full font-medium">
            +{extra} más
          </span>
        )}
      </div>
    </div>
  );
}

/** Determina qué mostrar en la celda IVA cuando hay múltiples ítems. */
function ivaResumen(v: Venta): string {
  const tipos = [...new Set(v.items.map((i) => i.tipo_iva))];
  if (tipos.length === 1) return ivaLabel[tipos[0]];
  return "Mixto";
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function VentasPage() {
  const [todas,      setTodas]      = useState<Venta[]>([]);
  const [busqueda,   setBusqueda]   = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoVenta | "">("");
  const [filtroIva,  setFiltroIva]  = useState<TipoIvaVenta | "">("");
  const [mostrarAnuladas, setMostrarAnuladas] = useState(true);
  const [detalle,    setDetalle]    = useState<Venta | null>(null);
  const [anularTarget, setAnularTarget] = useState<Venta | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [devolucionesOn, setDevolucionesOn] = useState(false);
  const [devolverVentaId, setDevolverVentaId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/devoluciones/flag", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setDevolucionesOn(j?.data?.enabled === true); })
      .catch(() => { if (!cancelled) setDevolucionesOn(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getVentas().then((data) => {
      if (cancelled) return;
      const ordenadas = [...data].sort((a, b) => {
        const ta = new Date(a.fecha).getTime();
        const tb = new Date(b.fecha).getTime();
        return tb - ta || b.numero_control.localeCompare(a.numero_control);
      });
      setTodas(ordenadas);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtradas = todas.filter((v) => {
    // Anuladas ocultas por defecto (toggle "Ver anuladas" las muestra).
    if (!mostrarAnuladas && v.estado === "anulada") return false;
    // Búsqueda por tokens: número de control, nombre o SKU de cualquier ítem.
    if (busqueda.trim() !== "" && !productoMatchesQuery(
      busqueda,
      v.numero_control,
      ...v.items.map((i) => i.producto_nombre),
      ...v.items.map((i) => i.sku),
    )) return false;
    // Tipo de venta
    if (filtroTipo !== "" && v.tipo_venta !== filtroTipo) return false;
    // IVA: coincide si al menos un ítem tiene ese tipo
    if (filtroIva !== "" && !v.items.some((i) => i.tipo_iva === filtroIva))
      return false;
    return true;
  });

  const hayFiltros = busqueda || filtroTipo || filtroIva || mostrarAnuladas;

  return (
    <div className="space-y-8">

      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
            Zentra · Operaciones
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Caja</h1>
            <p className="mt-0.5 text-xs text-slate-500">Cobro, facturación y cierre de pedidos</p>
          </div>
          {devolucionesOn && (
            <Link
              href="/ventas/devoluciones"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              Devoluciones
            </Link>
          )}
        </div>
      </div>

      <CajaControlPanel />

      <PedidosConsultaPendientes />
      <PedidosPendientesCaja />


      {/* ── Tabla de ventas ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Órdenes de venta</h2>
          <Link
            href="/ventas/nueva"
            className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            + Nueva venta
          </Link>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          <input
            type="text"
            placeholder="Buscar por número, producto o SKU..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-0 flex-1 sm:min-w-64`}
          />
          <FancySelect
            value={filtroTipo}
            onChange={(v) => setFiltroTipo(v as TipoVenta | "")}
            ariaLabel="Filtrar por tipo de venta"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los tipos" },
              { value: "CONTADO", label: "Contado" },
              { value: "CREDITO", label: "Crédito" },
            ]}
          />
          <FancySelect
            value={filtroIva}
            onChange={(v) => setFiltroIva(v as TipoIvaVenta | "")}
            ariaLabel="Filtrar por IVA"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los IVA" },
              { value: "EXENTA", label: "Exenta" },
              { value: "5%", label: "IVA 5%" },
              { value: "10%", label: "IVA 10%" },
            ]}
          />
          <label className="inline-flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={mostrarAnuladas}
              onChange={(e) => setMostrarAnuladas(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]"
            />
            Ver anuladas
          </label>
          {hayFiltros && (
            <button
              onClick={() => { setBusqueda(""); setFiltroTipo(""); setFiltroIva(""); setMostrarAnuladas(false); }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2"
            >
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {filtradas.length} de {todas.length} ventas
          </span>
        </div>

        {/* Tabla — min-w fuerza scroll horizontal en mobile; columnas secundarias
            (Items, Cant total, IVA, Pago) se ocultan progresivamente. */}
        <EdgeScrollArea>
          <table className="w-full min-w-[760px] lg:min-w-0 text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-sm font-semibold">
                <th className="py-3 pr-4 font-medium">Número</th>
                <th className="py-3 pr-4 font-medium">Productos</th>
                <th className="hidden py-3 pr-4 text-center font-medium lg:table-cell">Ítems</th>
                <th className="py-3 pr-4 font-medium text-right hidden lg:table-cell">Cant. total</th>
                <th className="py-3 pr-4 font-medium hidden lg:table-cell">IVA</th>
                <th className="py-3 pr-4 font-medium text-right">Total</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Tipo</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Pago</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Vendedor</th>
                <th className="py-3 pr-4 font-medium">Fecha</th>
                <th className="py-3 font-medium text-center">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-gray-400">
                    {todas.length === 0
                      ? "No hay ventas registradas"
                      : "Ninguna venta coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                filtradas.map((v) => {
                  const cantTotal = v.items.reduce((s, i) => s + i.cantidad, 0);
                  const isAnulada = v.estado === "anulada";
                  return (
                    <tr
                      key={v.id}
                      onClick={() => setDetalle(v)}
                      className={`border-b border-slate-200 last:border-0 transition-colors cursor-pointer ${
                        isAnulada ? "bg-red-50/40 text-slate-400 line-through hover:bg-red-50/60" : "hover:bg-[#4FAEB2]/[0.04]"
                      }`}
                    >
                      <td className="py-4 pr-4 font-mono text-xs text-gray-500 align-middle">
                        <div className="flex items-center gap-1.5">
                          <span>{v.numero_control}</span>
                          {isAnulada && (
                            <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700 no-underline">
                              Anulada
                            </span>
                          )}
                          {v.estado === "devuelta_total" && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800 no-underline">
                              Devuelta
                            </span>
                          )}
                          {v.estado === "parcialmente_devuelta" && (
                            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 no-underline">
                              Dev. parcial
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <ResumenProductos v={v} />
                      </td>
                      <td className="hidden py-4 pr-4 text-center align-middle lg:table-cell">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                          {v.items.length}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-right tabular-nums text-gray-700 align-middle hidden lg:table-cell">
                        {cantTotal}
                      </td>
                      <td className="py-4 pr-4 align-middle hidden lg:table-cell">
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
                          {ivaResumen(v)}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-right tabular-nums font-semibold text-gray-800 align-middle">
                        {formatGs(v.total)}
                      </td>
                      <td className="hidden py-4 pr-4 align-middle lg:table-cell">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${tipoVentaBadge[v.tipo_venta]}`}>
                          {v.tipo_venta === "CONTADO"
                            ? "Contado"
                            : `Crédito ${v.plazo_dias ?? ""}d`}
                        </span>
                      </td>
                      <td className="hidden py-4 pr-4 align-middle text-xs text-gray-600 lg:table-cell">
                        {v.metodo_pago === "mixto" ? (
                          <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">
                            Mixto
                          </span>
                        ) : v.metodo_pago === "tarjeta" ? "Tarjeta"
                          : v.metodo_pago === "transferencia" ? "Transfer."
                          : v.metodo_pago === "efectivo" ? "Efectivo"
                          : "—"}
                      </td>
                      <td className="hidden py-4 pr-4 align-middle text-xs text-gray-600 lg:table-cell">
                        {v.usuario_nombre ?? "—"}
                      </td>
                      <td className="py-4 pr-4 text-gray-500 text-xs tabular-nums align-middle">
                        {formatFecha(v.fecha)}
                      </td>
                      <td className="py-4 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          {devolucionesOn && !isAnulada && v.estado !== "devuelta_total" && (
                            <button
                              type="button"
                              onClick={() => setDevolverVentaId(v.id)}
                              className="inline-flex items-center justify-center rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
                              title="Ver detalle y registrar una devolución"
                            >
                              {v.estado === "parcialmente_devuelta" ? "Devolver más" : "Devolver"}
                            </button>
                          )}
                          <a
                            href={`/api/ventas/${v.id}/comprobante-a4`}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                            title="Abrir comprobante A4 imprimible"
                          >
                            Imprimir
                          </a>
                          <a
                            href={`/api/ventas/${v.id}/factura?auto=1`}
                            target="_blank"
                            rel="noopener"
                            className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                            title="Emitir / ver factura electrónica"
                          >
                            Factura
                          </a>
                          {v.genera_nota_remision && (
                            <a
                              href={`/api/ventas/${v.id}/ticket?tipo=remision`}
                              target="_blank"
                              rel="noopener"
                              className="inline-flex items-center justify-center rounded-md border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 hover:bg-sky-100 transition-colors"
                              title="Nota de remisión (documento no fiscal)"
                            >
                              Nota de remisión
                            </a>
                          )}
                          {!isAnulada && (
                            <button
                              type="button"
                              onClick={() => setAnularTarget(v)}
                              className="inline-flex items-center justify-center rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 transition-colors"
                              title={
                                v.estado === "devuelta_total" || v.estado === "parcialmente_devuelta"
                                  ? "Anular la operación completa (venta + devolución)"
                                  : "Anular venta y revertir stock"
                              }
                            >
                              Anular
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>

      </div>

      {/* FAB mobile: acceso 1-tap a "+ Nueva venta" desde cualquier scroll position */}
      <MobileFab href="/ventas/nueva" label="Nueva venta" />

      {detalle && <VentaDetalleModal venta={detalle} onClose={() => setDetalle(null)} />}

      {devolucionesOn && devolverVentaId && (
        <DevolucionWizard
          ventaId={devolverVentaId}
          onClose={() => setDevolverVentaId(null)}
          onDone={(devId) => {
            setDevolverVentaId(null);
            try { window.open(`/api/devoluciones/${devId}/comprobante?auto=1`, "_blank", "noopener"); } catch {}
            setReloadKey((k) => k + 1);
          }}
        />
      )}
      {anularTarget && (
        <AnularVentaModal
          venta={anularTarget}
          onClose={() => setAnularTarget(null)}
          onDone={() => {
            setAnularTarget(null);
            setReloadKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function AnularVentaModal({
  venta,
  onClose,
  onDone,
}: {
  venta: Venta;
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ventas/${venta.id}/anular`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: motivo.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error ?? `Error ${res.status}`);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo anular la venta.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border-2 border-red-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-red-100 bg-red-50/60 px-5 py-4">
          <h3 className="text-base font-bold text-red-800">Anular venta {venta.numero_control}</h3>
          <p className="mt-1 text-xs text-red-700">
            {venta.estado === "devuelta_total" || venta.estado === "parcialmente_devuelta"
              ? "Se van a anular también las devoluciones asociadas, revirtiendo stock y caja para dejar todo como antes de la operación. Esta acción no se puede deshacer."
              : "Se va a devolver el stock al inventario y revertir el movimiento de caja de esta venta. Esta acción no se puede deshacer."}
          </p>
        </div>
        <div className="p-5 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Motivo (opcional)</span>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: error de carga, cliente devolvió, etc."
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-400 focus:ring-2 focus:ring-red-200 outline-none"
              rows={3}
              disabled={loading}
            />
          </label>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={loading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? "Anulando..." : "Anular venta"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modal de detalle de venta ───────────────────────────────────────────────────

function VentaDetalleModal({ venta, onClose }: { venta: Venta; onClose: () => void }) {
  const cantTotal = venta.items.reduce((s, i) => s + i.cantidad, 0);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <div>
            <h3 className="font-mono text-sm font-bold text-[#3F8E91]">{venta.numero_control}</h3>
            <p className="mt-0.5 text-xs text-slate-500">Detalle de la venta</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Meta: fecha/hora, vendedor, tipo, pago */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-4">
          <Meta label="Fecha y hora" value={formatFecha(venta.fecha)} />
          <Meta label="Vendedor" value={venta.usuario_nombre ?? "—"} />
          <Meta
            label="Tipo"
            value={venta.tipo_venta === "CONTADO" ? "Contado" : `Crédito ${venta.plazo_dias ?? ""}d`}
          />
          <Meta
            label="Pago"
            value={
              venta.metodo_pago === "mixto" ? "Mixto"
              : venta.metodo_pago === "tarjeta" ? "Tarjeta"
              : venta.metodo_pago === "transferencia" ? "Transferencia"
              : venta.metodo_pago === "efectivo" ? "Efectivo"
              : "—"
            }
          />
        </div>

        {/* Ítems */}
        <div className="max-h-[50vh] overflow-y-auto px-5 pb-2">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2 text-center font-semibold">Cant.</th>
                  <th className="px-3 py-2 text-right font-semibold">P. Unit.</th>
                  <th className="px-3 py-2 text-center font-semibold">IVA</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {venta.items.map((it, idx) => (
                  <tr key={`${it.producto_id}-${idx}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{it.producto_nombre}</div>
                      <div className="font-mono text-xs text-slate-400">{it.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-slate-700">{it.cantidad}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatGs(it.precio_venta)}</td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">{ivaLabel[it.tipo_iva]}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{formatGs(it.total_linea)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totales */}
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <Fila label={`Subtotal (${venta.items.length} ítem(s), ${cantTotal} u.)`} value={formatGs(venta.subtotal)} />
            <Fila label="IVA" value={formatGs(venta.monto_iva)} />
            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Total</span>
              <span className="tabular-nums">{formatGs(venta.total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

function Fila({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
