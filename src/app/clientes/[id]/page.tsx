"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addNotaCliente,
  clienteNombre,
  getCliente,
  toggleEstado,
  updateCliente,
} from "@/lib/clientes/storage";
import {
  apiDeleteCliente,
  apiGetBajaOperativaPreview,
  apiBajaOperativaCliente,
  apiGetEliminarClientePreview,
  apiGetGestionTributariaClientes,
  apiGetObligacionesTributariasCatalogo,
  apiPutClientePerfilTributario,
  apiCreateFactura,
  apiCreateFacturaWithError,
  apiCreatePago,
  apiCreateSuscripcion,
  type BajaOperativaPreview,
  type EliminarClientePreview,
} from "@/lib/api/client";
import { getFacturas, getSuscripciones } from "@/lib/facturacion/storage";
import { getMarketingTasks, createMarketingTask, updateTaskStatus } from "@/lib/marketing/storage";
import { getUsuariosActivosEmpresa, type UsuarioEmpresa } from "@/lib/usuarios/empresa";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { SifenEstadoBadge } from "@/components/sifen/SifenEstadoBadge";
import { useFacturaSifenEstados } from "@/hooks/useFacturaSifenEstados";
import MontoInput from "@/components/ui/MontoInput";
import { getPlanes } from "@/lib/planes/storage";
import type { Cliente, NotaCliente } from "@/lib/clientes/types";
import {
  etiquetaVisibleTipoServicio,
  type ClienteTipoServicioRow,
} from "@/lib/clientes/tipo-servicio-catalogo";
import { filasTiposDesdeSistemaEstatico, fetchTiposFormCliente } from "@/lib/clientes/fetch-tipos-servicio-form";
import type { Factura } from "@/lib/gestion-clientes/types";
import {
  clasesBadgeEstadoFacturaUi,
  estadoFacturaParaUi,
  textoBadgeEstadoFacturaUi,
} from "@/lib/gestion-clientes/estado-factura-ui";
import type { Suscripcion } from "@/lib/facturacion/types";
import type { Plan } from "@/lib/planes/types";
import type { MarketingTask } from "@/lib/marketing/types";
import { TIPOS_CONTENIDO, ESTADOS_TASK } from "@/lib/marketing/types";
import {
  ClientePerfilTributarioForm,
  buildPerfilTributarioPutBody,
  emptyTributarioForm,
  formStateFromPerfil,
  getErrorDiaVencimientoTributario,
  type TributarioFormState,
} from "@/components/clientes/ClientePerfilTributarioForm";
import { ClienteDatosSifenReceptorForm } from "@/components/clientes/ClienteDatosSifenReceptorForm";
import { NEURA_CLIENT_SCHEMA } from "@/lib/supabase/schema";

/** Instancias monocliente con formulario/detalle de clientes simplificado (sin campos SaaS/Neura). */
const SIMPLE_CLIENTE =
  NEURA_CLIENT_SCHEMA === "reservacaacupe" ||
  NEURA_CLIENT_SCHEMA === "ferreteriarepublica";
// ── Estilos ────────────────────────────────────────────────────────────────────

const inputClass =
  "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-4">
      {children}
    </p>
  );
}

// ── Tipos de pestaña ──────────────────────────────────────────────────────────

type TabId = "informacion" | "estado_cuenta" | "suscripciones" | "marketing" | "proyectos" | "actividad" | "notas";

const TABS: { id: TabId; label: string; showWhen?: (c: Cliente) => boolean }[] = [
  { id: "informacion",   label: "Información"      },
  { id: "estado_cuenta", label: "Estado de cuenta" },
  { id: "suscripciones", label: "Suscripciones"    },
  { id: "marketing",     label: "Marketing",        showWhen: (c) => c.tipo_servicio_cliente === "marketing" },
  { id: "proyectos",     label: "Proyectos"         },
  { id: "actividad",     label: "Actividad"         },
  { id: "notas",         label: "Notas"             },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch { return ""; }
}

function formatFechaHora(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch { return ""; }
}

// ── Placeholder para pestañas futuras ─────────────────────────────────────────

function PlaceholderTab({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <span className="text-5xl mb-4">{icon}</span>
      <h3 className="text-base font-semibold text-gray-600 mb-2">{title}</h3>
      <p className="text-sm text-gray-400 max-w-xs">{desc}</p>
      <span className="mt-5 text-xs bg-gray-100 text-gray-500 px-3 py-1.5 rounded-full">Próximamente</span>
    </div>
  );
}

function ClienteFichaSkeleton() {
  const bar = "animate-pulse rounded-md bg-slate-200/90";
  return (
    <div className="space-y-6 max-w-5xl">
      <div className={`h-3 w-28 ${bar}`} aria-hidden />
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="h-40 bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200 animate-pulse" aria-hidden />
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 border-t border-gray-100">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-5 py-3 space-y-2">
              <div className={`h-2.5 w-16 ${bar}`} />
              <div className={`h-4 w-24 ${bar}`} />
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="flex gap-2 px-3 py-3 border-b border-gray-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={`h-8 flex-1 max-w-[7rem] ${bar}`} />
          ))}
        </div>
        <div className="p-6 space-y-3">
          <div className={`h-4 w-full max-w-md ${bar}`} />
          <div className={`h-4 w-full max-w-sm ${bar}`} />
          <div className={`h-32 w-full ${bar}`} />
        </div>
      </div>
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ClienteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = params?.id;
  const id =
    typeof rawId === "string" ? rawId : Array.isArray(rawId) ? (rawId[0] ?? "") : "";

  const [cliente,   setCliente]   = useState<Cliente | null>(null);
  const [notFound,  setNotFound]  = useState(false);
  const [cargandoCliente, setCargandoCliente] = useState(true);
  /** Planes, suscripciones y facturas (no bloquea el encabezado del cliente). */
  const [cargandoDetalleCliente, setCargandoDetalleCliente] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("informacion");
  const [esAdmin, setEsAdmin] = useState(false);
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);
  const [deletionReason, setDeletionReason] = useState("");
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const [eliminarPreview, setEliminarPreview] = useState<EliminarClientePreview | null>(null);
  const [eliminarCargandoPreview, setEliminarCargandoPreview] = useState(false);
  const [eliminarCancelarSusc, setEliminarCancelarSusc] = useState(true);
  const [eliminarAnularFacturas, setEliminarAnularFacturas] = useState(false);
  const [modalBajaOperativa, setModalBajaOperativa] = useState(false);
  const [bajaMotivo, setBajaMotivo] = useState("");
  const [bajaAnularFactura, setBajaAnularFactura] = useState(false);
  const [bajaCancelarSuscripciones, setBajaCancelarSuscripciones] = useState(true);
  const [bajaPreview, setBajaPreview] = useState<BajaOperativaPreview | null>(null);
  const [bajaProcesando, setBajaProcesando] = useState(false);
  const [errorBaja, setErrorBaja] = useState<string | null>(null);

  // Estados del formulario de información
  const [form, setForm] = useState({
    tipo_cliente:        "empresa" as Cliente["tipo_cliente"],
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
    pais:                "",
    sitio_web:           "",
    instagram:           "",
    linkedin:            "",
    valor_cliente:       "",
    condicion_pago:      "",
    moneda_preferida:      "GS" as "GS" | "USD",
    vendedor_asignado:     "",
    vendedor_usuario_id:   "",
    tipo_servicio_cliente: "" as string,
    estado:                "activo" as Cliente["estado"],
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

  const [formError, setFormError] = useState<string | null>(null);

  // Campos de suscripción (solo cuando condicion_pago = MENSUAL en edición)
  const [formSuscEdit, setFormSuscEdit] = useState({
    plan_id: "", precio: "", duracion_meses: "12", dia_facturacion: "1", dia_vencimiento: "10", generar_factura: false,
  });

  // Campos factura Contado (edición)
  const [formContadoEdit, setFormContadoEdit] = useState({
    emitir_factura: false, monto: "", descripcion: "Venta al contado",
  });

  const [gestionTributariaEmpresa, setGestionTributariaEmpresa] = useState(false);
  const [catalogoObligacionesTrib, setCatalogoObligacionesTrib] = useState<
    { id: string; slug: string; nombre: string; requiere_detalle_otro: boolean }[]
  >([]);
  const [formTributario, setFormTributario] = useState<TributarioFormState>(() => emptyTributarioForm());
  const [tributBlockOpen, setTributBlockOpen] = useState(false);

  // Estados de notas
  const [nuevaNota,     setNuevaNota]     = useState("");
  const [guardandoNota, setGuardandoNota] = useState(false);
  const notaRef = useRef<HTMLTextAreaElement>(null);

  // Suscripciones
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [modalSuscripcion, setModalSuscripcion] = useState(false);
  const [formSusc, setFormSusc] = useState({
    plan_id: "", precio: "", fecha_inicio: "", duracion_meses: "12", dia_facturacion: "1", dia_vencimiento: "10", generar_factura_este_mes: false,
  });
  const [guardandoSusc, setGuardandoSusc] = useState(false);
  const [marketingTasks, setMarketingTasks] = useState<MarketingTask[]>([]);
  const [usuariosEmpresa, setUsuariosEmpresa] = useState<UsuarioEmpresa[]>([]);
  const [usuariosEmpresaError, setUsuariosEmpresaError] = useState<string | null>(null);
  const [modalNuevaTarea, setModalNuevaTarea] = useState(false);
  const [formTarea, setFormTarea] = useState({ titulo: "", descripcion: "", tipo_contenido: "post" as const, fecha_entrega: "", responsable_user_id: "", prioridad: "" as "" | "baja" | "media" | "alta" | "urgente" });
  const [guardandoTarea, setGuardandoTarea] = useState(false);
  const [errorTarea, setErrorTarea] = useState<string | null>(null);

  // Estado de cuenta
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [modalPago, setModalPago] = useState(false);
  const [facturaPago, setFacturaPago] = useState<Factura | null>(null);
  const [formPago, setFormPago] = useState({ factura_id: "" as string, monto: "", fecha_pago: "", metodo_pago: "efectivo" as const, referencia: "" });
  const [guardandoPago, setGuardandoPago] = useState(false);
  const [modalFacturaContado, setModalFacturaContado] = useState(false);
  const [formFacturaContado, setFormFacturaContado] = useState<{
    monto: string;
    descripcion: string;
    iva_tipo: "exenta" | "iva_5" | "iva_10";
  }>({ monto: "", descripcion: "Venta al contado", iva_tipo: "iva_10" });
  const [guardandoFacturaContado, setGuardandoFacturaContado] = useState(false);
  /** Error visible en el modal "Factura al contado". Antes la API podía fallar (p. ej. PGRST106
   *  para tenants erp_* no expuestos) y el botón parecía "no hacer nada". Ahora exponemos el motivo. */
  const [errorFacturaContado, setErrorFacturaContado] = useState<string | null>(null);

  const [filasTiposServicio, setFilasTiposServicio] = useState<ClienteTipoServicioRow[]>(() => filasTiposDesdeSistemaEstatico());
  const labelTipoServicioMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of filasTiposServicio) m[t.slug] = t.nombre;
    return m;
  }, [filasTiposServicio]);
  const opcionesTipoServicio = useMemo(() => {
    const t = (form.tipo_servicio_cliente ?? "").trim();
    const list = filasTiposServicio;
    if (!t) return list;
    if (list.some((f) => f.slug === t)) return list;
    return [
      ...list,
      {
        id: `ghost-${t}`,
        empresa_id: "",
        slug: t,
        nombre: etiquetaVisibleTipoServicio(t, labelTipoServicioMap),
        activo: false,
        orden: 0,
        es_sistema: false,
        created_at: "",
        updated_at: "",
      } satisfies ClienteTipoServicioRow,
    ];
  }, [form.tipo_servicio_cliente, filasTiposServicio, labelTipoServicioMap]);

  const sifenPorFactura = useFacturaSifenEstados(facturas.map((f) => f.id));
  const suscripcionActiva = useMemo(
    () => suscripciones.find((s) => s.estado === "activa") ?? null,
    [suscripciones]
  );

  const hoyYmdFactura = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  useEffect(() => {
    if (!id) return;
    const inc = (form.tipo_servicio_cliente || cliente?.tipo_servicio_cliente || "").trim() || null;
    void fetchTiposFormCliente(inc).then(setFilasTiposServicio);
  }, [id, form.tipo_servicio_cliente, cliente?.tipo_servicio_cliente]);

  const cargar = useCallback(async () => {
    setCargandoCliente(true);
    setCargandoDetalleCliente(false);
    setErrorCarga(null);
    setNotFound(false);
    setCliente(null);
    try {
      if (process.env.NODE_ENV === "development") console.info("[cliente detalle] cargar inicio", { id });
      const c = await getCliente(id);
      if (!c) {
        setCliente(null);
        setPlanes([]);
        setSuscripciones([]);
        setFacturas([]);
        setNotFound(true);
        if (process.env.NODE_ENV === "development") console.warn("[cliente detalle] getCliente null", { id });
        setCargandoCliente(false);
        setCargandoDetalleCliente(false);
        return;
      }
      setCliente(c);
      setForm({
        tipo_cliente:        c.tipo_cliente,
        empresa:             c.empresa             ?? "",
        nombre_contacto:     c.nombre_contacto,
        nombre_facturacion:  c.nombre_facturacion  ?? "",
        nivel_precio:        (c.nivel_precio ?? "minorista") as "minorista" | "mayorista" | "distribuidor",
        ruc:                 c.ruc                 ?? "",
        documento:           c.documento           ?? "",
        es_contribuyente:    c.es_contribuyente === true,
        telefono:            c.telefono            ?? "",
        telefono_secundario: c.telefono_secundario ?? "",
        email:               c.email               ?? "",
        email_secundario:    c.email_secundario    ?? "",
        direccion:           c.direccion           ?? "",
        ciudad:              c.ciudad              ?? "",
        pais:                c.pais                ?? "",
        sitio_web:           c.sitio_web           ?? "",
        instagram:           c.instagram           ?? "",
        linkedin:            c.linkedin            ?? "",
        valor_cliente:       c.valor_cliente != null ? String(c.valor_cliente) : "",
        condicion_pago:       c.condicion_pago      ?? "",
        moneda_preferida:     c.moneda_preferida    ?? "GS",
        vendedor_asignado:    c.vendedor_asignado   ?? "",
        vendedor_usuario_id:  c.vendedor_usuario_id ?? "",
        tipo_servicio_cliente: c.tipo_servicio_cliente ?? "",
        estado:               c.estado,
        usa_nota_remision:    c.usa_nota_remision === true,
        sifen_receptor_manual: Boolean(c.sifen_receptor_manual),
        sifen_receptor_naturaleza: c.sifen_receptor_naturaleza ?? "",
        sifen_ti_ope: c.sifen_ti_ope != null ? String(c.sifen_ti_ope) : "",
        sifen_tipo_doc: c.sifen_tipo_doc_receptor != null ? String(c.sifen_tipo_doc_receptor) : "",
        sifen_num_id_de: c.sifen_num_id_de ?? "",
        sifen_codigo_pais: c.sifen_codigo_pais ?? "",
        sifen_direccion_de: c.sifen_direccion_de ?? "",
        sifen_num_casa_de: c.sifen_num_casa_de != null ? String(c.sifen_num_casa_de) : "",
        sifen_descripcion_tipo_doc: c.sifen_descripcion_tipo_doc ?? "",
      });
      setFormTributario(formStateFromPerfil(c.perfil_tributario ?? null));
      setTributBlockOpen(
        Boolean(
          c.perfil_tributario_activo ||
            (c.perfil_tributario && c.perfil_tributario.perfil_activo)
        )
      );
      setCargandoCliente(false);
      setCargandoDetalleCliente(true);
      try {
        const [planesL, susL, facL] = await Promise.all([
          getPlanes(),
          getSuscripciones(id),
          getFacturas(id),
        ]);
        setPlanes(planesL);
        setSuscripciones(susL);
        setFacturas(facL);
        if (process.env.NODE_ENV === "development") {
          console.info("[cliente detalle] cargar ok", { id, planes: planesL.length, suscripciones: susL.length, facturas: facL.length });
        }
      } finally {
        setCargandoDetalleCliente(false);
      }
    } catch (e) {
      console.error("[cliente detalle] cargar excepción", { id, e });
      setErrorCarga(e instanceof Error ? e.message : "Error al cargar el cliente");
      setCliente(null);
      setPlanes([]);
      setSuscripciones([]);
      setFacturas([]);
      setNotFound(false);
      setCargandoCliente(false);
      setCargandoDetalleCliente(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id.trim()) {
      setNotFound(true);
      setCargandoCliente(false);
      return;
    }
    void cargar();
  }, [id, cargar]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithSupabaseSession("/api/auth/empresa-context", { cache: "no-store" });
        const json = (await res.json()) as { success?: boolean; data?: { es_admin?: boolean } };
        if (cancelled) return;
        if (res.ok && json.success && json.data?.es_admin != null) {
          setEsAdmin(Boolean(json.data.es_admin));
          return;
        }
      } catch {
        /* fallback abajo */
      }
      if (cancelled) return;
      setEsAdmin(false);
    })();
    return () => {
      cancelled = true;
    };
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
          if (!cancelled) setCatalogoObligacionesTrib(cat);
        }
      } catch (e) {
        if (cancelled) return;
        setGestionTributariaEmpresa(false);
        if (process.env.NODE_ENV === "development") {
          console.error("[cliente] gestión tributaria:", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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
    if (!id.trim()) return;
    if (activeTab === "marketing") {
      getMarketingTasks(id).then(setMarketingTasks);
    }
    if (activeTab === "estado_cuenta" || activeTab === "suscripciones") {
      getFacturas(id).then(setFacturas);
      getSuscripciones(id).then(setSuscripciones);
      getPlanes().then(setPlanes);
    }
  }, [id, activeTab]);

  useEffect(() => {
    if (form.condicion_pago === "MENSUAL") {
      getPlanes().then(setPlanes);
      getSuscripciones(id).then(setSuscripciones);
    }
    if (form.condicion_pago === "CONTADO") {
      getFacturas(id).then(setFacturas);
    }
  }, [form.condicion_pago, id]);

  const upper = ["empresa", "nombre_contacto", "nombre_facturacion", "ciudad", "pais", "vendedor_asignado", "condicion_pago", "direccion", "sifen_codigo_pais"];
  const lower = ["email", "email_secundario"];

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    setFormError(null);
    const { name, value } = e.target;
    const type = (e.target as HTMLInputElement).type;
    let normalized = value;
    if (lower.includes(name) || type === "email") normalized = value.toLowerCase();
    else if (upper.includes(name)) normalized = value.toUpperCase();
    setForm((prev) => ({ ...prev, [name]: normalized }));
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.nombre_contacto.trim())                             return setFormError("El contacto es obligatorio.");
    if (form.tipo_cliente === "empresa" && !form.empresa.trim())  return setFormError("La razón social es obligatoria para empresas.");

    // Solo validar creación de suscripción cuando: MENSUAL + activo + NO tiene suscripciones
    if (form.condicion_pago === "MENSUAL" && form.estado === "activo" && suscripciones.length === 0) {
      const dur = parseInt(formSuscEdit.duracion_meses, 10) || 0;
      const diaFac = parseInt(formSuscEdit.dia_facturacion, 10) || 0;
      const diaVenc = parseInt(formSuscEdit.dia_vencimiento, 10) || 0;
      if (dur <= 0) return setFormError("La duración del contrato debe ser mayor a 0.");
      if (diaFac < 1 || diaFac > 28) return setFormError("El día de facturación debe estar entre 1 y 28.");
      if (diaVenc < 1 || diaVenc > 31) return setFormError("El día de vencimiento debe estar entre 1 y 31.");
      if (diaVenc <= diaFac) return setFormError("El día de vencimiento debe ser mayor al día de facturación.");
      if (!formSuscEdit.plan_id.trim()) return setFormError("Seleccioná un plan para clientes mensuales.");
      const precio = parseFloat(formSuscEdit.precio) || 0;
      if (precio <= 0) return setFormError("El precio debe ser mayor a 0.");
    }

    if (form.condicion_pago === "CONTADO" && formContadoEdit.emitir_factura) {
      const monto = parseFloat(formContadoEdit.monto) || 0;
      if (monto <= 0) return setFormError("El monto de la factura debe ser mayor a 0.");
    }

    if (gestionTributariaEmpresa && formTributario.perfil_activo) {
      const eDia = getErrorDiaVencimientoTributario(formTributario);
      if (eDia) return setFormError(eDia);
      const otro = catalogoObligacionesTrib.find((c) => c.slug === "otro");
      if (otro && formTributario.obligacion_catalogo_ids.includes(otro.id) && !formTributario.obligacion_otro_detalle.trim()) {
        return setFormError('Completá el detalle cuando seleccionás la obligación "Otro".');
      }
    }

    if (form.sifen_receptor_manual) {
      if (!form.sifen_receptor_naturaleza.trim()) {
        return setFormError("SIFEN receptor: elegí la naturaleza del receptor.");
      }
      if (!form.sifen_ti_ope.trim()) {
        return setFormError("SIFEN receptor: elegí el tipo de operación (B2B / B2C / B2G / B2F).");
      }
      if (!form.sifen_direccion_de.trim()) {
        return setFormError("SIFEN receptor (modo explícito): completá la dirección para el DE.");
      }
      if (form.sifen_num_casa_de.trim() === "") {
        return setFormError("SIFEN receptor (modo explícito): indicá el número de casa para el DE (0 si no aplica).");
      }
      if (form.sifen_receptor_naturaleza === "extranjero") {
        const iso = form.sifen_codigo_pais.trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(iso) || iso === "PRY") {
          return setFormError("SIFEN receptor (extranjero): indicá un código país ISO3 válido distinto de PRY.");
        }
      }
      if (form.sifen_receptor_naturaleza === "contribuyente_paraguayo" && !form.ruc.trim()) {
        return setFormError("SIFEN receptor (contribuyente): el RUC del cliente es obligatorio.");
      }
      if (
        form.sifen_receptor_naturaleza !== "contribuyente_paraguayo" &&
        !form.sifen_num_id_de.trim() &&
        !form.documento.trim() &&
        !form.ruc.trim()
      ) {
        return setFormError(
          "SIFEN receptor: completá el número de documento del DE o el documento/RUC del cliente."
        );
      }
      const td = form.sifen_tipo_doc.trim();
      if (td === "9") {
        const d = form.sifen_descripcion_tipo_doc.trim();
        if (d.length < 9 || d.length > 41) {
          return setFormError(
            "SIFEN receptor: con tipo de documento «Otro», la descripción debe tener entre 9 y 41 caracteres (SET)."
          );
        }
      }
    }

    const tipoTs = (form.tipo_servicio_cliente || "").trim().toLowerCase();
    const sifenManualPayload = form.sifen_receptor_manual
      ? ({
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
        } satisfies Partial<Cliente>)
      : ({
          sifen_receptor_manual: false,
          sifen_receptor_naturaleza: null,
          sifen_ti_ope: null,
          sifen_tipo_doc_receptor: null,
          sifen_num_id_de: null,
          sifen_direccion_de: null,
          sifen_num_casa_de: null,
          sifen_descripcion_tipo_doc: null,
        } satisfies Partial<Cliente>);

    // Facturación B2B: alcanza con el RUC del cliente; el receptor SIFEN se detecta
    // AUTOMÁTICAMENTE del RUC. NO forzamos modo manual (exigiría el tipo de operación
    // iTiOpe). Si el modo manual no está activo, sifenManualPayload ya deja el flag en
    // false, así que re-guardar un cliente limpia un manual mal seteado.
    const contribuyenteSifenPayload: Partial<Cliente> = {};
    try {
      await updateCliente(id, {
        tipo_cliente:        form.tipo_cliente,
        empresa:             form.tipo_cliente === "empresa" ? form.empresa.trim().toUpperCase() : undefined,
        nombre_contacto:     form.nombre_contacto.trim().toUpperCase(),
        nombre_facturacion:  form.nombre_facturacion.trim().toUpperCase() || null,
        nivel_precio:        form.nivel_precio,
        ruc:                 form.ruc.trim()                 || undefined,
        documento:           form.documento.trim()           || undefined,
        es_contribuyente:    form.tipo_cliente === "persona" ? form.es_contribuyente : false,
        telefono:            form.telefono.trim()            || undefined,
        telefono_secundario: form.telefono_secundario.trim() || undefined,
        email:               form.email.trim()               || undefined,
        email_secundario:    form.email_secundario.trim()    || undefined,
        direccion:           form.direccion.trim()           || undefined,
        ciudad:              form.ciudad.trim().toUpperCase()  || undefined,
        pais:                form.pais.trim().toUpperCase()    || undefined,
        sitio_web:           form.sitio_web.trim()           || undefined,
        instagram:           form.instagram.trim()           || undefined,
        linkedin:            form.linkedin.trim()            || undefined,
        valor_cliente:       parseFloat(form.valor_cliente) || undefined,
        condicion_pago:      form.condicion_pago.trim().toUpperCase()    || undefined,
        moneda_preferida:    form.moneda_preferida,
        vendedor_asignado:   form.vendedor_asignado.trim().toUpperCase() || undefined,
        vendedor_usuario_id: form.vendedor_usuario_id.trim() || null,
        tipo_servicio_cliente: tipoTs || null,
        estado:              form.estado,
        usa_nota_remision:   form.usa_nota_remision,
        ...sifenManualPayload,
        ...contribuyenteSifenPayload,
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      if (/inexistente|inexistente en el cat|catálogo/i.test(m) || /check constraint/i.test(m) || m.includes("23514")) {
        return setFormError(
          "Ese «Tipo de servicio» no está en el catálogo CRM de tu empresa (o la base lo rechazó). Configuración → CRM → tipos/segmento: creá el tipo con el mismo identificador (slug), o elegí un tipo de la lista actualizada, y guardá de nuevo."
        );
      }
      return setFormError(m || "No se pudo guardar el cliente.");
    }

    if (gestionTributariaEmpresa) {
      const put = await apiPutClientePerfilTributario(id, buildPerfilTributarioPutBody(formTributario));
      if (!put.ok) return setFormError(put.error ?? "No se pudo guardar el perfil tributario.");
    }

    // Crear factura si condicion_pago = CONTADO y Emitir factura
    if (form.condicion_pago === "CONTADO" && formContadoEdit.emitir_factura) {
      const monto = parseFloat(formContadoEdit.monto) || 0;
      if (monto > 0) {
        const hoy = new Date().toISOString().slice(0, 10);
        const factura = await apiCreateFactura({
          cliente_id: id,
          fecha: hoy,
          fecha_vencimiento: hoy,
          monto,
          tipo: "contado",
          moneda: form.moneda_preferida,
          descripcion_linea: formContadoEdit.descripcion.trim() || "Venta al contado",
        });
        if (factura) getFacturas(id).then(setFacturas);
      }
    }

    // Crear suscripción si condicion_pago = MENSUAL, estado activo y no existe
    if (form.condicion_pago === "MENSUAL" && form.estado === "activo" && suscripciones.length === 0) {
      const plan = planes.find((p) => p.id === formSuscEdit.plan_id);
      await apiCreateSuscripcion({
        cliente_id: id,
        plan_id: formSuscEdit.plan_id || null,
        precio: parseFloat(formSuscEdit.precio) || (plan?.precio ?? 0),
        moneda: form.moneda_preferida,
        fecha_inicio: new Date().toISOString().slice(0, 10),
        duracion_meses: parseInt(formSuscEdit.duracion_meses, 10) || 12,
        dia_facturacion: parseInt(formSuscEdit.dia_facturacion, 10) || 1,
        dia_vencimiento: parseInt(formSuscEdit.dia_vencimiento, 10) || 10,
        generar_factura_este_mes: formSuscEdit.generar_factura,
      });
    }

    router.push("/clientes");
  }

  async function handleToggleEstado() {
    if (!cliente) return;
    setFormError(null);
    const nuevo = cliente.estado === "activo" ? "inactivo" : "activo";
    try {
      await toggleEstado(id, nuevo);
      cargar();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "No se pudo cambiar el estado del cliente.");
    }
  }

  async function abrirModalBajaOperativa() {
    setModalBajaOperativa(true);
    setBajaMotivo("");
    setBajaAnularFactura(false);
    setBajaCancelarSuscripciones(true);
    setErrorBaja(null);
    setBajaPreview(await apiGetBajaOperativaPreview(id));
  }

  async function abrirModalEliminar() {
    setConfirmarEliminar(true);
    setDeletionReason("");
    setErrorEliminar(null);
    setEliminarPreview(null);
    setEliminarCancelarSusc(true);
    setEliminarAnularFacturas(false);
    setEliminarCargandoPreview(true);
    const preview = await apiGetEliminarClientePreview(id);
    setEliminarCargandoPreview(false);
    setEliminarPreview(preview);
    if (!preview) {
      setErrorEliminar("No se pudo cargar la vista previa. Verifique permisos de administrador.");
    }
  }

  async function handleBajaOperativa() {
    if (!bajaMotivo.trim()) {
      setErrorBaja("El motivo es obligatorio");
      return;
    }
    if (bajaPreview && bajaPreview.suscripciones_activas > 0 && !bajaCancelarSuscripciones) {
      setErrorBaja("Debe confirmar cancelar las suscripciones activas para dar de baja.");
      return;
    }
    setBajaProcesando(true);
    setErrorBaja(null);
    const res = await apiBajaOperativaCliente(id, bajaMotivo.trim(), bajaAnularFactura, bajaCancelarSuscripciones);
    setBajaProcesando(false);
    if (!res.ok) {
      setErrorBaja(res.error ?? "Error al dar de baja");
      return;
    }
    setModalBajaOperativa(false);
    router.push("/clientes?baja_ok=1");
  }

  async function handleEliminar() {
    if (!deletionReason.trim()) {
      setErrorEliminar("El motivo es obligatorio");
      return;
    }
    if (eliminarPreview) {
      if (!eliminarPreview.puede_eliminar) {
        setErrorEliminar("No se puede eliminar: el cliente tiene ventas o tipificaciones asociadas.");
        return;
      }
      if (eliminarPreview.suscripciones_activas > 0 && !eliminarCancelarSusc) {
        setErrorEliminar("Debe confirmar la cancelación de las suscripciones activas para continuar.");
        return;
      }
      if (eliminarPreview.facturas_pendientes_count > 0 && !eliminarAnularFacturas) {
        setErrorEliminar(
          "Debe confirmar la anulación de las facturas pendientes (o cobrarlas antes) para no ensuciar reportería."
        );
        return;
      }
    }
    setEliminando(true);
    setErrorEliminar(null);
    const res = await apiDeleteCliente(id, deletionReason.trim(), {
      cancelar_suscripciones: eliminarCancelarSusc,
      anular_facturas_pendientes: eliminarAnularFacturas,
    });
    setEliminando(false);
    if (!res.ok) {
      setErrorEliminar(res.error ?? "Error al eliminar");
      return;
    }
    setConfirmarEliminar(false);
    setDeletionReason("");
    setEliminarPreview(null);
    router.push("/clientes");
  }

  async function handleAgregarNota(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevaNota.trim()) return;
    setGuardandoNota(true);
    await addNotaCliente(id, nuevaNota);
    setNuevaNota("");
    await cargar();
    setGuardandoNota(false);
    setTimeout(() => notaRef.current?.focus(), 0);
  }

  async function handleGuardarTarea(e: React.FormEvent) {
    e.preventDefault();
    setErrorTarea(null);
    if (!formTarea.titulo.trim()) return setErrorTarea("El título es obligatorio.");
    if (!formTarea.fecha_entrega) return setErrorTarea("La fecha de entrega es obligatoria.");
    setGuardandoTarea(true);
    const tarea = await createMarketingTask({
      cliente_id: id,
      titulo: formTarea.titulo.trim(),
      descripcion: formTarea.descripcion.trim() || undefined,
      tipo_contenido: formTarea.tipo_contenido,
      fecha_entrega: formTarea.fecha_entrega,
      responsable_user_id: formTarea.responsable_user_id || undefined,
      prioridad: formTarea.prioridad ? (formTarea.prioridad as "baja" | "media" | "alta" | "urgente") : undefined,
    });
    setGuardandoTarea(false);
    if (tarea) {
      setMarketingTasks((prev) => [...prev, tarea].sort((a, b) => a.fecha_entrega.localeCompare(b.fecha_entrega)));
      setFormTarea({ titulo: "", descripcion: "", tipo_contenido: "post", fecha_entrega: "", responsable_user_id: "", prioridad: "" });
      setModalNuevaTarea(false);
    } else {
      setErrorTarea("No se pudo crear la tarea.");
    }
  }

  async function handleCambiarEstadoTask(taskId: string, nuevoEstado: MarketingTask["estado"]) {
    const actualizada = await updateTaskStatus(taskId, nuevoEstado);
    if (actualizada) {
      setMarketingTasks((prev) =>
        prev.map((t) => (t.id === taskId ? actualizada : t))
      );
    }
  }

  function abrirRegistrarPago() {
    setActiveTab("estado_cuenta");
    const conSaldo = facturas.filter((f) => f.saldo > 0);
    const primera = conSaldo[0];
    if (!primera) return;
    setFacturaPago(null);
    setFormPago({
      factura_id: primera.id,
      monto: String(primera.saldo),
      fecha_pago: new Date().toISOString().slice(0, 10),
      metodo_pago: "efectivo",
      referencia: "",
    });
    setModalPago(true);
  }

  async function emitirFacturaContadoDesdeModal() {
    const monto = parseFloat(formFacturaContado.monto) || 0;
    if (monto <= 0 || !cliente) {
      setErrorFacturaContado("El monto debe ser mayor a 0.");
      return;
    }
    setErrorFacturaContado(null);
    setGuardandoFacturaContado(true);
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const result = await apiCreateFacturaWithError({
        cliente_id: id,
        fecha: hoy,
        fecha_vencimiento: hoy,
        monto,
        tipo: "contado",
        moneda: cliente.moneda_preferida ?? "GS",
        descripcion_linea: formFacturaContado.descripcion.trim() || "Venta al contado",
        iva_tipo: formFacturaContado.iva_tipo,
      });
      if (!result.ok) {
        setErrorFacturaContado(result.error);
        return;
      }
      setModalFacturaContado(false);
      setFormFacturaContado({ monto: "", descripcion: "Venta al contado", iva_tipo: "iva_10" });
      setActiveTab("estado_cuenta");
      getFacturas(id).then(setFacturas);
    } catch (err) {
      setErrorFacturaContado(err instanceof Error ? err.message : "No se pudo emitir la factura.");
    } finally {
      setGuardandoFacturaContado(false);
    }
  }

  if (cargandoCliente) {
    return <ClienteFichaSkeleton />;
  }

  if (notFound) {
    return (
      <div className="space-y-4 max-w-5xl">
        <h1 className="text-2xl font-bold text-gray-800">Cliente no encontrado</h1>
        <p className="text-xs font-mono text-gray-400 break-all">ID en URL: {id || "—"}</p>
        <button onClick={() => router.push("/clientes")} className="text-sm text-gray-500 underline">
          ← Volver a Clientes
        </button>
      </div>
    );
  }

  if (errorCarga) {
    return (
      <div className="space-y-4 max-w-5xl">
        <h1 className="text-xl font-bold text-gray-800">No se pudo cargar el cliente</h1>
        <p className="text-sm text-red-600">{errorCarga}</p>
        <p className="text-xs font-mono text-gray-400 break-all">ID: {id}</p>
        <button type="button" onClick={() => void cargar()} className="text-sm text-[#0EA5E9] underline">
          Reintentar
        </button>
        <button type="button" onClick={() => router.push("/clientes")} className="ml-4 text-sm text-gray-500 underline">
          ← Volver a Clientes
        </button>
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="space-y-4 max-w-5xl">
        <p className="text-sm text-gray-600">No hay datos del cliente.</p>
        <p className="text-xs font-mono text-gray-400 break-all">ID: {id}</p>
        <button type="button" onClick={() => router.push("/clientes")} className="text-sm text-gray-500 underline">
          ← Volver a Clientes
        </button>
      </div>
    );
  }

  const nombre = clienteNombre(cliente);

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ── Breadcrumb ────────────────────────────────────────────────────── */}
      <button
        onClick={() => router.push("/clientes")}
        className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
      >
        ← Clientes
      </button>

      {/* ── Panel resumen ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-slate-800 via-slate-800 to-[#3F8E91] px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              {/* Avatar */}
              <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold text-white shrink-0 ${
                cliente.tipo_cliente === "empresa" ? "bg-blue-500/80" : "bg-violet-500/80"
              }`}>
                {nombre.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h1 className="text-xl font-bold text-white leading-tight">{nombre}</h1>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  <span className="text-gray-300 font-mono text-xs">{cliente.codigo_cliente}</span>
                  {cliente.ruc && (
                    <span className="text-gray-300 text-xs">RUC: {cliente.ruc}</span>
                  )}
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    cliente.estado === "activo"
                      ? "bg-green-500/20 text-green-300"
                      : "bg-gray-500/30 text-gray-300"
                  }`}>
                    ● {cliente.estado === "activo" ? "Activo" : "Inactivo"}
                  </span>
                  {cliente.perfil_tributario_activo && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/15 text-white border border-white/25">
                      Tributario
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    Cliente desde {formatFecha(cliente.created_at)}
                  </span>
                </div>
              </div>
            </div>
            {/* Acciones del header */}
            <div className="flex items-center gap-2 shrink-0">
              {cliente.estado === "activo" ? (
                esAdmin ? (
                  <button
                    onClick={abrirModalBajaOperativa}
                    className="text-xs font-medium border border-amber-400/60 text-amber-200 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Dar de baja cliente
                  </button>
                ) : (
                  <button
                    onClick={handleToggleEstado}
                    className="text-xs font-medium border border-white/20 text-white/80 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Desactivar
                  </button>
                )
              ) : (
                <button
                  onClick={handleToggleEstado}
                  className="text-xs font-medium border border-white/20 text-white/80 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Reactivar
                </button>
              )}
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => void abrirModalEliminar()}
                  className="text-red-200 hover:text-white hover:bg-red-900/40 border border-red-400/40 flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors text-xs font-medium"
                  title="Eliminar cliente (baja lógica)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 shrink-0" aria-hidden>
                    <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
                  </svg>
                  Eliminar
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-white/15 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setFormSusc({
                  plan_id: "",
                  precio: "",
                  fecha_inicio: new Date().toISOString().slice(0, 10),
                  duracion_meses: "12",
                  dia_facturacion: "1",
                  dia_vencimiento: "10",
                  generar_factura_este_mes: false,
                });
                setModalSuscripcion(true);
              }}
              className="text-xs font-medium bg-white/15 hover:bg-white/25 text-white border border-white/30 px-3 py-1.5 rounded-lg transition-colors"
            >
              Nueva suscripción
            </button>
            <button
              type="button"
              onClick={() => {
                setFormFacturaContado({ monto: "", descripcion: "Venta al contado", iva_tipo: "iva_10" });
                setErrorFacturaContado(null);
                setModalFacturaContado(true);
              }}
              className="text-xs font-medium bg-white/15 hover:bg-white/25 text-white border border-white/30 px-3 py-1.5 rounded-lg transition-colors"
            >
              Factura al contado
            </button>
            <button
              type="button"
              onClick={abrirRegistrarPago}
              className="text-xs font-medium bg-white/15 hover:bg-white/25 text-white border border-white/30 px-3 py-1.5 rounded-lg transition-colors"
            >
              Registrar pago
            </button>
          </div>
        </div>

        {/* Estadísticas rápidas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-gray-100 border-t border-gray-100">
          {(
            [
              { label: "Origen", value: cliente.origen },
              {
                label: "Tipo servicio",
                value: etiquetaVisibleTipoServicio(
                  cliente.tipo_servicio_cliente ?? null,
                  labelTipoServicioMap
                ),
              },
              { label: "Condición", value: cliente.condicion_pago ?? "—" },
              {
                label: "Plan activo",
                value: cargandoDetalleCliente ? (
                  <span className="inline-block h-4 w-36 max-w-full animate-pulse rounded-md bg-slate-200" aria-hidden />
                ) : suscripcionActiva ? (
                  `${planes.find((p) => p.id === suscripcionActiva.plan_id)?.nombre ?? suscripcionActiva.plan_nombre ?? "Plan"} (${suscripcionActiva.moneda})`
                ) : (
                  "—"
                ),
              },
              { label: "Moneda", value: cliente.moneda_preferida ?? "GS" },
              {
                label: "Vendedor",
                value: (() => {
                  const uid = cliente.vendedor_usuario_id?.trim();
                  if (uid) {
                    const u = usuariosEmpresa.find((x) => x.id === uid);
                    const nom = (u?.nombre ?? "").trim() || u?.email?.trim();
                    if (nom) return nom;
                  }
                  return cliente.vendedor_asignado ?? "—";
                })(),
              },
              { label: "Creado por", value: cliente.created_by_nombre?.trim() || "—" },
            ] as { label: string; value: ReactNode }[]
          )
            .filter((item) => !SIMPLE_CLIENTE || !["Origen", "Tipo servicio", "Plan activo", "Vendedor"].includes(item.label))
            .map((item) => (
            <div key={item.label} className="px-5 py-3">
              <p className="text-xs text-gray-400">{item.label}</p>
              <div className="text-sm font-semibold text-gray-700 mt-0.5">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal Dar de baja operativa */}
      {modalBajaOperativa && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <p className="text-sm text-amber-800 font-medium">
            Dar de baja operativa: el cliente pasará a inactivo y no se generarán facturas futuras. Confirme abajo si cancela suscripciones activas y si anula facturas con saldo pendiente.
          </p>
          {bajaPreview != null && bajaPreview.suscripciones_activas > 0 && (
            <div className="bg-amber-100/50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-900 font-medium mb-2">
                Este cliente tiene {bajaPreview.suscripciones_activas} suscripción
                {bajaPreview.suscripciones_activas === 1 ? "" : "es"} activa
                {bajaPreview.suscripciones_activas === 1 ? "" : "s"}.
              </p>
              <p className="text-xs text-amber-800 mb-2">
                ¿Desea cancelarlas al dar de baja? (quedarán en estado cancelada)
              </p>
              <div className="flex gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setBajaCancelarSuscripciones(true)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium ${bajaCancelarSuscripciones ? "bg-amber-600 text-white" : "bg-white border border-amber-300 text-amber-800 hover:bg-amber-100"}`}
                >
                  Sí, cancelar suscripciones activas
                </button>
                <button
                  type="button"
                  onClick={() => setBajaCancelarSuscripciones(false)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium ${!bajaCancelarSuscripciones ? "bg-amber-600 text-white" : "bg-white border border-amber-300 text-amber-800 hover:bg-amber-100"}`}
                >
                  No, conservar suscripciones activas
                </button>
              </div>
            </div>
          )}
          {bajaPreview?.factura_pendiente_mes && (
            <div className="bg-amber-100/50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-900 font-medium mb-2">
                {bajaPreview.facturas_pendientes_count != null && bajaPreview.facturas_pendientes_count > 1
                  ? `Este cliente tiene ${bajaPreview.facturas_pendientes_count} facturas con saldo pendiente (ej.: ${bajaPreview.factura_pendiente_mes.numero_factura} — Gs. ${bajaPreview.factura_pendiente_mes.monto?.toLocaleString("es-PY")}).`
                  : `Este cliente tiene factura pendiente (${bajaPreview.factura_pendiente_mes.numero_factura} — Gs. ${bajaPreview.factura_pendiente_mes.monto?.toLocaleString("es-PY")}).`}
              </p>
              <p className="text-xs text-amber-800 mb-2">
                ¿Deseas anularlas al dar de baja? (quedarán en estado Anulado y no sumarán en cobranzas)
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setBajaAnularFactura(true)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium ${bajaAnularFactura ? "bg-amber-600 text-white" : "bg-white border border-amber-300 text-amber-800 hover:bg-amber-100"}`}
                >
                  Sí, anular facturas pendientes
                </button>
                <button
                  type="button"
                  onClick={() => setBajaAnularFactura(false)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium ${!bajaAnularFactura ? "bg-amber-600 text-white" : "bg-white border border-amber-300 text-amber-800 hover:bg-amber-100"}`}
                >
                  No, conservar factura pendiente
                </button>
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-amber-800 mb-1">Motivo obligatorio</label>
            <textarea
              value={bajaMotivo}
              onChange={(e) => { setBajaMotivo(e.target.value); setErrorBaja(null); }}
              placeholder="Ej: Fin del contrato, solicitud del cliente..."
              className="w-full border border-amber-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-amber-400 min-h-[60px]"
              rows={2}
            />
            {errorBaja && <p className="text-xs text-red-600 mt-1">{errorBaja}</p>}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleBajaOperativa}
              disabled={bajaProcesando}
              className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
            >
              {bajaProcesando ? "Procesando…" : "Confirmar baja"}
            </button>
            <button
              onClick={() => setModalBajaOperativa(false)}
              disabled={bajaProcesando}
              className="border border-amber-200 text-amber-700 px-3 py-1.5 rounded-lg text-xs hover:bg-amber-100 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Confirmación de eliminación (baja lógica); modal centrado */}
      {confirmarEliminar && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/45"
          role="dialog"
          aria-modal="true"
          aria-labelledby="eliminar-cliente-titulo"
          onClick={() => {
            if (eliminando) return;
            setConfirmarEliminar(false);
            setDeletionReason("");
            setErrorEliminar(null);
            setEliminarPreview(null);
          }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[min(90vh,640px)] overflow-y-auto border border-red-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 space-y-3 border-b border-slate-100">
              <h2 id="eliminar-cliente-titulo" className="text-base font-semibold text-slate-900">
                Eliminar cliente
              </h2>
              <p className="text-sm text-slate-600">
                Eliminación administrativa (baja lógica): el registro se conserva por integridad contable; deja de listarse.
                No es borrado físico salvo que en el futuro se habilite un proceso aparte de purga.
              </p>
            </div>
            <div className="p-5 space-y-3">
              {eliminarCargandoPreview && (
                <div className="space-y-2" aria-busy="true">
                  <div className="h-3 w-40 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-full max-w-xs animate-pulse rounded bg-slate-100" />
                </div>
              )}
              {eliminarPreview && !eliminarCargandoPreview && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-800">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Resumen del cliente</p>
                  <ul className="grid gap-1.5 text-sm">
                    <li>
                      Facturas con saldo pendiente:{" "}
                      <span className="font-semibold">{eliminarPreview.facturas_pendientes_count}</span>
                    </li>
                    <li>
                      Facturas pagadas:{" "}
                      <span className="font-semibold">{eliminarPreview.facturas_pagadas_count ?? 0}</span>
                    </li>
                    <li>
                      Facturas emitidas (no anuladas):{" "}
                      <span className="font-semibold">{eliminarPreview.facturas_emitidas_count ?? 0}</span>
                    </li>
                    <li>
                      Pagos registrados:{" "}
                      <span className="font-semibold">{eliminarPreview.pagos_registrados_count ?? 0}</span>
                    </li>
                    <li>
                      Suscripciones asociadas (total):{" "}
                      <span className="font-semibold">{eliminarPreview.suscripciones_total ?? 0}</span>
                      {eliminarPreview.suscripciones_activas > 0 && (
                        <span className="text-slate-600">
                          {" "}
                          ({eliminarPreview.suscripciones_activas} activa
                          {eliminarPreview.suscripciones_activas === 1 ? "" : "s"})
                        </span>
                      )}
                    </li>
                  </ul>
                </div>
              )}
              {eliminarPreview && !eliminarPreview.puede_eliminar && (
                <div className="bg-red-100/60 border border-red-300 rounded-lg p-3 text-sm text-red-900">
                  <p className="font-medium mb-1">No se puede eliminar este cliente</p>
                  <p className="text-xs">
                    Tiene {eliminarPreview.bloqueos.join(" y ")} asociados. Resuelva esas relaciones antes de eliminar.
                  </p>
                </div>
              )}
              {eliminarPreview?.puede_eliminar && eliminarPreview.suscripciones_activas > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-900 font-medium mb-2">
                    Hay {eliminarPreview.suscripciones_activas} suscripción
                    {eliminarPreview.suscripciones_activas === 1 ? "" : "es"} activa
                    {eliminarPreview.suscripciones_activas === 1 ? "" : "s"}.
                  </p>
                  <p className="text-xs text-red-800 mb-2">¿Cancelarlas al eliminar el cliente?</p>
                  <div className="flex gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setEliminarCancelarSusc(true)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium ${eliminarCancelarSusc ? "bg-red-600 text-white" : "bg-white border border-red-300 text-red-800 hover:bg-red-50"}`}
                    >
                      Sí, cancelar suscripciones
                    </button>
                    <button
                      type="button"
                      onClick={() => setEliminarCancelarSusc(false)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium ${!eliminarCancelarSusc ? "bg-red-600 text-white" : "bg-white border border-red-300 text-red-800 hover:bg-red-50"}`}
                    >
                      No
                    </button>
                  </div>
                </div>
              )}
              {eliminarPreview?.puede_eliminar && eliminarPreview.facturas_pendientes_count > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-900 font-medium mb-2">
                    {eliminarPreview.facturas_pendientes_count === 1 && eliminarPreview.factura_ejemplo
                      ? `Factura con saldo pendiente (${eliminarPreview.factura_ejemplo.numero_factura} — Gs. ${eliminarPreview.factura_ejemplo.monto?.toLocaleString("es-PY")}).`
                      : `Hay ${eliminarPreview.facturas_pendientes_count} facturas con saldo pendiente${eliminarPreview.factura_ejemplo ? ` (ej.: ${eliminarPreview.factura_ejemplo.numero_factura})` : ""}.`}
                  </p>
                  <p className="text-xs text-red-800 mb-2">
                    ¿Anularlas al eliminar? (estado Anulado, saldo 0 — no sumarán en cobranzas ni reportería de pendientes)
                  </p>
                  <div className="flex gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setEliminarAnularFacturas(true)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium ${eliminarAnularFacturas ? "bg-red-600 text-white" : "bg-white border border-red-300 text-red-800 hover:bg-red-50"}`}
                    >
                      Sí, anular facturas pendientes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEliminarAnularFacturas(false)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium ${!eliminarAnularFacturas ? "bg-red-600 text-white" : "bg-white border border-red-300 text-red-800 hover:bg-red-50"}`}
                    >
                      No, conservar facturas
                    </button>
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Motivo obligatorio</label>
                <textarea
                  value={deletionReason}
                  onChange={(e) => {
                    setDeletionReason(e.target.value);
                    setErrorEliminar(null);
                  }}
                  placeholder="Ej: Cliente duplicado, solicitud del interesado..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-red-400 min-h-[60px]"
                  rows={2}
                />
                {errorEliminar && <p className="text-xs text-red-600 mt-1">{errorEliminar}</p>}
              </div>
              <div className="flex gap-2 shrink-0 pt-1">
                <button
                  type="button"
                  onClick={() => void handleEliminar()}
                  disabled={
                    eliminando ||
                    eliminarCargandoPreview ||
                    !eliminarPreview ||
                    !eliminarPreview.puede_eliminar
                  }
                  className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {eliminando ? "Eliminando…" : "Confirmar eliminación"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmarEliminar(false);
                    setDeletionReason("");
                    setErrorEliminar(null);
                    setEliminarPreview(null);
                  }}
                  disabled={eliminando}
                  className="border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Pestañas ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Tab nav */}
        <div className="border-b border-gray-200 flex overflow-x-auto">
          {TABS.filter((tab) => !tab.showWhen || tab.showWhen(cliente)).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "border-gray-900 text-gray-900"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              } ${tab.id === "notas" && cliente.notas.length > 0 ? "relative" : ""}`}
            >
              {tab.label}
              {tab.id === "notas" && cliente.notas.length > 0 && (
                <span className="ml-1.5 text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">
                  {cliente.notas.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="relative min-h-[220px]">
          {cargandoDetalleCliente && (
            <div
              className="absolute inset-0 z-[1] rounded-b-xl bg-white/60 backdrop-blur-[0.5px] flex items-start justify-center pt-14 pointer-events-none"
              aria-hidden
            >
              <div className="flex flex-col items-center gap-2 w-full max-w-md px-6">
                <div className="h-2.5 w-3/4 max-w-xs rounded animate-pulse bg-slate-200" />
                <div className="h-2.5 w-2/3 max-w-xs rounded animate-pulse bg-slate-200" />
                <div className="h-28 w-full max-w-md rounded-lg animate-pulse bg-slate-100 mt-2" />
              </div>
            </div>
          )}
          <div className="p-6">

          {/* ── INFORMACIÓN ─────────────────────────────────────────────── */}
          {activeTab === "informacion" && (
            <form onSubmit={handleGuardar} className="space-y-8 max-w-2xl">

              {/* Trazabilidad de baja operativa */}
              {cliente.baja_operativa_at && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider">Baja operativa registrada</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <div>
                      <span className="text-amber-700">Fecha de baja:</span>
                      <span className="ml-2 font-medium text-amber-900">{formatFecha(cliente.baja_operativa_at)}</span>
                    </div>
                    <div>
                      <span className="text-amber-700">Usuario:</span>
                      <span className="ml-2 font-medium text-amber-900">{cliente.baja_operativa_by_nombre ?? cliente.baja_operativa_by_user_id ?? "—"}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-amber-700">Motivo:</span>
                      <span className="ml-2 font-medium text-amber-900">{cliente.baja_operativa_motivo ?? "—"}</span>
                    </div>
                    <div>
                      <span className="text-amber-700">Factura pendiente anulada:</span>
                      <span className="ml-2 font-medium text-amber-900">{cliente.baja_operativa_anulo_factura ? "Sí" : "No"}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Tipo */}
              <section className="space-y-4">
                <SectionTitle>Datos de identificación</SectionTitle>

                <div>
                  <label className={labelClass}>Tipo de cliente</label>
                  <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
                    {(["empresa", "persona"] as Cliente["tipo_cliente"][]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, tipo_cliente: t }))}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          form.tipo_cliente === t ? "bg-[#0EA5E9] text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                        }`}
                      >
                        {t === "empresa" ? "Empresa" : "Persona"}
                      </button>
                    ))}
                  </div>
                </div>

                {!SIMPLE_CLIENTE && (
                <div>
                  <label className={labelClass}>Tipo de servicio</label>
                  <select
                    name="tipo_servicio_cliente"
                    value={form.tipo_servicio_cliente}
                    onChange={handleChange}
                    className={inputClass}
                  >
                    <option value="">— Ninguno —</option>
                    {opcionesTipoServicio.map((f) => (
                      <option key={f.slug} value={f.slug}>
                        {f.nombre}
                        {!f.activo && (form.tipo_servicio_cliente || "").trim() === f.slug ? " (inactivo)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                )}

                {form.tipo_cliente === "empresa" && (
                  <div>
                    <label className={labelClass}>Razón social</label>
                    <input type="text" name="empresa" value={form.empresa} onChange={handleChange} className={`${inputClass} uppercase`} />
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>{form.tipo_cliente === "empresa" ? "Persona de contacto" : "Nombre completo"}</label>
                    <input type="text" name="nombre_contacto" value={form.nombre_contacto} onChange={handleChange} className={`${inputClass} uppercase`} required />
                  </div>
                  <div>
                    <label className={labelClass}>{form.tipo_cliente === "empresa" ? "RUC" : "CI / Documento"}</label>
                    {form.tipo_cliente === "empresa" ? (
                      <input type="text" name="ruc" value={form.ruc} onChange={handleChange} className={inputClass} />
                    ) : (
                      <input type="text" name="documento" value={form.documento} onChange={handleChange} className={inputClass} />
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

              {/* Contacto */}
              <section className="space-y-4">
                <SectionTitle>Contacto</SectionTitle>

                <div>
                  <label className={labelClass}>Teléfono</label>
                  <input type="text" name="telefono" value={form.telefono} onChange={handleChange} className={inputClass} />
                </div>

                <div>
                  <label className={labelClass}>Email</label>
                  <input type="email" name="email" value={form.email} onChange={handleChange} className={inputClass} />
                </div>

                <div>
                  <label className={labelClass}>Dirección</label>
                  <input type="text" name="direccion" value={form.direccion} onChange={handleChange} className={inputClass} />
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Ciudad</label>
                    <input type="text" name="ciudad" value={form.ciudad} onChange={handleChange} className={`${inputClass} uppercase`} />
                  </div>
                  <div>
                    <label className={labelClass}>País</label>
                    <input type="text" name="pais" value={form.pais} onChange={handleChange} className={`${inputClass} uppercase`} />
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

              {/* Digital */}
              <section className="space-y-4">
                <SectionTitle>Presencia digital</SectionTitle>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={labelClass}>Sitio web</label>
                    <input type="text" name="sitio_web" value={form.sitio_web} onChange={handleChange} placeholder="https://" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Instagram</label>
                    <input type="text" name="instagram" value={form.instagram} onChange={handleChange} placeholder="@usuario" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>LinkedIn</label>
                    <input type="text" name="linkedin" value={form.linkedin} onChange={handleChange} placeholder="URL o perfil" className={inputClass} />
                  </div>
                </div>
              </section>

              {/* Comercial */}
              <section className="space-y-4">
                <SectionTitle>Datos comerciales</SectionTitle>

                {!SIMPLE_CLIENTE && suscripcionActiva && (
                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/90">
                    <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wide">Plan mensual activo</p>
                    <p className="text-sm text-emerald-950 mt-1">
                      <span className="font-semibold">
                        {planes.find((p) => p.id === suscripcionActiva.plan_id)?.nombre ??
                          suscripcionActiva.plan_nombre ??
                          "Plan"}
                      </span>
                      {" · "}
                      {suscripcionActiva.moneda === "USD" ? "U$S " : "Gs. "}
                      {suscripcionActiva.precio.toLocaleString("es-PY")}
                      {" · facturación día "}
                      {suscripcionActiva.dia_facturacion}
                      {" · vencimiento día "}
                      {suscripcionActiva.dia_vencimiento}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={labelClass}>Condición de pago</label>
                    <select
                      name="condicion_pago"
                      value={form.condicion_pago}
                      onChange={handleChange}
                      className={inputClass}
                    >
                      <option value="">—</option>
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
                      onChange={(e) => setForm((p) => ({ ...p, moneda_preferida: e.target.value as "GS" | "USD" }))}
                      className={inputClass}
                    >
                      <option value="GS">Guaraníes (GS)</option>
                      <option value="USD">Dólares (USD)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Valor anual estimado (Gs.)</label>
                    <MontoInput value={form.valor_cliente} onChange={(n) => setForm((p) => ({ ...p, valor_cliente: String(n) }))} className={inputClass} decimals={false} />
                  </div>
                </div>

                {!SIMPLE_CLIENTE && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Vendedor responsable (usuario ERP)</label>
                    <select
                      name="vendedor_usuario_id"
                      value={form.vendedor_usuario_id}
                      onChange={(e) => setForm((p) => ({ ...p, vendedor_usuario_id: e.target.value }))}
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
                  <div>
                    <label className={labelClass}>Vendedor asignado (texto libre)</label>
                    <input type="text" name="vendedor_asignado" value={form.vendedor_asignado} onChange={handleChange} className={`${inputClass} uppercase`} />
                  </div>
                </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Estado</label>
                    <select
                      name="estado"
                      value={form.estado}
                      onChange={(e) => setForm((p) => ({ ...p, estado: e.target.value as Cliente["estado"] }))}
                      className={inputClass}
                    >
                      <option value="activo">Activo</option>
                      <option value="inactivo">Inactivo</option>
                    </select>
                  </div>
                </div>

                {/* Campos factura Contado */}
                {form.condicion_pago === "CONTADO" && (
                  <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                    <SectionTitle>Facturación al contado</SectionTitle>
                    {facturas.length > 0 ? (
                      <p className="text-sm text-slate-600">Este cliente ya tiene {facturas.length} factura(s).</p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="emitir_contado_edit"
                            checked={formContadoEdit.emitir_factura}
                            onChange={(e) => setFormContadoEdit((p) => ({ ...p, emitir_factura: e.target.checked }))}
                          />
                          <label htmlFor="emitir_contado_edit" className="text-sm text-slate-600">Emitir factura inicial</label>
                        </div>
                        {formContadoEdit.emitir_factura && (
                          <>
                            <div>
                              <label className={labelClass}>Monto (Gs.)</label>
                              <MontoInput
                                value={formContadoEdit.monto}
                                onChange={(n) => setFormContadoEdit((p) => ({ ...p, monto: String(n) }))}
                                className={inputClass}
                                placeholder="Monto de la factura"
                              />
                            </div>
                            <div>
                              <label className={labelClass}>Descripción</label>
                              <input
                                type="text"
                                value={formContadoEdit.descripcion}
                                onChange={(e) => setFormContadoEdit((p) => ({ ...p, descripcion: e.target.value }))}
                                className={inputClass}
                                placeholder="Venta al contado"
                              />
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Campos de suscripción (solo cuando condicion_pago = MENSUAL y no tiene suscripciones) */}
                {!SIMPLE_CLIENTE && form.condicion_pago === "MENSUAL" && (
                  <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                    <SectionTitle>Configuración de suscripción</SectionTitle>
                    {suscripciones.length > 0 ? (
                      <p className="text-sm text-slate-600">Este cliente ya tiene {suscripciones.length} suscripción(es). Podés agregar más desde la pestaña Suscripciones.</p>
                    ) : (
                      <>
                        <div>
                          <label className={labelClass}>Plan</label>
                          <select
                            value={formSuscEdit.plan_id}
                            onChange={(e) => {
                              const p = planes.find((x) => x.id === e.target.value);
                              setFormSuscEdit((prev) => ({ ...prev, plan_id: e.target.value, precio: p ? String(p.precio) : prev.precio }));
                            }}
                            className={inputClass}
                          >
                            <option value="">— Seleccionar plan —</option>
                            {planes.filter((p) => p.estado === "activo").map((p) => (
                              <option key={p.id} value={p.id}>{p.nombre} — Gs. {p.precio.toLocaleString("es-PY")}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Precio (Gs.)</label>
                          <MontoInput
                            value={formSuscEdit.precio}
                            onChange={(n) => setFormSuscEdit((p) => ({ ...p, precio: String(n) }))}
                            className={inputClass}
                            placeholder="Monto mensual"
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Duración contrato (meses)</label>
                          <input
                            type="number"
                            value={formSuscEdit.duracion_meses}
                            onChange={(e) => setFormSuscEdit((p) => ({ ...p, duracion_meses: e.target.value }))}
                            className={inputClass}
                            min={1}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className={labelClass}>Día facturación (1–28)</label>
                            <input
                              type="number"
                              value={formSuscEdit.dia_facturacion}
                              onChange={(e) => setFormSuscEdit((p) => ({ ...p, dia_facturacion: e.target.value }))}
                              className={inputClass}
                              min={1}
                              max={28}
                            />
                          </div>
                          <div>
                            <label className={labelClass}>Día vencimiento (1–31)</label>
                            <input
                              type="number"
                              value={formSuscEdit.dia_vencimiento}
                              onChange={(e) => setFormSuscEdit((p) => ({ ...p, dia_vencimiento: e.target.value }))}
                              className={inputClass}
                              min={1}
                              max={31}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="gen_fact_edit"
                            checked={formSuscEdit.generar_factura}
                            onChange={(e) => setFormSuscEdit((p) => ({ ...p, generar_factura: e.target.checked }))}
                          />
                          <label htmlFor="gen_fact_edit" className="text-sm text-slate-600">Emitir factura este mes</label>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </section>

              {gestionTributariaEmpresa && (
                <section className="space-y-3">
                  <details
                    className="group rounded-2xl border border-indigo-100/80 bg-gradient-to-b from-slate-50/80 to-white shadow-sm open:shadow-md transition-shadow [open]:shadow-md"
                    open={tributBlockOpen}
                    onToggle={(e) => {
                      setTributBlockOpen((e.currentTarget as HTMLDetailsElement).open);
                    }}
                  >
                    <summary className="cursor-pointer list-none px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between gap-2 text-left [&::-webkit-details-marker]:hidden">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Opcional</p>
                        <p className="text-sm font-semibold text-slate-800 mt-0.5">Perfil tributario</p>
                        <p className="text-xs text-slate-500 mt-0.5 max-w-xl">
                          Obligaciones, honorarios y vencimientos. El RUC principal sigue en Identificación.
                        </p>
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
                        catalog={catalogoObligacionesTrib}
                        value={formTributario}
                        onChange={setFormTributario}
                        tipoCliente={form.tipo_cliente}
                        claveYaConfigurada={Boolean(cliente.perfil_tributario?.clave_tributaria_configurada)}
                      />
                    </div>
                  </details>
                </section>
              )}

              {formError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  <span>⚠</span><span className="font-medium">{formError}</span>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm active:scale-95"
                >
                  Guardar cambios
                </button>
              </div>
            </form>
          )}

          {/* ── ESTADO DE CUENTA ─────────────────────────────────────────── */}
          {activeTab === "estado_cuenta" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionTitle>Facturas del cliente</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFormFacturaContado({ monto: "", descripcion: "Venta al contado", iva_tipo: "iva_10" });
                      setErrorFacturaContado(null);
                      setModalFacturaContado(true);
                    }}
                    className="text-sm font-medium border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg"
                  >
                    Emitir factura al contado
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const conSaldo = facturas.filter((f) => f.saldo > 0);
                      const primera = conSaldo[0];
                      setFacturaPago(null);
                      setFormPago({
                        factura_id: primera?.id ?? "",
                        monto: primera ? String(primera.saldo) : "",
                        fecha_pago: new Date().toISOString().slice(0, 10),
                        metodo_pago: "efectivo",
                        referencia: "",
                      });
                      setModalPago(true);
                    }}
                    className="text-sm font-medium text-[#0EA5E9] hover:text-[#0284C7]"
                  >
                    Registrar pago
                  </button>
                </div>
              </div>
              {facturas.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No hay facturas registradas.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {["Número", "Fecha", "Vencimiento", "Total", "Estado", "SIFEN"].map((h) => (
                          <th key={h} className="text-left text-xs font-semibold text-slate-600 px-4 py-3">{h}</th>
                        ))}
                        <th className="text-right text-xs font-semibold text-slate-600 px-4 py-3">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {facturas.map((f) => (
                        <tr key={f.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono text-slate-800">
                            <Link href={`/facturas/${f.id}`} className="text-[#0EA5E9] hover:underline font-semibold">
                              {f.numero_factura}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{formatFecha(f.fecha)}</td>
                          <td className="px-4 py-3 text-slate-600">{formatFecha(f.fecha_vencimiento)}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">Gs. {f.monto.toLocaleString("es-PY")}</td>
                          <td className="px-4 py-3">
                            {(() => {
                              const estUi = estadoFacturaParaUi(f, hoyYmdFactura);
                              return (
                                <span
                                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${clasesBadgeEstadoFacturaUi(estUi)}`}
                                >
                                  {textoBadgeEstadoFacturaUi(estUi)}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3 align-top">
                            <SifenEstadoBadge estadoSifen={sifenPorFactura[f.id]?.estado_sifen ?? null} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            {f.saldo > 0 && (
                              <button
                                type="button"
                                onClick={() => { setFacturaPago(f); setFormPago({ factura_id: f.id, monto: String(f.saldo), fecha_pago: new Date().toISOString().slice(0, 10), metodo_pago: "efectivo", referencia: "" }); setModalPago(true); }}
                                className="text-xs font-medium text-[#0EA5E9] hover:underline"
                              >
                                Registrar pago
                              </button>
                            )}
                            <Link
                              href={`/facturas/${f.id}`}
                              className="text-xs font-medium text-slate-500 hover:text-[#0EA5E9] hover:underline ml-2"
                            >
                              Ver
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── SUSCRIPCIONES ────────────────────────────────────────────── */}
          {activeTab === "suscripciones" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle>Suscripciones</SectionTitle>
                <button
                  type="button"
                  onClick={() => { setFormSusc({ plan_id: "", precio: "", fecha_inicio: new Date().toISOString().slice(0, 10), duracion_meses: "12", dia_facturacion: "1", dia_vencimiento: "10", generar_factura_este_mes: false }); setModalSuscripcion(true); }}
                  className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Nueva suscripción
                </button>
              </div>
              {suscripciones.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No hay suscripciones.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {["Plan", "Precio", "Moneda", "Inicio", "Meses", "Día fact.", "Día venc.", "Estado"].map((h) => (
                          <th key={h} className="text-left text-xs font-semibold text-slate-600 px-4 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {suscripciones.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-800">
                            {planes.find((p) => p.id === s.plan_id)?.nombre ?? s.plan_nombre ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{s.precio.toLocaleString("es-PY")}</td>
                          <td className="px-4 py-3 text-slate-600">{s.moneda}</td>
                          <td className="px-4 py-3 text-slate-600">{formatFecha(s.fecha_inicio)}</td>
                          <td className="px-4 py-3 text-slate-600">{s.duracion_meses}</td>
                          <td className="px-4 py-3 text-slate-600">{s.dia_facturacion}</td>
                          <td className="px-4 py-3 text-slate-600">{s.dia_vencimiento}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                              s.estado === "activa" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                            }`}>{s.estado}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── MARKETING ───────────────────────────────────────────────── */}
          {activeTab === "marketing" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <SectionTitle>Tareas de marketing</SectionTitle>
                <button
                  type="button"
                  onClick={() => {
                    setFormTarea({ titulo: "", descripcion: "", tipo_contenido: "post", fecha_entrega: new Date().toISOString().slice(0, 10), responsable_user_id: "", prioridad: "" });
                    setErrorTarea(null);
                    setModalNuevaTarea(true);
                  }}
                  className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Nueva tarea
                </button>
              </div>
              {marketingTasks.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No hay tareas de marketing.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        {["Título", "Tipo", "Estado", "Fecha entrega", "Responsable", "Origen"].map((h) => (
                          <th key={h} className="text-left text-xs font-semibold text-slate-600 px-4 py-3">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {marketingTasks.map((t) => {
                        const hoy = new Date().toISOString().slice(0, 10);
                        const atrasada = t.fecha_entrega < hoy && !["publicado", "aprobado"].includes(t.estado);
                        return (
                          <tr key={t.id} className={`hover:bg-slate-50 ${atrasada ? "bg-red-50/50" : ""}`}>
                            <td className="px-4 py-3 font-medium text-slate-800">
                              {t.titulo}
                              {atrasada && <span className="ml-1.5 text-xs text-red-600 font-medium">(atrasada)</span>}
                            </td>
                            <td className="px-4 py-3 text-slate-600 capitalize">{t.tipo_contenido}</td>
                            <td className="px-4 py-3">
                              <select
                                value={t.estado}
                                onChange={(e) => handleCambiarEstadoTask(t.id, e.target.value as MarketingTask["estado"])}
                                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                              >
                                {ESTADOS_TASK.map((est) => (
                                  <option key={est} value={est}>{est.replace("_", " ")}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-3 text-slate-600">{formatFecha(t.fecha_entrega)}</td>
                            <td className="px-4 py-3 text-slate-600">
                              {t.responsable_user_id
                                ? usuariosEmpresa.find((u) => u.id === t.responsable_user_id)?.nombre ?? "—"
                                : "—"}
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">
                              {t.generada_automaticamente ? "Plan" : "Manual"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── PROYECTOS ────────────────────────────────────────────────── */}
          {activeTab === "proyectos" && (
            <PlaceholderTab
              icon="📁"
              title="Proyectos"
              desc="Proyectos en curso y finalizados asociados a este cliente, con etapas y responsables."
            />
          )}

          {/* ── ACTIVIDAD ────────────────────────────────────────────────── */}
          {activeTab === "actividad" && (
            <PlaceholderTab
              icon="🕐"
              title="Actividad"
              desc="Timeline completo de interacciones, cambios de estado, ventas y eventos del cliente."
            />
          )}

          {/* ── NOTAS ───────────────────────────────────────────────────── */}
          {activeTab === "notas" && (
            <div className="max-w-2xl space-y-6">
              <form onSubmit={handleAgregarNota}>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nueva nota</label>
                <textarea
                  ref={notaRef}
                  value={nuevaNota}
                  onChange={(e) => setNuevaNota(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleAgregarNota(e as unknown as React.FormEvent);
                    }
                  }}
                  rows={3}
                  placeholder="Escribí una nota interna (Ctrl+Enter para guardar)..."
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm resize-none mb-3"
                />
<button
                type="submit"
                disabled={!nuevaNota.trim() || guardandoNota}
                className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              >
                  Agregar nota
                </button>
              </form>

              {cliente.notas.length === 0 ? (
                <p className="text-sm text-gray-400 italic">No hay notas registradas aún.</p>
              ) : (
                <div className="space-y-3">
                  {[...cliente.notas].reverse().map((nota: NotaCliente) => (
                    <div key={nota.id} className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{nota.texto}</p>
                      <p className="text-xs text-gray-400 mt-2">{formatFechaHora(nota.fecha)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
        </div>
      </div>

      {/* Modal factura al contado (nueva compra sin suscripción) */}
      {modalFacturaContado && cliente && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setModalFacturaContado(false)}
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Nueva factura al contado</h3>
            <p className="text-xs text-slate-500 mb-4">
              Compra puntual: no crea suscripción. El ítem se guarda en el servidor junto con la factura.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void emitirFacturaContadoDesdeModal();
              }}
              className="space-y-4"
            >
              <div>
                <label className={labelClass}>Monto ({cliente.moneda_preferida === "USD" ? "USD" : "Gs."})</label>
                <MontoInput
                  value={formFacturaContado.monto}
                  onChange={(n) => setFormFacturaContado((p) => ({ ...p, monto: String(n) }))}
                  className={inputClass}
                  decimals={cliente.moneda_preferida === "USD"}
                />
              </div>
              <div>
                <label className={labelClass}>Descripción (línea de factura)</label>
                <input
                  type="text"
                  value={formFacturaContado.descripcion}
                  onChange={(e) => setFormFacturaContado((p) => ({ ...p, descripcion: e.target.value }))}
                  className={inputClass}
                  placeholder="Venta al contado"
                />
              </div>
              <div>
                <label className={labelClass}>IVA de esta factura</label>
                <select
                  value={formFacturaContado.iva_tipo}
                  onChange={(e) =>
                    setFormFacturaContado((p) => ({
                      ...p,
                      iva_tipo: e.target.value as "exenta" | "iva_5" | "iva_10",
                    }))
                  }
                  className={inputClass}
                >
                  <option value="iva_10">IVA 10%</option>
                  <option value="iva_5">IVA 5%</option>
                  <option value="exenta">Exenta</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  Aplica solo a esta factura. Default IVA 10%.
                </p>
              </div>
              {errorFacturaContado ? (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                >
                  {errorFacturaContado}
                </div>
              ) : null}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setModalFacturaContado(false)}
                  className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardandoFacturaContado || !formFacturaContado.monto.trim()}
                  className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40"
                >
                  {guardandoFacturaContado ? "Guardando…" : "Emitir factura"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nueva suscripción */}
      {modalSuscripcion && cliente && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModalSuscripcion(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Nueva suscripción</h3>
            <form onSubmit={async (e) => {
              e.preventDefault();
              setGuardandoSusc(true);
              const plan = planes.find((p) => p.id === formSusc.plan_id);
              await apiCreateSuscripcion({
                cliente_id: id,
                plan_id: formSusc.plan_id || null,
                precio: parseFloat(formSusc.precio) || (plan?.precio ?? 0),
                moneda: cliente.moneda_preferida ?? "GS",
                fecha_inicio: formSusc.fecha_inicio || new Date().toISOString().slice(0, 10),
                duracion_meses: parseInt(formSusc.duracion_meses, 10) || 12,
                dia_facturacion: parseInt(formSusc.dia_facturacion, 10) || 1,
                dia_vencimiento: parseInt(formSusc.dia_vencimiento, 10) || 10,
                generar_factura_este_mes: formSusc.generar_factura_este_mes,
              });
              setModalSuscripcion(false);
              getSuscripciones(id).then(setSuscripciones);
              getFacturas(id).then(setFacturas);
              setGuardandoSusc(false);
            }} className="space-y-4">
              <div>
                <label className={labelClass}>Plan</label>
                <select
                  value={formSusc.plan_id}
                  onChange={(e) => {
                    const p = planes.find((x) => x.id === e.target.value);
                    setFormSusc((prev) => ({ ...prev, plan_id: e.target.value, precio: p ? String(p.precio) : prev.precio }));
                  }}
                  className={inputClass}
                >
                  <option value="">— Seleccionar —</option>
                  {planes.filter((p) => p.estado === "activo").map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre} — Gs. {p.precio.toLocaleString("es-PY")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Precio</label>
                <MontoInput value={formSusc.precio} onChange={(n) => setFormSusc((p) => ({ ...p, precio: String(n) }))} className={inputClass} required />
              </div>
              <div>
                <label className={labelClass}>Fecha inicio</label>
                <input type="date" value={formSusc.fecha_inicio} onChange={(e) => setFormSusc((p) => ({ ...p, fecha_inicio: e.target.value }))} className={inputClass} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Duración (meses)</label>
                  <input type="number" value={formSusc.duracion_meses} onChange={(e) => setFormSusc((p) => ({ ...p, duracion_meses: e.target.value }))} className={inputClass} min={1} />
                </div>
                <div>
                  <label className={labelClass}>Día facturación</label>
                  <input type="number" value={formSusc.dia_facturacion} onChange={(e) => setFormSusc((p) => ({ ...p, dia_facturacion: e.target.value }))} className={inputClass} min={1} max={28} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Día vencimiento</label>
                <input type="number" value={formSusc.dia_vencimiento} onChange={(e) => setFormSusc((p) => ({ ...p, dia_vencimiento: e.target.value }))} className={inputClass} min={1} max={31} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="gen_fact" checked={formSusc.generar_factura_este_mes} onChange={(e) => setFormSusc((p) => ({ ...p, generar_factura_este_mes: e.target.checked }))} />
                <label htmlFor="gen_fact" className="text-sm text-slate-600">Emitir factura este mes</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={guardandoSusc} className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  Guardar
                </button>
                <button type="button" onClick={() => setModalSuscripcion(false)} className="border border-slate-200 px-4 py-2 rounded-lg text-sm hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Nueva tarea marketing */}
      {modalNuevaTarea && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModalNuevaTarea(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Nueva tarea de marketing</h3>
            <form onSubmit={handleGuardarTarea} className="space-y-4">
              <div>
                <label className={labelClass}>Título *</label>
                <input
                  type="text"
                  value={formTarea.titulo}
                  onChange={(e) => setFormTarea((p) => ({ ...p, titulo: e.target.value }))}
                  className={inputClass}
                  placeholder="Ej: Post campaña navidad"
                  required
                />
              </div>
              <div>
                <label className={labelClass}>Tipo de contenido</label>
                <select
                  value={formTarea.tipo_contenido}
                  onChange={(e) => setFormTarea((p) => ({ ...p, tipo_contenido: e.target.value as typeof formTarea.tipo_contenido }))}
                  className={inputClass}
                >
                  {TIPOS_CONTENIDO.map((tc) => (
                    <option key={tc} value={tc}>{tc.charAt(0).toUpperCase() + tc.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Fecha de entrega *</label>
                <input
                  type="date"
                  value={formTarea.fecha_entrega}
                  onChange={(e) => setFormTarea((p) => ({ ...p, fecha_entrega: e.target.value }))}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className={labelClass}>Responsable</label>
                <select
                  value={formTarea.responsable_user_id}
                  onChange={(e) => setFormTarea((p) => ({ ...p, responsable_user_id: e.target.value }))}
                  className={inputClass}
                >
                  <option value="">— Sin asignar —</option>
                  {usuariosEmpresa.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre ?? u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Descripción</label>
                <textarea
                  value={formTarea.descripcion}
                  onChange={(e) => setFormTarea((p) => ({ ...p, descripcion: e.target.value }))}
                  className={inputClass}
                  rows={3}
                  placeholder="Detalles opcionales..."
                />
              </div>
              {errorTarea && (
                <p className="text-sm text-red-600">{errorTarea}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={guardandoTarea} className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  Guardar
                </button>
                <button type="button" onClick={() => setModalNuevaTarea(false)} className="border border-slate-200 px-4 py-2 rounded-lg text-sm hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Registrar pago */}
      {modalPago && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModalPago(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Registrar pago</h3>
            {facturaPago && <p className="text-sm text-slate-600 mb-4">Factura {facturaPago.numero_factura} — Saldo: Gs. {facturaPago.saldo.toLocaleString("es-PY")}</p>}
            <form onSubmit={async (e) => {
              e.preventDefault();
              const fid = facturaPago?.id ?? formPago.factura_id;
              if (!fid) return;
              setGuardandoPago(true);
              await apiCreatePago({
                factura_id: fid,
                monto: parseFloat(formPago.monto) || 0,
                fecha_pago: formPago.fecha_pago,
                metodo_pago: formPago.metodo_pago,
                referencia: formPago.referencia || undefined,
              });
              setModalPago(false);
              getFacturas(id).then(setFacturas);
              setGuardandoPago(false);
            }} className="space-y-4">
              {!facturaPago && facturas.filter((f) => f.saldo > 0).length > 0 && (
                <div>
                  <label className={labelClass}>Factura</label>
                  <select
                    value={formPago.factura_id}
                    onChange={(e) => {
                      const f = facturas.find((x) => x.id === e.target.value);
                      if (f) setFormPago((p) => ({ ...p, factura_id: f.id, monto: String(f.saldo) }));
                    }}
                    className={inputClass}
                    required
                  >
                    <option value="">— Seleccionar —</option>
                    {facturas.filter((f) => f.saldo > 0).map((f) => (
                      <option key={f.id} value={f.id}>{f.numero_factura} — Saldo Gs. {f.saldo.toLocaleString("es-PY")}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className={labelClass}>Monto</label>
                <MontoInput value={formPago.monto} onChange={(n) => setFormPago((p) => ({ ...p, monto: String(n) }))} className={inputClass} required />
              </div>
              <div>
                <label className={labelClass}>Fecha pago</label>
                <input type="date" value={formPago.fecha_pago} onChange={(e) => setFormPago((p) => ({ ...p, fecha_pago: e.target.value }))} className={inputClass} required />
              </div>
              <div>
                <label className={labelClass}>Método de pago</label>
                <select value={formPago.metodo_pago} onChange={(e) => setFormPago((p) => ({ ...p, metodo_pago: e.target.value as "efectivo" }))} className={inputClass}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Referencia</label>
                <input type="text" value={formPago.referencia} onChange={(e) => setFormPago((p) => ({ ...p, referencia: e.target.value }))} className={inputClass} placeholder="Nº de comprobante" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={guardandoPago} className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  Guardar
                </button>
                <button type="button" onClick={() => setModalPago(false)} className="border border-slate-200 px-4 py-2 rounded-lg text-sm hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
