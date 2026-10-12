-- 0547_dgg220_templates_captacion.sql
-- =============================================================================
-- DGG-220 · Fase 4 — 7 plantillas de email de captación (manaxer-v1, banner-led).
-- Copy por agentes de marketing; banners premium hosteados en public/email/.
-- Vencimiento (E1-E3): FUNDPLATA estrella (curso), GG coordina. Bondades (E4-E7): GG estrella.
-- from_casilla='cursos' (aísla reputación del transaccional contacto@; ver guardrail
-- reputación en el plan — ideal: remitente de marketing dedicado antes de escalar).
-- La línea de baja (List-Unsubscribe + footer) la agrega dispatch-emails (Fase 2).
-- =============================================================================

-- helper de maquetado reutilizable no existe en SQL → cada cuerpo es banner-img + copy.
-- Banner masthead: <img width=576 ...>; cajas destacadas: #E7F1F9 / border-left #009ECA.

INSERT INTO public.email_templates
  (slug, nombre, descripcion, asunto, kicker, titulo_visual, color_acento, cta_text, cta_url, firma, mostrar_logo, from_casilla, incluir_tabla_envio, layout_version, body_html, variables, activo, cuerpo_html_visual)
VALUES
-- ===================== E1 · Curso 31-90 días (FUNDPLATA) =====================
('captacion-curso-3190', 'Captación · Curso 31-90d (FUNDPLATA)',
 'DGG-220: prospecto cuya matrícula vence en 31-90 días → curso de actualización.',
 '{{nombre}}, tu curso de actualización ya te espera',
 '', '', '#009ECA', 'Hacer el curso', 'https://gestionglobal.ar/formulario/curso-actualizacion?origen=prospecto',
 'Aliados de tu tiempo.', true, 'cursos', false, 'manaxer-v1', '<!-- manaxer-v1 -->',
 '["nombre","dias_restantes","fecha_vencimiento"]'::jsonb, true,
 $html$<img src="https://www.gestionglobal.ar/email/dgg220-curso-3190.png" alt="Curso de Actualización · FUNDPLATA · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 14px;">Tu matrícula de administrador vence el <strong>{{fecha_vencimiento}}</strong>: todavía te quedan <strong>{{dias_restantes}} días</strong>. Tiempo de sobra para resolver, con calma, el paso que la mantiene vigente: el curso de actualización anual.</p><p style="margin:0 0 16px;">Es el <strong>Curso de Actualización de FUNDPLATA</strong>, coordinado académicamente por Gestión Global. No es un trámite de relleno: son asignaturas pensadas para administradores profesionales como vos, con contenidos teórico-prácticos que suman a tu gestión diaria y llevan la profesión a otro nivel.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#0B1F33;">Lo hacés desde nuestro <strong>campus virtual, a tu ritmo</strong>, cuando te queda cómodo. Al terminar, el <strong>certificado oficial</strong> te queda listo para la renovación.</td></tr></table><p style="margin:0;">Adelantarte ahora es sacarte el pendiente de encima antes de que apremie. De los plazos y el resto nos ocupamos nosotros.</p>$html$),

-- ===================== E2 · Curso + Renovación ≤30 días (FUNDPLATA) =====================
('captacion-curso-reno', 'Captación · Curso+Renovación ≤30d (FUNDPLATA)',
 'DGG-220: matrícula vence en ≤30 días → curso + renovación juntos.',
 '{{nombre}}, curso y renovación en un solo lugar',
 '', '', '#009ECA', 'Hacer el curso y renovar', 'https://gestionglobal.ar/formulario/curso-actualizacion?origen=prospecto',
 'Aliados de tu tiempo.', true, 'cursos', false, 'manaxer-v1', '<!-- manaxer-v1 -->',
 '["nombre","fecha_vencimiento"]'::jsonb, true,
 $html$<img src="https://www.gestionglobal.ar/email/dgg220-curso-reno.png" alt="Curso + Renovación · FUNDPLATA · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 14px;">Tu matrícula vence el <strong>{{fecha_vencimiento}}</strong>. Entrás en la recta final, pero estás a tiempo. Y a tiempo de hacerlo sin vueltas.</p><p style="margin:0 0 14px;">Para seguir habilitado necesitás dos cosas: el <strong>curso de actualización</strong> y la <strong>renovación ante el RPAC</strong>. La buena noticia es que las dos las resolvés en el mismo lugar, sin saltar de ventanilla en ventanilla.</p><p style="margin:0 0 16px;">El curso es el <strong>Curso de Actualización de FUNDPLATA</strong>, coordinado académicamente por Gestión Global: campus virtual cómodo, contenidos a la altura de un administrador profesional y certificado oficial al cierre.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#0B1F33;">Hacés el curso y, con el <strong>certificado en mano, gestionamos tu renovación ante la DPPJ</strong>. Vos seguís con lo tuyo; de los plazos y el trámite nos ocupamos nosotros.</td></tr></table><p style="margin:0;">Sin corridas de último momento. Así trabaja un aliado de tu tiempo.</p>$html$),

-- ===================== E3 · Matrícula vencida (FUNDPLATA) =====================
('captacion-vencida', 'Captación · Matrícula vencida (FUNDPLATA)',
 'DGG-220: matrícula ya vencida → curso + renovación en un lugar (empático).',
 '¿Se te venció la matrícula, {{nombre}}? Hay solución',
 '', '', '#009ECA', 'Regularizar ahora', 'https://gestionglobal.ar/formulario/curso-actualizacion?origen=prospecto',
 'Aliados de tu tiempo.', true, 'cursos', false, 'manaxer-v1', '<!-- manaxer-v1 -->',
 '["nombre","fecha_vencimiento"]'::jsonb, true,
 $html$<img src="https://www.gestionglobal.ar/email/dgg220-vencida.png" alt="¿Se te venció la matrícula? · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 14px;">Tu matrícula venció el <strong>{{fecha_vencimiento}}</strong>. Si todavía no la regularizaste, quedate tranquilo: entre tantos vencimientos, le pasa a muchos administradores. Lo importante es que tiene solución, y más simple de lo que parece.</p><p style="margin:0 0 14px;">Para volver a estar al día necesitás ponerte al día con el <strong>curso de actualización</strong> y gestionar la <strong>renovación de la matrícula</strong>. Las dos cosas, en un solo lugar.</p><p style="margin:0 0 16px;">El curso es el <strong>Curso de Actualización de FUNDPLATA</strong>, coordinado académicamente por Gestión Global: lo hacés desde el campus virtual, a tu ritmo, con contenidos pensados para profesionales y <strong>certificado oficial</strong> al terminar.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#0B1F33;">Nos encargamos de <strong>ordenar tu situación de principio a fin</strong>: el curso, el certificado y el trámite ante el RPAC. Vos empezás; del resto nos ocupamos nosotros.</td></tr></table><p style="margin:0;">Regularizar hoy es sacarte un peso de encima. Somos aliados de tu tiempo — también cuando el tiempo se pasó.</p>$html$),

-- ===================== E4 · Campus + certificado (GG) =====================
('captacion-campus', 'Captación · Campus + certificado (GG)',
 'DGG-220: bondad plataforma — campus virtual + certificado.',
 'Capacitate, diferenciate: campus con certificado',
 '', '', '#009ECA', 'Conocer el campus', 'https://gestionglobal.ar/?origen=prospecto',
 'Aliados de tu tiempo.', true, 'cursos', false, 'manaxer-v1', '<!-- manaxer-v1 -->',
 '["nombre"]'::jsonb, true,
 $html$<img src="https://www.gestionglobal.ar/email/dgg220-campus.png" alt="Campus virtual · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 14px;">Administrar consorcios hoy es una profesión que exige estar a la altura: normativa que cambia, clientes más informados, decisiones que no admiten improvisación. Vos ya lo sabés, porque lo vivís todos los días.</p><p style="margin:0 0 16px;">Por eso creamos el <strong>Campus Virtual de Gestión Global</strong>: formación teórico-práctica pensada a la medida del administrador profesional. 100% online, a tu ritmo y desde donde estés, sin resignar la profundidad que el oficio merece.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#0B1F33;">Al terminar cada capacitación recibís tu <strong>certificado oficial</strong>: un respaldo concreto que suma a tu trayectoria y que tus consorcios valoran.</td></tr></table><p style="margin:0;">Capacitarte no es un trámite más: es la forma más directa de <strong>elevar tu práctica y diferenciarte</strong>. Nosotros te damos las herramientas; el diferencial lo ponés vos.</p>$html$),

-- ===================== E5 · Agenda de vencimientos (GG) · reusa banner DGG-219 =====================
('captacion-agenda', 'Captación · Agenda de vencimientos (GG)',
 'DGG-220: bondad plataforma — agenda personalizada + recordatorios.',
 'Nunca más un vencimiento librado a tu memoria',
 '', '', '#009ECA', 'Quiero mi agenda', 'https://gestionglobal.ar/?origen=prospecto',
 'Aliados de tu tiempo.', true, 'cursos', false, 'manaxer-v1', '<!-- manaxer-v1 -->',
 '["nombre"]'::jsonb, true,
 $html$<img src="https://www.gestionglobal.ar/email/dgg219-banner.png" alt="Mi agenda de vencimientos profesionales · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 14px;">Entre consorcios, reuniones, proveedores y urgencias, el día del administrador no da respiro. Y en medio de tanto, lo importante no puede quedar librado a la memoria.</p><p style="margin:0 0 16px;">Para eso está tu plataforma de <strong>Gestión Global</strong>: te armamos tu <strong>agenda personalizada de vencimientos profesionales</strong> y te avisamos a tiempo —por mail, en tu portal y en tu teléfono— para que nunca llegues tarde.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#0B1F33;"><strong>Renovación de matrícula · DDJJ anual · Curso de actualización.</strong> Cada fecha clave, cargada, ordenada y con recordatorios automáticos. Vos ocupate de administrar; de las fechas nos ocupamos nosotros.</td></tr></table><p style="margin:0;">Porque estar al día no debería costarte una sola noche de insomnio. Somos aliados de tu tiempo: lo cuidamos como lo cuidás vos.</p>$html$),

-- ===================== E6 · Seguimiento de trámites (GG) =====================
('captacion-tramites', 'Captación · Seguimiento de trámites (GG)',
 'DGG-220: bondad plataforma — seguimiento de trámites en tiempo real.',
 '{{nombre}}, nunca más preguntes cómo va tu trámite',
 '', '', '#009ECA', 'Ver la plataforma', 'https://gestionglobal.ar/?origen=prospecto',
 'Aliados de tu tiempo.', true, 'cursos', false, 'manaxer-v1', '<!-- manaxer-v1 -->',
 '["nombre"]'::jsonb, true,
 $html$<img src="https://www.gestionglobal.ar/email/dgg220-tramites.png" alt="Seguí cada trámite en tiempo real · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 14px;">Entre la renovación de matrícula, las DDJJ, los certificados y las mil gestiones del día, saber en qué anda cada trámite no debería depender de un llamado ni de tu memoria.</p><p style="margin:0 0 16px;">Con Gestión Global ves cada gestión <strong>en tiempo real, desde tu portal</strong>: en qué etapa está, qué paso falta y cómo viene avanzando. Y cuando algo se mueve —o necesita una acción tuya—, <strong>te avisamos a tiempo</strong>, sin que tengas que correr detrás de nadie.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#0B1F33;">Renovación, DDJJ, certificados y mucho más: <strong>todo en una sola pantalla</strong>, con el estado actualizado al instante. Transparencia total, cero incertidumbre.</td></tr></table><p style="margin:0;">Así entendemos ser aliados de tu tiempo: menos llamados para preguntar, más tranquilidad para administrar.</p>$html$),

-- ===================== E7 · Capacitaciones gratuitas (GG) =====================
('captacion-capacitaciones', 'Captación · Capacitaciones gratuitas (GG)',
 'DGG-220: bondad plataforma — capacitaciones/webinars gratuitos.',
 'Capacitaciones gratuitas, {{nombre}}: sumá valor',
 '', '', '#009ECA', 'Sumarme', 'https://gestionglobal.ar/?origen=prospecto',
 'Aliados de tu tiempo.', true, 'cursos', false, 'manaxer-v1', '<!-- manaxer-v1 -->',
 '["nombre"]'::jsonb, true,
 $html$<img src="https://www.gestionglobal.ar/email/dgg220-capacitaciones.png" alt="Formación profesional sin costo · Gestión Global" width="576" style="display:block;width:100%;max-width:576px;height:auto;border-radius:12px;margin:2px 0 22px;" /><p style="margin:0 0 14px;">Hola <strong>{{nombre}}</strong>,</p><p style="margin:0 0 14px;">Mantenerte actualizado es parte de ejercer bien la profesión. Pero la buena capacitación no siempre es accesible —ni en tiempo, ni en costo.</p><p style="margin:0 0 16px;">En Gestión Global creemos que crecer no debería tener precio. Por eso te damos acceso a <strong>capacitaciones y webinars gratuitos</strong>, pensados para administradores: novedades normativas, buenas prácticas y herramientas para tu día a día, de parte de quienes conocen el oficio.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#E7F1F9;border-left:4px solid #009ECA;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14.5px;line-height:1.6;color:#0B1F33;"><strong>Formación profesional sin costo</strong>, online y a tu ritmo. Sumate a una comunidad de administradores que comparten experiencia y se actualizan juntos.</td></tr></table><p style="margin:0;">Es nuestra manera de acompañarte: aliados de tu tiempo, también cuando se trata de seguir aprendiendo.</p>$html$)

ON CONFLICT (slug) DO UPDATE SET
  nombre=EXCLUDED.nombre, descripcion=EXCLUDED.descripcion, asunto=EXCLUDED.asunto,
  kicker=EXCLUDED.kicker, titulo_visual=EXCLUDED.titulo_visual, color_acento=EXCLUDED.color_acento,
  cta_text=EXCLUDED.cta_text, cta_url=EXCLUDED.cta_url, firma=EXCLUDED.firma,
  mostrar_logo=EXCLUDED.mostrar_logo, from_casilla=EXCLUDED.from_casilla,
  incluir_tabla_envio=EXCLUDED.incluir_tabla_envio, layout_version=EXCLUDED.layout_version,
  body_html=EXCLUDED.body_html, variables=EXCLUDED.variables, activo=EXCLUDED.activo,
  cuerpo_html_visual=EXCLUDED.cuerpo_html_visual, updated_at=now();
