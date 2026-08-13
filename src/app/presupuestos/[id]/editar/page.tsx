"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import SelectFromList from "@/components/inventario/SelectFromList";
import ClienteBuscador, { type ClienteBuscadorItem } from "@/components/clientes/ClienteBuscador";
import { calcMontoIvaIncluido, type IvaTipoPresupuesto } from "@/lib/presupuestos/types";

type ProductoLite = { id: string; nombre: string; sku: string; precio_venta: number; unidad_medida: string; };
type ClienteLite = { id: string; nombre: string; ruc: string | null; telefono: string | null; direccion: string | null; };
type Item = {
  producto_id: string | null;
  producto_nombre: string;
  sku: string | null;
  cantidad: number;
  unidad_medida: string | null;
  precio_unitario: number;
  iva_tipo: IvaTipoPresupuesto;
  descuento: number;
};

function fmtGs(n: number) {
  return "Gs. " + (Number(n) || 0).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}
function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function itemTotals(it: Item) {
  const bruto = (Number(it.precio_unitario) || 0) * (Number(it.cantidad) || 0);
  const total = Math.max(0, bruto - (Number(it.descuento) || 0));
  const iva = round2(calcMontoIvaIncluido(it.iva_tipo, total));
  return { total: round2(total), iva, subtotal: round2(total - iva) };
}

const IVAS: IvaTipoPresupuesto[] = ["10%", "5%", "EXENTA"];
const labelClass = "block text-xs font-medium text-gray-600 mb-1";
const inputClass = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm";

export default function EditarPresupuestoPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const presupuestoId = params?.id ?? "";

  const [productos, setProductos] = useState<ProductoLite[]>([]);
  const [clientes, setClientes] = useState<ClienteLite[]>([]);

  const [numeroControl, setNumeroControl] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clienteNombre, setClienteNombre] = useState("");
  const [clienteRuc, setClienteRuc] = useState("");
  const [clienteTel, setClienteTel] = useState("");
  const [clienteDir, setClienteDir] = useState("");

  const [items, setItems] = useState<Item[]>([]);
  const [selProd, setSelProd] = useState("");

  const [validezDias, setValidezDias] = useState("15");
  const [formaPago, setFormaPago] = useState("");
  const [plazoEntrega, setPlazoEntrega] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bloqueado, setBloqueado] = useState<string | null>(null);

  // Cargar productos y clientes
  useEffect(() => {
    fetchWithSupabaseSession("/api/productos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          const list = (j.data?.productos ?? []) as Record<string, unknown>[];
          setProductos(list.filter((p) => p.es_vendible !== false).map((p) => ({
            id: String(p.id), nombre: String(p.nombre), sku: String(p.sku ?? ""),
            precio_venta: Number(p.precio_venta) || 0, unidad_medida: String(p.unidad_medida ?? "UNIDAD"),
          })));
        }
      }).catch(() => {});
    fetchWithSupabaseSession("/api/clientes", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success && Array.isArray(j.data)) {
          const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
          setClientes((j.data as Record<string, unknown>[]).map((r) => ({
            id: String(r.id),
            nombre: s(r.empresa) || s(r.nombre_contacto) || s(r.nombre) || "Cliente",
            ruc: s(r.ruc) || null, telefono: s(r.telefono) || null, direccion: s(r.direccion) || null,
          })));
        }
      }).catch(() => {});
  }, []);

  // Cargar presupuesto existente
  useEffect(() => {
    if (!presupuestoId) return;
    (async () => {
      try {
        const r = await fetchWithSupabaseSession(`/api/presupuestos/${presupuestoId}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok || !j?.success) { setError(j?.error ?? "No se pudo cargar el presupuesto."); setCargando(false); return; }
        const p = j.data.presupuesto as Record<string, unknown>;
        const its = (j.data.items ?? []) as Record<string, unknown>[];
        if (p.estado === "convertido") {
          setBloqueado("Este presupuesto ya fue convertido en pedido y no se puede editar.");
          setCargando(false);
          return;
        }
        setNumeroControl(String(p.numero_control ?? ""));
        setClienteId(p.cliente_id ? String(p.cliente_id) : "");
        setClienteNombre(String(p.cliente_nombre ?? ""));
        setClienteRuc(String(p.cliente_ruc ?? ""));
        setClienteTel(String(p.cliente_telefono ?? ""));
        setClienteDir(String(p.cliente_direccion ?? ""));
        setValidezDias(p.validez_dias ? String(p.validez_dias) : "");
        setFormaPago(String(p.forma_pago ?? ""));
        setPlazoEntrega(String(p.plazo_entrega ?? ""));
        setObservaciones(String(p.observaciones ?? ""));
        setItems(its.map((it) => ({
          producto_id: it.producto_id ? String(it.producto_id) : null,
          producto_nombre: String(it.producto_nombre ?? ""),
          sku: it.sku ? String(it.sku) : null,
          cantidad: Number(it.cantidad) || 0,
          unidad_medida: it.unidad_medida ? String(it.unidad_medida) : null,
          precio_unitario: Number(it.precio_unitario) || 0,
          iva_tipo: (it.iva_tipo === "5%" || it.iva_tipo === "EXENTA" ? it.iva_tipo : "10%") as IvaTipoPresupuesto,
          descuento: Number(it.descuento) || 0,
        })));
        setCargando(false);
      } catch {
        setError("Error de red cargando el presupuesto.");
        setCargando(false);
      }
    })();
  }, [presupuestoId]);

  function seleccionarCliente(id: string) {
    setClienteId(id);
    const c = clientes.find((x) => x.id === id);
    if (c) {
      setClienteNombre(c.nombre); setClienteRuc(c.ruc ?? ""); setClienteTel(c.telefono ?? ""); setClienteDir(c.direccion ?? "");
    }
  }
  function agregarProducto() {
    const p = productos.find((x) => x.id === selProd);
    if (!p) return;
    if (items.some((it) => it.producto_id === p.id)) return;
    setItems((prev) => [...prev, {
      producto_id: p.id, producto_nombre: p.nombre, sku: p.sku || null,
      cantidad: 1, unidad_medida: p.unidad_medida, precio_unitario: p.precio_venta, iva_tipo: "10%", descuento: 0,
    }]);
    setSelProd("");
  }
  function agregarManual() {
    setItems((prev) => [...prev, {
      producto_id: null, producto_nombre: "", sku: null,
      cantidad: 1, unidad_medida: null, precio_unitario: 0, iva_tipo: "10%", descuento: 0,
    }]);
  }
  function updItem(i: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function delItem(i: number) {
    setItems((prev) => prev.filter((_, idx) => idx !== i));
  }

  const totales = useMemo(() => {
    let subtotal = 0, iva = 0, desc = 0, total = 0;
    for (const it of items) {
      const t = itemTotals(it);
      subtotal += t.subtotal; iva += t.iva; total += t.total; desc += Number(it.descuento) || 0;
    }
    return { subtotal: round2(subtotal), iva: round2(iva), desc: round2(desc), total: round2(total) };
  }, [items]);

  const valido =
    clienteNombre.trim().length > 0 &&
    items.length > 0 &&
    items.every((it) => it.producto_nombre.trim() && it.cantidad > 0 && it.precio_unitario >= 0);

  async function guardar() {
    if (guardando || !valido) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession(`/api/presupuestos/${presupuestoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId || null,
          cliente_nombre: clienteNombre.trim(),
          cliente_ruc: clienteRuc.trim() || null,
          cliente_telefono: clienteTel.trim() || null,
          cliente_direccion: clienteDir.trim() || null,
          moneda: "PYG",
          validez_dias: validezDias.trim() === "" ? null : parseInt(validezDias, 10),
          forma_pago: formaPago.trim() || null,
          plazo_entrega: plazoEntrega.trim() || null,
          observaciones: observaciones.trim() || null,
          items: items.map((it) => ({
            producto_id: it.producto_id,
            producto_nombre: it.producto_nombre.trim(),
            sku: it.sku,
            cantidad: Number(it.cantidad),
            unidad_medida: it.unidad_medida,
            precio_unitario: Number(it.precio_unitario),
            iva_tipo: it.iva_tipo,
            descuento: Number(it.descuento) || 0,
          })),
        }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudo guardar el presupuesto.");
        return;
      }
      router.push(`/presupuestos/${presupuestoId}`);
    } catch {
      setError("Error de red al guardar el presupuesto.");
    } finally {
      setGuardando(false);
    }
  }

  if (cargando) {
    return (
      <div className="space-y-4">
        <Link href="/presupuestos" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Volver a presupuestos
        </Link>
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">Cargando presupuesto…</p>
      </div>
    );
  }

  if (bloqueado) {
    return (
      <div className="space-y-4">
        <Link href={`/presupuestos/${presupuestoId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" /> Volver
        </Link>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{bloqueado}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href={`/presupuestos/${presupuestoId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Volver a {numeroControl || "presupuesto"}
      </Link>

      <div className="flex items-center gap-3">
        <FileText className="h-7 w-7 text-[#4FAEB2]" />
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Editar {numeroControl}</h1>
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {/* Cliente */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Cliente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <ClienteBuscador
              clientes={clientes as ClienteBuscadorItem[]}
              value={clienteId}
              onSelect={(c) => {
                setClienteId(c.id);
                setClienteNombre(c.nombre);
                setClienteRuc(c.ruc ?? "");
                setClienteTel(c.telefono ?? "");
                setClienteDir(c.direccion ?? "");
              }}
              onClear={() => setClienteId("")}
              label="Cliente existente (opcional)"
            />
            <p className="mt-1 text-[11px] text-gray-400">O completá los campos de abajo manualmente si es un cliente nuevo.</p>
          </div>
          <div>
            <label className={labelClass}>Nombre / Razón social *</label>
            <input value={clienteNombre} onChange={(e) => { setClienteId(""); setClienteNombre(e.target.value); }} className={inputClass} placeholder="Nombre del cliente" />
          </div>
          <div>
            <label className={labelClass}>RUC / CI</label>
            <input value={clienteRuc} onChange={(e) => setClienteRuc(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Teléfono</label>
            <input value={clienteTel} onChange={(e) => setClienteTel(e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Dirección</label>
            <input value={clienteDir} onChange={(e) => setClienteDir(e.target.value)} className={inputClass} />
          </div>
        </div>
      </div>

      {/* Productos */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Productos</h2>
        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[260px]">
            <label className={labelClass}>Agregar desde inventario</label>
            <SelectFromList
              value={selProd || null}
              onChange={(v) => setSelProd(v ?? "")}
              placeholder="— Buscá un producto por nombre o SKU —"
              options={productos.filter((p) => !items.some((it) => it.producto_id === p.id))
                .map((p) => ({ id: p.id, label: p.nombre, sublabel: p.sku || undefined }))}
            />
          </div>
          <button type="button" onClick={agregarProducto} disabled={!selProd} className="inline-flex items-center gap-1 rounded-md bg-[#4FAEB2] px-3 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
            <Plus className="h-4 w-4" /> Agregar
          </button>
          <button type="button" onClick={agregarManual} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Ítem manual
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-gray-500">Sin ítems. Agregá productos del inventario o ítems manuales.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-gray-500 uppercase">
                <tr>
                  <th className="py-2 pr-2">Descripción</th>
                  <th className="py-2 px-2 w-20">Cant.</th>
                  <th className="py-2 px-2 w-32">Precio unit.</th>
                  <th className="py-2 px-2 w-24">IVA</th>
                  <th className="py-2 px-2 w-28">Descuento</th>
                  <th className="py-2 px-2 w-32 text-right">Total</th>
                  <th className="py-2 pl-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((it, i) => {
                  const t = itemTotals(it);
                  return (
                    <tr key={i}>
                      <td className="py-2 pr-2">
                        <input value={it.producto_nombre} onChange={(e) => updItem(i, { producto_nombre: e.target.value })} className={inputClass} placeholder="Descripción" />
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="0.01" value={it.cantidad} onChange={(e) => updItem(i, { cantidad: Number(e.target.value) })} onFocus={(e) => e.target.select()} className={inputClass} />
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="1" value={it.precio_unitario === 0 ? "" : it.precio_unitario} onChange={(e) => updItem(i, { precio_unitario: e.target.value === "" ? 0 : Number(e.target.value) })} onFocus={(e) => e.target.select()} className={inputClass} />
                      </td>
                      <td className="py-2 px-2">
                        <select value={it.iva_tipo} onChange={(e) => updItem(i, { iva_tipo: e.target.value as IvaTipoPresupuesto })} className={`${inputClass} bg-white`}>
                          {IVAS.map((iv) => <option key={iv} value={iv}>{iv}</option>)}
                        </select>
                      </td>
                      <td className="py-2 px-2">
                        <input type="number" min="0" step="1" value={it.descuento === 0 ? "" : it.descuento} onChange={(e) => updItem(i, { descuento: e.target.value === "" ? 0 : Number(e.target.value) })} onFocus={(e) => e.target.select()} className={inputClass} />
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums font-medium">{fmtGs(t.total)}</td>
                      <td className="py-2 pl-2 text-right">
                        <button onClick={() => delItem(i)} className="text-red-600 hover:text-red-700" aria-label="Eliminar"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {items.length > 0 && (
          <div className="mt-4 ml-auto w-full sm:w-72 text-sm space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal (sin IVA)</span><span className="tabular-nums">{fmtGs(totales.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">IVA</span><span className="tabular-nums">{fmtGs(totales.iva)}</span></div>
            {totales.desc > 0 && <div className="flex justify-between"><span className="text-gray-500">Descuentos</span><span className="tabular-nums">- {fmtGs(totales.desc)}</span></div>}
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-base"><span>Total</span><span className="tabular-nums text-[#4FAEB2]">{fmtGs(totales.total)}</span></div>
          </div>
        )}
      </div>

      {/* Condiciones */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Condiciones comerciales</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Validez (días)</label>
            <input type="number" min="0" value={validezDias} onChange={(e) => setValidezDias(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Forma de pago</label>
            <input value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Plazo de entrega</label>
            <input value={plazoEntrega} onChange={(e) => setPlazoEntrega(e.target.value)} className={inputClass} />
          </div>
          <div className="sm:col-span-3">
            <label className={labelClass}>Observaciones</label>
            <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} className={inputClass} />
          </div>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Link href={`/presupuestos/${presupuestoId}`} className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
          Cancelar
        </Link>
        <button onClick={guardar} disabled={!valido || guardando} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
          {guardando ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : "Guardar cambios"}
        </button>
      </div>
    </div>
  );
}
