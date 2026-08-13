# Gestión Global — UI Kit (dirección visual marca-nativa)

Paquete para que **Claude Code** aplique la nueva dirección visual con precisión y sin romper nada. No adivina: tiene los tokens exactos, los mockups de referencia y un método seguro y reversible.

## Contenido
- **`PROMPT-para-claude-code.md`** — empezá acá. Instrucciones de instalación + el prompt copy-paste.
- **`SKILL.md`** — la skill para Claude Code (poné en `.claude/skills/gestionglobal-ui/`). Es la fuente de verdad de reglas y método.
- **`ESPECIFICACION.md`** — spec de diseño legible: tokens, tipografía, componentes, mapeo desde el estado actual.
- **`tokens.css`** — variables CSS (bajo `[data-theme="gg-brand"]`, para tema conmutable).
- **`tailwind-theme.js`** — extensión de theme Tailwind (prefijo `gg-`) + plugin de chamfer.
- **`mockups/`** — los dos HTML de referencia (portal del cliente y panel de gerencia).

## Idea en una línea
El diseño nuevo se instala como **tema paralelo con interruptor**: se prende con un flag y, si algo se ve mal, se apaga al instante y vuelve el actual. Cero riesgo estructural, todo reversible.

## Orden sugerido
1. Copiar `gestionglobal-ui-kit/` a la raíz del repo y `SKILL.md` a `.claude/skills/gestionglobal-ui/`.
2. Abrir Claude Code, pegar el prompt de `PROMPT-para-claude-code.md`.
3. Claude Code audita el repo y frena para tu OK antes de tocar código.
4. Primer pase: portal del cliente (Inicio, Campus, Detalle de curso).
5. Segundo pase (opcional): panel de gerencia.

Paleta: navy `#0B1F33` · petróleo `#159AA6` · cyan `#009ECA` · Oswald + Archivo.
