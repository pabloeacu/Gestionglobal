-- 0653 · DGG-244 · LexPH F1 — Siembra inicial: etiquetas + Edición N°2 (5/11/2026).
--
-- Contenido real redactado por Pablo (LexPH Ed.2, período 21/09–05/11/2026): 6 fallos + 4
-- normativas + 1 internacional. Carga directa (sin RPC: en migración no hay contexto auth y el
-- INSERT corre como owner, RLS bypass). Idempotente por `slug` (ON CONFLICT DO NOTHING) para que
-- re-aplicar en un entorno fresco deje el mismo contenido de arranque. El wrapper editorial
-- (resumen ejecutivo, tendencias, Insight) es nivel-edición → entra con el modelo de newsletter (Fase 2).
--
-- Texto con apóstrofes/comillas → dollar-quoting ($gg$…$gg$). campos jsonb por tipo; fuentes jsonb.

-- ============================================================================
-- Etiquetas (materia + jurisdicción)
-- ============================================================================
INSERT INTO public.lexph_tags (slug, nombre, tipo, orden) VALUES
  ('danos-responsabilidad',      'Daños y responsabilidad',        'materia', 10),
  ('seguros',                    'Seguros',                        'materia', 20),
  ('responsabilidad-administrador','Responsabilidad del administrador','materia', 30),
  ('asambleas',                  'Asambleas',                      'materia', 40),
  ('alquileres-temporarios',     'Alquileres temporarios',         'materia', 50),
  ('laboral',                    'Laboral',                        'materia', 60),
  ('accesibilidad',              'Accesibilidad',                  'materia', 70),
  ('medianeria',                 'Medianería',                     'materia', 80),
  ('filtraciones',               'Filtraciones',                   'materia', 90),
  ('honor-profesional',          'Honor profesional',              'materia', 100),
  ('caba',                       'CABA',                           'jurisdiccion', 10),
  ('pba',                        'Provincia de Buenos Aires',      'jurisdiccion', 20),
  ('nacional',                   'Nacional',                       'jurisdiccion', 30),
  ('internacional',              'Internacional',                  'jurisdiccion', 40)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- Artículos
-- ============================================================================

-- 1 · Fallo SUM balcón
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'fallo-sum-balcon-80', 'fallo', 'publicado',
  $gg$Muerte por caída desde el balcón del SUM: el consorcio responde en un 80%$gg$,
  $gg$La Cámara Civil (Sala K) confirmó la condena al consorcio por la muerte de un joven que cayó del balcón del SUM: responsabilidad objetiva, reparto 80/20, con un límite de cobertura de póliza irrisorio frente a la condena.$gg$,
  $gg$<p>En 2019, un joven de 23 años cayó desde el balcón del salón de usos múltiples (6° piso) y murió. La puerta metálica del balcón tenía un bloqueo deficiente, sin pasador ni candado, y la pasarela no tenía barandas. En primera instancia se atribuyó el 80% de la responsabilidad al consorcio y el 20% a la víctima por su estado de alcoholemia, con condenas de $66.836.000 para cada progenitor y $34.000.000 para la hermana, extendidas a la aseguradora. La demanda contra la administradora fue rechazada. La Cámara confirmó la responsabilidad objetiva del consorcio y el reparto 80/20, descartando que el alcohol fuera causa exclusiva, y revisó varios rubros indemnizatorios. También debió resolver cómo actualizar el límite de cobertura de la póliza, fijado en $1.059.500 por acontecimiento.</p>$gg$,
  jsonb_build_object(
    'tribunal', $gg$CNCiv, Sala K$gg$,
    'fecha', $gg$10 de septiembre de 2026$gg$,
    'caratula', $gg$"G., Norma y otros c/ Consorcio de Propietarios Gutenberg XXXX y otros s/ daños y perjuicios"$gg$,
    'voces', jsonb_build_array('Responsabilidad objetiva','Cosa riesgosa en parte común (arts. 1757 y 1758 CCyCN)','Hecho de la víctima como eximente parcial','Seguro de responsabilidad civil','Límite de cobertura'),
    'clave_administrador', $gg$Un espacio común con riesgo de caída (balcones, terrazas, pasarelas) convierte al consorcio en responsable objetivo: no alcanza con probar que "nadie tuvo la culpa". Cerrar accesos, colocar barandas y documentar inspecciones es la única defensa real. Que la víctima haya estado alcoholizada solo redujo la condena en un 20%.$gg$,
    'riesgo_oportunidad', $gg$El dato más alarmante es el límite de cobertura de la póliza, irrisorio frente a condenas de decenas de millones. Revisar sumas aseguradas y cláusulas de actualización de las pólizas de RC de cada consorcio es urgente. En sede penal la administradora fue procesada: el riesgo personal existe aunque la demanda civil se haya rechazado.$gg$
  ),
  jsonb_build_array(jsonb_build_object('cita', $gg$Microjuris Al Día · 21/10/2026 · Cita MJ-JU-M-161305-AR$gg$, 'url', $gg$https://aldiaargentina.microjuris.com/2026/10/21/fallos-muerte-por-caida-desde-el-balcon-de-un-sum-responsabilidad-del-consorcio-y-atribucion-del-20-de-responsabilidad-a-la-victima-por-su-estado-de-alcoholemia/$gg$)),
  timestamptz '2026-09-10 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 2 · Fallo matafuego
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'fallo-matafuego-soporte-vencido', 'fallo', 'publicado',
  $gg$Matafuego que cae sobre una inquilina: el soporte vencido es responsabilidad del consorcio$gg$,
  $gg$La Sala L responsabilizó al consorcio por un matafuego que cayó sobre una inquilina: el soporte es una cosa común a su cargo y contratar la recarga no traslada la responsabilidad.$gg$,
  $gg$<p>En el palier del piso 11, un matafuego colgado cerca del ascensor cayó sobre el pie de una inquilina y le provocó una fractura expuesta. La prueba incluyó fotos del soporte vencido y la propia denuncia de siniestro de la administración. La Cámara confirmó que el matafuego y su soporte son cosas comunes a cargo del consorcio y que hubo negligencia en su mantenimiento; la empresa de mantenimiento de matafuegos quedó fuera de la condena. Según la reseña, se elevaron la incapacidad física (de $3,5 a $7 millones) y el daño moral (de $4 a $7 millones), y el límite de cobertura se ordenó actualizar por IPC desde la fecha del hecho.</p>$gg$,
  jsonb_build_object(
    'tribunal', $gg$CNCiv, Sala L$gg$,
    'fecha', $gg$2 de septiembre de 2026$gg$,
    'caratula', $gg$"B., E. c/ Consorcio de Propietarios Humboldt 455 y otros s/ daños y perjuicios"$gg$,
    'voces', jsonb_build_array('Cosas comunes (arts. 2040 y 2041 inc. k CCyCN)','Responsabilidad objetiva (arts. 1757 y 1758)','Deber de mantenimiento','Ley de Seguros 17.418','Actualización del límite de cobertura'),
    'clave_administrador', $gg$Contratar a una empresa de recarga de matafuegos no traslada la responsabilidad: el soporte y la fijación siguen siendo obligación del consorcio. Incluí en el control periódico de seguridad los anclajes y soportes, no solo la carga y el vencimiento del extintor.$gg$,
    'riesgo_oportunidad', $gg$La aseguradora intentó defenderse invocando la falta de denuncia del siniestro (arts. 46 y 47, Ley 17.418). Denunciar a tiempo cada accidente en partes comunes es lo que mantiene viva la cobertura. Las costas de alzada quedaron a cargo de la aseguradora.$gg$
  ),
  jsonb_build_array(jsonb_build_object('cita', $gg$Microjuris Al Día · 29/09/2026 · Cita MJ-JU-M-161059-AR$gg$, 'url', $gg$https://aldiaargentina.microjuris.com/2026/09/29/fallos-consorcios-procedencia-de-una-demanda-por-los-danos-sufridos-por-una-inquilina-al-caerle-un-matafuego-en-el-pie-dentro-de-un-espacio-comun-del-edificio/$gg$)),
  timestamptz '2026-09-02 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 3 · Fallo accesibilidad / rampa
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'fallo-accesibilidad-rampa-dolores', 'fallo', 'publicado',
  $gg$Ordenan a un consorcio eliminar barreras arquitectónicas: la accesibilidad no depende de la asamblea$gg$,
  $gg$Un juzgado de Dolores ordenó al consorcio construir una rampa en 120 días: la accesibilidad no puede quedar sujeta a la inactividad de la asamblea.$gg$,
  $gg$<p>Una propietaria de 79 años, usuaria de silla de ruedas desde 2021, solo podía acceder a su unidad por una escalera. Reclamó por carta documento en 2023 y la asamblea posterior no puso las obras a votación. El consorcio se defendió diciendo que las obras en partes comunes requerían las mayorías del reglamento y que el reclamo judicial era prematuro. El juzgado rechazó esa defensa: las mejoras de accesibilidad no pueden quedar sujetas a la voluntad o a la inactividad de la asamblea. Ordenó ejecutar las obras propuestas por el perito (reubicación de escalera, rampa lateral, descansos y barandas) u otra alternativa técnicamente adecuada, en 120 días desde que la sentencia quede firme, con costas al consorcio.</p>$gg$,
  jsonb_build_object(
    'tribunal', $gg$Juzgado en lo Civil y Comercial N° 4 de Dolores$gg$,
    'fecha', $gg$publicado el 7 de octubre de 2026$gg$,
    'voces', jsonb_build_array('Accesibilidad','Personas con movilidad reducida','Obras en partes comunes','Límites a las facultades de la asamblea','Carta documento como reclamo fehaciente'),
    'clave_administrador', $gg$Ante un pedido de accesibilidad, no alcanza con "llevarlo a la próxima asamblea". Hay que tratarlo de inmediato, pedir un informe técnico y proponer una solución concreta. La inacción se paga con una orden judicial y las costas del juicio.$gg$,
    'riesgo_oportunidad', $gg$Es sentencia de primera instancia y la nota no informa si está firme. Aun así marca una tendencia: en materia de discapacidad, los jueces priorizan las normas protectorias sobre las mayorías reglamentarias. Conviene relevar los edificios con desniveles en el acceso y planificar las obras antes del reclamo.$gg$
  ),
  jsonb_build_array(jsonb_build_object('cita', $gg$Infobae · 07/10/2026$gg$, 'url', $gg$https://www.infobae.com/judiciales/2026/10/07/tras-la-demanda-de-una-vecina-un-consorcio-debera-adaptar-el-acceso-al-edificio-para-personas-con-movilidad-reducida/$gg$)),
  timestamptz '2026-10-07 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 4 · Fallo filtraciones
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'fallo-filtraciones-causas-mixtas', 'fallo', 'publicado',
  $gg$Filtraciones con causas mixtas: consorcio y vecino de arriba pagan por partes iguales$gg$,
  $gg$Causas mixtas (comunes y propias): la Cámara repartió la condena entre el consorcio y el vecino de arriba. Clave: pedir una pericia que separe cada foco.$gg$,
  $gg$<p>Un departamento de Av. del Libertador 4700 (CABA) sufría humedad en cocina, baño y dormitorio. La pericia determinó que la humedad de la cocina provenía de un desagüe obstruido en la unidad de arriba, mientras que la del baño y el dormitorio tenía causas mixtas: desagües del piso superior, la medianera y la cañería de recolección principal (comunes). La Cámara revocó parcialmente la sentencia y condenó también al propietario de arriba: la cocina corre por su cuenta, y baño y dormitorio se reparten por partes iguales con el consorcio. El daño moral se fijó en $2.000.000, a cargo de ambos.</p>$gg$,
  jsonb_build_object(
    'tribunal', $gg$CNCiv (jueces Carranza Casares y Polo Olivera)$gg$,
    'fecha', $gg$publicado el 26 de septiembre de 2026$gg$,
    'voces', jsonb_build_array('Filtraciones','Partes comunes vs. partes propias','Concurrencia de causas','Responsabilidad concurrente','Prueba pericial'),
    'clave_administrador', $gg$Ante una filtración, pedir una pericia que identifique cada foco por separado. Eso evita que el consorcio cargue con daños que corresponden a una unidad particular, y permite reclamar al propietario responsable su parte.$gg$,
    'riesgo_oportunidad', $gg$Cuando hay causas comunes y propias mezcladas, la condena es concurrente: el damnificado puede reclamarle todo al consorcio. Por eso conviene citar al propietario de la unidad superior al proceso desde el inicio.$gg$
  ),
  jsonb_build_array(jsonb_build_object('cita', $gg$Justicia de Primera · 26/09/2026$gg$, 'url', $gg$https://justiciadeprimera.com/2026/09/26/filtraciones-en-un-edificio-cuando-responde-el-consorcio-y-cuando-el-propietario/$gg$)),
  timestamptz '2026-09-26 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 5 · Fallo difamación WhatsApp
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'fallo-difamacion-whatsapp-administradora', 'fallo', 'publicado',
  $gg$Difamación en el grupo de WhatsApp del edificio: indemnizan a una administradora$gg$,
  $gg$La Sala F elevó a $1.500.000 la indemnización a una administradora difamada en el grupo de WhatsApp del edificio: el honor profesional del administrador también se protege.$gg$,
  $gg$<p>Una administradora se enteró por vecinas de que una copropietaria la descalificaba a ella y a su trabajo en el grupo de WhatsApp del consorcio, sugiriendo actos deshonestos. Demandó por daños y la primera instancia le reconoció $600.000 por daño moral. Apeló solo por el monto, y la Cámara entendió que los mensajes afectaron su honor y su reputación profesional porque pudieron hacer dudar de su honestidad: elevó la indemnización a $1.500.000.</p>$gg$,
  jsonb_build_object(
    'tribunal', $gg$CNCiv, Sala F$gg$,
    'fecha', $gg$publicado el 3 de noviembre de 2026$gg$,
    'voces', jsonb_build_array('Derecho al honor','Reputación profesional del administrador','Daño moral','Redes y mensajería entre consorcistas'),
    'clave_administrador', $gg$Las críticas a la gestión son legítimas; las acusaciones de deshonestidad sin sustento, no. Guardá capturas con fecha y testigos de los mensajes. Y respondé a los cuestionamientos con información: rendición de cuentas clara y documentación accesible.$gg$,
    'riesgo_oportunidad', $gg$El precedente sirve también para proponer en asamblea reglas de uso del grupo de WhatsApp del edificio: canal informativo, sin agravios personales, con los reclamos formales por vía fehaciente.$gg$
  ),
  jsonb_build_array(jsonb_build_object('cita', $gg$Revista Quorum · 03/11/2026$gg$, 'url', $gg$https://revistaquorum.com.ar/2026/11/03/indemnizan-a-una-administradora-de-consorcio-por-mensajes-de-whatsapp-en-los-que-se-dudaba-de-su-honradez/$gg$)),
  timestamptz '2026-11-03 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 6 · Fallo medianería
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'fallo-medianeria-consorcio-60-millones', 'fallo', 'publicado',
  $gg$Una desarrolladora deberá pagarle al consorcio más de $60 millones por usar su medianera$gg$,
  $gg$El consorcio cobra más de $60 millones a una desarrolladora que se apoyó en su medianera. Oportunidad concreta de recupero; clave conservar planos y comprobantes de pago.$gg$,
  $gg$<p>El consorcio de un edificio de Villa Urquiza (CABA) reclamó a la desarrolladora del edificio lindero, que construyó apoyándose en su pared medianera (unos 443 m²). La empresa negó el uso y ofreció $5.175.000. El perito confirmó que los edificios estaban en contacto por la medianera y que la empresa se ahorró más de 400 m² de muro propio; la demandada no asistió a la inspección pericial. La jueza la condenó a pagar $60.363.295 más intereses (8% anual y luego tasa activa BNA), con costas. La pericia había calculado $66.399.625, pero se descontaron $6.036.329 de honorarios profesionales cuyo pago no se acreditó.</p>$gg$,
  jsonb_build_object(
    'tribunal', $gg$Juzgado Nacional en lo Civil N° 109$gg$,
    'fecha', $gg$2 de noviembre de 2026$gg$,
    'caratula', $gg$Consorcio Pacheco 2855/57 c/ Desarrolladora B.A. S.A.$gg$,
    'voces', jsonb_build_array('Medianería','Consorcio como actor','Valor de los derechos de medianería','Prueba pericial','Primera instancia, no firme'),
    'clave_administrador', $gg$Si un edificio nuevo se apoya en la medianera del consorcio, hay un crédito a cobrar. Guardá planos, antigüedad y costos del muro, y documentá el avance de la obra lindera desde el primer día.$gg$,
    'riesgo_oportunidad', $gg$Oportunidad concreta de recuperar fondos para el consorcio. Detalle práctico: los honorarios técnicos no acreditados se descuentan, así que hay que conservar facturas y comprobantes de pago. Es sentencia de primera instancia y puede ser apelada.$gg$
  ),
  jsonb_build_array(
    jsonb_build_object('cita', $gg$Diario Río Negro · 04/11/2026$gg$, 'url', $gg$https://www.rionegro.com.ar/justicia/debera-pagar-66-399-625-por-construir-sobre-una-medianera-cual-fue-el-reclamo-del-consorcio-en-la-justicia-4784994/$gg$),
    jsonb_build_object('cita', $gg$Elonce · 04/11/2026$gg$, 'url', $gg$https://www.elonce.com/sociedad/construyo-un-edificio-usando-una-medianera-y-debera-pagar-mas-de-60-millones.htm$gg$)
  ),
  timestamptz '2026-11-02 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 7 · Normativa FAL
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'normativa-decreto-1228-2026-fal', 'normativa', 'publicado',
  $gg$Decreto 1228/2026 – El FAL entra en vigencia el 1° de diciembre de 2026$gg$,
  $gg$El Decreto 1228/2026 corrió la vigencia del Fondo de Asistencia Laboral al 1/12/2026 y amplió la carencia a 12 períodos. Hay que elegir entidad habilitada antes de esa fecha.$gg$,
  $gg$<p>El Decreto 1228/2026 (BO 20/10/2026) modificó el Decreto 408/26: prorrogó la entrada en vigencia del Fondo de Asistencia Laboral de la Ley 27.802 del 1° de noviembre al 1° de diciembre de 2026 y amplió el plazo de carencia de 6 a 12 períodos mensuales. Si el empleador no elige una entidad habilitada antes del 1/12, la CNV le asignará una de oficio. Según ConsorciosPH, los consorcios de propietarios quedan obligados a constituir el FAL por sus empleados.</p>$gg$,
  jsonb_build_object(
    'organismo', $gg$Poder Ejecutivo Nacional (BO)$gg$,
    'norma', $gg$Decreto 1228/2026 (modifica Decreto 408/26)$gg$,
    'fecha', $gg$BO 20/10/2026 · vigencia 1/12/2026$gg$,
    'clave_administrador', $gg$Elegí la entidad habilitada antes del 1/12/2026: si no, la CNV asigna una de oficio. Los consorcios con empleados quedan obligados a constituir el FAL.$gg$
  ),
  jsonb_build_array(
    jsonb_build_object('cita', $gg$Infobae · 20/10/2026$gg$, 'url', $gg$https://www.infobae.com/economia/2026/10/20/postergaron-la-entrada-en-vigencia-del-fal-el-fondo-para-pagar-indemnizaciones-laborales/$gg$),
    jsonb_build_object('cita', $gg$iProfesional · 20/10/2026$gg$, 'url', $gg$https://www.iprofesional.com/impuestos/466986-prorrogan-fal-hasta-cuando-podran-adherir-empresas$gg$),
    jsonb_build_object('cita', $gg$ConsorciosPH$gg$, 'url', $gg$https://consorciosph.com.ar/de-que-se-trata-la-reglamentacion-de-la-ley-27-802-de-modernizacion-laboral/$gg$)
  ),
  timestamptz '2026-10-20 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 8 · Normativa RG ARCA
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'normativa-rg-arca-5915-2026', 'normativa', 'publicado',
  $gg$RG ARCA 5915/2026 – Ajuste operativo del FAL en las DDJJ de cargas sociales$gg$,
  $gg$ARCA adecuó la RG 5907 a la prórroga del FAL: aplica a las DDJJ del devengado diciembre 2026 y exige la versión 48 de "Declaración en línea".$gg$,
  $gg$<p>ARCA adecuó la RG 5907 a la prórroga: el régimen se aplica a las declaraciones juradas del período devengado diciembre de 2026 en adelante, y exige la versión 48 de "Declaración en línea" para las DDJJ presentadas desde el 1/12/2026. El primer aporte corresponde al devengado diciembre 2026, con vencimiento en enero de 2027.</p>$gg$,
  jsonb_build_object(
    'organismo', $gg$ARCA$gg$,
    'norma', $gg$RG 5915/2026 (adecúa la RG 5907)$gg$,
    'fecha', $gg$26/10/2026$gg$,
    'clave_administrador', $gg$Usá la versión 48 de "Declaración en línea" desde el 1/12/2026. El primer aporte del FAL es el devengado diciembre 2026, con vencimiento en enero 2027.$gg$
  ),
  jsonb_build_array(jsonb_build_object('cita', $gg$El Cronista · 26/10/2026$gg$, 'url', $gg$https://www.cronista.com/economia-politica/arca-reglamento-la-prorroga-del-fal-las-nuevas-fechas-y-que-cambia/$gg$)),
  timestamptz '2026-10-26 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 9 · Normativa encargados escalas
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'normativa-encargados-escalas-oct-2026', 'normativa', 'publicado',
  $gg$Encargados de edificio – Escalas de octubre 2026 (se pagan en noviembre)$gg$,
  $gg$SUTERH publicó las nuevas escalas del CCT 589/10 (octubre 2026, se pagan en noviembre). Revisá la planilla oficial antes de liquidar.$gg$,
  $gg$<p>SUTERH publicó las nuevas escalas del CCT 589/10. Referencias: encargado permanente sin vivienda 1ª categoría $1.504.674; con vivienda $1.316.343; suma remuneratoria mensual de $65.000 proporcional a la jornada. Se mantienen el plus del 50% por zona desfavorable y el 10% por título de Encargado Integral de Edificio. Revisá la planilla oficial antes de liquidar.</p>$gg$,
  jsonb_build_object(
    'organismo', $gg$SUTERH$gg$,
    'norma', $gg$CCT 589/10 – escalas octubre 2026$gg$,
    'fecha', $gg$23/10/2026$gg$,
    'clave_administrador', $gg$Liquidá noviembre con las escalas de octubre. Verificá el plus del 50% por zona desfavorable y el 10% por título de Encargado Integral antes de cerrar la liquidación.$gg$
  ),
  jsonb_build_array(
    jsonb_build_object('cita', $gg$El Observador · 23/10/2026$gg$, 'url', $gg$https://www.elobservador.com/argentina/economia/encargados-edificio-suterh-publico-las-nuevas-escalas-aumento-cuanto-cobra-cada-categoria-noviembre-2026-n6061434$gg$),
    jsonb_build_object('cita', $gg$SUTERH – Planilla Octubre 2026$gg$, 'url', $gg$https://suterh.org.ar/planilla-salarial-octubre-2026/$gg$)
  ),
  timestamptz '2026-10-23 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 10 · Normativa agenda CABA DDJJ
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'normativa-caba-ddjj-30-11-2026', 'normativa', 'publicado',
  $gg$Agenda CABA – La DDJJ de consorcios administrados vence el 30/11/2026$gg$,
  $gg$La DDJJ anual de consorcios administrados (período 2025) vence el 30/11/2026. Quien no la haya iniciado al vencimiento será considerado infractor (art. 12, Ley 941).$gg$,
  $gg$<p>Recordatorio: según la Disposición 2615/DGDYPC/26, los administradores que ejercieron en 2025 deben presentar la declaración jurada de consorcios administrados hasta el 30 de noviembre de 2026 inclusive. Quien no la haya iniciado al vencimiento será considerado infractor (art. 12, Ley 941). También debe exhibirse en el hall el certificado del Registro.</p>$gg$,
  jsonb_build_object(
    'organismo', $gg$GCBA – DGDYPC$gg$,
    'norma', $gg$Disposición 2615/DGDYPC/26 (Ley 941)$gg$,
    'fecha', $gg$vence 30/11/2026$gg$,
    'clave_administrador', $gg$Iniciá la DDJJ 2025 antes del 30/11/2026: no iniciarla a tiempo te hace infractor (art. 12, Ley 941). Exhibí el certificado del Registro en el hall.$gg$
  ),
  jsonb_build_array(jsonb_build_object('cita', $gg$Liga del Consorcista – Disp. 2615/DGDYPC/26$gg$, 'url', $gg$https://ligadelconsorcista.org/caba-disposicion-2615-2026-administradores-declaracion-jurada-2025$gg$)),
  timestamptz '2026-10-01 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- 11 · Internacional España
INSERT INTO public.lexph_articulos (slug, tipo, estado, titulo, resumen, cuerpo, campos, fuentes, publicado_at) VALUES (
  'internacional-espana-vivienda-turistica-boe', 'internacional', 'publicado',
  $gg$España – Sin aprobación de la junta de propietarios no hay vivienda turística$gg$,
  $gg$España confirma que, si la licencia de la vivienda turística es posterior al 3/4/2025, se necesita la aprobación de la junta con mayoría calificada. Posible referencia para una futura regulación local.$gg$,
  $gg$<p>La Dirección General de Seguridad Jurídica y Fe Pública (resolución del 21/05/2026, publicada en el BOE el 8 de octubre de 2026) desestimó el recurso de un propietario de Madrid y confirmó que, si las licencias municipales de la vivienda de uso turístico son posteriores al 3 de abril de 2025, "se precisa la aprobación de la Junta de Propietarios" con las mayorías del art. 17.12 de la Ley de Propiedad Horizontal (tres quintas partes de propietarios y de cuotas). La fecha que cuenta es la de la licencia, no la de la solicitud.</p><p><strong>Posible impacto en Argentina:</strong> España pone el control de los alquileres turísticos en manos de la comunidad de propietarios, con una mayoría calificada. En Argentina el debate pasa hoy por el destino que fija el reglamento. Si avanzaran regulaciones locales sobre alquiler temporario, el modelo español es una referencia probable.</p>$gg$,
  jsonb_build_object(
    'pais', $gg$España$gg$,
    'organismo', $gg$Dirección General de Seguridad Jurídica y Fe Pública$gg$,
    'norma', $gg$Resolución DGSJFP · BOE-A-2026-20955$gg$,
    'fecha', $gg$publicada en el BOE el 8/10/2026$gg$,
    'clave_administrador', $gg$Si avanza una regulación local de alquiler temporario, el modelo español (aprobación de la junta con mayoría calificada) es la referencia a seguir. Hoy en Argentina decide el destino que fija el reglamento.$gg$
  ),
  jsonb_build_array(jsonb_build_object('cita', $gg$BOE-A-2026-20955 · 08/10/2026$gg$, 'url', $gg$https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-20955$gg$)),
  timestamptz '2026-10-08 12:00:00-03'
) ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- Vínculos artículo ↔ etiqueta
-- ============================================================================
INSERT INTO public.lexph_articulo_tags (articulo_id, tag_id)
SELECT a.id, t.id
FROM (VALUES
  ('fallo-sum-balcon-80','danos-responsabilidad'),
  ('fallo-sum-balcon-80','seguros'),
  ('fallo-sum-balcon-80','responsabilidad-administrador'),
  ('fallo-sum-balcon-80','nacional'),
  ('fallo-matafuego-soporte-vencido','danos-responsabilidad'),
  ('fallo-matafuego-soporte-vencido','seguros'),
  ('fallo-matafuego-soporte-vencido','nacional'),
  ('fallo-accesibilidad-rampa-dolores','accesibilidad'),
  ('fallo-accesibilidad-rampa-dolores','asambleas'),
  ('fallo-accesibilidad-rampa-dolores','pba'),
  ('fallo-filtraciones-causas-mixtas','filtraciones'),
  ('fallo-filtraciones-causas-mixtas','danos-responsabilidad'),
  ('fallo-filtraciones-causas-mixtas','caba'),
  ('fallo-difamacion-whatsapp-administradora','honor-profesional'),
  ('fallo-difamacion-whatsapp-administradora','responsabilidad-administrador'),
  ('fallo-difamacion-whatsapp-administradora','nacional'),
  ('fallo-medianeria-consorcio-60-millones','medianeria'),
  ('fallo-medianeria-consorcio-60-millones','caba'),
  ('normativa-decreto-1228-2026-fal','laboral'),
  ('normativa-decreto-1228-2026-fal','nacional'),
  ('normativa-rg-arca-5915-2026','laboral'),
  ('normativa-rg-arca-5915-2026','nacional'),
  ('normativa-encargados-escalas-oct-2026','laboral'),
  ('normativa-encargados-escalas-oct-2026','nacional'),
  ('normativa-caba-ddjj-30-11-2026','responsabilidad-administrador'),
  ('normativa-caba-ddjj-30-11-2026','caba'),
  ('internacional-espana-vivienda-turistica-boe','alquileres-temporarios'),
  ('internacional-espana-vivienda-turistica-boe','asambleas'),
  ('internacional-espana-vivienda-turistica-boe','internacional')
) AS m(art_slug, tag_slug)
JOIN public.lexph_articulos a ON a.slug = m.art_slug
JOIN public.lexph_tags t ON t.slug = m.tag_slug
ON CONFLICT DO NOTHING;
