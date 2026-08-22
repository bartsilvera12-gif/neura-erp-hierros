/**
 * Generación de XML rDE (SIFEN / e-kuatia) formato 150 — Factura electrónica (iTiDE=1).
 * Namespace oficial: http://ekuatia.set.gov.py/sifen/xsd
 *
 * Salida: rDE > dVerFor + DE (sin Signature ni gCamFuFD; esos se completan al firmar).
 * Referencia estructural: pysifen/de/samples/v150/factura_electronica.xml (kmee/sifen).
 */
import { createHash } from "node:crypto";
import type { AmbienteSifen, SifenFacturaPayloadBase } from "./types";
import {
  SIFEN_TEST_CSC_GENERICO,
  SIFEN_TEST_LITERAL_DOCUMENTO,
} from "./sifen-ambiente-test";
import { SIFEN_EKUATIA_TARGET_NS, SIFEN_SIRECEP_DE_V150_XSD_FILE } from "./sifen-xsi-schema-location";
import { escapeXml } from "./xml";
import {
  fechaEmisionCdc,
  generarCdcFacturaElectronica,
  normalizarNumeroDocumentoSifen,
  normalizarNumeroTimbrado,
  normalizarCodigoTres,
  formatoCuerpoRucTipoTruc,
  padDigits,
  splitRucParaXml,
} from "./sifen-cdc";
import {
  descripcionTipoDocRecepXml,
  nombrePaisParaDescripcionSifen,
} from "./sifen-receptor-pais";

const NS = SIFEN_EKUATIA_TARGET_NS;
const XMLNS_XSI = "http://www.w3.org/2001/XMLSchema-instance";
/** Par namespace + archivo relativo (sin https): SET TEST acepta esto; URL absoluta al .xsd provoca 0160. */
const RDE_XSI_SCHEMA_LOCATION = `${NS} ${SIFEN_SIRECEP_DE_V150_XSD_FILE}`;

/** Enumeraciones / literales exactos según DE_Types_v150.xsd (y catálogos referidos). */
const XSD_DES_TI_DE_FACTURA = "Factura electrónica";
const XSD_DES_TIP_TRA_VENTA_MERC = "Venta de mercadería";
const XSD_DES_IND_PRES_PRESENCIAL = "Operación presencial";
const XSD_DES_T_IMP_IVA = "IVA";
const XSD_DES_MONE_PYG = "Guarani";
const XSD_DES_AFEC_EXENTO = "Exento";
const XSD_DES_AFEC_GRAVADO = "Gravado IVA";
const XSD_DES_DOC_CI_PY = "Cédula paraguaya";
const XSD_DES_UNI_MED = "UNI";
const XSD_D_COND_CRED_PLAZO = "Plazo";

function textEl(name: string, value: string | number): string {
  const c = escapeXml(String(value));
  return `<${name}>${c}</${name}>`;
}

/** `tgTotSub.dRedon` — tipo `tdCRed` (decimal, hasta 4 decimales). */
function montoRedondeo(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return v.toFixed(4);
}

/**
 * Zona usada en `dFeEmiDE` / `dFecFirma`. SET valida contra su reloj en Paraguay; usar `getHours()` del servidor
 * (p. ej. UTC en la nube) provoca error **1004 — La fecha y hora de la firma digital es adelantada**.
 */
const SIFEN_FECHA_REFERENCIA_TZ = "America/Asuncion";

/**
 * Margen si el reloj del host va algunos segundos por delante del SET (misma causa 1004).
 */
const SIFEN_FIRMA_SKEW_MS = 120_000;

function wallYmdAndHmsInSifenTz(d: Date): { ymd: string; hms: string } {
  const tz = SIFEN_FECHA_REFERENCIA_TZ;
  const ymd = d.toLocaleDateString("en-CA", { timeZone: tz });
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(d);
  const pick2 = (ty: Intl.DateTimeFormatPart["type"]) => {
    const raw = parts.find((p) => p.type === ty)?.value ?? "0";
    const n = parseInt(raw.replace(/\D/g, ""), 10);
    return Number.isFinite(n) ? String(n).padStart(2, "0") : "00";
  };
  return { ymd, hms: `${pick2("hour")}:${pick2("minute")}:${pick2("second")}` };
}

function formatDeDateTimeEnTzSifen(d: Date): string {
  const { ymd, hms } = wallYmdAndHmsInSifenTz(d);
  return `${ymd}T${hms}`;
}

/**
 * `dFeEmiDE` / `dFecFirma` deben usar la **misma fecha calendario** que entra en el CDC (`fechaEmisionCdc(documento.fecha)`).
 * Si se usa solo `new Date()` al generar el XML días después, el Id (CDC) y la fecha en el DE quedan desalineados y SET rechaza el documento.
 * La parte horaria debe ser **hora civil de Paraguay** en el instante de generación (no la zona del servidor).
 */
function dFeEmiDeYFecFirma(fechaFacturaIso: string, horaReferencia: Date): string {
  const ref = new Date(horaReferencia.getTime() - SIFEN_FIRMA_SKEW_MS);
  const t = fechaFacturaIso.trim();
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (dm) {
    const y = dm[1]!;
    const mo = dm[2]!;
    const d = dm[3]!;
    const { hms } = wallYmdAndHmsInSifenTz(ref);
    return `${y}-${mo}-${d}T${hms}`;
  }
  return formatDeDateTimeEnTzSifen(ref);
}

function inferirTasaIva(subtotal: number, iva: number): 0 | 5 | 10 {
  if (!(subtotal > 0) || iva <= 0) return 0;
  const p = Math.round((100 * iva) / subtotal);
  if (Math.abs(p - 10) <= 1) return 10;
  if (Math.abs(p - 5) <= 1) return 5;
  return 10;
}

/**
 * IVA incluido en el total de línea (PYG): base + IVA = T, alícuota 5% o 10%.
 * Alineado a totales SET (ej. dSub10 / dIVA10 / dBaseGrav10).
 */
function splitIvaIncluidoDesdeTotal(totalConIva: number, tasa: 5 | 10): { base: number; iva: number } {
  const T = Math.round(totalConIva);
  if (tasa === 10) {
    const base = Math.round(T / 1.1);
    return { base, iva: T - base };
  }
  const base = Math.round(T / 1.05);
  return { base, iva: T - base };
}

/** tMontoBase / tdCantProSer: hasta 8 decimales, sin ceros finales innecesarios. */
function formatDecimalSifen(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  const s = n.toFixed(8).replace(/\.?0+$/, "");
  return s === "" || s === "-" ? "0" : s;
}

function cantidadProSerValida(cant: number): number {
  if (!Number.isFinite(cant) || cant <= 0) return 1;
  return cant;
}

const SIFEN_E8 = BigInt(100000000);
/** Escala 10¹⁶: (cant×10⁸)×(precio×10⁸) = cant×precio×10¹⁶ */
const SIFEN_TEN16 = BigInt(10) ** BigInt(16);
const SIFEN_HALF16 = BigInt(5) * (BigInt(10) ** BigInt(15));
const SIFEN_BI0 = BigInt(0);
const SIFEN_BI1 = BigInt(1);
const SIFEN_BI2 = BigInt(2);

/** Convierte literal decimal positivo (punto, ≤8 fraccionales) a entero = valor×10⁸. */
function decimalStringAEscalaE8(s: string): bigint {
  const t = s.trim();
  if (!t || t === "0") return SIFEN_BI0;
  const [intRaw, fracRaw = ""] = t.split(".");
  const intPart = intRaw === "" ? "0" : intRaw;
  const frac8 = (fracRaw + "00000000").slice(0, 8);
  return BigInt(intPart) * SIFEN_E8 + BigInt(frac8 || "0");
}

/** Entero escala 10⁻⁸ → cadena XSD (sin notación científica). */
function escalaE8AStringDecimal(scaled: bigint): string {
  if (scaled <= SIFEN_BI0) return "0";
  const intPart = scaled / SIFEN_E8;
  let frac = (scaled % SIFEN_E8).toString().padStart(8, "0");
  frac = frac.replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : `${intPart}`;
}

/**
 * Total valor operación por ítem en PYG según `facturacionelectronicapy-xmlgen` (TIPS):
 * `(cant×precio).toFixed(decimals)` → `parseFloat` → `.toFixed(pygDecimals)` con defaults `2` y `0`.
 * La SET suele validar con la misma lógica; si no coincide, aparece el 1858.
 */
const SIFEN_PY_VALOR_ITEM_INTERMEDIATE_DECIMALS = 2;

function totalValorOperacionItemPygSegunTips(cantStr: string, precioStr: string): number {
  let x = parseFloat(precioStr) * parseFloat(cantStr);
  if (!Number.isFinite(x)) x = 0;
  x = parseFloat(x.toFixed(SIFEN_PY_VALOR_ITEM_INTERMEDIATE_DECIMALS));
  return parseFloat(x.toFixed(0));
}

/**
 * Precio unitario (×10⁸ entero) tal que redondeo half-up de (cant×precio) a guaraníes enteros = T.
 * Evita 1858 cuando la SET valida cant×precio en decimal fijo (p. ej. 3×3333.33333333≠10000).
 */
function precioUnitarioE8DesdeTotalGuaranies(T: number, cantE8: bigint): bigint {
  const Tb = BigInt(Math.max(0, Math.round(T)));
  const Q = cantE8 > SIFEN_BI0 ? cantE8 : SIFEN_E8;
  const P = (Tb * SIFEN_TEN16 + Q / SIFEN_BI2) / Q;
  const redondeado = (Q * P + SIFEN_HALF16) / SIFEN_TEN16;
  if (redondeado === Tb) return P;
  const lo = Tb * SIFEN_TEN16 - SIFEN_HALF16;
  const pMin = (lo + Q - SIFEN_BI1) / Q;
  const hi = (Tb + SIFEN_BI1) * SIFEN_TEN16 - SIFEN_HALF16 - SIFEN_BI1;
  const pMax = hi / Q;
  if (pMin <= pMax) return pMin;
  throw new Error(`SIFEN ítem: total ${T} incompatible con cantidad (escala ${Q}) para precio unitario`);
}

/**
 * `dPUniProSer` + totales de línea alineados al redondeo TIPS (1858).
 * Prioriza `precio_unitario` del ERP si ya cierra con `total` y cantidad.
 */
function resolverPrecioYTotalesValorItemPyg(
  precioUnitarioErp: number,
  totalLineaGs: number,
  dCantStr: string,
  cantE8: bigint
): { dPUniStr: string; dTotOpeItem: number } {
  const T = Math.max(0, Math.round(totalLineaGs));
  const erpStr = formatDecimalSifen(precioUnitarioErp);
  if (totalValorOperacionItemPygSegunTips(dCantStr, erpStr) === T) {
    return { dPUniStr: erpStr, dTotOpeItem: T };
  }
  const pE8 = precioUnitarioE8DesdeTotalGuaranies(T, cantE8);
  for (let i = -5000; i <= 5000; i++) {
    const P = pE8 + BigInt(i);
    if (P <= SIFEN_BI0) continue;
    const ps = escalaE8AStringDecimal(P);
    const tot = totalValorOperacionItemPygSegunTips(dCantStr, ps);
    if (tot === T) return { dPUniStr: ps, dTotOpeItem: tot };
  }
  throw new Error(
    `SIFEN ítem: total línea ${T} Gs y cantidad ${dCantStr} no admiten precio unitario (≤8 dec.) que cierre con el redondeo oficial (cant×precio). Corregí cantidad o totales en la factura.`
  );
}

/** `tdDesAfecIVA`: solo coinciden textos fijos del XSD (la tasa va en `dTasaIVA`). */
function descripcionAfectacion(tasa: 0 | 5 | 10): string {
  if (tasa === 0) return XSD_DES_AFEC_EXENTO;
  return XSD_DES_AFEC_GRAVADO;
}

/**
 * `tiTipCont` / `iTiContRec`: 1 = persona física, 2 = persona jurídica (Manual Técnico SIFEN).
 * El XSD no incluye `dDes` para estos códigos en `gEmis` / `gDatRec`.
 * Heurística: forma societaria típica en denominación (PY) → jurídica; si no coincide → física.
 */
function esPersonaJuridicaSegunDenominacion(denominacion: string): boolean {
  const u = denominacion.trim().toUpperCase();
  if (!u) return false;
  if (/\bS\.?\s*A\.?\b/.test(u)) return true;
  if (/\bS\.?\s*R\.?\s*L\.?\b/.test(u)) return true;
  if (/\bE\.?\s*A\.?\s*S\.?\b/.test(u)) return true;
  if (/\bEAS\b/.test(u)) return true;
  if (/\bLTDA\b/.test(u)) return true;
  if (/\bS\.\s*EN\s*C\.?\b/.test(u) || /\bS\s+EN\s+C\b/.test(u)) return true;
  if (/\bUNIPERSONAL\b/.test(u)) return true;
  if (/\bCOOP(?:ERATIVA)?\b/.test(u)) return true;
  if (/\bY\s+CIA\b/.test(u)) return true;
  return false;
}

function iTipContCodigo(denominacion: string): "1" | "2" {
  return esPersonaJuridicaSegunDenominacion(denominacion) ? "2" : "1";
}

function dCodSegNueveDigitos(csc: string, semilla: string): string {
  const h = createHash("sha256")
    .update(`${csc.trim()}|${semilla}`)
    .digest();
  let s = "";
  for (let i = 0; i < h.length && s.length < 9; i++) {
    s += String(h[i]! % 10);
  }
  return s.padStart(9, "0").slice(-9);
}

export interface BuildRdeXmlOptions {
  /** Vigencia timbrado inicio YYYY-MM-DD → `gTimb.dFeIniT` (v150 no incluye `dFeFinT` en el XSD). */
  timbradoFechaInicio: string;
  /** @deprecated v150: no se emite `dFeFinT` (no está en tgDTim del XSD; SET rechaza el nodo). */
  timbradoFechaFin?: string;
  /** Ambiente SIFEN de la empresa: en `test` aplican literales y CSC genérico del DE. */
  ambiente?: AmbienteSifen;
  /** Teléfono emisor 8–15 dígitos (solo números). */
  emisorTelefono: string;
  /** Email emisor válido según patrón SIFEN. */
  emisorEmail: string;
  /** Dirección emisor (mín. 1 carácter significativo). */
  emisorDireccion: string;
  /** Número de casa emisor (entero). */
  emisorNumCasa: number;
  /** Código departamento emisor (tabla SET). Por defecto 1 Capital. */
  emisorDepartamento?: string;
  emisorDepartamentoDescripcion?: string;
  /** Distrito y ciudad emisor (opcionales; si se omiten no se envían nodos). */
  emisorDistrito?: string;
  emisorDistritoDescripcion?: string;
  emisorCiudad?: string;
  emisorCiudadDescripcion?: string;
  /** Actividad económica principal (código + descripción). */
  actividadEconomicaCodigo?: string;
  actividadEconomicaDescripcion?: string;
  /** Momento de emisión / firma (por defecto ahora). */
  fechaHoraEmision?: Date;
}

function vigenciaIso(dateYmd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd.trim());
  if (!m) throw new Error(`Fecha timbrado inválida (use YYYY-MM-DD): ${dateYmd}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Construye el XML rDE oficial (factura electrónica) listo para firmar el nodo `DE`.
 */
export function buildOfficialRdeFacturaElectronicaXml(
  base: SifenFacturaPayloadBase,
  opts: BuildRdeXmlOptions
): string {
  const { emisor, documento, receptor, items } = base;
  if (documento.moneda !== "GS") {
    throw new Error(
      "RDE Factura Electrónica: por ahora solo moneda GS (PYG). USD requiere tipo de cambio en gOpeCom."
    );
  }

  const ambiente: AmbienteSifen = opts.ambiente ?? "produccion";
  const esAmbienteTest = ambiente === "test";

  let cscParaCodSeg: string;
  if (esAmbienteTest) {
    /** Si el timbrado de prueba tiene CSC en BD, SET valida CDC/dCodSeg contra ese valor; el genérico solo si no hay CSC. */
    const cscCfg = emisor.csc == null ? "" : String(emisor.csc).trim();
    cscParaCodSeg = cscCfg !== "" ? cscCfg : SIFEN_TEST_CSC_GENERICO;
  } else {
    const csc = emisor.csc;
    if (csc == null || String(csc).trim() === "") {
      throw new Error("Falta CSC en configuración SIFEN (empresa_sifen_config.csc) para generar el DE.");
    }
    cscParaCodSeg = String(csc).trim();
  }

  const { cuerpo: rucEmCuerpo, dDV: dDVEmi } = splitRucParaXml(emisor.ruc);
  const dRucEmCdc = padDigits(rucEmCuerpo, 8);
  const dNumTim = normalizarNumeroTimbrado(emisor.timbrado_numero);
  const dEst = normalizarCodigoTres(emisor.establecimiento);
  const dPunExp = normalizarCodigoTres(emisor.punto_expedicion);
  const dNumDoc = normalizarNumeroDocumentoSifen(documento.numero_factura);
  const fechaCdc = fechaEmisionCdc(documento.fecha);
  /** Debe coincidir con `gEmis.iTipCont` y entrar en el CDC antes de la fecha (SET / TIPS). */
  const iTipContEmi = iTipContCodigo(emisor.razon_social);

  /**
   * Semilla `dCodSeg` (y CDC): por defecto el id de `factura_electronica` (mismo DE al regenerar en borrador/generado).
   * Tras rechazo SET, `sifen_regeneracion_seq > 0` en BD altera la semilla para obtener un CDC nuevo antes de reenviar.
   */
  const regSeq = Math.max(0, Math.floor(Number(base.sifen.sifen_regeneracion_seq ?? 0)));
  const semillaSeg =
    regSeq > 0
      ? `${base.sifen.factura_electronica_id}:r${String(regSeq)}`
      : base.sifen.factura_electronica_id;
  const dCodSeg = dCodSegNueveDigitos(cscParaCodSeg, semillaSeg);

  const { cdc, dDVId } = generarCdcFacturaElectronica({
    iTiDE: "1",
    dRucEm: dRucEmCdc,
    dDVEmi,
    dEst,
    dPunExp,
    numeroFactura: documento.numero_factura,
    fechaEmision: fechaCdc,
    iTipContEmisor: iTipContEmi,
    iTipEmi: "1",
    dCodSeg,
  });

  const ahora = opts.fechaHoraEmision ?? new Date();
  const dFeEmiDE = dFeEmiDeYFecFirma(documento.fecha, ahora);
  const dFecFirma = dFeEmiDE;

  const dFeIniT = vigenciaIso(opts.timbradoFechaInicio);

  const telEmi = opts.emisorTelefono.replace(/\D/g, "");
  if (telEmi.length < 8 || telEmi.length > 15) {
    throw new Error("emisorTelefono debe tener entre 8 y 15 dígitos para gEmis.dTelEmi.");
  }

  const dirEmi = opts.emisorDireccion.trim();
  if (dirEmi.length < 1) throw new Error("emisorDireccion es obligatoria.");

  const dep = (opts.emisorDepartamento ?? "1").trim();
  const depDes = (opts.emisorDepartamentoDescripcion ?? "CAPITAL").trim();
  const cAct = opts.actividadEconomicaCodigo?.trim() ?? "";
  const dActDes = opts.actividadEconomicaDescripcion?.trim() ?? "";
  if (!cAct || !dActDes) {
    throw new Error(
      "Faltan actividadEconomicaCodigo y actividadEconomicaDescripcion (gEmis.gActEco). Configúrelos en Facturación electrónica; deben coincidir con el catálogo SET para su RUC (error 1261 si no)."
    );
  }

  const dNomEmi = esAmbienteTest ? SIFEN_TEST_LITERAL_DOCUMENTO : emisor.razon_social.trim();

  const gEmisParts: string[] = [
    "<gEmis>",
    /** Mismo relleno 8 dígitos que en el CDC; si no, SET TEST rechaza 1000. */
    textEl("dRucEm", dRucEmCdc),
    textEl("dDVEmi", dDVEmi),
    textEl("iTipCont", iTipContEmi),
    textEl("dNomEmi", dNomEmi),
    textEl("dDirEmi", dirEmi),
    textEl("dNumCas", opts.emisorNumCasa),
    textEl("cDepEmi", dep),
    textEl("dDesDepEmi", depDes),
  ];

  if (opts.emisorDistrito?.trim()) {
    gEmisParts.push(textEl("cDisEmi", opts.emisorDistrito.replace(/\D/g, "").slice(0, 4)));
    gEmisParts.push(textEl("dDesDisEmi", (opts.emisorDistritoDescripcion ?? "").trim() || "ASUNCION"));
  }
  if (opts.emisorCiudad?.trim()) {
    gEmisParts.push(textEl("cCiuEmi", opts.emisorCiudad.replace(/\D/g, "").slice(0, 5)));
    gEmisParts.push(textEl("dDesCiuEmi", (opts.emisorCiudadDescripcion ?? "").trim() || "ASUNCION"));
  } else {
    gEmisParts.push(textEl("cCiuEmi", "1"));
    gEmisParts.push(textEl("dDesCiuEmi", "ASUNCION (DISTRITO)"));
  }

  gEmisParts.push(textEl("dTelEmi", telEmi));
  gEmisParts.push(textEl("dEmailE", opts.emisorEmail.trim()));
  gEmisParts.push("<gActEco>");
  gEmisParts.push(textEl("cActEco", cAct));
  gEmisParts.push(textEl("dDesActEco", dActDes));
  gEmisParts.push("</gActEco>");
  gEmisParts.push("</gEmis>");

  const recParts: string[] = ["<gDatRec>"];
  // SIFEN: si se informa dDirRec, dNumCasRec es OBLIGATORIO. En las ramas
  // automáticas (B2B RUC / B2C CI / B2F) el cliente no tiene un número de casa
  // separado; usamos el configurado si existe, o 0 (aceptado por SET).
  const casaRecAuto: number = (() => {
    const cr = receptor.sifen_d_num_cas_rec;
    return cr == null || !Number.isFinite(Number(cr)) ? 0 : Math.max(0, Math.floor(Number(cr)));
  })();
  if (
    receptor.sifen_receptor_config_manual === true &&
    receptor.sifen_i_nat_rec != null &&
    receptor.sifen_i_ti_ope != null
  ) {
    const dirRec = (receptor.sifen_d_dir_rec ?? "").trim();
    if (!dirRec) {
      throw new Error("SIFEN receptor manual: falta dirección (dDirRec) en el payload.");
    }
    const cr = receptor.sifen_d_num_cas_rec;
    const casa =
      cr == null || !Number.isFinite(Number(cr)) ? 0 : Math.max(0, Math.floor(Number(cr)));
    recParts.push(textEl("iNatRec", String(receptor.sifen_i_nat_rec)));
    recParts.push(textEl("iTiOpe", String(receptor.sifen_i_ti_ope)));
    if (receptor.sifen_i_nat_rec === 1) {
      const rucL = receptor.ruc?.trim();
      if (!rucL) throw new Error("SIFEN receptor manual: falta RUC en el payload.");
      const { cuerpo: dRucRec, dDV: dDVRec } = splitRucParaXml(rucL);
      const iTiContRec = iTipContCodigo(receptor.nombre);
      recParts.push(textEl("cPaisRec", "PRY"));
      recParts.push(textEl("dDesPaisRe", "Paraguay"));
      recParts.push(textEl("iTiContRec", iTiContRec));
      recParts.push(textEl("dRucRec", formatoCuerpoRucTipoTruc(dRucRec)));
      recParts.push(textEl("dDVRec", dDVRec));
      recParts.push(textEl("dNomRec", receptor.nombre.trim()));
      recParts.push(textEl("dDirRec", dirRec));
      recParts.push(textEl("dNumCasRec", String(casa)));
    } else {
      const cPais = (receptor.codigo_pais_iso3 ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(cPais)) {
        throw new Error("SIFEN receptor manual: codigo_pais_iso3 inválido en el payload.");
      }
      const dDesPais = nombrePaisParaDescripcionSifen(cPais);
      const tipo = receptor.tipo_doc_receptor ?? (cPais === "PRY" ? 1 : 9);
      const dDesTipo = descripcionTipoDocRecepXml(tipo, receptor.descripcion_tipo_doc_receptor);
      const num = (receptor.num_id_receptor ?? "").replace(/\s/g, "").trim().slice(0, 20);
      if (!num) throw new Error("SIFEN receptor manual: falta num_id_receptor en el payload.");
      recParts.push(textEl("cPaisRec", cPais));
      recParts.push(textEl("dDesPaisRe", dDesPais));
      recParts.push(textEl("iTipIDRec", String(tipo)));
      recParts.push(textEl("dDTipIDRec", dDesTipo));
      recParts.push(textEl("dNumIDRec", num));
      recParts.push(textEl("dNomRec", receptor.nombre.trim()));
      recParts.push(textEl("dDirRec", dirRec));
      recParts.push(textEl("dNumCasRec", String(casa)));
    }
    if (receptor.telefono?.trim()) {
      const tr = receptor.telefono.replace(/\D/g, "");
      if (tr.length >= 8) recParts.push(textEl("dTelRec", tr.slice(0, 15)));
    }
    if (receptor.email?.trim()) recParts.push(textEl("dEmailRec", receptor.email.trim()));
  } else if (receptor.receptor_extranjero === true) {
    const cPais = (receptor.codigo_pais_iso3 ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cPais)) {
      throw new Error("Receptor extranjero SIFEN: codigo_pais_iso3 inválido o ausente en el payload.");
    }
    const dDesPais = nombrePaisParaDescripcionSifen(cPais);
    const tipo = receptor.tipo_doc_receptor ?? 9;
    const dDesTipo = descripcionTipoDocRecepXml(tipo, receptor.descripcion_tipo_doc_receptor);
    const num = (receptor.num_id_receptor ?? "").replace(/\s/g, "").trim().slice(0, 20);
    if (!num) {
      throw new Error("Receptor extranjero SIFEN: falta num_id_receptor en el payload.");
    }
    /** tiTiOpe (DE_Types v150): 1=B2B, 4=B2F. Receptor extranjero (iNatRec=2) exige B2F, no B2B. */
    recParts.push(textEl("iNatRec", "2"));
    recParts.push(textEl("iTiOpe", "4"));
    recParts.push(textEl("cPaisRec", cPais));
    recParts.push(textEl("dDesPaisRe", dDesPais));
    recParts.push(textEl("iTipIDRec", String(tipo)));
    recParts.push(textEl("dDTipIDRec", dDesTipo));
    recParts.push(textEl("dNumIDRec", num));
    recParts.push(textEl("dNomRec", receptor.nombre.trim()));
    if (receptor.direccion?.trim()) {
      recParts.push(textEl("dDirRec", receptor.direccion.trim()));
      recParts.push(textEl("dNumCasRec", String(casaRecAuto)));
    }
    if (receptor.telefono?.trim()) {
      const tr = receptor.telefono.replace(/\D/g, "");
      if (tr.length >= 8) recParts.push(textEl("dTelRec", tr.slice(0, 15)));
    }
    if (receptor.email?.trim()) recParts.push(textEl("dEmailRec", receptor.email.trim()));
  } else if (receptor.ruc?.trim()) {
    const { cuerpo: dRucRec, dDV: dDVRec } = splitRucParaXml(receptor.ruc.trim());
    const iTiContRec = iTipContCodigo(receptor.nombre);
    recParts.push(textEl("iNatRec", "1"));
    recParts.push(textEl("iTiOpe", "1"));
    recParts.push(textEl("cPaisRec", "PRY"));
    recParts.push(textEl("dDesPaisRe", "Paraguay"));
    recParts.push(textEl("iTiContRec", iTiContRec));
    recParts.push(textEl("dRucRec", formatoCuerpoRucTipoTruc(dRucRec)));
    recParts.push(textEl("dDVRec", dDVRec));
    recParts.push(textEl("dNomRec", receptor.nombre.trim()));
    if (receptor.direccion?.trim()) {
      recParts.push(textEl("dDirRec", receptor.direccion.trim()));
      recParts.push(textEl("dNumCasRec", String(casaRecAuto)));
    }
    if (receptor.telefono?.trim()) {
      const tr = receptor.telefono.replace(/\D/g, "");
      if (tr.length >= 8) recParts.push(textEl("dTelRec", tr.slice(0, 15)));
    }
    if (receptor.email?.trim()) recParts.push(textEl("dEmailRec", receptor.email.trim()));
  } else {
    const doc = (receptor.documento ?? "").replace(/\s/g, "").trim();
    if (!doc) throw new Error("Receptor sin RUC: se requiere documento (CI) en cliente.");
    recParts.push(textEl("iNatRec", "2"));
    recParts.push(textEl("iTiOpe", "1"));
    recParts.push(textEl("cPaisRec", "PRY"));
    recParts.push(textEl("dDesPaisRe", "Paraguay"));
    recParts.push(textEl("iTipIDRec", "1"));
    recParts.push(textEl("dDTipIDRec", XSD_DES_DOC_CI_PY));
    recParts.push(textEl("dNumIDRec", doc.slice(0, 20)));
    recParts.push(textEl("dNomRec", receptor.nombre.trim()));
    if (receptor.direccion?.trim()) {
      recParts.push(textEl("dDirRec", receptor.direccion.trim()));
      recParts.push(textEl("dNumCasRec", String(casaRecAuto)));
    }
    if (receptor.telefono?.trim()) {
      const tr = receptor.telefono.replace(/\D/g, "");
      if (tr.length >= 8) recParts.push(textEl("dTelRec", tr.slice(0, 15)));
    }
    if (receptor.email?.trim()) recParts.push(textEl("dEmailRec", receptor.email.trim()));
  }
  recParts.push("</gDatRec>");

  const itemsXml: string[] = [];
  let sumSub10 = 0;
  let sumSub5 = 0;
  let sumSubExe = 0;
  let sumIva10 = 0;
  let sumIva5 = 0;
  let sumBase10 = 0;
  let sumBase5 = 0;

  items.forEach((it, idx) => {
    const tasa = inferirTasaIva(it.subtotal, it.iva);
    const cantNum = cantidadProSerValida(Number(it.cantidad));
    const cantStrNorm = formatDecimalSifen(cantNum);
    let cantE8 = decimalStringAEscalaE8(cantStrNorm);
    if (cantE8 <= SIFEN_BI0) cantE8 = SIFEN_E8;
    const dCantStr = escalaE8AStringDecimal(cantE8);
    /** 1858: misma cadena de redondeo que TIPS (`jsonDteItem.service.ts`) + precio coherente. */
    const { dPUniStr, dTotOpeItem } = resolverPrecioYTotalesValorItemPyg(
      it.precio_unitario,
      it.total,
      dCantStr,
      cantE8
    );
    const dTotBruOpeItem = dTotOpeItem;

    let baseGrav = 0;
    let dLiq = 0;
    if (tasa === 10) {
      const sp = splitIvaIncluidoDesdeTotal(dTotOpeItem, 10);
      baseGrav = sp.base;
      dLiq = sp.iva;
      sumSub10 += dTotOpeItem;
      sumIva10 += dLiq;
      sumBase10 += baseGrav;
    } else if (tasa === 5) {
      const sp = splitIvaIncluidoDesdeTotal(dTotOpeItem, 5);
      baseGrav = sp.base;
      dLiq = sp.iva;
      sumSub5 += dTotOpeItem;
      sumIva5 += dLiq;
      sumBase5 += baseGrav;
    } else {
      sumSubExe += dTotOpeItem;
    }

    const iAfec = tasa === 0 ? "3" : "1";

    itemsXml.push("<gCamItem>");
    itemsXml.push(textEl("dCodInt", `L${idx + 1}`.slice(0, 20)));
    const dDesProSer =
      esAmbienteTest && idx === 0
        ? SIFEN_TEST_LITERAL_DOCUMENTO
        : it.descripcion.slice(0, 120);
    itemsXml.push(textEl("dDesProSer", dDesProSer));
    itemsXml.push(textEl("cUniMed", "77"));
    itemsXml.push(textEl("dDesUniMed", XSD_DES_UNI_MED));
    itemsXml.push(textEl("dCantProSer", dCantStr));
    itemsXml.push("<gValorItem>");
    itemsXml.push(textEl("dPUniProSer", dPUniStr));
    itemsXml.push(textEl("dTotBruOpeItem", dTotBruOpeItem));
    itemsXml.push("<gValorRestaItem>");
    itemsXml.push(textEl("dDescItem", "0"));
    itemsXml.push(textEl("dTotOpeItem", dTotOpeItem));
    /** PYG sin tipo de cambio por ítem: TIPS no informa `dTotOpeGs` (solo si `condicionTipoCambio==2`). */
    itemsXml.push("</gValorRestaItem>");
    itemsXml.push("</gValorItem>");
    itemsXml.push("<gCamIVA>");
    itemsXml.push(textEl("iAfecIVA", iAfec));
    itemsXml.push(textEl("dDesAfecIVA", descripcionAfectacion(tasa)));
    itemsXml.push(textEl("dPropIVA", tasa === 0 ? 0 : 100));
    itemsXml.push(textEl("dTasaIVA", tasa));
    itemsXml.push(textEl("dBasGravIVA", baseGrav));
    itemsXml.push(textEl("dLiqIVAItem", dLiq));
    /**
     * E737 `dBasExe`: según NT13 / TIPS (`jsonDteItem.service.ts`), para iAfecIVA 1, 2 o 3 debe ser **0**.
     * Solo 4 (gravado parcial) usa fórmula con parte exenta; el monto exento por línea no va aquí (1921 si se informa mal).
     * Los totales exentos del DE siguen en `gTotSub.dSubExe` sumando `dTotOpeItem` de ítems exentos.
     */
    itemsXml.push(textEl("dBasExe", 0));
    itemsXml.push("</gCamIVA>");
    itemsXml.push("</gCamItem>");
  });

  const dTotOpe = sumSub10 + sumSub5 + sumSubExe;
  const dTotIVA = sumIva10 + sumIva5;
  const dTotGralOpe = dTotOpe;
  const dTBasGraIVA = sumBase5 + sumBase10;

  /** Secuencia estricta `tgTotSub` en DE_v150.xsd */
  const totParts: string[] = ["<gTotSub>"];
  if (sumSubExe > 0) totParts.push(textEl("dSubExe", sumSubExe));
  if (sumSub5 > 0) totParts.push(textEl("dSub5", sumSub5));
  if (sumSub10 > 0) totParts.push(textEl("dSub10", sumSub10));
  totParts.push(
    textEl("dTotOpe", dTotOpe),
    textEl("dTotDesc", "0"),
    textEl("dTotDescGlotem", "0"),
    textEl("dTotAntItem", "0"),
    textEl("dTotAnt", "0"),
    textEl("dPorcDescTotal", "0"),
    textEl("dDescTotal", "0"),
    textEl("dAnticipo", "0"),
    textEl("dRedon", montoRedondeo(0)),
    textEl("dTotGralOpe", dTotGralOpe)
  );
  if (sumIva5 > 0) totParts.push(textEl("dIVA5", sumIva5));
  if (sumIva10 > 0) totParts.push(textEl("dIVA10", sumIva10));
  totParts.push(textEl("dTotIVA", dTotIVA));
  if (sumBase5 > 0) totParts.push(textEl("dBaseGrav5", sumBase5));
  if (sumBase10 > 0) totParts.push(textEl("dBaseGrav10", sumBase10));
  if (dTBasGraIVA > 0) totParts.push(textEl("dTBasGraIVA", dTBasGraIVA));
  /**
   * `dTotalGs` (minOccurs=0): solo aplica si `cMoneOpe` ≠ PYG (total convertido a Gs).
   * Con moneda Guaraníes, informarlo provoca rechazo SET **2389**.
   */
  totParts.push("</gTotSub>");

  const esCredito = documento.tipo === "credito" || documento.tipo === "suscripcion";
  let gCamCondXml: string;
  if (esCredito) {
    gCamCondXml = [
      "<gCamCond>",
      textEl("iCondOpe", "2"),
      textEl("dDCondOpe", "Crédito"),
      "<gPagCred>",
      textEl("iCondCred", "1"),
      textEl("dDCondCred", XSD_D_COND_CRED_PLAZO),
      textEl("dPlazoCre", "30"),
      "</gPagCred>",
      "</gCamCond>",
    ].join("");
  } else {
    gCamCondXml = [
      "<gCamCond>",
      textEl("iCondOpe", "1"),
      textEl("dDCondOpe", "Contado"),
      "<gPaConEIni>",
      textEl("iTiPago", "1"),
      textEl("dDesTiPag", "Efectivo"),
      textEl("dMonTiPag", dTotGralOpe),
      textEl("cMoneTiPag", "PYG"),
      textEl("dDMoneTiPag", XSD_DES_MONE_PYG),
      "</gPaConEIni>",
      "</gCamCond>",
    ].join("");
  }

  const deInner = [
    textEl("dDVId", dDVId),
    textEl("dFecFirma", dFecFirma),
    textEl("dSisFact", "1"),
    "<gOpeDE>",
    textEl("iTipEmi", "1"),
    textEl("dDesTipEmi", "Normal"),
    textEl("dCodSeg", dCodSeg),
    "</gOpeDE>",
    "<gTimb>",
    textEl("iTiDE", "1"),
    textEl("dDesTiDE", XSD_DES_TI_DE_FACTURA),
    textEl("dNumTim", dNumTim),
    textEl("dEst", dEst),
    textEl("dPunExp", dPunExp),
    textEl("dNumDoc", dNumDoc),
    textEl("dFeIniT", dFeIniT),
    "</gTimb>",
    "<gDatGralOpe>",
    textEl("dFeEmiDE", dFeEmiDE),
    "<gOpeCom>",
    /** iTipTra: el XSD no acopla iTipTra con iTiOpe B2F; se mantiene venta de mercadería (1) salvo normativa adicional. */
    textEl("iTipTra", "1"),
    textEl("dDesTipTra", XSD_DES_TIP_TRA_VENTA_MERC),
    textEl("iTImp", "1"),
    textEl("dDesTImp", XSD_DES_T_IMP_IVA),
    textEl("cMoneOpe", "PYG"),
    textEl("dDesMoneOpe", XSD_DES_MONE_PYG),
    "</gOpeCom>",
    ...gEmisParts,
    ...recParts,
    "</gDatGralOpe>",
    "<gDtipDE>",
    "<gCamFE>",
    textEl("iIndPres", "1"),
    textEl("dDesIndPres", XSD_DES_IND_PRES_PRESENCIAL),
    "</gCamFE>",
    gCamCondXml,
    ...itemsXml,
    "</gDtipDE>",
    ...totParts,
  ].join("");

  const de = `<DE Id="${escapeXml(cdc)}">${deInner}</DE>`;

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<rDE xmlns="${NS}" xmlns:xsi="${XMLNS_XSI}" xsi:schemaLocation="${escapeXml(RDE_XSI_SCHEMA_LOCATION)}">` +
    textEl("dVerFor", "150") +
    de +
    `</rDE>\n`;

  return xml;
}

/** Re-exportados para generadores de otros tipos de DE (p. ej. nota de crédito). */
export {
  dFeEmiDeYFecFirma as sifenDFeEmiDeYFecFirma,
  dCodSegNueveDigitos as sifenDCodSegNueveDigitos,
  iTipContCodigo as sifenEmisorITipContCodigo,
};
