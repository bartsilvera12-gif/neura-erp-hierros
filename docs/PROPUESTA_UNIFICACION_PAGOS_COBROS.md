# Propuesta técnica — Unificación de los flujos de pago/cobro

> Estado: **borrador para revisión**
> Autor: Soporte/Programación · Fecha: 2026-09-30
> Motivación: incidente FAC-000107 (Hierros VH) — factura marcada "Pagada" por una vía, cuenta por cobrar sin actualizar por la otra, y sin recibo.

## 1. Problema

El ERP tiene **dos flujos de pago independientes que no se sincronizan** y que representan la misma deuda:

| Flujo | Endpoint | Escribe en | Actualiza | ¿Genera recibo? | UI |
|---|---|---|---|---|---|
| **A — "Registrar pago"** (nivel factura) | `POST /api/pagos` | `pagos` | `facturas.saldo` / `facturas.estado` | ❌ No | Ficha de cliente (`clientes/[id]`) |
| **B — "Registrar cobro"** (nivel cuenta por cobrar) | `POST /api/cobros` | `cobros_clientes` | `cuentas_por_cobrar.saldo` / `.estado` | ✅ Sí (`recibos_dinero`) | Estado de cuenta, `/pagos` |

Para una venta a crédito coexisten **una factura** y **una cuenta por cobrar** por la misma deuda. Si el usuario cobra por el flujo A, la factura queda "Pagada" pero la cuenta sigue "pendiente" (y al revés). Además, **el recibo solo existe en el flujo B**, así que un pago hecho por A no tiene comprobante imprimible.

### Incidente que lo disparó (FAC-000107)
1. Se registró el pago por el flujo A → factura "Pagada", cuenta sin tocar, **sin recibo**.
2. El cliente no encontraba el recibo y creía que la venta había pasado a "contado" (confusión entre estado *Pagado* y condición *contado*).
3. Corrección manual en BD: revertir el pago del flujo A, registrar por el flujo B (recibo `REC-000001`) y reconciliar el estado de la factura.

## 2. Impacto y consumidores actuales

Ambas tablas están integradas en reportería y otros módulos, por lo que **cualquier unificación debe preservar estos consumos**:

- `pagos`: `dashboard`, `dashboard/financial-audit`, `comisiones/preview`, `facturas`, `nota-credito` (gate de creación y creación de NC), `clientes/[id]/estado-cuenta`, `clientes/[id]/eliminar-preview`.
- `cobros_clientes`: `cobros`, `cobros/cuentas`, `clientes/[id]/estado-cuenta`, `dashboard`, `dashboard/tenant-tables`, `reportes/creditos`, `reportes`.

> ⚠️ Riesgo de **doble conteo** de ingresos si un mismo pago llega a ambas tablas y algún reporte suma las dos.

## 3. Objetivo (comportamiento esperado)

1. **Un único registro de pago** por cada abono (una sola fuente de verdad del dinero).
2. La **condición de venta** (contado/crédito) nunca se altera al cobrar.
3. Al cobrar, se actualizan de forma **consistente** el saldo/estado de la factura **y** de la cuenta por cobrar.
4. **Todo cobro genera (o permite generar) un recibo** imprimible, sin importar desde qué pantalla se registre.
5. Sin doble conteo en caja/reportes.

## 4. Opciones de diseño

### Opción 1 — Fuente de verdad única: `cobros_clientes` + cuenta por cobrar (recomendada)
- El **cobro** (`cobros_clientes` sobre `cuentas_por_cobrar`) pasa a ser el **único** registro de dinero para ventas a crédito.
- `facturas.saldo/estado` se vuelve un **espejo derivado** de la cuenta por cobrar (se actualiza en la misma operación del cobro).
- El flujo A ("Registrar pago" en factura) se **redirige internamente** al flujo B (o se deshabilita para crédito), garantizando recibo siempre.
- **Pros:** el circuito de cobros ya genera recibo, ya maneja parcial/total, entidad bancaria y conciliación. Menos cambios en la lógica de recibos.
- **Contras:** hay que asegurar el espejo factura⇄cuenta y migrar los `pagos` históricos que no tengan su `cobro` equivalente.

### Opción 2 — Fuente de verdad única: `pagos` + factura
- El `pagos`/factura se vuelve el registro único y la cuenta por cobrar se deriva.
- **Contras:** habría que portar toda la generación de recibos, conciliación y entidades al flujo de `pagos`. Más trabajo; peor relación costo/beneficio.

### Opción 3 — Capa de servicio única con doble escritura sincronizada
- Un solo servicio `registrarAbono()` que, en una transacción, escribe el pago, actualiza factura **y** cuenta por cobrar y genera el recibo. Ambos endpoints (`/api/pagos` y `/api/cobros`) delegan en él.
- **Pros:** compatibilidad total hacia atrás (ambas UIs siguen funcionando); consistencia garantizada por transacción.
- **Contras:** mantiene dos tablas; hay que definir cuál es la autoritativa para reportes y evitar doble conteo.

> **Recomendación:** **Opción 1** como destino final, implementada de forma incremental vía una **capa de servicio única (Opción 3 como paso puente)**. Es decir: primero centralizar la escritura en un servicio transaccional que sincroniza ambos lados y siempre deja recibo; luego converger la reportería a una única fuente y deprecar el camino redundante.

## 5. Plan de implementación por fases

**Fase 0 — Diagnóstico de datos (read-only)**
- Query de reconciliación: facturas cuyo estado no coincide con su cuenta por cobrar (saldo/estado divergentes), y pagos sin cobro equivalente (y viceversa). Cuantificar por tenant.

**Fase 1 — Capa de servicio transaccional `registrarAbono()`**
- Nueva función server que, en una sola transacción:
  1. inserta el registro de pago (fuente única elegida),
  2. actualiza `facturas.saldo/estado`,
  3. actualiza `cuentas_por_cobrar.saldo/estado`,
  4. deja disponible el recibo (`recibos_dinero`).
- `POST /api/pagos` y `POST /api/cobros` pasan a delegar en este servicio (sin cambiar sus contratos → sin romper las UIs).
- Validación anti-duplicado por (factura/cuenta + idempotency key).

**Fase 2 — UI coherente**
- En ventas a crédito, unificar el CTA: "Registrar cobro" (con recibo) como acción principal; el "Registrar pago" de la factura queda como alias que llama al mismo servicio.
- Mostrar el botón "Recibo" en ambas pantallas.

**Fase 3 — Convergencia de reportería**
- Definir la **fuente autoritativa** de ingresos y ajustar `dashboard`, `financial-audit`, `comisiones`, `reportes/creditos` para leer de ella (evitar sumar ambas tablas).

**Fase 4 — Migración de datos históricos**
- Script idempotente que reconcilia los desvíos detectados en Fase 0 (por tenant), conservando cada pago una sola vez. Con dry-run y reporte antes de aplicar.

**Fase 5 — Deprecación**
- Retirar el camino redundante una vez que todo consume la fuente única.

## 6. Criterios de aceptación
- Cobrar desde cualquiera de las dos pantallas deja **factura y cuenta por cobrar consistentes** y **un recibo** disponible.
- La condición de venta no cambia nunca al cobrar.
- Reportes de ingresos/caja no cambian de total por el mismo pago (sin doble conteo).
- Pagos parciales y totales reflejan saldo correcto en ambos lados.
- Reversión/anulación de un abono revierte ambos lados y el recibo.

## 7. Riesgos y mitigaciones
- **Doble conteo durante la transición** → feature flag por tenant + fuente autoritativa única para reportes desde Fase 3.
- **Multi-tenant (~70 schemas)** → cambios de lógica en código (sin migración de esquema donde sea posible); si se agregan columnas, migración idempotente por schema con verificación.
- **Datos históricos inconsistentes** → Fase 0/4 con dry-run y respaldo previo.

## 8. Alcance NO incluido
- No modifica la firma/envío SIFEN ni la condición fiscal de los documentos.
- No cambia el diseño del recibo (ya incluye N° de factura y saldo pendiente).

---

## Anexo A — Resultados Fase 0 (diagnóstico de datos en producción)

> Consulta read-only sobre todos los schemas de tenant (2026-09-30). Excluye anulados.

### A.1 Alcance real del crédito
Solo **14 tenants** tienen cuentas por cobrar (>0). El resto no usa crédito, así que el problema es acotado.

### A.2 ¿Quién usa cada flujo de pago?

| Patrón | Tenants | Lectura |
|---|---|---|
| **Ambos flujos** (`pagos` + `cobros_clientes`) | **reservacaacupe** (67 + 105), **hierros** (1 + 1) | ⚠️ Riesgo real de doble conteo y de la confusión del incidente |
| **Solo `cobros_clientes`** | abhuevos, darocha, ferrecolor, tecnolabo, autorepuestosfelix, ferreteriarepublica, ferretodo, mexicana, asunhome, greenlanderp | Facturas quedan **desincronizadas** (cobros no se reflejan en la factura) |
| Sin cobros aún | hhperfomance, mariliaerp | — |

**Hallazgo clave:** el patrón peligroso (ambos flujos) está **solo en 2 tenants** (uno es hierros, ya corregido). El problema dominante en el resto **no es doble conteo**, sino **facturas con estado/saldo viejos** porque los pagos entran por `cobros_clientes` y **nunca actualizan la factura**.

### A.3 Divergencia factura ⇄ cuenta por cobrar (tenants con enlace)
En los tenants donde factura y CxC son enlazables (modelo con `facturas.origen_venta_id` o `ventas.factura_id`):

| Tenant | CxC | Facturas con estado "pagado" desalineado | Facturas con saldo desalineado | Pagos sobre crédito (flujo A) |
|---|---|---|---|---|
| reservacaacupe | 285 | 41 | 105 | 67 |
| abhuevos | 109 | 67 | 67 | 0 |
| darocha | 41 | 20 | 20 | 0 |
| ferrecolor | 57 | 8 | 8 | 0 |
| **Total** | | **136** | **200** | **67** |

### A.4 Limitación de medición
4 tenants con volumen de crédito **no** tienen enlace factura↔venta (`greenlanderp` 610 CxC, `tecnolabo` 73, `autorepuestosfelix` 56, `ferreteriarepublica` 47): sus `facturas` son un subsistema separado (p. ej. greenlanderp es inmobiliario/suscripciones, factura sin `origen_venta_id`). Para esos, la reconciliación factura↔CxC **no aplica con el mismo criterio**; su pago va por `cobros_clientes` (facturas no acopladas).

### A.5 Conclusiones para el plan
1. **Prioridad 1 — reservacaacupe:** único tenant activo que usa ambos flujos con volumen (67 pagos + 105 cobros). Requiere reconciliación de datos cuidadosa (deduplicar pagos vs cobros) antes de unificar.
2. **Prioridad 2 — sincronización factura⇄CxC:** el problema dominante (abhuevos/darocha/ferrecolor y la mayoría) es que los cobros no se reflejan en la factura. La **capa de servicio transaccional** (Fase 1) que actualiza ambos lados lo resuelve de raíz para los cobros nuevos; los históricos se corrigen en Fase 4.
3. **Riesgo de doble conteo:** bajo a nivel plataforma (solo 2 tenants), pero real — refuerza definir una **fuente autoritativa única** de ingresos en la reportería (Fase 3).
4. **Fuera de alcance directo:** los tenants sin enlace factura↔venta (modelo distinto) se tratan aparte.
