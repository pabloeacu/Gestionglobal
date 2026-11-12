-- 0683 · DGG-248 · Copy honesto para la familia 'declarado' (voz de calendario).
--
-- E-GG-274: la plantilla 'vencimiento-declarado-cliente' afirmaba una acción
-- del cliente ("SEGÚN TUS DATOS" / "Según los datos que cargaste en tu perfil")
-- que 121 de 157 matriculados nunca hicieron: la DDJJ-de-marzo se infiere de la
-- matrícula que tiene GG, no de un dato cargado por el cliente. Al universalizar
-- la materialización (DGG-248), ese claim se volvía un envío masivo deshonesto.
-- Decisión de Pablo: UNA voz de calendario, honesta para los 121 inferidos y
-- también cierta para los 36 que sí declararon. (El copy del push vive en el
-- edge dispatch-vencimientos; se corrige en el mismo chunk. El badge/leyenda de
-- la ficha, en el frontend.)

UPDATE public.email_templates
   SET kicker = 'TU AGENDA REGULATORIA',
       cuerpo_html_visual =
         '<p style="margin:0 0 12px;color:#1e293b;">Según el calendario regulatorio de tu matrícula, {{frase_estado}}.</p>'
         || '<p style="margin:0 0 12px;background:#ecfeff;border-left:4px solid #0891b2;border-radius:8px;padding:12px 14px;color:#0e7490;">Si ya la presentaste, cargá la fecha en tu ficha y dejamos de recordártela. Si todavía no, escribinos y la resolvemos con vos.</p>'
         || '<p style="margin:0;color:#475569;font-size:14px;">{{nota_verificacion}}</p>',
       updated_at = now()
 WHERE slug = 'vencimiento-declarado-cliente';
