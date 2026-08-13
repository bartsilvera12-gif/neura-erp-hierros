"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileText, Plus, Loader2, Lock, ChevronDown } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { ESTADO_LABEL, type EstadoPresupuesto } from "@/lib/presupuestos/types";

/** Estados que el usuario puede elegir manualmente desde el listado (nunca 'convertido'). */
const ESTADOS_EDITABLES: EstadoPresupuesto[] = ["creado", "enviado", "aprobado", "rechazado"];

type PresupuestoRow = {
  id: string;
  numero_control: string;
  cliente_nombre: string;
  fecha: string;
  total: number | string;
  estado: EstadoPresupuesto;
  moneda: string;
};

const ESTADO_BADGE: Record<EstadoPresupuesto, string> = {
  creado: "bg-slate-100 text-slate-700",
  enviado: "bg-sky-100 text-sky-700",
  aprobado: "bg-emerald-100 text-emerald-700",
  rechazado: "bg-red-100 text-red-700",
  convertido: "bg-violet-100 text-violet-700",
};
const ESTADO_DOT: Record<EstadoPresupuesto, string> = {
  creado: "bg-slate-400",
  enviado: "bg-sky-500",
  aprobado: "bg-emerald-500",
  rechazado: "bg-red-500",
  convertido: "bg-violet-500",
};

function fmtGs(n: number | string, moneda: string) {
  const v = Number(n) || 0;
  return (moneda === "USD" ? "USD " : "Gs. ") + v.toLocaleString("es-PY", { maximumFractionDigits: moneda === "USD" ? 2 : 0 });
}
function fmtFecha(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

const FILTROS: { id: "todos" | EstadoPresupuesto; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "creado", label: "Creados" },
  { id: "enviado", label: "Enviados" },
  { id: "aprobado", label: "Aprobados" },
  { id: "rechazado", label: "Rechazados" },
  { id: "convertido", label: "Convertidos" },
];

export default function PresupuestosPage() {
  const [rows, setRows] = useState<PresupuestoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | EstadoPresupuesto>("todos");
  const [toast, setToast] = useState<{ tipo: "ok" | "error"; msg: string } | null>(null);
  const [actualizando, setActualizando] = useState<Set<string>>(new Set());

  const mostrarToast = useCallback((tipo: "ok" | "error", msg: string) => {
    setToast({ tipo, msg });
    setTimeout(() => setToast(null), 2800);
  }, []);

  /**
   * Cambia el estado de un presupuesto desde el listado con actualización optimista:
   * actualiza la fila de inmediato; si el PATCH falla, revierte al estado anterior.
   */
  const cambiarEstado = useCallback(
    async (id: string, anterior: EstadoPresupuesto, nuevo: EstadoPresupuesto) => {
      if (nuevo === anterior) return;
      // Optimista: aplicar ya.
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, estado: nuevo } : r)));
      setActualizando((prev) => new Set(prev).add(id));
      try {
        const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ estado: nuevo }),
        });
        const body = await res.json();
        if (!res.ok || body?.success === false) {
          // Rollback visual.
          setRows((prev) => prev.map((r) => (r.id === id ? { ...r, estado: anterior } : r)));
          mostrarToast("error", body?.error ?? "No se pudo cambiar el estado.");
          return;
        }
        mostrarToast("ok", "Estado actualizado");
      } catch {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, estado: anterior } : r)));
        mostrarToast("error", "Error de red al cambiar el estado.");
      } finally {
        setActualizando((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [mostrarToast]
  );

  const borrar = useCallback(
    async (id: string, numero: string) => {
      if (!window.confirm(`¿Borrar el presupuesto ${numero}? Esta acción no se puede deshacer.`)) return;
      setActualizando((prev) => new Set(prev).add(id));
      try {
        const res = await fetchWithSupabaseSession(`/api/presupuestos/${id}`, { method: "DELETE" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success === false) {
          mostrarToast("error", body?.error ?? "No se pudo borrar el presupuesto.");
          return;
        }
        setRows((prev) => prev.filter((r) => r.id !== id));
        mostrarToast("ok", `Presupuesto ${numero} borrado.`);
      } catch {
        mostrarToast("error", "Error de red al borrar.");
      } finally {
        setActualizando((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [mostrarToast]
  );

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/presupuestos", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudieron cargar los presupuestos.");
        return;
      }
      setRows((body.data?.presupuestos ?? []) as PresupuestoRow[]);
    } catch {
      setError("Error de red al cargar presupuestos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const filtradas = useMemo(
    () => (filtro === "todos" ? rows : rows.filter((r) => r.estado === filtro)),
    [rows, filtro]
  );

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg ${
            toast.tipo === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
          role="status"
        >
          {toast.tipo === "ok" ? "✓ " : "⚠ "}
          {toast.msg}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <FileText className="h-7 w-7 text-[#4FAEB2]" />
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Presupuestos</h1>
            <p className="text-gray-600">Cotizaciones comerciales. No afectan stock hasta convertirse en pedido.</p>
          </div>
        </div>
        <Link
          href="/presupuestos/nuevo"
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#3F8E91]"
        >
          <Plus className="h-4 w-4" /> Nuevo presupuesto
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              filtro === f.id ? "bg-[#4FAEB2] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-8 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : filtradas.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No hay presupuestos {filtro !== "todos" ? `en estado "${ESTADO_LABEL[filtro as EstadoPresupuesto]}"` : "todavía"}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-3 px-4 font-medium">Número</th>
                  <th className="py-3 px-4 font-medium">Cliente</th>
                  <th className="py-3 px-4 font-medium">Fecha</th>
                  <th className="py-3 px-4 font-medium text-right">Total</th>
                  <th className="py-3 px-4 font-medium w-48">Estado</th>
                  <th className="py-3 px-4 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtradas.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-medium text-gray-800">{r.numero_control}</td>
                    <td className="py-3 px-4 text-gray-700">{r.cliente_nombre}</td>
                    <td className="py-3 px-4 text-gray-600">{fmtFecha(r.fecha)}</td>
                    <td className="py-3 px-4 text-right tabular-nums font-semibold text-gray-800">{fmtGs(r.total, r.moneda)}</td>
                    <td className="py-3 px-4 align-middle">
                      {r.estado === "convertido" ? (
                        <span
                          className={`inline-flex h-8 w-36 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${ESTADO_BADGE.convertido}`}
                          title="Convertido en pedido — no editable"
                        >
                          <Lock className="h-3.5 w-3.5" /> {ESTADO_LABEL.convertido}
                        </span>
                      ) : (
                        <div className="relative inline-flex h-8 w-36 items-center">
                          <span className={`pointer-events-none absolute left-3 h-2 w-2 rounded-full ${ESTADO_DOT[r.estado]}`} aria-hidden />
                          <select
                            value={r.estado}
                            disabled={actualizando.has(r.id)}
                            onChange={(e) => cambiarEstado(r.id, r.estado, e.target.value as EstadoPresupuesto)}
                            className={`h-8 w-36 cursor-pointer appearance-none rounded-lg pl-7 pr-7 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#4FAEB2]/40 disabled:opacity-60 ${ESTADO_BADGE[r.estado]}`}
                            aria-label={`Estado de ${r.numero_control}`}
                          >
                            {ESTADOS_EDITABLES.map((s) => (
                              <option key={s} value={s} className="bg-white text-slate-700">{ESTADO_LABEL[s]}</option>
                            ))}
                          </select>
                          {actualizando.has(r.id) ? (
                            <Loader2 className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 animate-spin text-current opacity-70" />
                          ) : (
                            <ChevronDown className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 opacity-70" />
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-3">
                        <Link href={`/presupuestos/${r.id}`} className="text-sm font-medium text-[#4FAEB2] hover:underline">
                          Ver
                        </Link>
                        {r.estado !== "convertido" && (
                          <Link href={`/presupuestos/${r.id}/editar`} className="text-sm font-medium text-slate-600 hover:underline">
                            Editar
                          </Link>
                        )}
                        {r.estado !== "convertido" && (
                          <button
                            onClick={() => borrar(r.id, r.numero_control)}
                            disabled={actualizando.has(r.id)}
                            className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                          >
                            Borrar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
