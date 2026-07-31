// ============================================================================
// mascaraGestoria · DGG-122 (pedido JL/Pablo 31/07)
//
// "Máscara" de presentación de los datos del trámite para el GESTOR: toma el
// JSON crudo del formulario (cuyas claves Postgres reordena internamente — el
// origen del "orden aleatorio" que reportó JL) y lo estructura en el orden
// EXACTO e inalterable pedido, con etiquetas legibles y campos concatenados.
//
// REGLAS DE ORO (Pablo): esto NO toca cómo se recogen ni cómo se guardan los
// datos. Es solo exposición. Nada se borra: todo campo que no esté mapeado en
// los bloques cae al bloque final "Otros datos del trámite". La misma máscara
// alimenta el panel del gestor Y el PDF de descarga (una sola fuente de orden).
// ============================================================================

export interface CampoMascara {
  etiqueta: string;
  valor: string;
  /** Nota aclaratoria chica debajo del campo (ej. Clave ARCA). */
  nota?: string;
}

export interface BloqueMascara {
  /** Subtítulo del bloque (ej. "Información adicional para pedido de…"). */
  titulo?: string;
  izquierda: CampoMascara[];
  derecha: CampoMascara[];
}

export interface MascaraGestoria {
  /** "Personas Físicas:" | "Personas Jurídicas:" */
  encabezado: string;
  bloques: BloqueMascara[];
  /** Todo lo no mapeado, con etiquetas limpias. */
  otros: CampoMascara[];
}

const NOTA_CLAVE_ARCA =
  '* LA CLAVE SOLO LA UTILIZAMOS NOSOTROS PARA SOLICITAR CERTIFICADOS Y ' +
  'REALIZAR LA INSCRIPCIÓN, NO SE PASA AL RPAC';

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v).trim();
  // Fechas ISO (YYYY-MM-DD) → formato es-AR. Nada más se transforma: los
  // valores libres (claves, emails) jamás se tocan.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

// Etiquetas curadas para "Otros datos" (§6: 'ano_egreso' en uppercase se leía
// "ANO EGRESO" — desafortunado en español frente al gestor).
const ETIQUETAS: Record<string, string> = {
  ano_egreso: 'Año de egreso',
  titulo: 'Título',
  institucion_titulo: 'Institución del título',
  dni: 'DNI',
  cuit_conyuge: 'CUIT del cónyuge',
  matricula: 'Matrícula',
  matricula_rpac: 'Matrícula RPAC',
  legajo_rpac: 'Legajo RPAC',
  declaracion_jurada: 'Declaración jurada',
  origen_canal: 'Origen del canal',
  tipo_persona_solicitante: 'Tipo de solicitante',
};

function humanizar(key: string): string {
  const curada = ETIQUETAS[key.trim().replace(/^_+/, '')];
  if (curada) return curada;
  const limpio = key.replace(/_/g, ' ').trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/**
 * Consume claves de `datos` y devuelve el valor concatenado (o '' si ninguna
 * clave tiene valor). Marca TODAS las claves pedidas como consumidas aunque
 * estén vacías, para que no reaparezcan en "Otros datos".
 */
function tomar(
  datos: Record<string, unknown>,
  usadas: Set<string>,
  keys: string[],
  separador = ' ',
): string {
  const partes: string[] = [];
  for (const k of keys) {
    usadas.add(k);
    const v = str(datos[k]);
    if (v !== '') partes.push(v);
  }
  return partes.join(separador);
}

function campo(etiqueta: string, valor: string, nota?: string): CampoMascara | null {
  if (valor === '') return null;
  return nota ? { etiqueta, valor, nota } : { etiqueta, valor };
}

function compactar(items: Array<CampoMascara | null>): CampoMascara[] {
  return items.filter((x): x is CampoMascara => x !== null);
}

/**
 * Heurística de tipo: es jurídica si el envío trae razón social con valor o
 * si el switch PF/PJ del formulario (DGG-123) lo declara explícitamente.
 */
export function esPersonaJuridica(datos: Record<string, unknown>): boolean {
  return (
    str(datos['razon_social']) !== '' ||
    str(datos['tipo_persona_solicitante']) === 'Persona jurídica'
  );
}

export function construirMascaraGestoria(
  datos: Record<string, unknown>,
): MascaraGestoria {
  const usadas = new Set<string>();
  const juridica = esPersonaJuridica(datos);

  let bloques: BloqueMascara[];
  let encabezado: string;

  if (juridica) {
    encabezado = 'Personas Jurídicas:';
    bloques = [
      {
        izquierda: compactar([
          campo('RAZÓN SOCIAL', tomar(datos, usadas, ['razon_social'])),
          campo(
            'DOMICILIO',
            tomar(datos, usadas, ['domicilio_empresa', 'domicilio', 'calle', 'numero', 'piso', 'depto', 'departamento']),
          ),
          campo('LOCALIDAD', tomar(datos, usadas, ['localidad'])),
          // §6 (auditor C): sin esta línea `provincia` caía a "Otros datos"
          // y el domicilio de la sede social quedaba partido en dos lugares.
          campo('PROVINCIA', tomar(datos, usadas, ['partido', 'provincia'])),
          campo('CÓDIGO POSTAL', tomar(datos, usadas, ['codigo_postal'])),
          campo('TITULAR EN ARCA', tomar(datos, usadas, ['nombre', 'apellido'])),
          campo('DNI DEL TITULAR', tomar(datos, usadas, ['dni'])),
        ]),
        derecha: compactar([
          campo('TELÉFONO', tomar(datos, usadas, ['telefono', 'celular'])),
          campo('MAIL', tomar(datos, usadas, ['email_empresa', 'email'])),
          // DGG-123 · Claves canónicas: en el flujo PF/PJ el CUIT de la
          // EMPRESA viaja en `cuit` (valida identidad/dedupe) y el del titular
          // en `cuit_titular_arca`. Las claves legacy del form jurídico viejo
          // se mantienen por si reaparece un dato histórico.
          campo(
            'C.U.I.T. RAZÓN SOCIAL',
            tomar(datos, usadas, ['cuit_razon_social', 'cuit_persona_juridica', 'cuit']),
          ),
          campo('C.U.I.T. TITULAR EN ARCA', tomar(datos, usadas, ['cuit_titular_arca'])),
          campo(
            'CLAVE ARCA DEL TITULAR',
            tomar(datos, usadas, ['clave_arca_titular', 'clave_fiscal_arca']),
            NOTA_CLAVE_ARCA,
          ),
        ]),
      },
    ];
  } else {
    encabezado = 'Personas Físicas:';
    bloques = [
      {
        izquierda: compactar([
          campo('NOMBRE Y APELLIDO', tomar(datos, usadas, ['nombre', 'apellido'])),
          campo('DOMICILIO', tomar(datos, usadas, ['calle', 'numero', 'piso', 'depto', 'departamento'])),
          campo('LOCALIDAD', tomar(datos, usadas, ['localidad'])),
          campo('PARTIDO', tomar(datos, usadas, ['partido', 'provincia'])),
          campo('CÓDIGO POSTAL', tomar(datos, usadas, ['codigo_postal'])),
        ]),
        derecha: compactar([
          campo('TELÉFONO', tomar(datos, usadas, ['celular', 'telefono'])),
          campo('MAIL', tomar(datos, usadas, ['email'])),
          campo('C.U.I.T.', tomar(datos, usadas, ['cuit'])),
          campo(
            'CLAVE ARCA',
            tomar(datos, usadas, ['clave_fiscal_arca']),
            NOTA_CLAVE_ARCA,
          ),
        ]),
      },
      {
        titulo:
          'Información adicional para pedido de certificado de antecedentes personales:',
        izquierda: compactar([
          campo('FECHA DE NACIMIENTO', tomar(datos, usadas, ['fecha_nacimiento'])),
          campo(
            'APELLIDO Y NOMBRE DEL PADRE',
            tomar(datos, usadas, ['padre_apellido_nombre']),
          ),
          campo(
            'APELLIDO Y NOMBRE DE LA MADRE',
            tomar(datos, usadas, ['madre_apellido_nombre']),
          ),
        ]),
        derecha: compactar([
          campo(
            'LUGAR DE NACIMIENTO',
            tomar(datos, usadas, ['lugar_nacimiento', 'nacionalidad']),
          ),
          campo('ESTADO CIVIL', tomar(datos, usadas, ['estado_civil'])),
          campo(
            'APELLIDO Y NOMBRE DEL CÓNYUGE',
            tomar(datos, usadas, ['apellido_nombre_conyuge', 'conyuge_apellido_nombre']),
          ),
        ]),
      },
    ];
  }

  // Bloques sin ningún dato no se muestran (ej. renovación sin domicilio).
  bloques = bloques.filter(
    (b) => b.izquierda.length > 0 || b.derecha.length > 0,
  );

  // §6: si NINGÚN campo de persona mapeó (ej. una solicitud derivada que no
  // viene de un form de personas), el encabezado "Personas Físicas:" queda
  // fuera de contexto — se omite y todo va directo a "Otros datos".
  if (bloques.length === 0) encabezado = '';

  // Todo lo demás, en orden alfabético estable (determinístico, sin depender
  // del orden interno del jsonb) — nada se suprime.
  const otros = Object.keys(datos)
    .filter((k) => !usadas.has(k))
    .filter((k) => str(datos[k]) !== '')
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({ etiqueta: humanizar(k), valor: str(datos[k]) }));

  return { encabezado, bloques, otros };
}
