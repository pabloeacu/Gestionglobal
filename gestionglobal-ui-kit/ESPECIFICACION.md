# Gestión Global — Especificación de dirección visual

Dirección: **marca-nativa**. Tomar la identidad institucional real de Gestión Global (tipografía condensada en mayúsculas, azules en capas, motivo triangular, esquinas biseladas) y aplicarla a la interfaz para sacarla del look genérico de IA. Esta es la fuente de verdad; los archivos `tokens.css` y `tailwind-theme.js` son su implementación, y los HTML de referencia muestran el resultado esperado.

Archivos de referencia (mirar antes de codear):
- `mockups/gestionglobal-portal-cliente.html` — Inicio, Campus, Detalle de curso (objetivo del primer pase).
- `mockups/gestionglobal-propuesta-visual.html` — Panel de gerencia y librería de componentes.

---

## 1. Principios (no negociables)

1. **Esquinas rectas o biseladas, nunca redondeadas.** `border-radius: 0`. Tarjetas, botones y badges llevan un corte de esquina (chamfer) vía `clip-path`, no `border-radius`.
2. **Bordes finos + reglas, no sombras difusas.** Superficies planas con `1px` de borde. El realce en hover es un offset duro de color, no un blur.
3. **Tipografía de marca:** Oswald condensada en MAYÚSCULAS para títulos y micro-etiquetas; Archivo para texto y datos. Nunca usar Inter para títulos.
4. **Números tabulares** en toda cifra (dinero, fechas, contadores): `font-variant-numeric: tabular-nums`.
5. **Motivo triangular** de la marca como textura sutil en encabezados, portadas y estados vacíos (opacidad ~10-16%).
6. **Azules en capas** con jerarquía: navy = estructura/texto, petróleo = acento de marca, cyan = acción/activo, celeste/pálido = superficies y motivos.

---

## 2. Tokens de color

| Token | Hex | Uso |
|---|---|---|
| `--gg-ink` | `#0B1F33` | Navy institucional. Riel/sidebar, texto de títulos, estructura |
| `--gg-ink-2` | `#122230` | Texto principal |
| `--gg-slate` | `#5D7284` | Texto secundario, micro-labels neutrales |
| `--gg-petrol` | `#159AA6` | Acento de marca (eyebrows, reglas, bordes de acento) |
| `--gg-cyan` | `#009ECA` | Acción principal, estado activo, foco |
| `--gg-blue` | `#2E6FB0` | Íconos de datos, motivos |
| `--gg-sky` | `#9CC7E4` | Motivos, texto sobre navy |
| `--gg-pale` | `#E7F1F9` | Rellenos de panel, cuadros de ícono |
| `--gg-paper` | `#F3F7FB` | Fondo de trabajo |
| `--gg-line` | `rgba(11,31,51,.14)` | Bordes |
| OK / WARN / BAD / INFO | `#0E9F6E` / `#C46A10` / `#C22B4A` / `#009ECA` | Estados (con sus `-bg` claros) |

## 3. Tipografía

- **Display / labels:** `Oswald` — pesos 500/600/700. Mayúsculas + `letter-spacing` 0.06–0.14em.
- **Body / datos:** `Archivo` — pesos 400/500/600.
- **Entrega de fuentes:** self-host recomendado (privacidad/estabilidad); fallback Google Fonts `Oswald` + `Archivo`. Preload de los pesos usados.

Escala: micro 10 · xs 12 · sm 13 · base 14 · subtítulo 17 · 22 · 30 · **H1 40**.

Reglas de uso:
- Eyebrow / micro-label: Oswald 600, 10–11px, mayúsculas, tracking .12em, color `petrol` (o `slate` si es neutral).
- H1 de página: Oswald 700, 38–40px, color `ink`.
- Etiquetas de KPI y encabezados de tabla: Oswald 600 mayúsculas, 10–11px.
- Cifras de dinero: Archivo 600 con tabular-nums.

## 4. Forma y motivo

- **Chamfer** (corte de esquina): grande `14px` en tarjetas/paneles; chico `8px` en botones/badges. Implementar con `clip-path` (ver `.gg-chamfer` en `tokens.css`).
- **Reglas de sección:** franja de 3px bajo el encabezado tipo pestaña: `petrol` (0–44px) → `ink` (44–78px) → transparente.
- **Motivo triangular:** patrón de medios-cuadrados (`linear-gradient` diagonales), `background-size` ~34px, opacidad 10–16%. Usar `currentColor` para teñir según contexto.
- **Viñetas:** triángulo cyan (borde CSS) en vez de bullets redondos.

---

## 5. Componentes (anatomía y estados)

Para cada componente respetar: estados `default / hover / focus-visible / active / disabled / loading / error` y comportamiento de teclado.

### Botón
- Forma: `gg-chamfer-sm`. Tipografía Oswald 600 mayúsculas 12px.
- Variantes: **primary** (fondo cyan, texto blanco, hover = offset duro cyan), **dark** (navy), **outline** (borde navy, hover invierte), **ghost** (borde línea, hover pale), **danger** (fondo bad).
- Ícono opcional: triángulo `▶` (borde CSS) a la derecha en CTAs.
- Focus-visible: `box-shadow: 0 0 0 3px rgba(0,158,202,.35)`.

### Badge / estado
- Forma `gg-chamfer-sm` (6px). Oswald 600 mayúsculas 10px. Cuadrito rotado 45° a la izquierda del color del estado.
- Estados: Autorizado/Activa (ok), Pendiente (warn), Vencido (bad), Emitido (info), Borrador (neutral slate).

### Tarjeta / panel
- Fondo blanco, `1px` borde línea, sin sombra. Chamfer 14px en tarjetas de acción.
- Acento: keyline superior de 3px del color relevante, o borde izquierdo de 3px cyan/petrol en avisos.

### Encabezado de sección (device de marca)
- Cuadro de ícono (46px, fondo `pale`, borde) + barra de título con esquina cortada + regla teal/navy de 3px al pie. Título Oswald 600 mayúsculas 17–18px.

### Tabla de datos
- Header: fondo `paper`, Oswald 600 mayúsculas 10.5px, color slate, borde inferior.
- Filas: borde `line-2`, hover `pale`. Importes a la derecha con tabular-nums (Oswald 600). IDs de comprobante en Oswald 500.

### Campo de formulario
- Label Oswald 600 mayúsculas 10px slate. Input fondo `paper`, borde `line`; focus borde cyan + halo `rgba(0,158,202,.15)`. Sin redondeo.

### Navegación
- **Portal (cliente):** riel de íconos navy (74px). Ítem activo: borde izquierdo cyan + degradé cyan translúcido. Motivo triangular tenue al pie.
- **App (gerencia):** sidebar navy 250px, grupos con micro-label Oswald, ítem activo borde izquierdo cyan.

### Reproductor / campus
- Portada de curso: degradé navy→blue→petrol + motivo triangular blanco tenue; título Oswald 700 mayúsculas.
- Módulos: acordeón con número en cuadro `pale`, docente en Archivo. Clase activa: borde izquierdo cyan + fondo pale.
- Botón play: bloque cyan biselado con triángulo blanco.

---

## 6. Mapeo desde el estado actual (qué cambia)

| Hoy (genérico) | Nuevo (marca) |
|---|---|
| Inter en todo | Oswald (títulos/labels) + Archivo (cuerpo/datos) |
| `border-radius` redondeado | Esquinas rectas + chamfer |
| Sombras suaves difusas | Bordes finos + offset duro en hover |
| Sidebar blanco/celeste | Riel/sidebar navy con motivo |
| Acentos celestes planos | Jerarquía navy→petrol→cyan + motivo triangular |
| Números proporcionales | Tabular-nums en toda cifra |

Lo que **NO** cambia: estructura de datos, rutas, lógica de negocio, textos/copys, comportamiento funcional. Es exclusivamente capa de presentación.
