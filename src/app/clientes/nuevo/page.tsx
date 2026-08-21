"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  apiCreateCliente,
  apiCreateFactura,
  apiCreateSuscripcion,
  apiGetGestionTributariaClientes,
  apiGetObligacionesTributariasCatalogo,
  apiPutClientePerfilTributario,
} from "@/lib/api/client";
import {
  ClientePerfilTributarioForm,
  buildPerfilTributarioPutBody,
  emptyTributarioForm,
  getErrorDiaVencimientoTributario,
  type TributarioFormState,
} from "@/components/clientes/ClientePerfilTributarioForm";
import { getProspecto, updateProspecto } from "@/lib/crm/storage";
import { getUsuariosActivosEmpresa, type UsuarioEmpresa } from "@/lib/usuarios/empresa";
import MontoInput from "@/components/ui/MontoInput";
import { getPlanes } from "@/lib/planes/storage";
import type { Cliente, TipoCliente, OrigenCliente } from "@/lib/clientes/types";
import { ClienteDatosSifenReceptorForm } from "@/components/clientes/ClienteDatosSifenReceptorForm";
import type { ClienteTipoServicioRow } from "@/lib/clientes/tipo-servicio-catalogo";
import { filasTiposDesdeSistemaEstatico, fetchTiposFormCliente } from "@/lib/clientes/fetch-tipos-servicio-form";
import type { Plan } from "@/lib/planes/types";
import { NEURA_CLIENT_SCHEMA } from "@/lib/supabase/schema";

/**
 * Instancias monocliente con formulario de clientes simplificado (sin
 * campos SaaS/Neura: sin Plan, sin vendedor responsable ERP, sin facturacion
 * mensual recurrente, sin campos de email secundario, condicion de pago
 * por defecto CONTADO, etc).
 *
 * Lo aplico a ferreteriarepublica porque una ferreteria solo necesita los
 * datos basicos del cliente (nombre, telefono, RUC/CI opcional, direccion).
 */
const SIMPLE_CLIENTE =
  NEURA_CLIENT_SCHEMA === "reservacaacupe" ||
  NEURA_CLIENT_SCHEMA === "ferreteriarepublica";

// ── Estilos ────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-sm font-medium text-slate-700 mb-1.5";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4 pt-1">
      {children}
    </p>
  );
}

// ── Formulario interno ────────────────────────────────────────────────────────

function NuevoClienteForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const fromCrmId    = searchParams?.get("from_crm");

  const [crmBanner,  setCrmBanner]  = useState<string | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [guardando,  setGuardando]  = useState(false);
  const [planes,     setPlanes]     = useState<Plan[]>([]);
  const [usuariosEmpresa, setUsuariosEmpresa] = useState<UsuarioEmpresa[]>([]);
  const [usuariosEmpresaError, setUsuariosEmpresaError] = useState<string | null>(null);

  const [form, setForm] = useState({
    tipo_cliente:        "empresa" as TipoCliente,
    empresa:             "",
    nombre_contacto:     "",
    nombre_facturacion:  "",
    nivel_precio:        "minorista" as "minorista" | "mayorista" | "distribuidor",
    ruc:                 "",
    documento:           "",
    es_contribuyente:    false,
    telefono:            "",
    telefono_secundario: "",
    email:               "",
    email_secundario:    "",
    direccion:           "",
    ciudad:              "",
    pais:                "PARAGUAY",
    sitio_web:           "",
    instagram:           "",
    linkedin:            "",
    valor_cliente:       "",
    condicion_pago:      "CONTADO",
    moneda_preferida:    "GS" as "GS" | "USD",
    vendedor_asignado:   "",
    vendedor_usuario_id: "",
    origen:              "MANUAL" as OrigenCliente,
    prospecto_id:          null as string | null,
    tipo_servicio_cliente: "" as string,
    estado:                "activo" as "activo" | "inactivo",
    usa_nota_remision:     false,
    sifen_receptor_manual: false,
    sifen_receptor_naturaleza: "" as string,
    sifen_ti_ope: "" as string,
    sifen_tipo_doc: "" as string,
    sifen_num_id_de: "",
    sifen_codigo_pais: "",
    sifen_direccion_de: "",
    sifen_num_casa_de: "",
    sifen_descripcion_tipo_doc: "",
  });

  // Campos de suscripción (solo cuando condicion_pago = MENSUAL)
  const [formSusc, setFormSusc] = useState({
    plan_id:           "",
    precio:            "",
    duracion_meses:    "12",
    dia_facturacion:   "1",
    dia_vencimiento:   "10",
    generar_factura:   false,
  });

  // Campos factura inicial Contado
  const [formContado, setFormContado] = useState({
    emitir_factura: false,
    monto:         "",
    descripcion:   "Venta al contado",
  });

  const [gestionTributariaEmpresa, setGestionTributariaEmpresa] = useState(false);
  const [catalogoObligaciones, setCatalogoObligaciones] = useState<
    { id: string; slug: string; nombre: string; requiere_detalle_otro: boolean }[]
  >([]);
  const [formTributario, setFormTributario] = useState<TributarioFormState>(() => emptyTributarioForm());
  const [filasTipoServicio, setFilasTipoServicio] = useState<ClienteTipoServicioRow[]>(() => filasTiposDesdeSistemaEstatico());

  useEffect(() => {
    getPlanes().then(setPlanes);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const usuarios = await getUsuariosActivosEmpresa();
        if (cancelled) return;
        setUsuariosEmpresa(usuarios);
        setUsuariosEmpresaError(null);
      } catch (e) {
        if (cancelled) return;
        setUsuariosEmpresa([]);
        setUsuariosEmpresaError(e instanceof Error ? e.message : "No se pudieron cargar usuarios activos.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void fetchTiposFormCliente().then(setFilasTipoServicio);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const on = await apiGetGestionTributariaClientes();
        if (cancelled) return;
        setGestionTributariaEmpresa(on);
        if (on) {
          const cat = await apiGetObligacionesTributariasCatalogo();
          if (!cancelled) setCatalogoObligaciones(cat);
        }
      } catch (e) {
        if (cancelled) return;
        setGestionTributariaEmpresa(false);
        if (process.env.NODE_ENV === "development") {
          console.error("[nuevo cliente] gestión tributaria (¿migración/columna empresas?):", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Contado: al elegir plan, precargar monto de factura con el precio del plan (editable después).
  useEffect(() => {
    if (form.condicion_pago !== "CONTADO") return;
    const p = planes.find((x) => x.id === formSusc.plan_id);
    if (p) setFormContado((fc) => ({ ...fc, monto: String(p.precio) }));
  }, [formSusc.plan_id, form.condicion_pago, planes]);

  // Pre-fill desde CRM si viene con ?from_crm=id
  useEffect(() => {
    if (!fromCrmId) return;
    let cancelled = false;
    getProspecto(fromCrmId).then((prospecto) => {
      if (cancelled || !prospecto) return;
      setCrmBanner(`Prospecto ${prospecto.numero_control} — ${prospecto.empresa}`);
      setForm((prev) => ({
        ...prev,
        tipo_cliente:    "empresa",
        empresa:         prospecto.empresa,
        nombre_contacto: prospecto.contacto,
        telefono:        prospecto.telefono ?? "",
        email:           prospecto.email    ?? "",
        origen:          "CRM",
        prospecto_id:    prospecto.id,
      }));
    });
    return () => { cancelled = true; };
  }, [fromCrmId]);

  const upper = ["empresa", "nombre_contacto", "nombre_facturacion", "ciudad", "pais", "vendedor_asignado", "condicion_pago", "direccion", "sifen_codigo_pais"];
  const lower = ["email", "email_secundario"];

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    setError(null);
    const { name, value } = e.target;
    const type = (e.target as HTMLInputElement).type;
    let normalized = value;
    if (lower.includes(name) || type === "email") normalized = value.toLowerCase();
    else if (upper.includes(name)) normalized = value.toUpperCase();
    setForm((prev) => ({ ...prev, [name]: normalized }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.nombre_contacto.trim())                              return setError("El nombre de contacto es obligatorio.");
    if (form.tipo_cliente === "empresa" && !form.empresa.trim())   return setError("La razón social es obligatoria para empresas.");

    if (form.condicion_pago === "MENSUAL" && form.estado === "activo") {
      const dur = parseInt(formSusc.duracion_meses, 10) || 0;
      const diaFac = parseInt(formSusc.dia_facturacion, 10) || 0;
      const diaVenc = parseInt(formSusc.dia_vencimiento, 10) || 0;
      if (dur <= 0) return setError("La duración del contrato debe ser mayor a 0.");
      if (diaFac < 1 || diaFac > 28) return setError("El día de facturación debe estar entre 1 y 28.");
      if (diaVenc < 1 || diaVenc > 31) return setError("El día de vencimiento debe estar entre 1 y 31.");
      if (diaVenc <= diaFac) return setError("El día de vencimiento debe ser mayor al día de facturación.");
      if (!formSusc.plan_id.trim()) return setError("Seleccioná un plan para clientes mensuales.");
      const precio = parseFloat(formSusc.precio) || 0;
      if (precio <= 0) return setError("El precio debe ser mayor a 0.");
    }

    if (form.condicion_pago === "CONTADO" && formContado.emitir_factura) {
      const monto = parseFloat(formContado.monto) || 0;
      if (monto <= 0) return setError("El monto de la factura debe ser mayor a 0.");
    }

    if (gestionTributariaEmpresa && formTributario.perfil_activo) {
      const eDia = getErrorDiaVencimientoTributario(formTributario);
      if (eDia) return setError(eDia);
      const otro = catalogoObligaciones.find((c) => c.slug === "otro");
      if (otro && formTributario.obligacion_catalogo_ids.includes(otro.id) && !formTributario.obligacion_otro_detalle.trim()) {
        return setError('Completá el detalle cuando seleccionás la obligación "Otro".');
      }
    }

    if (form.sifen_receptor_manual) {
      if (!form.sifen_receptor_naturaleza.trim()) {
        return setError("SIFEN receptor: elegí la naturaleza del receptor.");
      }
      if (!form.sifen_ti_ope.trim()) {
        return setError("SIFEN receptor: elegí el tipo de operación (B2B / B2C / B2G / B2F).");
      }
      if (!form.sifen_direccion_de.trim()) {
        return setError("SIFEN receptor (modo explícito): completá la dirección para el DE.");
      }
      if (form.sifen_num_casa_de.trim() === "") {
        return setError("SIFEN receptor (modo explícito): indicá el número de casa para el DE (0 si no aplica).");
      }
      if (form.sifen_receptor_naturaleza === "extranjero") {
        const iso = form.sifen_codigo_pais.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(iso) || iso === "PRY") {
          return setError("SIFEN receptor (extranjero): indicá un código país ISO3 válido distinto de PRY.");
        }
      }
      if (form.sifen_receptor_naturaleza === "contribuyente_paraguayo" && !form.ruc.trim()) {
        return setError("SIFEN receptor (contribuyente): el RUC del cliente es obligatorio.");
      }
      if (
        form.sifen_receptor_naturaleza !== "contribuyente_paraguayo" &&
        !form.sifen_num_id_de.trim() &&
        !form.documento.trim() &&
        !form.ruc.trim()
      ) {
        return setError(
          "SIFEN receptor: completá el número de documento del DE o el documento/RUC del cliente."
        );
      }
      const td = form.sifen_tipo_doc.trim();
      if (td === "9") {
        const d = form.sifen_descripcion_tipo_doc.trim();
        if (d.length < 9 || d.length > 41) {
          return setError(
            "SIFEN receptor: con tipo de documento «Otro», la descripción debe tener entre 9 y 41 caracteres (SET)."
          );
        }
      }
    }

    const sifenManualCreate: Partial<Parameters<typeof apiCreateCliente>[0]> =
      form.sifen_receptor_manual
        ? {
            sifen_receptor_manual: true,
            sifen_receptor_naturaleza: (form.sifen_receptor_naturaleza.trim() || null) as Cliente["sifen_receptor_naturaleza"],
            sifen_ti_ope: form.sifen_ti_ope.trim() ? parseInt(form.sifen_ti_ope, 10) : null,
            sifen_tipo_doc_receptor: form.sifen_tipo_doc.trim() ? parseInt(form.sifen_tipo_doc, 10) : null,
            sifen_num_id_de: form.sifen_num_id_de.trim() || null,
            sifen_codigo_pais: form.sifen_codigo_pais.trim().toUpperCase() || null,
            sifen_direccion_de: form.sifen_direccion_de.trim() || null,
            sifen_num_casa_de:
              form.sifen_num_casa_de.trim() === "" ? null : Math.max(0, parseInt(form.sifen_num_casa_de, 10) || 0),
            sifen_descripcion_tipo_doc: form.sifen_descripcion_tipo_doc.trim() || null,
          }
        : {};

    // Facturación → receptor SIFEN B2B (evita el rechazo 0301 de la SET).
    // Empresa con RUC = contribuyente; Persona solo si marca el checkbox y carga RUC.
    // El receptor SIFEN se arma desde sifen_receptor_manual + naturaleza + ruc (no desde es_contribuyente).
    const esContribuyenteEfectivo =
      form.tipo_cliente === "empresa" ? Boolean(form.ruc.trim()) : form.es_contribuyente;
    const contribuyenteSifenCreate: Partial<Parameters<typeof apiCreateCliente>[0]> =
      !form.sifen_receptor_manual && esContribuyenteEfectivo && form.ruc.trim()
        ? { sifen_receptor_manual: true, sifen_receptor_naturaleza: "contribuyente_paraguayo" }
        : {};

    setGuardando(true);

    const creado = await apiCreateCliente({
      tipo_cliente: form.tipo_cliente,
      tipo_servicio_cliente: form.tipo_servicio_cliente || undefined,
      empresa: form.tipo_cliente === "empresa" ? form.empresa.trim().toUpperCase() : undefined,
      nombre_contacto: form.nombre_contacto.trim().toUpperCase(),
      nombre_facturacion: form.nombre_facturacion.trim().toUpperCase() || null,
      nivel_precio: form.nivel_precio,
      ruc: form.ruc.trim() || undefined,
      documento: form.documento.trim() || undefined,
      es_contribuyente: form.tipo_cliente === "persona" ? form.es_contribuyente : false,
      telefono: form.telefono.trim() || undefined,
      email: form.email.trim() || undefined,
      direccion: form.direccion.trim() || undefined,
      ciudad: form.ciudad.trim().toUpperCase() || undefined,
      pais: form.pais.trim().toUpperCase() || undefined,
      condicion_pago: form.condicion_pago.trim().toUpperCase() || undefined,
      moneda_preferida: form.moneda_preferida,
      estado: form.estado,
      usa_nota_remision: form.usa_nota_remision,
      plan_comercial_id: formSusc.plan_id.trim() || null,
      vendedor_asignado: form.vendedor_asignado.trim().toUpperCase() || undefined,
      vendedor_usuario_id: form.vendedor_usuario_id.trim() || null,
      ...sifenManualCreate,
      ...contribuyenteSifenCreate,
    });

    if (creado.ok !== true) {
      setGuardando(false);
      return setError(creado.error || "Error al guardar. Revisá la consola.");
    }
    const clienteId = creado.data.id;

    if (gestionTributariaEmpresa && formTributario.perfil_activo) {
      const put = await apiPutClientePerfilTributario(clienteId, buildPerfilTributarioPutBody(formTributario));
      if (!put.ok) {
        setGuardando(false);
        return setError(put.error ?? "El cliente se creó, pero no se pudo guardar el perfil tributario.");
      }
    }

    // Crear suscripción automática si condicion_pago = MENSUAL y estado activo
    if (form.condicion_pago === "MENSUAL" && form.estado === "activo") {
      const plan = planes.find((p) => p.id === formSusc.plan_id);
      await apiCreateSuscripcion({
        cliente_id: clienteId,
        plan_id: formSusc.plan_id || null,
        precio: parseFloat(formSusc.precio) || (plan?.precio ?? 0),
        moneda: form.moneda_preferida,
        fecha_inicio: new Date().toISOString().slice(0, 10),
        duracion_meses: parseInt(formSusc.duracion_meses, 10) || 12,
        dia_facturacion: parseInt(formSusc.dia_facturacion, 10) || 1,
        dia_vencimiento: parseInt(formSusc.dia_vencimiento, 10) || 10,
        generar_factura_este_mes: formSusc.generar_factura,
      });
    }

    // Crear factura inicial si condicion_pago = CONTADO y Emitir factura
    if (form.condicion_pago === "CONTADO" && formContado.emitir_factura) {
      const monto = parseFloat(formContado.monto) || 0;
      if (monto > 0) {
        const hoy = new Date().toISOString().slice(0, 10);
        await apiCreateFactura({
          cliente_id: clienteId,
          fecha: hoy,
          fecha_vencimiento: hoy,
          monto,
          tipo: "contado",
          moneda: form.moneda_preferida,
          descripcion_linea: formContado.descripcion.trim() || "Venta al contado",
        });
      }
    }

    // Marcar prospecto CRM como cliente_creado
    if (form.prospecto_id) {
      await updateProspecto(form.prospecto_id, { cliente_creado: true });
    }

    setGuardando(false);
    router.push(`/clientes/${clienteId}`);
  }

  return (
    <div className="space-y-8">

      {/* Header */}
      <div>
        <button
          onClick={() => router.push("/clientes")}
          className="text-xs text-gray-400 hover:text-gray-600 mb-2 flex items-center gap-1"
        >
          ← Clientes
        </button>
        <h1 className="text-3xl font-bold text-gray-800">Nuevo cliente</h1>
        <p className="text-gray-500 text-sm mt-1">Registrá un cliente en la base de datos</p>
      </div>

      {/* Banner CRM */}
      {crmBanner && (
        <div className="flex items-center gap-3 bg-violet-50 border border-violet-200 rounded-xl px-5 py-3">
          <span className="text-violet-500 text-lg">🔗</span>
          <div>
            <p className="text-sm font-semibold text-violet-800">Creando desde CRM</p>
            <p className="text-xs text-violet-600">{crmBanner}</p>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 max-w-3xl">
        <form className="space-y-8" onSubmit={handleSubmit}>

          {/* ── Identificación ───────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Identificación</SectionTitle>

            {/* Tipo de cliente */}
            <div>
              <label className={labelClass}>Tipo de cliente</label>
              <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
                {(["empresa", "persona"] as TipoCliente[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, tipo_cliente: t }))}
                    className={`px-5 py-2.5 text-sm font-medium transition-colors ${
                      form.tipo_cliente === t
                        ? "bg-[#0EA5E9] text-white"
                        : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {t === "empresa" ? "Empresa" : "Persona"}
                  </button>
                ))}
              </div>
            </div>

            {form.tipo_cliente === "empresa" && (
              <div>
                <label className={labelClass}>
                  Razón social <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="empresa"
                  value={form.empresa}
                  onChange={handleChange}
                  placeholder="Nombre de la empresa"
                  className={`${inputClass} uppercase`}
                />
              </div>
            )}

            <div>
              <label className={labelClass}>
                Nombre para facturación <span className="text-gray-400 font-normal">(opcional)</span>
              </label>
              <input
                type="text"
                name="nombre_facturacion"
                value={form.nombre_facturacion}
                onChange={handleChange}
                placeholder="Ej: Nombre del cónyuge / hijo/a"
                className={`${inputClass} uppercase`}
              />
              <p className="mt-1.5 text-xs text-gray-400">
                Solo si la factura se emite a un nombre distinto de la Razón Social. Si queda vacío, se usa
                la Razón Social o el nombre de contacto.
              </p>
            </div>

            <div>
              <label className={labelClass}>Nivel de precio</label>
              <select
                name="nivel_precio"
                value={form.nivel_precio}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    nivel_precio: e.target.value as "minorista" | "mayorista" | "distribuidor",
                  }))
                }
                className={inputClass}
              >
                <option value="minorista">Minorista</option>
                <option value="mayorista">Mayorista</option>
                <option value="distribuidor">Distribuidor</option>
              </select>
              <p className="mt-1.5 text-xs text-gray-400">
                Se usa como precio por defecto al agregar productos en presupuestos, pedidos y ventas.
                Igual se puede cambiar en cada línea.
              </p>
            </div>

            {!SIMPLE_CLIENTE && (
            <div>
              <label className={labelClass}>Tipo de servicio</label>
              <select
                name="tipo_servicio_cliente"
                value={form.tipo_servicio_cliente}
                onChange={(e) => setForm((prev) => ({ ...prev, tipo_servicio_cliente: e.target.value }))}
                className={inputClass}
              >
                <option value="">— Ninguno —</option>
                {filasTipoServicio.map((f) => (
                  <option key={f.slug} value={f.slug}>
                    {f.nombre}
                  </option>
                ))}
              </select>
            </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>
                  {form.tipo_cliente === "empresa" ? "Persona de contacto" : "Nombre completo"}{" "}
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="nombre_contacto"
                  value={form.nombre_contacto}
                  onChange={handleChange}
                  placeholder="Nombre y apellido"
                  className={`${inputClass} uppercase`}
                  required
                />
              </div>
              <div>
                <label className={labelClass}>
                  {form.tipo_cliente === "empresa" ? "RUC" : "CI / Documento"}
                </label>
                {form.tipo_cliente === "empresa" ? (
                  <input
                    type="text"
                    name="ruc"
                    value={form.ruc}
                    onChange={handleChange}
                    placeholder="00000000-0"
                    className={inputClass}
                  />
                ) : (
                  <input
                    type="text"
                    name="documento"
                    value={form.documento}
                    onChange={handleChange}
                    placeholder="CI sin puntos"
                    className={inputClass}
                  />
                )}
              </div>
            </div>
            {form.tipo_cliente === "persona" && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="es_contribuyente"
                    checked={form.es_contribuyente}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setForm((prev) => ({
                        ...prev,
                        es_contribuyente: checked,
                        ruc: checked ? prev.ruc : "",
                      }));
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
                  />
                  <span>
                    <span className="font-medium">Es contribuyente inscripto en la SET</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Marcalo solo si esta persona está registrada como contribuyente en Marangatu. Con esta opción activada y RUC cargado, la factura sale como B2B (evita el rechazo 0301 de la SET).
                    </span>
                  </span>
                </label>
                {form.es_contribuyente && (
                  <div className="mt-3">
                    <label className={labelClass}>RUC de la persona</label>
                    <input
                      type="text"
                      name="ruc"
                      value={form.ruc}
                      onChange={handleChange}
                      placeholder="Ej: 2431868-0"
                      className={inputClass}
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      En Paraguay el RUC de persona física es la CI + dígito verificador.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Contacto ─────────────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Contacto</SectionTitle>

            <div>
              <label className={labelClass}>Teléfono</label>
              <input
                type="text"
                name="telefono"
                value={form.telefono}
                onChange={handleChange}
                placeholder="021-000000"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="contacto@empresa.com"
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass}>Dirección</label>
              <input
                type="text"
                name="direccion"
                value={form.direccion}
                onChange={handleChange}
                placeholder="Av. / Calle y número"
                className={inputClass}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.usa_nota_remision}
                onChange={(e) => setForm((p) => ({ ...p, usa_nota_remision: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-[#0EA5E9] focus:ring-[#0EA5E9]"
              />
              Usa nota de remisión
              <span className="text-xs text-slate-400">(se generará junto al ticket al venderle)</span>
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Ciudad</label>
                <input
                  type="text"
                  name="ciudad"
                  value={form.ciudad}
                  onChange={handleChange}
                  placeholder="ASUNCIÓN"
                  className={`${inputClass} uppercase`}
                />
              </div>
              <div>
                <label className={labelClass}>País</label>
                <input
                  type="text"
                  name="pais"
                  value={form.pais}
                  onChange={handleChange}
                  className={`${inputClass} uppercase`}
                />
              </div>
            </div>

            {!SIMPLE_CLIENTE && (
            <ClienteDatosSifenReceptorForm
              value={{
                sifen_receptor_manual: form.sifen_receptor_manual,
                sifen_receptor_naturaleza: (form.sifen_receptor_naturaleza || null) as Cliente["sifen_receptor_naturaleza"],
                sifen_ti_ope: form.sifen_ti_ope.trim() ? parseInt(form.sifen_ti_ope, 10) : null,
                sifen_tipo_doc_receptor: form.sifen_tipo_doc.trim() ? parseInt(form.sifen_tipo_doc, 10) : null,
                sifen_codigo_pais: form.sifen_codigo_pais.trim() || null,
                sifen_num_id_de: form.sifen_num_id_de.trim() || null,
                sifen_direccion_de: form.sifen_direccion_de.trim() || null,
                sifen_num_casa_de:
                  form.sifen_num_casa_de.trim() === "" ? null : Math.max(0, parseInt(form.sifen_num_casa_de, 10) || 0),
                sifen_descripcion_tipo_doc: form.sifen_descripcion_tipo_doc.trim() || null,
              }}
              onChange={(patch) => {
                setForm((p) => {
                  if (patch.sifen_receptor_manual === false) {
                    return {
                      ...p,
                      sifen_receptor_manual: false,
                      sifen_receptor_naturaleza: "",
                      sifen_ti_ope: "",
                      sifen_tipo_doc: "",
                      sifen_num_id_de: "",
                      sifen_codigo_pais: "",
                      sifen_direccion_de: "",
                      sifen_num_casa_de: "",
                      sifen_descripcion_tipo_doc: "",
                    };
                  }
                  return {
                    ...p,
                    ...(patch.sifen_receptor_manual !== undefined
                      ? { sifen_receptor_manual: Boolean(patch.sifen_receptor_manual) }
                      : {}),
                    ...(patch.sifen_receptor_naturaleza !== undefined
                      ? { sifen_receptor_naturaleza: patch.sifen_receptor_naturaleza ?? "" }
                      : {}),
                    ...(patch.sifen_ti_ope !== undefined
                      ? { sifen_ti_ope: patch.sifen_ti_ope != null ? String(patch.sifen_ti_ope) : "" }
                      : {}),
                    ...(patch.sifen_tipo_doc_receptor !== undefined
                      ? {
                          sifen_tipo_doc:
                            patch.sifen_tipo_doc_receptor != null ? String(patch.sifen_tipo_doc_receptor) : "",
                        }
                      : {}),
                    ...(patch.sifen_num_id_de !== undefined ? { sifen_num_id_de: patch.sifen_num_id_de ?? "" } : {}),
                    ...(patch.sifen_codigo_pais !== undefined
                      ? { sifen_codigo_pais: patch.sifen_codigo_pais ?? "" }
                      : {}),
                    ...(patch.sifen_direccion_de !== undefined
                      ? { sifen_direccion_de: patch.sifen_direccion_de ?? "" }
                      : {}),
                    ...(patch.sifen_num_casa_de !== undefined
                      ? {
                          sifen_num_casa_de:
                            patch.sifen_num_casa_de != null ? String(patch.sifen_num_casa_de) : "",
                        }
                      : {}),
                    ...(patch.sifen_descripcion_tipo_doc !== undefined
                      ? { sifen_descripcion_tipo_doc: patch.sifen_descripcion_tipo_doc ?? "" }
                      : {}),
                  };
                });
              }}
            />
            )}
          </section>

          {/* ── Datos comerciales ────────────────────────────────────────── */}
          <section className="space-y-4">
            <SectionTitle>Datos comerciales</SectionTitle>

            <div className={`grid gap-4 ${SIMPLE_CLIENTE ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-3"}`}>
              <div>
                <label className={labelClass}>Condición de pago</label>
                <select
                  name="condicion_pago"
                  value={form.condicion_pago}
                  onChange={handleChange}
                  className={inputClass}
                >
                  <option value="CONTADO">Contado</option>
                  <option value="15 DÍAS">15 días</option>
                  <option value="30 DÍAS">30 días</option>
                  <option value="60 DÍAS">60 días</option>
                  <option value="90 DÍAS">90 días</option>
                  {!SIMPLE_CLIENTE && <option value="MENSUAL">Mensual</option>}
                </select>
              </div>
              <div>
                <label className={labelClass}>Moneda preferida</label>
                <select
                  name="moneda_preferida"
                  value={form.moneda_preferida}
                  onChange={(e) => setForm((prev) => ({ ...prev, moneda_preferida: e.target.value as "GS" | "USD" }))}
                  className={inputClass}
                >
                  <option value="GS">Guaraníes (GS)</option>
                  <option value="USD">Dólares (USD)</option>
                </select>
              </div>
              {!SIMPLE_CLIENTE && (
              <div>
                <label className={labelClass}>Vendedor responsable (usuario ERP)</label>
                <select
                  name="vendedor_usuario_id"
                  value={form.vendedor_usuario_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, vendedor_usuario_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">— Sin asignar —</option>
                  {usuariosEmpresa.map((u) => (
                    <option key={u.id} value={u.id}>
                      {(u.nombre ?? "").trim() || u.email}
                    </option>
                  ))}
                </select>
                {usuariosEmpresaError ? (
                  <p className="mt-1 text-xs text-red-600">{usuariosEmpresaError}</p>
                ) : usuariosEmpresa.length === 0 ? (
                  <p className="mt-1 text-xs text-slate-500">No hay usuarios activos disponibles para asignar.</p>
                ) : null}
              </div>
              )}
              {!SIMPLE_CLIENTE && (
              <div>
                <label className={labelClass}>Vendedor asignado (texto libre)</label>
                <input
                  type="text"
                  name="vendedor_asignado"
                  value={form.vendedor_asignado}
                  onChange={handleChange}
                  placeholder="Referencia escrita (opcional)"
                  className={`${inputClass} uppercase`}
                />
              </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {!SIMPLE_CLIENTE && (
              <div>
                <label className={labelClass}>Origen del cliente</label>
                <select
                  name="origen"
                  value={form.origen}
                  onChange={(e) => setForm((prev) => ({ ...prev, origen: e.target.value as OrigenCliente }))}
                  className={inputClass}
                  disabled={!!fromCrmId}
                >
                  <option value="MANUAL">Manual</option>
                  <option value="CRM">CRM</option>
                  <option value="VENTA">Venta</option>
                </select>
              </div>
              )}
              <div>
                <label className={labelClass}>Estado inicial</label>
                <select
                  name="estado"
                  value={form.estado}
                  onChange={(e) => setForm((prev) => ({ ...prev, estado: e.target.value as "activo" | "inactivo" }))}
                  className={inputClass}
                >
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </select>
              </div>
            </div>

            {!SIMPLE_CLIENTE && (
            <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
              <SectionTitle>Plan</SectionTitle>
              <div>
                <label className={labelClass}>Plan</label>
                <select
                  value={formSusc.plan_id}
                  onChange={(e) => {
                    const p = planes.find((x) => x.id === e.target.value);
                    setFormSusc((prev) => ({
                      ...prev,
                      plan_id: e.target.value,
                      precio: p ? String(p.precio) : prev.precio,
                    }));
                  }}
                  className={inputClass}
                >
                  <option value="">— Seleccionar plan —</option>
                  {planes.filter((p) => p.estado === "activo").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre} — {p.moneda} {p.precio.toLocaleString("es-PY")}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            )}

            {/* Campos factura inicial Contado */}
            {form.condicion_pago === "CONTADO" && (
              <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                <SectionTitle>Facturación al contado</SectionTitle>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="emitir_contado"
                    checked={formContado.emitir_factura}
                    onChange={(e) => setFormContado((p) => ({ ...p, emitir_factura: e.target.checked }))}
                  />
                  <label htmlFor="emitir_contado" className="text-sm text-slate-600">Emitir factura inicial</label>
                </div>
                {formContado.emitir_factura && (
                  <>
                    <div>
                      <label className={labelClass}>Monto (Gs.)</label>
                      <MontoInput
                        value={formContado.monto}
                        onChange={(n) => setFormContado((p) => ({ ...p, monto: String(n) }))}
                        className={inputClass}
                        placeholder="Monto de la factura"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Descripción</label>
                      <input
                        type="text"
                        value={formContado.descripcion}
                        onChange={(e) => setFormContado((p) => ({ ...p, descripcion: e.target.value }))}
                        className={inputClass}
                        placeholder="Venta al contado"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Campos de suscripción (solo cuando condicion_pago = MENSUAL) */}
            {form.condicion_pago === "MENSUAL" && (
              <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                <SectionTitle>Configuración de suscripción</SectionTitle>
                <div>
                  <label className={labelClass}>Precio (Gs.)</label>
                  <MontoInput
                    value={formSusc.precio}
                    onChange={(n) => setFormSusc((p) => ({ ...p, precio: String(n) }))}
                    className={inputClass}
                    placeholder="Monto mensual"
                  />
                </div>
                <div>
                  <label className={labelClass}>Duración contrato (meses)</label>
                  <input
                    type="number"
                    value={formSusc.duracion_meses}
                    onChange={(e) => setFormSusc((p) => ({ ...p, duracion_meses: e.target.value }))}
                    className={inputClass}
                    min={1}
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className={labelClass}>Día facturación (1–28)</label>
                    <input
                      type="number"
                      value={formSusc.dia_facturacion}
                      onChange={(e) => setFormSusc((p) => ({ ...p, dia_facturacion: e.target.value }))}
                      className={inputClass}
                      min={1}
                      max={28}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Día vencimiento (1–31)</label>
                    <input
                      type="number"
                      value={formSusc.dia_vencimiento}
                      onChange={(e) => setFormSusc((p) => ({ ...p, dia_vencimiento: e.target.value }))}
                      className={inputClass}
                      min={1}
                      max={31}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="gen_fact_nuevo"
                    checked={formSusc.generar_factura}
                    onChange={(e) => setFormSusc((p) => ({ ...p, generar_factura: e.target.checked }))}
                  />
                  <label htmlFor="gen_fact_nuevo" className="text-sm text-slate-600">Emitir factura este mes</label>
                </div>
              </div>
            )}
          </section>

          {gestionTributariaEmpresa && (
            <section className="space-y-3">
              <details className="group rounded-2xl border border-indigo-100/80 bg-gradient-to-b from-slate-50/80 to-white shadow-sm open:shadow-md transition-shadow [open]:shadow-md">
                <summary className="cursor-pointer list-none px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between gap-2 text-left [&::-webkit-details-marker]:hidden">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Opcional</p>
                    <p className="text-sm font-semibold text-slate-800 mt-0.5">Perfil tributario</p>
                    <p className="text-xs text-slate-500 mt-0.5 max-w-xl">Expandir para IVA, IRE, honorarios y obligaciones. Los datos fiscales no reemplazan la ficha comercial.</p>
                  </div>
                  <span
                    className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 group-open:bg-indigo-50 group-open:text-indigo-800 group-open:border-indigo-100"
                    aria-hidden
                  >
                    Expandir
                  </span>
                </summary>
                <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-0">
                  <ClientePerfilTributarioForm
                    catalog={catalogoObligaciones}
                    value={formTributario}
                    onChange={setFormTributario}
                    tipoCliente={form.tipo_cliente}
                  />
                </div>
              </details>
            </section>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
              <span>⚠</span><span className="font-medium">{error}</span>
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-4 pt-2">
            <button
              type="submit"
              disabled={guardando}
              className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-6 py-3 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
            >
              {guardando ? "Guardando…" : "Guardar cliente"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/clientes")}
              className="border border-slate-200 px-6 py-3 rounded-lg text-sm hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
          </div>

        </form>
      </div>

    </div>
  );
}

// ── Page wrapper con Suspense (requerido por useSearchParams) ──────────────────

export default function NuevoClientePage() {
  return (
    <Suspense fallback={<div className="animate-pulse text-gray-400 text-sm p-8">Cargando formulario...</div>}>
      <NuevoClienteForm />
    </Suspense>
  );
}
