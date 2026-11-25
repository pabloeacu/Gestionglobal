-- 0717 · DGG-269 F1b — Plantillas de campaña federal (manaxer-v1, borrador gateado).
-- Copy redactado para CABA/nacional. Envío GATEADO por federal_campanas_activo (OFF) + la
-- RPC sólo manda slugs 'federal-%'. CTA → formularios públicos reales (/formulario/<slug>).
-- No se envía nada hasta aprobar copy + carril SES vivo. from_casilla='general' (marketing).
--  · federal-rpa-caba   : Curso de Actualización RPA (CABA) — modalidad MIXTA (en vivo +
--    asincrónicas), certificado habilitante p/ renovar en CABA, alianza Fundplata+Gestar.
--  · federal-consultoria: consultoría jurídica de PH (federal).
--  · federal-webinar    : MAQUETA parametrizada (activo=false) — variables evento_titulo,
--    evento_fecha, evento_hora, flyer_url, inscripcion_url, nombre.

insert into public.email_templates
  (slug, nombre, asunto, from_casilla, layout_version, body_html, kicker, titulo_visual,
   color_acento, mostrar_logo, cuerpo_html_visual, firma, incluir_tabla_envio, cta_text, cta_url, activo)
values
-- ───────────── Curso RPA CABA ─────────────
('federal-rpa-caba',
 'Federal · Curso de actualización RPA (CABA)',
 '{{nombre}}, renová tu matrícula de CABA con el curso que la habilita',
 'general', 'manaxer-v1', '<!-- manaxer-v1 -->',
 'FORMACIÓN · RPA CABA',
 'Actualización RPA (CABA): en vivo y a tu ritmo',
 '#009ECA', true,
 $html$<p style="margin:0 0 20px;text-align:center;"><img src="https://kaoyhkebnidzqjixvchh.supabase.co/storage/v1/object/public/campus-media/curso-banner/eaafb7af-5129-4d9c-a2a7-eeabd620b0e9/1784422877219-ACTUALIZACION_RPA.jpg" alt="Curso de Actualización RPA (CABA)" style="max-width:100%;height:auto;border-radius:12px;" /></p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{nombre}},</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Si administrás en la Ciudad de Buenos Aires, el <strong>Curso de Actualización RPA (CABA)</strong> es el que te <strong>habilita a renovar tu matrícula</strong>: el certificado es válido ante el Registro.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Lo cursás en <strong>modalidad mixta</strong>: clases <strong>en vivo</strong> para resolver dudas con los docentes, y clases <strong>asincrónicas</strong> (grabadas) para ver cuando te quede cómodo. En alianza académica con <strong>Gestar</strong>, con el sello de Gestión Global.</p>
<ul style="margin:0 0 8px;padding-left:20px;font-size:15px;line-height:1.7;color:#334155;">
<li>Clases <strong>en vivo</strong> + <strong>asincrónicas</strong> (modalidad mixta)</li>
<li>Certificado <strong>habilitante</strong> para renovar la matrícula en CABA</li>
<li><strong>Ebooks exclusivos</strong> para los alumnos</li>
</ul>$html$,
 'Equipo de Gestión Global', false,
 'Quiero inscribirme', 'https://www.gestionglobal.ar/formulario/curso-actualizacion-caba', true),

-- ───────────── Consultoría jurídica ─────────────
('federal-consultoria',
 'Federal · Consultoría jurídica de PH',
 '{{nombre}}, respaldo legal para tu administración cuando lo necesites',
 'general', 'manaxer-v1', '<!-- manaxer-v1 -->',
 'CONSULTORÍA JURÍDICA',
 'Un equipo de PH a tu lado, en todo el país',
 '#159AA6', true,
 $html$<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{nombre}},</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Administrar consorcios es, muchas veces, resolver temas legales: una asamblea impugnada, un reglamento que interpretar, un conflicto con un propietario, un contrato para revisar.</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Con la <strong>Consultoría Jurídica de Gestión Global</strong> tenés un equipo especializado en <strong>propiedad horizontal</strong> para consultar cuando lo necesites — sin importar en qué provincia administres.</p>
<ul style="margin:0 0 8px;padding-left:20px;font-size:15px;line-height:1.7;color:#334155;">
<li>Especialistas en propiedad horizontal</li>
<li>Respuestas claras, sin letra chica</li>
<li>Cobertura en todo el país</li>
</ul>$html$,
 'Equipo de Gestión Global', false,
 'Quiero asesorarme', 'https://www.gestionglobal.ar/formulario/consultoria-juridica', true),

-- ───────────── Webinar gratuito (MAQUETA) ─────────────
('federal-webinar',
 'Federal · Webinar gratuito (maqueta)',
 '{{nombre}}, te invitamos: {{evento_titulo}}',
 'general', 'manaxer-v1', '<!-- manaxer-v1 -->',
 'WEBINAR GRATUITO',
 '{{evento_titulo}}',
 '#2E6FB0', true,
 $html$<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Hola {{nombre}},</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">Te invitamos a nuestro próximo <strong>webinar gratuito y online</strong>:</p>
<p style="margin:0 0 16px;text-align:center;"><img src="{{flyer_url}}" alt="{{evento_titulo}}" style="max-width:100%;height:auto;border-radius:12px;" /></p>
<p style="margin:0 0 8px;font-size:16px;line-height:1.6;color:#0f172a;text-align:center;"><strong>📅 {{evento_fecha}}&nbsp;&nbsp;·&nbsp;&nbsp;🕒 {{evento_hora}}</strong></p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#64748b;text-align:center;">Es gratis, pero los cupos son limitados. Reservá tu lugar.</p>$html$,
 'Equipo de Gestión Global', false,
 'Inscribirme gratis', '{{inscripcion_url}}', false)

on conflict (slug) do update set
  nombre=excluded.nombre, asunto=excluded.asunto, from_casilla=excluded.from_casilla,
  layout_version=excluded.layout_version, body_html=excluded.body_html, kicker=excluded.kicker,
  titulo_visual=excluded.titulo_visual, color_acento=excluded.color_acento,
  mostrar_logo=excluded.mostrar_logo, cuerpo_html_visual=excluded.cuerpo_html_visual,
  firma=excluded.firma, incluir_tabla_envio=excluded.incluir_tabla_envio,
  cta_text=excluded.cta_text, cta_url=excluded.cta_url, activo=excluded.activo, updated_at=now();
