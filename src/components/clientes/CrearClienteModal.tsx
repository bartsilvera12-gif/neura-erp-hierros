"use client";

/**
 * Modal de alta rápida de cliente. Crea un cliente REAL (mismo endpoint que el
 * módulo Clientes → aparece en ese listado) y devuelve el creado por onCreated
 * para poder seleccionarlo al instante (ej. en una venta de Caja).
 *
 * Campos: los básicos que usa el alta de ferretería (empresa/persona, razón
 * social, contacto, RUC/CI, teléfono, email, dirección, ciudad).
 */
import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiCreateCliente } from "@/lib/api/client";

export interface ClienteCreado {
  id: string;
  label: string;
  ruc: string | null;
  usa_nota_remision: boolean;
}

type TipoCli = "empresa" | "persona";

const inputClass =
  "w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-600";

export default function CrearClienteModal({
  onClose,
  onCreated,
  initialNombre = "",
  initialRuc = "",
}: {
  onClose: () => void;
  onCreated: (c: ClienteCreado) => void;
  initialNombre?: string;
  initialRuc?: string;
}) {
  const [tipo, setTipo] = useState<TipoCli>("empresa");
  const [empresa, setEmpresa] = useState(initialNombre);
  const [contacto, setContacto] = useState(initialNombre);
  const [ruc, setRuc] = useState(initialRuc);
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [direccion, setDireccion] = useState("");
  const [ciudad, setCiudad] = useState("");
  const [pais, setPais] = useState("PARAGUAY");
  const [usaNotaRemision, setUsaNotaRemision] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (!contacto.trim()) {
      setErr(tipo === "empresa" ? "Ingresá la persona de contacto." : "Ingresá el nombre del cliente.");
      return;
    }
    if (tipo === "empresa" && !empresa.trim()) {
      setErr("La razón social es obligatoria para empresas.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiCreateCliente({
        tipo_cliente: tipo,
        empresa: tipo === "empresa" ? empresa.trim().toUpperCase() : undefined,
        nombre_contacto: contacto.trim().toUpperCase(),
        ruc: tipo === "empresa" ? (ruc.trim() || undefined) : undefined,
        documento: tipo === "persona" ? (documento.trim() || undefined) : undefined,
        telefono: telefono.trim() || undefined,
        email: email.trim() || undefined,
        direccion: direccion.trim() || undefined,
        ciudad: ciudad.trim().toUpperCase() || undefined,
        pais: pais.trim().toUpperCase() || undefined,
        estado: "activo",
        usa_nota_remision: usaNotaRemision,
        // Facturación B2B: alcanza con el RUC. El receptor SIFEN se detecta
        // automáticamente del RUC — no forzamos modo manual (exigiría iTiOpe).
      });
      if (!res.ok) {
        setErr(res.error || "No se pudo crear el cliente.");
        setBusy(false);
        return;
      }
      const label = (tipo === "empresa" ? empresa.trim() : contacto.trim()).toUpperCase() || "Cliente";
      onCreated({
        id: res.data.id,
        label,
        ruc: (tipo === "empresa" ? ruc.trim() : documento.trim()) || null,
        usa_nota_remision: usaNotaRemision,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error de red.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={busy ? undefined : onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-800">Crear cliente</h3>
            <p className="mt-0.5 text-xs text-slate-500">Se crea en el módulo Clientes y queda seleccionado en la venta.</p>
          </div>
          <button onClick={onClose} disabled={busy} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          {/* Tipo */}
          <div className="flex overflow-hidden rounded-lg border-2 border-slate-200 text-sm font-bold">
            {(["empresa", "persona"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                className={`flex-1 py-2 transition-colors ${tipo === t ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-50"} ${t === "persona" ? "border-l-2 border-slate-200" : ""}`}
              >
                {t === "empresa" ? "Empresa" : "Persona"}
              </button>
            ))}
          </div>

          {tipo === "empresa" && (
            <div>
              <label className={labelClass}>Razón social <span className="text-red-500">*</span></label>
              <input className={`${inputClass} uppercase`} value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Razón social" autoFocus />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>{tipo === "empresa" ? "Persona de contacto" : "Nombre completo"} <span className="text-red-500">*</span></label>
              <input className={`${inputClass} uppercase`} value={contacto} onChange={(e) => setContacto(e.target.value)} placeholder="Nombre" autoFocus={tipo === "persona"} />
            </div>
            <div>
              <label className={labelClass}>{tipo === "empresa" ? "RUC" : "CI / Documento"}</label>
              {tipo === "empresa" ? (
                <input className={inputClass} value={ruc} onChange={(e) => setRuc(e.target.value)} placeholder="80000000-1" />
              ) : (
                <input className={inputClass} value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="Documento" />
              )}
            </div>
            <div>
              <label className={labelClass}>Teléfono</label>
              <input className={inputClass} value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="09xx xxx xxx" />
            </div>
            <div>
              <label className={labelClass}>Email</label>
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@correo.com" />
            </div>
            <div>
              <label className={labelClass}>Dirección</label>
              <input className={`${inputClass} uppercase`} value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Dirección" />
            </div>
            <div>
              <label className={labelClass}>Ciudad</label>
              <input className={`${inputClass} uppercase`} value={ciudad} onChange={(e) => setCiudad(e.target.value)} placeholder="Ciudad" />
            </div>
            <div>
              <label className={labelClass}>País</label>
              <input className={`${inputClass} uppercase`} value={pais} onChange={(e) => setPais(e.target.value)} placeholder="País" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={usaNotaRemision} onChange={(e) => setUsaNotaRemision(e.target.checked)} />
            Este cliente usa nota de remisión
          </label>

          {err && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50/50 px-5 py-3">
          <button onClick={onClose} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-[#3F8E91] disabled:opacity-50">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Crear cliente
          </button>
        </div>
      </div>
    </div>
  );
}
