-- 0301 · Eventos (Pablo): los emails de inscripción/recordatorio de eventos se
-- enviaban con From/Reply-To = webinar@gestionglobal.ar. Pablo pide enviarlos
-- desde la casilla GENERAL (contacto@gestionglobal.ar), que es la principal:
-- (a) evita confusión, (b) evita problemas de entrega — webinar@ dependía de
-- estar verificada como "send-as" en la cuenta de contacto@ (Gmail acepta en la
-- API pero puede no entregar si el alias no está alineado; ver dispatch-emails).
-- El `aliasFor('general')` de la edge fn cae al default = contacto@.
UPDATE public.email_templates
   SET from_casilla = 'general'
 WHERE from_casilla = 'webinar';
