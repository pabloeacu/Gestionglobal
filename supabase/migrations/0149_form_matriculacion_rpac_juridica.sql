-- ============================================================================
-- Mig 0149 · Crear formulario "Matriculación RPAC · Persona Jurídica":
--   (A) Nuevo formulario público con slug `matriculacion-rpac-juridica`,
--       categoria 'tramite'. Schema completo:
--         · Datos de la empresa: Razón social, CUIT, Representante legal
--           (nombre + DNI), Email, Celular + Domicilio legal descompuesto
--           (Calle, Nº, Piso, Depto, Localidad, Provincia, CP).
--         · Documentación requerida: Estatuto o contrato social (req),
--           Anexo societario (opcional), Comprobante de pago (req, voucher
--           100% lo exime).
--         · Observaciones (textarea opcional).
--   (B) Nuevo servicio `rpac_inscripcion_juridica` con la misma categoría
--       que Inscripción al RPAC (humana). Precio inicial 80.000 público y
--       cliente — luego se ajusta desde gerencia si corresponde. IVA 21
--       (mismo que el servicio humano).
--
-- Orden: form primero porque el check
-- private.servicios_check_formulario_slug() exige que el slug ya exista
-- como formulario para poder usarlo en servicios.formulario_publico_slug.
-- ============================================================================

DO $$
DECLARE
  v_cat uuid;
  v_servicio uuid;
  v_form_id uuid;
  v_humano_servicio_id constant uuid := 'ef903233-f87f-4240-8670-b4b333c74c32';
  v_schema jsonb;
BEGIN
  SELECT categoria_id INTO v_cat FROM public.servicios WHERE id = v_humano_servicio_id;

  v_schema := jsonb_build_object(
    'sections', jsonb_build_array(
      jsonb_build_object(
        'title', 'Datos de la empresa',
        'fields', jsonb_build_array(
          jsonb_build_object('name','razon_social','type','text','label','Razón social','required',true,'hint','Tal como figura en estatuto / contrato social.'),
          jsonb_build_object('name','cuit_persona_juridica','type','text','label','CUIT','required',true,'hint','11 dígitos sin guiones. Empieza con 30/33/34.'),
          jsonb_build_object('name','representante_legal_nombre','type','text','label','Nombre del representante legal','required',true),
          jsonb_build_object('name','representante_legal_dni','type','text','label','DNI del representante legal','required',true,'hint','Sin puntos ni guiones.'),
          jsonb_build_object('name','email','type','email','label','Correo electrónico','required',true,'placeholder','contacto@empresa.com'),
          jsonb_build_object('name','celular','type','tel','label','Celular','required',true,'hint','Incluí característica con el 9 (móvil).','placeholder','+54 11 5555-1234'),
          jsonb_build_object('name','calle','type','text','label','Calle','required',true),
          jsonb_build_object('name','numero','type','text','label','Número','required',true),
          jsonb_build_object('name','piso','type','text','label','Piso','required',false),
          jsonb_build_object('name','departamento','type','text','label','Departamento','required',false),
          jsonb_build_object('name','localidad','type','text','label','Localidad','required',true),
          jsonb_build_object('name','provincia','type','text','label','Provincia','required',true),
          jsonb_build_object('name','codigo_postal','type','text','label','Código postal','required',true)
        )
      ),
      jsonb_build_object(
        'title', 'Documentación requerida',
        'fields', jsonb_build_array(
          jsonb_build_object('name','documentacion_societaria','type','file','label','Estatuto o contrato social','required',true,'hint','Adjuntá el estatuto vigente o el contrato social inscripto en IGJ / Registro Público.'),
          jsonb_build_object('name','anexo_societario','type','file','label','Anexo societario (opcional)','required',false,'hint','Si tu documentación societaria viene en hojas separadas (acta de directorio, designación de autoridades, modificaciones recientes), subilas acá como un único archivo.'),
          jsonb_build_object('name','comprobante_pago_inscripcion','type','file','label','Comprobante de pago de la inscripción','required',true,'hint','Transferencia, Mercado Pago o depósito a nombre de Gestión Global. Si vas a usar un voucher 100% lo podés ingresar en la sección "Voucher" y este campo se omitirá automáticamente.')
        )
      ),
      jsonb_build_object(
        'title', 'Observaciones',
        'fields', jsonb_build_array(
          jsonb_build_object('name','observaciones','type','textarea','label','Observaciones / Comentarios','required',false,'hint','Cualquier dato adicional que quieras dejar registrado para la gestión del trámite.')
        )
      )
    ),
    'submit_label', 'Enviar inscripción',
    'post_submit', jsonb_build_object(
      'message', '¡Gracias! Recibimos tu inscripción. Te vamos a contactar en breve para coordinar los próximos pasos.',
      'redirect_url', NULL
    )
  );

  INSERT INTO public.formularios (
    slug, titulo, descripcion, categoria,
    schema, publico, activo,
    servicio_id, exige_aceptacion_terminos,
    mensaje_confirmacion, orden
  )
  VALUES (
    'matriculacion-rpac-juridica',
    'Inscripción al RPAC · Persona Jurídica',
    'Trámite de matriculación inicial ante el RPAC para sociedades y empresas. Adjuntá la documentación societaria y el comprobante de pago.',
    'tramite',
    v_schema,
    true, true,
    NULL, true,
    '¡Gracias! Recibimos tu inscripción. Te vamos a contactar en breve para coordinar los próximos pasos.',
    11
  )
  RETURNING id INTO v_form_id;

  INSERT INTO public.servicios (
    categoria_id, codigo, nombre, descripcion,
    precio_modo, precio_publico, precio_cliente, iva_alicuota,
    requiere_administracion, requiere_consorcio,
    habilita_campus, habilitado_formulario_publico, formulario_publico_slug,
    activo, orden, observaciones
  )
  VALUES (
    v_cat,
    'rpac_inscripcion_juridica',
    'Inscripción al RPAC · Persona Jurídica',
    'Trámite de matriculación inicial ante el RPAC para sociedades / empresas.',
    'fijo', 80000.00, 80000.00, '21',
    true, false,
    false, true, 'matriculacion-rpac-juridica',
    true, 11, NULL
  )
  RETURNING id INTO v_servicio;

  UPDATE public.formularios SET servicio_id = v_servicio WHERE id = v_form_id;
END $$;
