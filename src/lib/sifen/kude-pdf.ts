/**
 * KuDE PDF — representación gráfica del DE (pdf-lib, Vercel-safe).
 * Estilo factura PY; acento Neura #0EA5E9; textos en negro.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import type { KudeItemRow, KudeParsedFromXml } from "./parse-kude-from-signed-xml";

/**
 * Branding opcional por empresa (KuDE/PDF únicamente).
 * - `logoBytes`: PNG ya descargado server-side. Si es null/inválido → fallback al logo Neura.
 * - `colorPrimario`/`colorPrimarioFill`: hex `#RRGGBB`. NULL/inválido → fallback Neura.
 *
 * NO afecta XML, firma, envío SET, CDC ni datos fiscales. Solo apariencia del PDF.
 */
export type KudeBranding = {
  logoBytes?: Uint8Array | null;
  colorPrimario?: string | null;
  colorPrimarioFill?: string | null;
};

export type BuildKudePdfInput = {
  parsed: KudeParsedFromXml;
  numeroFactura: string;
  dProtAut: string | null;
  qrUrl: string;
  /** Branding opcional. Si no viene o es inválido, se usa el diseño Neura. */
  branding?: KudeBranding | null;
};

const A4_W = 595.28;
const A4_H = 841.89;
/** Default Neura `#0EA5E9`. Se preserva cuando la empresa no configura branding. */
const NEURA_BLUE: RGB = rgb(14 / 255, 165 / 255, 233 / 255);
/** Tonalidad clara default Neura (~ azul a 93% blanco). */
const NEURA_BLUE_FILL: RGB = rgb(0.93, 0.97, 1);
const BLACK: RGB = rgb(0, 0, 0);
const GRAY: RGB = rgb(0.35, 0.35, 0.35);

/** Parsea `#RGB` / `#RRGGBB` → RGB de pdf-lib. Devuelve null si no matchea. */
function parseHexColorToRgb(hex: string | null | undefined): RGB | null {
  if (hex == null) return null;
  const s = String(hex).trim();
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(s);
  if (m6) {
    const h = m6[1]!;
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return rgb(r / 255, g / 255, b / 255);
  }
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (m3) {
    const h = m3[1]!;
    const r = parseInt(h[0]! + h[0]!, 16);
    const g = parseInt(h[1]! + h[1]!, 16);
    const b = parseInt(h[2]! + h[2]!, 16);
    return rgb(r / 255, g / 255, b / 255);
  }
  return null;
}

/**
 * Deriva un fill suave (mezcla con blanco al `mix`, default 0.92) cuando la
 * empresa solo proveyó el primario. Igual al ratio actual NEURA_BLUE → NEURA_BLUE_FILL.
 */
function blendWithWhite(c: RGB, mix = 0.92): RGB {
  return rgb(
    c.red * (1 - mix) + 1 * mix,
    c.green * (1 - mix) + 1 * mix,
    c.blue * (1 - mix) + 1 * mix
  );
}

/** Distancia desde el borde superior de la página hasta la línea base del texto (pt). */
function baselineFromTop(page: PDFPage, fromTop: number): number {
  return page.getHeight() - fromTop;
}

function drawRectFromTop(
  page: PDFPage,
  left: number,
  fromTop: number,
  width: number,
  height: number,
  opts: { border?: RGB; borderW?: number; fill?: RGB }
) {
  page.drawRectangle({
    x: left,
    y: page.getHeight() - (fromTop + height),
    width,
    height,
    borderColor: opts.border ?? NEURA_BLUE,
    borderWidth: opts.borderW ?? 0.75,
    color: opts.fill,
  });
}

function formatMonto(nStr: string, moneda: string): string {
  const n = Number.parseFloat(String(nStr).replace(",", "."));
  if (!Number.isFinite(n)) return String(nStr);
  if (moneda === "PYG" || moneda === "GS") {
    return Math.round(n).toLocaleString("es-PY");
  }
  return n.toLocaleString("es-PY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function readLogoBytes(): Uint8Array | null {
  // Fallback del logo del KuDE para HIERROS VH cuando la empresa no configuró
  // un logo propio en `empresa_sifen_config.kude_logo_path`. Antes usaba el logo
  // de Neura; en este tenant el default es la marca HIERROS.
  const candidates = [
    path.join(process.cwd(), "public", "brand", "hierros-logo.png"),
    path.join(process.cwd(), "public", "logo-neura.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p));
    } catch {
      /* ignore */
    }
  }
  return null;
}

function trunc(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Alinea el texto al borde derecho `rightX` (coordenada x del final del trazo). */
function drawTextRight(
  page: PDFPage,
  text: string,
  rightX: number,
  fromTop: number,
  size: number,
  font: PDFFont,
  color: RGB
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: rightX - w,
    y: baselineFromTop(page, fromTop),
    size,
    font,
    color,
  });
}

/** Parte texto por ancho máximo aproximado (caracteres) para no invadir columna derecha. */
function wrapByChars(text: string, maxChars: number): string[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxChars) return [t];
  const out: string[] = [];
  let rest = t;
  while (rest.length > 0) {
    if (rest.length <= maxChars) {
      out.push(rest);
      break;
    }
    let cut = rest.lastIndexOf(" ", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  return out.filter(Boolean);
}

function drawLabelValue(
  page: PDFPage,
  x: number,
  fromTop: number,
  label: string,
  value: string,
  fontBold: PDFFont,
  font: PDFFont,
  size: number,
  labelColor: RGB
) {
  const y = baselineFromTop(page, fromTop);
  page.drawText(label, { x, y, size, font: fontBold, color: labelColor });
  const w = fontBold.widthOfTextAtSize(label, size);
  page.drawText(value, { x: x + w + 1.5, y, size, font, color: BLACK });
}

/** Origen x de columnas de montos (Exentas / 5% / 10%) — debe coincidir con `drawTableChunk`. */
function kudeTableMoneyXs(margin: number) {
  return { xEx: margin + 316, x5: margin + 366, x10: margin + 414 };
}

function drawTableChunk(
  page: PDFPage,
  items: KudeItemRow[],
  parsed: KudeParsedFromXml,
  margin: number,
  innerW: number,
  fromTop: number,
  font: PDFFont,
  fontBold: PDFFont,
  primary: RGB,
  primaryFill: RGB
): number {
  const fsz = 6.5;
  const headH = 16;
  const rowH = 11;
  const bodyH = Math.max(14, items.length * rowH + 8);
  const totalH = headH + bodyH;

  drawRectFromTop(page, margin, fromTop, innerW, totalH, { fill: rgb(1, 1, 1), border: primary });
  drawRectFromTop(page, margin, fromTop, innerW, headH, { fill: primaryFill, border: primary });

  const xCod = margin + 4;
  const xDesc = margin + 36;
  const xUm = margin + 186;
  const xPr = margin + 228;
  const xCan = margin + 282;
  const { xEx, x5, x10 } = kudeTableMoneyXs(margin);
  const headerBaseline = fromTop + 11;

  const drawH = (txt: string, x: number, bold: boolean) => {
    page.drawText(txt, {
      x,
      y: baselineFromTop(page, headerBaseline),
      size: fsz,
      font: bold ? fontBold : font,
      color: bold ? primary : BLACK,
    });
  };
  drawH("Código", xCod, true);
  drawH("Descripción", xDesc, true);
  drawH("Unidad", xUm, true);
  drawH("Precio", xPr, true);
  drawH("Cant.", xCan, true);
  drawH("Exentas", xEx, true);
  drawH("5%", x5, true);
  drawH("10%", x10, true);

  let rowBaseline = fromTop + headH + 9;
  for (const row of items) {
    const yb = baselineFromTop(page, rowBaseline);
    page.drawText(trunc(row.codigo, 10), { x: xCod, y: yb, size: fsz, font, color: BLACK });
    page.drawText(trunc(row.descripcion, 40), { x: xDesc, y: yb, size: fsz, font, color: BLACK });
    page.drawText(trunc(row.unidadMedida, 8), { x: xUm, y: yb, size: fsz, font, color: BLACK });
    page.drawText(formatMonto(row.precioUnit, parsed.monedaCodigo), { x: xPr, y: yb, size: fsz, font, color: BLACK });
    page.drawText(row.cantidad || "—", { x: xCan, y: yb, size: fsz, font, color: BLACK });
    page.drawText(formatMonto(row.montoExenta, parsed.monedaCodigo), { x: xEx, y: yb, size: fsz, font, color: BLACK });
    page.drawText(formatMonto(row.montoGrav5, parsed.monedaCodigo), { x: x5, y: yb, size: fsz, font, color: BLACK });
    page.drawText(formatMonto(row.montoGrav10, parsed.monedaCodigo), { x: x10, y: yb, size: fsz, font, color: BLACK });
    rowBaseline += rowH;
  }

  return fromTop + totalH + 10;
}

export async function buildKudePdfBuffer(input: BuildKudePdfInput): Promise<Buffer> {
  const { parsed, numeroFactura, dProtAut, qrUrl, branding } = input;

  /**
   * Branding resolution: si la empresa configuró color/logo válidos, los usamos;
   * si no, se preservan exactamente NEURA_BLUE / NEURA_BLUE_FILL / logo-neura.png
   * (cero cambios visuales para empresas sin branding).
   */
  const primaryConfig = parseHexColorToRgb(branding?.colorPrimario ?? null);
  const primary: RGB = primaryConfig ?? NEURA_BLUE;
  const primaryFillConfig = parseHexColorToRgb(branding?.colorPrimarioFill ?? null);
  const primaryFill: RGB =
    primaryFillConfig ?? (primaryConfig ? blendWithWhite(primaryConfig, 0.92) : NEURA_BLUE_FILL);

  const qrPng = await QRCode.toBuffer(qrUrl, {
    type: "png",
    width: 168,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`KuDE — Factura ${numeroFactura}`);
  pdfDoc.setAuthor("Neura ERP");

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 36;
  const innerW = A4_W - margin * 2;
  const rightEdge = margin + innerW - 8;
  /** Columna izquierda del encabezado: no escribir más allá de esta x para no chocar con la derecha. */
  const headerSplitX = margin + innerW * 0.52;
  let page = pdfDoc.addPage([A4_W, A4_H]);

  const nroTimbrado = `${parsed.timbrado.dEst}-${parsed.timbrado.dPunExp}-${parsed.timbrado.dNumDoc}`;
  const rucEmisor = `${parsed.emisor.dRucEm}-${parsed.emisor.dDVEmi}`;
  const tipoCambio =
    parsed.monedaCodigo === "PYG" || parsed.monedaCodigo === "GS"
      ? "1,00 (moneda local)"
      : "Ver documento electrónico";

  let cursorTop = margin;

  /* ── Header: medir → marco → logo + emisor (ancho limitado) + factura a la derecha ── */
  const headerPad = 12;
  const logoMaxW = 72;
  let logoH = 0;
  let logoW = 0;
  let logoImg: PDFImage | null = null;
  /**
   * Preferencia de logo:
   *   1) Branding por empresa (PNG bytes ya descargado por el endpoint).
   *   2) Logo Neura del bundle (`public/logo-neura.png`).
   * Si ambos fallan, header se renderiza sin logo (igual que hoy).
   */
  const brandingLogo = branding?.logoBytes ?? null;
  const fallbackLogo = readLogoBytes();
  const candidates: Uint8Array[] = [];
  if (brandingLogo && brandingLogo.length > 0) candidates.push(brandingLogo);
  if (fallbackLogo) candidates.push(fallbackLogo);

  for (const bytes of candidates) {
    try {
      logoImg = await pdfDoc.embedPng(bytes);
      logoW = logoMaxW;
      const sc = logoW / logoImg.width;
      logoH = logoImg.height * sc;
      break;
    } catch {
      logoH = 0;
      logoW = 0;
      logoImg = null;
    }
  }

  const leftTextX = margin + headerPad + (logoW > 0 ? logoW + 12 : 0);
  const leftMaxChars = Math.max(28, Math.floor((headerSplitX - leftTextX) / 4.2));

  // Tel/Email del emisor: se toman del XML firmado (config SIFEN de la empresa),
  // NO de constantes hardcodeadas. Si el emisor no tiene el dato, se omite la línea.
  const telEmisor = (parsed.emisor.dTelEmi || "").trim();
  const emailEmisor = (parsed.emisor.dEmailE || "").trim();
  const leftChunks: { lines: string[]; size: number; bold: boolean; col: RGB }[] = [
    { lines: wrapByChars(parsed.emisor.dNomEmi, leftMaxChars), size: 9, bold: true, col: BLACK },
    { lines: wrapByChars(parsed.emisor.dDirEmi, leftMaxChars), size: 7.5, bold: false, col: BLACK },
    ...(telEmisor ? [{ lines: [`Tel.: ${telEmisor}`], size: 7.5, bold: false, col: BLACK }] : []),
    ...(emailEmisor ? [{ lines: [`Email: ${emailEmisor}`], size: 7.5, bold: false, col: BLACK }] : []),
  ];

  const rightLines = 6;
  const rightLineLead = 11;
  let leftBottom = cursorTop + headerPad + 9;
  for (const ch of leftChunks) {
    const lead = ch.size + 3;
    leftBottom += ch.lines.length * lead;
  }
  const rightBottom = cursorTop + headerPad + 9 + rightLines * rightLineLead + 4;
  const logoBottom = cursorTop + headerPad + logoH;
  const headerBottom = Math.max(leftBottom, rightBottom, logoBottom) + 10;
  const headerH = headerBottom - cursorTop;

  drawRectFromTop(page, margin, cursorTop, innerW, headerH, { fill: rgb(1, 1, 1), border: primary });

  if (logoImg && logoW > 0) {
    page.drawImage(logoImg, {
      x: margin + headerPad,
      y: baselineFromTop(page, cursorTop + headerPad + logoH),
      width: logoW,
      height: logoH,
    });
  }

  let leftBaseline = cursorTop + headerPad + 9;
  for (const ch of leftChunks) {
    const f = ch.bold ? fontBold : font;
    const lead = ch.size + 3;
    for (const ln of ch.lines) {
      page.drawText(ln, {
        x: leftTextX,
        y: baselineFromTop(page, leftBaseline),
        size: ch.size,
        font: f,
        color: ch.col,
      });
      leftBaseline += lead;
    }
  }

  let rightBaseline = cursorTop + headerPad + 9;
  drawTextRight(page, `RUC: ${rucEmisor}`, rightEdge, rightBaseline, 8.5, fontBold, BLACK);
  rightBaseline += rightLineLead;
  drawTextRight(page, `Timbrado Nº: ${parsed.timbrado.dNumTim}`, rightEdge, rightBaseline, 8, font, BLACK);
  rightBaseline += rightLineLead;
  drawTextRight(page, `Vigencia: ${parsed.timbrado.dFeIniT}`, rightEdge, rightBaseline, 8, font, BLACK);
  rightBaseline += rightLineLead;
  drawTextRight(page, "Tipo de documento: Factura electrónica", rightEdge, rightBaseline, 8, font, BLACK);
  rightBaseline += rightLineLead;
  drawTextRight(page, `Nº: ${nroTimbrado}`, rightEdge, rightBaseline, 9, fontBold, BLACK);
  rightBaseline += rightLineLead;
  drawTextRight(page, `Ref. ERP: ${numeroFactura}`, rightEdge, rightBaseline, 7, font, GRAY);

  cursorTop += headerH + 10;

  const sectionTitle = (title: string) => {
    page.drawText(title, {
      x: margin,
      y: baselineFromTop(page, cursorTop + 9),
      size: 9,
      font: fontBold,
      color: primary,
    });
    cursorTop += 13;
  };

  /* Operación + cliente (un cuadro, dos columnas como modelo KuDE) */
  sectionTitle("DATOS DE LA OPERACIÓN Y DEL CLIENTE");
  const opCliH = 102;
  drawRectFromTop(page, margin, cursorTop, innerW, opCliH, { fill: rgb(1, 1, 1), border: primary });
  const col1X = margin + 8;
  const col2X = margin + innerW * 0.48;
  const labSz = 7.5;
  let yOp = cursorTop + 10;
  drawLabelValue(page, col1X, yOp, "Fecha de emisión: ", parsed.dFeEmiDE, fontBold, font, labSz, primary);
  yOp += 11;
  drawLabelValue(
    page,
    col1X,
    yOp,
    "Condición de venta: ",
    parsed.operacion.condicionVenta,
    fontBold,
    font,
    labSz,
    primary
  );
  yOp += 11;
  drawLabelValue(
    page,
    col1X,
    yOp,
    "Moneda: ",
    `${parsed.monedaDescripcion || parsed.monedaCodigo} (${parsed.monedaCodigo})`,
    fontBold,
    font,
    labSz,
    primary
  );
  yOp += 11;
  drawLabelValue(page, col1X, yOp, "Tipo de cambio: ", tipoCambio, fontBold, font, labSz, primary);
  yOp += 11;
  drawLabelValue(page, col1X, yOp, "Tipo de operación: ", parsed.operacion.tipoOperacion, fontBold, font, labSz, primary);

  let yRec = cursorTop + 10;
  drawLabelValue(
    page,
    col2X,
    yRec,
    `${parsed.receptor.docLabel}: `,
    parsed.receptor.docValue,
    fontBold,
    font,
    labSz,
    primary
  );
  yRec += 11;
  const nomLines = wrapByChars(parsed.receptor.nombre, 34);
  drawLabelValue(page, col2X, yRec, "Razón social: ", nomLines[0] ?? "—", fontBold, font, labSz, primary);
  yRec += 11;
  const indent = fontBold.widthOfTextAtSize("Razón social: ", labSz) + col2X + 1.5;
  for (let i = 1; i < nomLines.length; i++) {
    page.drawText(nomLines[i]!, {
      x: indent,
      y: baselineFromTop(page, yRec),
      size: labSz,
      font,
      color: BLACK,
    });
    yRec += 11;
  }
  drawLabelValue(
    page,
    col2X,
    yRec,
    "Dirección: ",
    (parsed.receptor.direccion || "—").replace(/\s+/g, " ").trim(),
    fontBold,
    font,
    labSz,
    primary
  );
  yRec += 11;
  drawLabelValue(page, col2X, yRec, "Tel.: ", parsed.receptor.telefono || "—", fontBold, font, labSz, primary);

  cursorTop += opCliH + 10;

  /* Tabla */
  sectionTitle("DETALLE DE LA MERCADERÍA / SERVICIOS");
  const footerReserve = 200;
  const rowH = 11;
  const headH = 16;
  let idx = 0;
  const items = parsed.items;
  while (idx < items.length) {
    let room = A4_H - cursorTop - footerReserve;
    if (room < headH + rowH + 20) {
      page = pdfDoc.addPage([A4_W, A4_H]);
      cursorTop = margin;
      room = A4_H - cursorTop - footerReserve;
    }
    const maxRows = Math.max(1, Math.floor((room - headH - 12) / rowH));
    const slice = items.slice(idx, idx + maxRows);
    if (slice.length === 0) {
      page = pdfDoc.addPage([A4_W, A4_H]);
      cursorTop = margin;
      continue;
    }
    cursorTop = drawTableChunk(page, slice, parsed, margin, innerW, cursorTop, font, fontBold, primary, primaryFill);
    idx += slice.length;
    if (idx < items.length) {
      page = pdfDoc.addPage([A4_W, A4_H]);
      cursorTop = margin;
      page.drawText("(Continúa detalle)", {
        x: margin,
        y: baselineFromTop(page, cursorTop + 8),
        size: 8,
        font,
        color: GRAY,
      });
      cursorTop += 16;
    }
  }

  /* Totales */
  if (A4_H - cursorTop < 160) {
    page = pdfDoc.addPage([A4_W, A4_H]);
    cursorTop = margin;
  }
  sectionTitle("TOTALES Y LIQUIDACIÓN DEL IVA");
  const { xEx, x5, x10 } = kudeTableMoneyXs(margin);
  const rEx = x5 - 4;
  const r5 = x10 - 4;
  const r10 = margin + innerW - 8;

  const totBoxH = 94;
  drawRectFromTop(page, margin, cursorTop, innerW, totBoxH, {
    fill: primaryFill,
    border: primary,
  });

  let ty = cursorTop + 14;
  const fsTot = 8.5;

  page.drawText("SUBTOTAL", {
    x: margin + 10,
    y: baselineFromTop(page, ty),
    size: fsTot,
    font: fontBold,
    color: BLACK,
  });
  drawTextRight(page, formatMonto(parsed.totales.dSubExe, parsed.monedaCodigo), rEx, ty, fsTot, fontBold, BLACK);
  drawTextRight(page, formatMonto(parsed.totales.dSub5, parsed.monedaCodigo), r5, ty, fsTot, fontBold, BLACK);
  drawTextRight(page, formatMonto(parsed.totales.dSub10, parsed.monedaCodigo), r10, ty, fsTot, fontBold, BLACK);
  ty += 17;

  page.drawText("TOTAL DE LA OPERACIÓN", {
    x: margin + 10,
    y: baselineFromTop(page, ty),
    size: fsTot,
    font: fontBold,
    color: BLACK,
  });
  drawTextRight(
    page,
    formatMonto(parsed.totales.dTotOpe, parsed.monedaCodigo),
    rightEdge,
    ty,
    fsTot,
    fontBold,
    BLACK
  );
  ty += 16;

  page.drawText("TOTAL EN GUARANÍES", {
    x: margin + 10,
    y: baselineFromTop(page, ty),
    size: fsTot,
    font: fontBold,
    color: BLACK,
  });
  drawTextRight(
    page,
    formatMonto(parsed.totales.dTotGralOpe, parsed.monedaCodigo),
    rightEdge,
    ty,
    fsTot,
    fontBold,
    BLACK
  );
  ty += 14;

  page.drawLine({
    start: { x: margin + 8, y: baselineFromTop(page, ty) },
    end: { x: margin + innerW - 8, y: baselineFromTop(page, ty) },
    thickness: 0.45,
    color: primary,
  });
  ty += 12;

  const liq5 = formatMonto(parsed.totales.dIVA5, parsed.monedaCodigo);
  const liq10 = formatMonto(parsed.totales.dIVA10, parsed.monedaCodigo);
  const liqTot = formatMonto(parsed.totales.dTotIVA, parsed.monedaCodigo);
  page.drawText(`LIQUIDACIÓN DEL IVA    (5%) ${liq5}    (10%) ${liq10}`, {
    x: margin + 10,
    y: baselineFromTop(page, ty),
    size: 8,
    font: fontBold,
    color: BLACK,
  });
  drawTextRight(page, `TOTAL IVA: ${liqTot}`, rightEdge, ty, 8, fontBold, BLACK);

  cursorTop += totBoxH + 12;

  /* Pie: fila 1 = QR (izq) + textos (der); fila 2 = leyendas ancho completo debajo del QR */
  if (A4_H - cursorTop < 185) {
    page = pdfDoc.addPage([A4_W, A4_H]);
    cursorTop = margin;
  }

  const qrImg = await pdfDoc.embedPng(new Uint8Array(qrPng));
  const qSz = 90;
  const footPad = 14;
  const gapAfterQr = 14;
  const legendSize = 6.5;
  const legendLead = 9;

  const cdcLines = wrapByChars(`CDC: ${parsed.cdc}`, 52);
  const footTextW = innerW - footPad * 2 - qSz - 16;
  const footTextX = margin + footPad + qSz + 14;
  const validacionFootLines = wrapByChars(
    "Este comprobante puede verificarse en el portal e-kuatia de la SET. Escanee el código QR o ingrese el CDC.",
    Math.max(28, Math.floor(footTextW / 3.5))
  ).length;
  const protAutLines = dProtAut ? wrapByChars(`dProtAut: ${dProtAut}`, 52).length : 0;

  let footTextBaseline = cursorTop + footPad + 9;
  const textBlockLines = 1 + validacionFootLines + 2 + cdcLines.length + protAutLines;
  const textBlockHeight = textBlockLines * 10 + 12;
  const legendBlockHeight = legendLead * 3 + 8;
  const footBoxH = footPad + Math.max(qSz, textBlockHeight) + gapAfterQr + legendBlockHeight + footPad;

  drawRectFromTop(page, margin, cursorTop, innerW, footBoxH, { fill: rgb(1, 1, 1), border: primary });

  page.drawImage(qrImg, {
    x: margin + footPad,
    y: baselineFromTop(page, cursorTop + footPad + qSz),
    width: qSz,
    height: qSz,
  });

  page.drawText("Consulta de validez (e-kuatia / SET)", {
    x: footTextX,
    y: baselineFromTop(page, footTextBaseline),
    size: 8.5,
    font: fontBold,
    color: primary,
  });
  footTextBaseline += 13;
  for (const line of wrapByChars(
    "Este comprobante puede verificarse en el portal e-kuatia de la SET. Escanee el código QR o ingrese el CDC.",
    Math.max(28, Math.floor(footTextW / 3.5))
  )) {
    page.drawText(line, {
      x: footTextX,
      y: baselineFromTop(page, footTextBaseline),
      size: 7,
      font,
      color: GRAY,
    });
    footTextBaseline += 9.5;
  }
  footTextBaseline += 4;
  for (const line of cdcLines) {
    page.drawText(line, {
      x: footTextX,
      y: baselineFromTop(page, footTextBaseline),
      size: 7.5,
      font: fontBold,
      color: BLACK,
    });
    footTextBaseline += 10;
  }
  if (dProtAut) {
    for (const line of wrapByChars(`dProtAut: ${dProtAut}`, 52)) {
      page.drawText(line, {
        x: footTextX,
        y: baselineFromTop(page, footTextBaseline),
        size: 7.5,
        font,
        color: BLACK,
      });
      footTextBaseline += 10;
    }
  }

  const legendTop = cursorTop + footPad + qSz + gapAfterQr;
  let leg = legendTop + 8;
  const leg1 =
    "ESTE DOCUMENTO ES UNA REPRESENTACIÓN GRÁFICA DE UN DOCUMENTO ELECTRÓNICO (XML)";
  for (const line of wrapByChars(leg1, 78)) {
    page.drawText(line, {
      x: margin + footPad,
      y: baselineFromTop(page, leg),
      size: legendSize,
      font: fontBold,
      color: primary,
    });
    leg += legendLead;
  }
  leg += 2;
  page.drawText("Generado con Neura ERP", {
    x: margin + footPad,
    y: baselineFromTop(page, leg),
    size: 6.5,
    font,
    color: GRAY,
  });

  return Buffer.from(await pdfDoc.save());
}
