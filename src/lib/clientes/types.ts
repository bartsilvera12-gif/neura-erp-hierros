export type TipoCliente = "empresa" | "persona";
export type OrigenCliente = "CRM" | "VENTA" | "MANUAL";
export type EstadoCliente = "activo" | "inactivo";

import {
  SLUGS_TIPOS_CLIENTE_SISTEMA,
} from "./tipo-servicio-catalogo";

/**
 * Clasificación operativa del cliente (distinto de tipo_cliente). Slug libre; los de sistema
 * (marketing, saas, etc.) se documentan en `SLUGS_TIPOS_CLIENTE_SISTEMA`.
 */
export type TipoServicioCliente = string;

export const TIPOS_SERVICIO_CLIENTE: string[] = [...SLUGS_TIPOS_CLIENTE_SISTEMA];
export { SLUGS_TIPOS_CLIENTE_SISTEMA };

export interface NotaCliente {
  id:    number;
  texto: string;
  fecha: string; // ISO string
}

export interface Cliente {
  id:                  string;          // UUID de Supabase
  codigo_cliente:      string;          // CL-000001

  tipo_cliente:        TipoCliente;
  empresa?:            string;          // razón social (si es empresa)
  nombre_contacto:     string;          // persona de contacto principal

  ruc?:                string;
  documento?:          string;          // CI / pasaporte (persona)

  /** Nombre alternativo para emitir la factura (opcional). Si vacío se usa razón social / contacto. */
  nombre_facturacion?: string | null;
  /** Nivel de precio por defecto al cargar productos (presupuestos/pedidos/ventas). */
  nivel_precio?:       "minorista" | "mayorista" | "distribuidor";
  /** Persona contribuyente inscripta en la SET (con RUC → factura B2B, evita rechazo 0301). */
  es_contribuyente?:   boolean;

  telefono?:           string;
  telefono_secundario?: string;
  email?:              string;
  email_secundario?:   string;

  direccion?:          string;
  ciudad?:             string;
  pais?:               string;

  /** El cliente requiere nota de remisión al venderle (documento no fiscal). */
  usa_nota_remision?:  boolean;

  sitio_web?:          string;
  instagram?:          string;
  linkedin?:           string;

  valor_cliente?:      number;          // valor estimado anual en GS

  condicion_pago?:     string;          // CONTADO / 30 DÍAS / 60 DÍAS…
  moneda_preferida?:   "GS" | "USD";
  vendedor_asignado?:  string;
  /** Usuario ERP responsable comercial (FK zentra_erp.usuarios); el texto libre sigue en vendedor_asignado. */
  vendedor_usuario_id?: string | null;
  /** Display enriquecido desde `zentra_erp.usuarios` para listados; no reemplaza la FK. */
  vendedor_usuario_nombre?: string | null;
  vendedor_usuario_email?:  string | null;

  origen:              OrigenCliente;
  prospecto_id?:       number;          // ID del prospecto CRM de origen

  estado:              EstadoCliente;
  notas:               NotaCliente[];

  /** Clasificación operativa (marketing, saas, branding, web, otro) */
  tipo_servicio_cliente?: TipoServicioCliente;

  /** Usuario que creó el cliente (auth.users.id) */
  created_by_user_id?:   string | null;
  /** Nombre del creador para display (denormalizado) */
  created_by_nombre?:    string | null;

  /** Eliminación lógica */
  deleted_at?:           string | null;   // ISO string
  deleted_by_user_id?:   string | null;
  deletion_reason?:      string | null;

  /** Baja operativa (estado inactivo + suscripciones canceladas) */
  baja_operativa_at?:         string | null;   // ISO string
  baja_operativa_by_user_id?: string | null;
  baja_operativa_by_nombre?:  string | null;   // Para trazabilidad
  baja_operativa_motivo?:     string | null;
  baja_operativa_anulo_factura?: boolean | null;

  /** SIFEN factura electrónica: receptor extranjero (no dRucRec/dDVRec paraguayos en el DE). */
  sifen_receptor_extranjero?: boolean;
  /** ISO 3166-1 alpha-3 (ej. PER); opcional si `pais` ya permite inferir el código. */
  sifen_codigo_pais?: string | null;
  /** tiTipDocRec SET (1–6 | 9); con extranjero, null → 9 en facturación. */
  sifen_tipo_doc_receptor?: number | null;

  /** Modo explícito «Datos SIFEN del receptor» (no inferencia legacy). */
  sifen_receptor_manual?: boolean;
  sifen_receptor_naturaleza?: "contribuyente_paraguayo" | "no_contribuyente" | "extranjero" | null;
  /** iTiOpe SET 1–4 (B2B/B2C/B2G/B2F). */
  sifen_ti_ope?: number | null;
  /** Número de identificación en el DE cuando el modo manual lo exige. */
  sifen_num_id_de?: string | null;
  /** Dirección en gDatRec (prioridad sobre `direccion` comercial si está cargada). */
  sifen_direccion_de?: string | null;
  /** dNumCasRec (entero ≥ 0). */
  sifen_num_casa_de?: number | null;
  /** Texto dDTipIDRec solo si tipo documento = 9 (9–41 caracteres SET). */
  sifen_descripcion_tipo_doc?: string | null;

  created_at:          string;          // ISO string
  updated_at:          string;          // ISO string

  /** Nombre del plan activo (suscripción activa). Solo cuando se solicita en listado. */
  plan_activo?:        string | null;

  /** Indicador de UI: el perfil tributario está activo (no implica que la empresa tenga la función encendida). */
  perfil_tributario_activo?: boolean;

  /** Detalle de obligaciones y metadatos fiscales (sin clave en claro). */
  perfil_tributario?:  PerfilTributarioCliente | null;
}

/** Perfil fiscal extendido; la clave nunca se expone, solo el hecho de que exista. */
export interface PerfilTributarioCliente {
  perfil_activo: boolean;
  dv: string | null;
  razon_social_fiscal: string | null;
  /** 1-31, día fijo de vencimiento mensual; `null` si no aplica. */
  dia_vencimiento_tributario: number | null;
  honorario_mensual: number | null;
  honorario_anual: number | null;
  notas_tributarias: string | null;
  obligacion_otro_detalle: string | null;
  clave_tributaria_configurada: boolean;
  obligaciones: { id: string; slug: string; nombre: string }[];
}
