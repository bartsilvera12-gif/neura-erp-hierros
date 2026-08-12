"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { generarYAbrirRecibo } from "@/lib/recibos/client";
import { RegistrarCobroModalCxc } from "@/components/cobros/RegistrarCobroModalCxc";

type Cuenta = {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  venta_id: string;
  numero_venta: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  moneda: string;
  total: number;
  saldo: number;
  estado: string;
  vencida: boolean;
};
type Cobro = {
  id: string;
  cliente_id: string | null;
  cliente_nombre: string;
  numero_venta: string | null;
  fecha_pago: string | null;
  monto: number;
  metodo_pago: string;
  referencia: string | null;
  usuario_nombre: string | null;
};

const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  parcial: "bg-sky-100 text-sky-700",
  pagado: "bg-emerald-100 text-emerald-700",
  vencido: "bg-red-100 text-red-700",
  anulado: "bg-slate-100 text-slate-500",
};
const METODO_LABEL: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", otro: "Otro",
};

function fmtGs(n: number, moneda = "PYG") {
  return (moneda === "USD" ? "USD " : "Gs. ") + Math.round(Number(n) || 0).toLocaleString("es-PY");
}
function ymd(iso: string | null): string {
  if (!iso) return "";
  return String(iso).slice(0, 10);
}
function fmtFecha(iso: string | null) {
  const s = ymd(iso);
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return d && m && y ? `${d}/${m}/${y}` : s;
}

const inputClass = "rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#4FAEB2]/40";

export default function PagosPage() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"pendientes" | "cobrados">("pendientes");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const [cobrando, setCobrando] = useState<Cuenta | null>(null);
  const [reciboBusy, setReciboBusy] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/cobros/cuentas", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudieron cargar las cobranzas.");
        return;
      }
      setCuentas((body.data?.cuentas ?? []) as Cuenta[]);
      setCobros((body.data?.cobros ?? []) as Cobro[]);
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const enRango = useCallback(
    (fecha: string | null) => {
      const f = ymd(fecha);
      if (!f) return !desde && !hasta;
      if (desde && f < desde) return false;
      if (hasta && f > hasta) return false;
      return true;
    },
    [desde, hasta]
  );

  // Pendientes = cuentas con saldo > 0 (incluye parciales). Filtro por emisión o vencimiento.
  const pendientes = useMemo(
    () =>
      cuentas
        .filter((c) => c.saldo > 0 && c.estado !== "anulado")
        .filter((c) => (!desde && !hasta) ? true : (enRango(c.fecha_emision) || enRango(c.fecha_vencimiento))),
    [cuentas, desde, hasta, enRango]
  );
  // Cobrados = historial de pagos. Filtro por fecha de pago.
  const cobradosVista = useMemo(
    () => cobros.filter((c) => (!desde && !hasta) ? true : enRango(c.fecha_pago)),
    [cobros, desde, hasta, enRango]
  );

  const sumPend = useMemo(
    () => pendientes.reduce((a, c) => ({ total: a.total + c.total, saldo: a.saldo + c.saldo }), { total: 0, saldo: 0 }),
    [pendientes]
  );
  const sumCob = useMemo(() => cobradosVista.reduce((a, c) => a + c.monto, 0), [cobradosVista]);

  function abrirCobro(c: Cuenta) {
    setCobrando(c);
  }

  const hayFiltro = !!desde || !!hasta;

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg">✓ {toast}</div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Banknote className="h-7 w-7 text-[#4FAEB2]" />
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Comercial</p>
            <h1 className="text-2xl font-bold text-gray-800">Cobranzas</h1>
            <p className="text-sm text-gray-500">Cuentas por cobrar de ventas a crédito y registro de cobros.</p>
          </div>
        </div>
        {/* Filtro de fechas */}
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Desde</label>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Hasta</label>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputClass} />
          </div>
          {hayFiltro && (
            <button type="button" onClick={() => { setDesde(""); setHasta(""); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Limpiar
            </button>
          )}
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-400">Cuentas con saldo</div>
          <div className="mt-1 text-2xl font-bold text-slate-800">{pendientes.length}</div>
          <div className="text-[11px] text-slate-400">de {cuentas.length} en total</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-amber-600">Saldo pendiente</div>
          <div className="mt-1 text-2xl font-bold text-amber-700">{fmtGs(sumPend.saldo)}</div>
          <div className="text-[11px] text-amber-500">Total: {fmtGs(sumPend.total)}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-emerald-600">Cobrado (filtros)</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">{fmtGs(sumCob)}</div>
          <div className="text-[11px] text-emerald-500">{cobradosVista.length} pagos</div>
        </div>
      </div>

      {/* Pestañas: solo 2 */}
      <div className="flex gap-2">
        <button onClick={() => setTab("pendientes")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "pendientes" ? "bg-[#4FAEB2] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Pendientes <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "pendientes" ? "bg-white/25" : "bg-slate-100"}`}>{pendientes.length}</span>
        </button>
        <button onClick={() => setTab("cobrados")} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === "cobrados" ? "bg-[#4FAEB2] text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Cobrados <span className={`rounded-full px-2 py-0.5 text-xs ${tab === "cobrados" ? "bg-white/25" : "bg-slate-100"}`}>{cobradosVista.length}</span>
        </button>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="p-8 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : tab === "pendientes" ? (
        <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {pendientes.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">No hay cuentas pendientes {hayFiltro ? "en el rango seleccionado" : ""}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">Cliente</th>
                    <th className="py-3 px-4 font-medium">Venta</th>
                    <th className="py-3 px-4 font-medium">Emisión</th>
                    <th className="py-3 px-4 font-medium">Vencimiento</th>
                    <th className="py-3 px-4 font-medium text-right">Total</th>
                    <th className="py-3 px-4 font-medium text-right">Cobrado</th>
                    <th className="py-3 px-4 font-medium text-right">Saldo</th>
                    <th className="py-3 px-4 font-medium">Estado</th>
                    <th className="py-3 px-4 font-medium text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pendientes.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 text-gray-700"><Link href={`/clientes/${c.cliente_id}/estado-cuenta`} className="hover:text-[#4FAEB2] hover:underline">{c.cliente_nombre}</Link></td>
                      <td className="py-3 px-4 font-mono font-medium text-gray-800">{c.numero_venta ?? "—"}</td>
                      <td className="py-3 px-4 text-gray-600">{fmtFecha(c.fecha_emision)}</td>
                      <td className={`py-3 px-4 ${c.vencida ? "font-semibold text-red-600" : "text-gray-600"}`}>{fmtFecha(c.fecha_vencimiento)}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{fmtGs(c.total, c.moneda)}</td>
                      <td className="py-3 px-4 text-right tabular-nums text-emerald-700">{fmtGs(c.total - c.saldo, c.moneda)}</td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-amber-600">{fmtGs(c.saldo, c.moneda)}</td>
                      <td className="py-3 px-4">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO_BADGE[c.vencida && c.estado !== "pagado" ? "vencido" : c.estado] ?? ESTADO_BADGE.pendiente}`}>
                          {c.vencida && c.estado !== "pagado" ? "Vencido" : c.estado.charAt(0).toUpperCase() + c.estado.slice(1)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button onClick={() => abrirCobro(c)} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]">Registrar pago</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/90">
                    <td colSpan={4} className="px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">Suma de la vista</p>
                      <p className="text-[11px] text-slate-500">{pendientes.length} registro{pendientes.length === 1 ? "" : "s"} · recalcula al cambiar fechas o pestaña</p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</span>
                      <p className="text-sm font-bold tabular-nums text-slate-800">{fmtGs(sumPend.total)}</p>
                    </td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Saldo</span>
                      <p className="text-sm font-bold tabular-nums text-amber-600">{fmtGs(sumPend.saldo)}</p>
                    </td>
                    <td colSpan={2} className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {cobradosVista.length === 0 ? (
            <div className="p-10 text-center text-sm text-gray-500">No hay cobros {hayFiltro ? "en el rango seleccionado" : "registrados"}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">Fecha</th>
                    <th className="py-3 px-4 font-medium">Cliente</th>
                    <th className="py-3 px-4 font-medium">Venta</th>
                    <th className="py-3 px-4 font-medium">Método</th>
                    <th className="py-3 px-4 font-medium">Referencia</th>
                    <th className="py-3 px-4 font-medium">Registrado por</th>
                    <th className="py-3 px-4 font-medium text-right">Monto</th>
                    <th className="py-3 px-4 font-medium text-right">Recibo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cobradosVista.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 text-gray-600">{fmtFecha(c.fecha_pago)}</td>
                      <td className="py-2.5 px-4 text-gray-700">
                        {c.cliente_id ? <Link href={`/clientes/${c.cliente_id}/estado-cuenta`} className="hover:text-[#4FAEB2] hover:underline">{c.cliente_nombre}</Link> : c.cliente_nombre}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-gray-700">{c.numero_venta ?? "—"}</td>
                      <td className="py-2.5 px-4 text-gray-600">{METODO_LABEL[c.metodo_pago] ?? c.metodo_pago}</td>
                      <td className="py-2.5 px-4 text-gray-500">{c.referencia ?? "—"}</td>
                      <td className="py-2.5 px-4 text-gray-600">{c.usuario_nombre ?? "—"}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-emerald-700">{fmtGs(c.monto)}</td>
                      <td className="py-2.5 px-4 text-right">
                        <button
                          disabled={reciboBusy === c.id}
                          onClick={async () => {
                            if (reciboBusy) return;
                            setReciboBusy(c.id);
                            try {
                              const r = await generarYAbrirRecibo({ origen: "cobro_cxc", cobro_cliente_id: c.id });
                              if (r.ok) { setToast("Recibo generado"); setTimeout(() => setToast(null), 2500); }
                              else { setError(r.error ?? "No se pudo generar el recibo."); }
                            } finally {
                              setReciboBusy(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {reciboBusy === c.id ? <><Loader2 className="h-3 w-3 animate-spin" /> Abriendo…</> : "Recibo"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/90">
                    <td colSpan={5} className="px-4 py-3">
                      <p className="text-xs font-semibold text-slate-700">Total cobrado en la vista</p>
                      <p className="text-[11px] text-slate-500">{cobradosVista.length} registro{cobradosVista.length === 1 ? "" : "s"} · recalcula al cambiar fechas</p>
                    </td>
                    <td className="px-4 py-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">Cobrado</td>
                    <td className="px-4 py-3 text-right"><p className="text-sm font-bold tabular-nums text-emerald-700">{fmtGs(sumCob)}</p></td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal registrar pago (componente compartido con campos de Transferencia/Tarjeta) */}
      <RegistrarCobroModalCxc
        open={!!cobrando}
        cuenta={cobrando ? { id: cobrando.id, numero_venta: cobrando.numero_venta, saldo: cobrando.saldo, moneda: cobrando.moneda, cliente_nombre: cobrando.cliente_nombre } : null}
        onClose={() => setCobrando(null)}
        onExito={async () => { setToast("Pago registrado"); setTimeout(() => setToast(null), 2800); await cargar(); }}
      />
    </div>
  );
}
