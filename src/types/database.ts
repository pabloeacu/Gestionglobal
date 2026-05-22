export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accesos_externos: {
        Row: {
          created_at: string
          created_by: string | null
          email_destinatario: string
          nombre_destinatario: string | null
          observaciones: string | null
          recurso_id: string
          recurso_tipo: string
          revocado_at: string | null
          token: string
          total_visitas: number
          ultima_visita_at: string | null
          usado_at: string | null
          vence_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email_destinatario: string
          nombre_destinatario?: string | null
          observaciones?: string | null
          recurso_id: string
          recurso_tipo: string
          revocado_at?: string | null
          token: string
          total_visitas?: number
          ultima_visita_at?: string | null
          usado_at?: string | null
          vence_at: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email_destinatario?: string
          nombre_destinatario?: string | null
          observaciones?: string | null
          recurso_id?: string
          recurso_tipo?: string
          revocado_at?: string | null
          token?: string
          total_visitas?: number
          ultima_visita_at?: string | null
          usado_at?: string | null
          vence_at?: string
        }
        Relationships: []
      }
      accesos_externos_log: {
        Row: {
          abierto_at: string
          id: string
          ip: string | null
          token: string
          user_agent: string | null
        }
        Insert: {
          abierto_at?: string
          id?: string
          ip?: string | null
          token: string
          user_agent?: string | null
        }
        Update: {
          abierto_at?: string
          id?: string
          ip?: string | null
          token?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      administracion_emails: {
        Row: {
          activo: boolean
          administracion_id: string
          created_at: string
          email: string
          es_principal: boolean
          id: string
          nota: string | null
          recibe_cobranzas: boolean
          recibe_facturacion: boolean
          recibe_tramites: boolean
          updated_at: string
        }
        Insert: {
          activo?: boolean
          administracion_id: string
          created_at?: string
          email: string
          es_principal?: boolean
          id?: string
          nota?: string | null
          recibe_cobranzas?: boolean
          recibe_facturacion?: boolean
          recibe_tramites?: boolean
          updated_at?: string
        }
        Update: {
          activo?: boolean
          administracion_id?: string
          created_at?: string
          email?: string
          es_principal?: boolean
          id?: string
          nota?: string | null
          recibe_cobranzas?: boolean
          recibe_facturacion?: boolean
          recibe_tramites?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "administracion_emails_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
        ]
      }
      administraciones: {
        Row: {
          activo: boolean
          codigo: string
          codigo_postal: string | null
          condicion_iva: string | null
          convenio: string | null
          created_at: string
          created_by: string | null
          cuit: string | null
          descuento_porc: number
          direccion: string | null
          domicilio_fiscal: string | null
          email: string | null
          estado: string
          foto_url: string | null
          horarios: string | null
          id: string
          localidad: string | null
          matricula_rpa: string | null
          matricula_rpa_fecha: string | null
          matricula_rpa_vencimiento: string | null
          matricula_rpac: string | null
          matricula_rpac_fecha: string | null
          matricula_rpac_vencimiento: string | null
          nombre: string
          nombre_normalizado: string
          observaciones: string | null
          origen: string | null
          provincia: string | null
          responsable_apellido: string | null
          responsable_nombre: string | null
          telefono: string | null
          updated_at: string
          user_id: string | null
          whatsapp: string | null
        }
        Insert: {
          activo?: boolean
          codigo: string
          codigo_postal?: string | null
          condicion_iva?: string | null
          convenio?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          descuento_porc?: number
          direccion?: string | null
          domicilio_fiscal?: string | null
          email?: string | null
          estado?: string
          foto_url?: string | null
          horarios?: string | null
          id?: string
          localidad?: string | null
          matricula_rpa?: string | null
          matricula_rpa_fecha?: string | null
          matricula_rpa_vencimiento?: string | null
          matricula_rpac?: string | null
          matricula_rpac_fecha?: string | null
          matricula_rpac_vencimiento?: string | null
          nombre: string
          nombre_normalizado: string
          observaciones?: string | null
          origen?: string | null
          provincia?: string | null
          responsable_apellido?: string | null
          responsable_nombre?: string | null
          telefono?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          activo?: boolean
          codigo?: string
          codigo_postal?: string | null
          condicion_iva?: string | null
          convenio?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          descuento_porc?: number
          direccion?: string | null
          domicilio_fiscal?: string | null
          email?: string | null
          estado?: string
          foto_url?: string | null
          horarios?: string | null
          id?: string
          localidad?: string | null
          matricula_rpa?: string | null
          matricula_rpa_fecha?: string | null
          matricula_rpa_vencimiento?: string | null
          matricula_rpac?: string | null
          matricula_rpac_fecha?: string | null
          matricula_rpac_vencimiento?: string | null
          nombre?: string
          nombre_normalizado?: string
          observaciones?: string | null
          origen?: string | null
          provincia?: string | null
          responsable_apellido?: string | null
          responsable_nombre?: string | null
          telefono?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "administraciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_categories: {
        Row: {
          color: string
          created_at: string
          icon: string | null
          id: string
          is_system: boolean
          name: string
          orden: number
          owner_id: string
          updated_at: string
        }
        Insert: {
          color: string
          created_at?: string
          icon?: string | null
          id?: string
          is_system?: boolean
          name: string
          orden?: number
          owner_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          icon?: string | null
          id?: string
          is_system?: boolean
          name?: string
          orden?: number
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_categories_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_event_overrides: {
        Row: {
          created_at: string
          done_at: string | null
          id: string
          new_end_at: string | null
          new_start_at: string | null
          original_date: string
          parent_id: string
          status: string
        }
        Insert: {
          created_at?: string
          done_at?: string | null
          id?: string
          new_end_at?: string | null
          new_start_at?: string | null
          original_date: string
          parent_id: string
          status: string
        }
        Update: {
          created_at?: string
          done_at?: string | null
          id?: string
          new_end_at?: string | null
          new_start_at?: string | null
          original_date?: string
          parent_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_event_overrides_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "agenda_events"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_eventos: {
        Row: {
          cancelado_at: string | null
          categoria: string
          cliente_id: string | null
          completado_at: string | null
          created_at: string
          created_by: string | null
          descripcion: string | null
          fecha_fin: string | null
          fecha_inicio: string
          id: string
          origen: string
          prioridad: string
          recordatorio_enviado_at: string | null
          recordatorio_minutos_antes: number
          responsable_id: string | null
          servicio_id: string | null
          titulo: string
          todo_el_dia: boolean
          tramite_id: string | null
          updated_at: string
          vencimiento_id: string | null
        }
        Insert: {
          cancelado_at?: string | null
          categoria?: string
          cliente_id?: string | null
          completado_at?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          fecha_fin?: string | null
          fecha_inicio: string
          id?: string
          origen?: string
          prioridad?: string
          recordatorio_enviado_at?: string | null
          recordatorio_minutos_antes?: number
          responsable_id?: string | null
          servicio_id?: string | null
          titulo: string
          todo_el_dia?: boolean
          tramite_id?: string | null
          updated_at?: string
          vencimiento_id?: string | null
        }
        Update: {
          cancelado_at?: string | null
          categoria?: string
          cliente_id?: string | null
          completado_at?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string
          id?: string
          origen?: string
          prioridad?: string
          recordatorio_enviado_at?: string | null
          recordatorio_minutos_antes?: number
          responsable_id?: string | null
          servicio_id?: string | null
          titulo?: string
          todo_el_dia?: boolean
          tramite_id?: string | null
          updated_at?: string
          vencimiento_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agenda_eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_eventos_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_eventos_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_eventos_vencimiento_id_fkey"
            columns: ["vencimiento_id"]
            isOneToOne: false
            referencedRelation: "vencimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_events: {
        Row: {
          all_day: boolean
          category_id: string | null
          color_override: string | null
          created_at: string
          done_at: string | null
          end_at: string | null
          id: string
          is_done: boolean
          linked_administracion_id: string | null
          linked_comprobante_id: string | null
          linked_consorcio_ids: string[]
          linked_tramite_id: string | null
          notes: string | null
          owner_id: string
          priority: string
          recurrence: string
          recurrence_monthday: number | null
          recurrence_until: string | null
          recurrence_weekdays: number[] | null
          reminder_offsets: number[]
          start_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          category_id?: string | null
          color_override?: string | null
          created_at?: string
          done_at?: string | null
          end_at?: string | null
          id?: string
          is_done?: boolean
          linked_administracion_id?: string | null
          linked_comprobante_id?: string | null
          linked_consorcio_ids?: string[]
          linked_tramite_id?: string | null
          notes?: string | null
          owner_id: string
          priority?: string
          recurrence?: string
          recurrence_monthday?: number | null
          recurrence_until?: string | null
          recurrence_weekdays?: number[] | null
          reminder_offsets?: number[]
          start_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          category_id?: string | null
          color_override?: string | null
          created_at?: string
          done_at?: string | null
          end_at?: string | null
          id?: string
          is_done?: boolean
          linked_administracion_id?: string | null
          linked_comprobante_id?: string | null
          linked_consorcio_ids?: string[]
          linked_tramite_id?: string | null
          notes?: string | null
          owner_id?: string
          priority?: string
          recurrence?: string
          recurrence_monthday?: number | null
          recurrence_until?: string | null
          recurrence_weekdays?: number[] | null
          reminder_offsets?: number[]
          start_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_events_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "agenda_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agenda_events_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agenda_reminders_log: {
        Row: {
          event_id: string
          id: number
          kind: string
          occurrence_date: string
          sent_at: string
        }
        Insert: {
          event_id: string
          id?: number
          kind: string
          occurrence_date: string
          sent_at?: string
        }
        Update: {
          event_id?: string
          id?: number
          kind?: string
          occurrence_date?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agenda_reminders_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "agenda_events"
            referencedColumns: ["id"]
          },
        ]
      }
      arca_anomalias: {
        Row: {
          created_at: string
          detalle: Json
          id: string
          resuelto_at: string | null
          resuelto_by: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          detalle?: Json
          id?: string
          resuelto_at?: string | null
          resuelto_by?: string | null
          tipo: string
        }
        Update: {
          created_at?: string
          detalle?: Json
          id?: string
          resuelto_at?: string | null
          resuelto_by?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "arca_anomalias_resuelto_by_fkey"
            columns: ["resuelto_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      arca_config: {
        Row: {
          ambiente: string
          cert_alias: string | null
          cert_b64: string | null
          cert_subido_at: string | null
          cert_valido_desde: string | null
          cert_valido_hasta: string | null
          created_at: string
          csr_b64: string | null
          csr_generado_at: string | null
          id: number
          key_b64: string | null
          punto_venta_default: number
          ultimo_test_at: string | null
          ultimo_test_latencia_ms: number | null
          ultimo_test_msg: string | null
          ultimo_test_ok: boolean | null
          updated_at: string
        }
        Insert: {
          ambiente?: string
          cert_alias?: string | null
          cert_b64?: string | null
          cert_subido_at?: string | null
          cert_valido_desde?: string | null
          cert_valido_hasta?: string | null
          created_at?: string
          csr_b64?: string | null
          csr_generado_at?: string | null
          id?: number
          key_b64?: string | null
          punto_venta_default?: number
          ultimo_test_at?: string | null
          ultimo_test_latencia_ms?: number | null
          ultimo_test_msg?: string | null
          ultimo_test_ok?: boolean | null
          updated_at?: string
        }
        Update: {
          ambiente?: string
          cert_alias?: string | null
          cert_b64?: string | null
          cert_subido_at?: string | null
          cert_valido_desde?: string | null
          cert_valido_hasta?: string | null
          created_at?: string
          csr_b64?: string | null
          csr_generado_at?: string | null
          id?: number
          key_b64?: string | null
          punto_venta_default?: number
          ultimo_test_at?: string | null
          ultimo_test_latencia_ms?: number | null
          ultimo_test_msg?: string | null
          ultimo_test_ok?: boolean | null
          updated_at?: string
        }
        Relationships: []
      }
      arca_emision_queue: {
        Row: {
          attempt: number
          cae: string | null
          cae_vencimiento: string | null
          comprobante_id: string
          created_at: string
          finished_at: string | null
          id: string
          last_error: string | null
          max_attempts: number
          request_xml: string | null
          response_xml: string | null
          scheduled_at: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          cae?: string | null
          cae_vencimiento?: string | null
          comprobante_id: string
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          request_xml?: string | null
          response_xml?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          cae?: string | null
          cae_vencimiento?: string | null
          comprobante_id?: string
          created_at?: string
          finished_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          request_xml?: string | null
          response_xml?: string | null
          scheduled_at?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "arca_emision_queue_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "arca_emision_queue_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
        ]
      }
      arca_tokens: {
        Row: {
          ambiente: string
          created_at: string
          expires_at: string
          id: string
          obtained_at: string
          service: string
          sign: string
          token: string
        }
        Insert: {
          ambiente: string
          created_at?: string
          expires_at: string
          id?: string
          obtained_at?: string
          service?: string
          sign: string
          token: string
        }
        Update: {
          ambiente?: string
          created_at?: string
          expires_at?: string
          id?: string
          obtained_at?: string
          service?: string
          sign?: string
          token?: string
        }
        Relationships: []
      }
      auditoria_cambios: {
        Row: {
          created_at: string
          diff: Json | null
          entidad: string
          entidad_id: string | null
          id: string
          operacion: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          diff?: Json | null
          entidad: string
          entidad_id?: string | null
          id?: string
          operacion: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          diff?: Json | null
          entidad?: string
          entidad_id?: string | null
          id?: string
          operacion?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "auditoria_cambios_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cajas: {
        Row: {
          activo: boolean
          alias: string | null
          banco_entidad: string | null
          cbu: string | null
          color: string | null
          created_at: string
          created_by: string | null
          icono: string | null
          id: string
          moneda: string
          nombre: string
          numero_cuenta: string | null
          observaciones: string | null
          orden: number
          tipo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          alias?: string | null
          banco_entidad?: string | null
          cbu?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          icono?: string | null
          id?: string
          moneda?: string
          nombre: string
          numero_cuenta?: string | null
          observaciones?: string | null
          orden?: number
          tipo: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          alias?: string | null
          banco_entidad?: string | null
          cbu?: string | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          icono?: string | null
          id?: string
          moneda?: string
          nombre?: string
          numero_cuenta?: string | null
          observaciones?: string | null
          orden?: number
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cajas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_finanzas: {
        Row: {
          activo: boolean
          color: string | null
          created_at: string
          created_by: string | null
          icono: string | null
          id: string
          nombre: string
          tipo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          color?: string | null
          created_at?: string
          created_by?: string | null
          icono?: string | null
          id?: string
          nombre: string
          tipo: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          color?: string | null
          created_at?: string
          created_by?: string | null
          icono?: string | null
          id?: string
          nombre?: string
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_finanzas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_servicio: {
        Row: {
          activo: boolean
          codigo: string
          color: string | null
          created_at: string
          descripcion: string | null
          icono: string | null
          id: string
          nombre: string
          orden: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          codigo: string
          color?: string | null
          created_at?: string
          descripcion?: string | null
          icono?: string | null
          id?: string
          nombre: string
          orden?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          codigo?: string
          color?: string | null
          created_at?: string
          descripcion?: string | null
          icono?: string | null
          id?: string
          nombre?: string
          orden?: number
          updated_at?: string
        }
        Relationships: []
      }
      comprobante_avisos_vencimiento: {
        Row: {
          comprobante_id: string
          enviado_at: string
          sent_email_id: string | null
          umbral_dias: number
        }
        Insert: {
          comprobante_id: string
          enviado_at?: string
          sent_email_id?: string | null
          umbral_dias: number
        }
        Update: {
          comprobante_id?: string
          enviado_at?: string
          sent_email_id?: string | null
          umbral_dias?: number
        }
        Relationships: [
          {
            foreignKeyName: "comprobante_avisos_vencimiento_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobante_avisos_vencimiento_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "comprobante_avisos_vencimiento_sent_email_id_fkey"
            columns: ["sent_email_id"]
            isOneToOne: false
            referencedRelation: "sent_emails"
            referencedColumns: ["id"]
          },
        ]
      }
      comprobantes: {
        Row: {
          administracion_id: string
          arca_observaciones: Json | null
          arca_request_xml: string | null
          arca_response_xml: string | null
          cae: string | null
          cae_vencimiento: string | null
          comprobante_referencia_id: string | null
          concepto: string
          consorcio_id: string | null
          cotizacion: number
          created_at: string
          created_by: string | null
          email_enviado_at: string | null
          email_envios_count: number
          emitido_arca: boolean
          estado: string
          estado_cobranza: string
          exento: number
          fecha: string
          id: string
          impuestos_internos: number
          iva_105: number
          iva_21: number
          iva_27: number
          lote_id: string | null
          moneda: string
          motivo_nc: string | null
          motivo_rechazo: string | null
          neto: number
          no_gravado: number
          numero: number | null
          observaciones: string | null
          origen: string
          pdf_url: string | null
          periodo: string
          punto_venta: number
          receptor_condicion_iva: string
          receptor_doc_tipo_enviado: number | null
          receptor_domicilio: string | null
          receptor_numero_documento: string
          receptor_razon_social: string
          receptor_tipo_documento: string
          saldo_pendiente: number
          servicio_id: string | null
          tipo: string
          total: number
          total_iva: number
          updated_at: string
          vencimiento: string | null
        }
        Insert: {
          administracion_id: string
          arca_observaciones?: Json | null
          arca_request_xml?: string | null
          arca_response_xml?: string | null
          cae?: string | null
          cae_vencimiento?: string | null
          comprobante_referencia_id?: string | null
          concepto?: string
          consorcio_id?: string | null
          cotizacion?: number
          created_at?: string
          created_by?: string | null
          email_enviado_at?: string | null
          email_envios_count?: number
          emitido_arca?: boolean
          estado?: string
          estado_cobranza?: string
          exento?: number
          fecha?: string
          id?: string
          impuestos_internos?: number
          iva_105?: number
          iva_21?: number
          iva_27?: number
          lote_id?: string | null
          moneda?: string
          motivo_nc?: string | null
          motivo_rechazo?: string | null
          neto?: number
          no_gravado?: number
          numero?: number | null
          observaciones?: string | null
          origen?: string
          pdf_url?: string | null
          periodo?: string
          punto_venta: number
          receptor_condicion_iva: string
          receptor_doc_tipo_enviado?: number | null
          receptor_domicilio?: string | null
          receptor_numero_documento: string
          receptor_razon_social: string
          receptor_tipo_documento: string
          saldo_pendiente?: number
          servicio_id?: string | null
          tipo: string
          total?: number
          total_iva?: number
          updated_at?: string
          vencimiento?: string | null
        }
        Update: {
          administracion_id?: string
          arca_observaciones?: Json | null
          arca_request_xml?: string | null
          arca_response_xml?: string | null
          cae?: string | null
          cae_vencimiento?: string | null
          comprobante_referencia_id?: string | null
          concepto?: string
          consorcio_id?: string | null
          cotizacion?: number
          created_at?: string
          created_by?: string | null
          email_enviado_at?: string | null
          email_envios_count?: number
          emitido_arca?: boolean
          estado?: string
          estado_cobranza?: string
          exento?: number
          fecha?: string
          id?: string
          impuestos_internos?: number
          iva_105?: number
          iva_21?: number
          iva_27?: number
          lote_id?: string | null
          moneda?: string
          motivo_nc?: string | null
          motivo_rechazo?: string | null
          neto?: number
          no_gravado?: number
          numero?: number | null
          observaciones?: string | null
          origen?: string
          pdf_url?: string | null
          periodo?: string
          punto_venta?: number
          receptor_condicion_iva?: string
          receptor_doc_tipo_enviado?: number | null
          receptor_domicilio?: string | null
          receptor_numero_documento?: string
          receptor_razon_social?: string
          receptor_tipo_documento?: string
          saldo_pendiente?: number
          servicio_id?: string | null
          tipo?: string
          total?: number
          total_iva?: number
          updated_at?: string
          vencimiento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comprobantes_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_comprobante_referencia_id_fkey"
            columns: ["comprobante_referencia_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_comprobante_referencia_id_fkey"
            columns: ["comprobante_referencia_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "comprobantes_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_facturacion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      config_global: {
        Row: {
          arca_intervalo_emision_seg: number
          codigo_postal: string | null
          condicion_iva: string
          created_at: string
          cuit: string | null
          domicilio_fiscal: string | null
          email_contacto: string | null
          email_remitente_nombre: string | null
          email_reply_to: string | null
          id: number
          localidad: string | null
          logo_url: string | null
          nombre_fantasia: string
          provincia: string | null
          proximo_dni_ficticio: number
          razon_social: string
          sitio_web: string | null
          telefono: string | null
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          arca_intervalo_emision_seg?: number
          codigo_postal?: string | null
          condicion_iva?: string
          created_at?: string
          cuit?: string | null
          domicilio_fiscal?: string | null
          email_contacto?: string | null
          email_remitente_nombre?: string | null
          email_reply_to?: string | null
          id?: number
          localidad?: string | null
          logo_url?: string | null
          nombre_fantasia?: string
          provincia?: string | null
          proximo_dni_ficticio?: number
          razon_social?: string
          sitio_web?: string | null
          telefono?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          arca_intervalo_emision_seg?: number
          codigo_postal?: string | null
          condicion_iva?: string
          created_at?: string
          cuit?: string | null
          domicilio_fiscal?: string | null
          email_contacto?: string | null
          email_remitente_nombre?: string | null
          email_reply_to?: string | null
          id?: number
          localidad?: string | null
          logo_url?: string | null
          nombre_fantasia?: string
          provincia?: string | null
          proximo_dni_ficticio?: number
          razon_social?: string
          sitio_web?: string | null
          telefono?: string | null
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      consorcios: {
        Row: {
          activo: boolean
          administracion_id: string
          baja_fecha: string | null
          baja_motivo: string | null
          bauleras: number
          cocheras: number
          codigo: string
          codigo_postal: string | null
          condicion_iva: string
          created_at: string
          created_by: string | null
          domicilio: string | null
          empleados: number
          facturar_con_cuit_administracion: boolean
          id: string
          localidad: string | null
          monto_abono: number
          nombre: string
          nombre_normalizado: string
          numero_documento: string
          observaciones: string | null
          provincia: string | null
          tipo_documento: string
          unidades_funcionales: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          administracion_id: string
          baja_fecha?: string | null
          baja_motivo?: string | null
          bauleras?: number
          cocheras?: number
          codigo: string
          codigo_postal?: string | null
          condicion_iva?: string
          created_at?: string
          created_by?: string | null
          domicilio?: string | null
          empleados?: number
          facturar_con_cuit_administracion?: boolean
          id?: string
          localidad?: string | null
          monto_abono?: number
          nombre: string
          nombre_normalizado: string
          numero_documento: string
          observaciones?: string | null
          provincia?: string | null
          tipo_documento: string
          unidades_funcionales?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          administracion_id?: string
          baja_fecha?: string | null
          baja_motivo?: string | null
          bauleras?: number
          cocheras?: number
          codigo?: string
          codigo_postal?: string | null
          condicion_iva?: string
          created_at?: string
          created_by?: string | null
          domicilio?: string | null
          empleados?: number
          facturar_con_cuit_administracion?: boolean
          id?: string
          localidad?: string | null
          monto_abono?: number
          nombre?: string
          nombre_normalizado?: string
          numero_documento?: string
          observaciones?: string | null
          provincia?: string | null
          tipo_documento?: string
          unidades_funcionales?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consorcios_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consorcios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_bibliografia: {
        Row: {
          archivo_url: string | null
          autor: string | null
          created_at: string
          curso_id: string
          descripcion: string | null
          id: string
          titulo: string
          url: string | null
        }
        Insert: {
          archivo_url?: string | null
          autor?: string | null
          created_at?: string
          curso_id: string
          descripcion?: string | null
          id?: string
          titulo: string
          url?: string | null
        }
        Update: {
          archivo_url?: string | null
          autor?: string | null
          created_at?: string
          curso_id?: string
          descripcion?: string | null
          id?: string
          titulo?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curso_bibliografia_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_clases: {
        Row: {
          created_at: string
          descripcion: string | null
          duracion_min: number | null
          id: string
          material_url: string | null
          modulo_id: string
          orden: number
          tipo: string
          titulo: string
          updated_at: string
          youtube_url: string | null
          zoom_fecha_hora: string | null
          zoom_url: string | null
        }
        Insert: {
          created_at?: string
          descripcion?: string | null
          duracion_min?: number | null
          id?: string
          material_url?: string | null
          modulo_id: string
          orden?: number
          tipo?: string
          titulo: string
          updated_at?: string
          youtube_url?: string | null
          zoom_fecha_hora?: string | null
          zoom_url?: string | null
        }
        Update: {
          created_at?: string
          descripcion?: string | null
          duracion_min?: number | null
          id?: string
          material_url?: string | null
          modulo_id?: string
          orden?: number
          tipo?: string
          titulo?: string
          updated_at?: string
          youtube_url?: string | null
          zoom_fecha_hora?: string | null
          zoom_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curso_clases_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "curso_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_condiciones_config: {
        Row: {
          activa: boolean
          automatica: boolean
          created_at: string
          curso_id: string
          etiqueta: string
          examen_id: string | null
          id: string
          obligatoria: boolean
          orden: number
          tipo: string
          updated_at: string
        }
        Insert: {
          activa?: boolean
          automatica?: boolean
          created_at?: string
          curso_id: string
          etiqueta: string
          examen_id?: string | null
          id?: string
          obligatoria?: boolean
          orden?: number
          tipo: string
          updated_at?: string
        }
        Update: {
          activa?: boolean
          automatica?: boolean
          created_at?: string
          curso_id?: string
          etiqueta?: string
          examen_id?: string | null
          id?: string
          obligatoria?: boolean
          orden?: number
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_condiciones_config_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_condiciones_config_examen_id_fkey"
            columns: ["examen_id"]
            isOneToOne: false
            referencedRelation: "curso_examenes"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_encuentro_asistencias: {
        Row: {
          encuentro_id: string
          id: string
          marcada_at: string
          marcada_por: string | null
          matricula_id: string
          presente: boolean
        }
        Insert: {
          encuentro_id: string
          id?: string
          marcada_at?: string
          marcada_por?: string | null
          matricula_id: string
          presente?: boolean
        }
        Update: {
          encuentro_id?: string
          id?: string
          marcada_at?: string
          marcada_por?: string | null
          matricula_id?: string
          presente?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "curso_encuentro_asistencias_encuentro_id_fkey"
            columns: ["encuentro_id"]
            isOneToOne: false
            referencedRelation: "curso_encuentros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_encuentro_asistencias_marcada_por_fkey"
            columns: ["marcada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_encuentro_asistencias_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "curso_matriculas"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_encuentros: {
        Row: {
          created_at: string
          curso_id: string
          descripcion: string | null
          fecha_hora: string | null
          id: string
          link_zoom: string | null
          orden: number
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          curso_id: string
          descripcion?: string | null
          fecha_hora?: string | null
          id?: string
          link_zoom?: string | null
          orden?: number
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          curso_id?: string
          descripcion?: string | null
          fecha_hora?: string | null
          id?: string
          link_zoom?: string | null
          orden?: number
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_encuentros_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_examenes: {
        Row: {
          created_at: string
          curso_id: string
          descripcion: string | null
          fecha_cierre: string | null
          fecha_habilitacion: string | null
          id: string
          intentos_max: number
          mezclar_preguntas: boolean
          modulo_id: string | null
          mostrar_resultados: boolean
          nota_aprobacion: number
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          curso_id: string
          descripcion?: string | null
          fecha_cierre?: string | null
          fecha_habilitacion?: string | null
          id?: string
          intentos_max?: number
          mezclar_preguntas?: boolean
          modulo_id?: string | null
          mostrar_resultados?: boolean
          nota_aprobacion?: number
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          curso_id?: string
          descripcion?: string | null
          fecha_cierre?: string | null
          fecha_habilitacion?: string | null
          id?: string
          intentos_max?: number
          mezclar_preguntas?: boolean
          modulo_id?: string | null
          mostrar_resultados?: boolean
          nota_aprobacion?: number
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_examenes_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_examenes_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "curso_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_matriculas: {
        Row: {
          administracion_id: string | null
          created_at: string
          curso_id: string
          estado: string
          id: string
          inscripto_at: string
          observaciones: string | null
          profile_id: string
          submission_origen: string | null
          updated_at: string
          vigencia_hasta: string | null
        }
        Insert: {
          administracion_id?: string | null
          created_at?: string
          curso_id: string
          estado?: string
          id?: string
          inscripto_at?: string
          observaciones?: string | null
          profile_id: string
          submission_origen?: string | null
          updated_at?: string
          vigencia_hasta?: string | null
        }
        Update: {
          administracion_id?: string | null
          created_at?: string
          curso_id?: string
          estado?: string
          id?: string
          inscripto_at?: string
          observaciones?: string | null
          profile_id?: string
          submission_origen?: string | null
          updated_at?: string
          vigencia_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curso_matriculas_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_matriculas_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_matriculas_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_matriculas_submission_origen_fkey"
            columns: ["submission_origen"]
            isOneToOne: false
            referencedRelation: "formulario_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_modulos: {
        Row: {
          created_at: string
          curso_id: string
          descripcion: string | null
          id: string
          orden: number
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          curso_id: string
          descripcion?: string | null
          id?: string
          orden?: number
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          curso_id?: string
          descripcion?: string | null
          id?: string
          orden?: number
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_modulos_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_opciones: {
        Row: {
          correcta: boolean
          created_at: string
          id: string
          orden: number
          pregunta_id: string
          retroalimentacion: string | null
          texto: string
        }
        Insert: {
          correcta?: boolean
          created_at?: string
          id?: string
          orden?: number
          pregunta_id: string
          retroalimentacion?: string | null
          texto: string
        }
        Update: {
          correcta?: boolean
          created_at?: string
          id?: string
          orden?: number
          pregunta_id?: string
          retroalimentacion?: string | null
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_opciones_pregunta_id_fkey"
            columns: ["pregunta_id"]
            isOneToOne: false
            referencedRelation: "curso_preguntas"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_preguntas: {
        Row: {
          created_at: string
          enunciado: string
          examen_id: string
          id: string
          orden: number
          puntaje: number
          tipo: string
        }
        Insert: {
          created_at?: string
          enunciado: string
          examen_id: string
          id?: string
          orden?: number
          puntaje?: number
          tipo?: string
        }
        Update: {
          created_at?: string
          enunciado?: string
          examen_id?: string
          id?: string
          orden?: number
          puntaje?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_preguntas_examen_id_fkey"
            columns: ["examen_id"]
            isOneToOne: false
            referencedRelation: "curso_examenes"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_progreso: {
        Row: {
          clase_id: string
          completada: boolean
          completada_at: string | null
          created_at: string
          id: string
          matricula_id: string
        }
        Insert: {
          clase_id: string
          completada?: boolean
          completada_at?: string | null
          created_at?: string
          id?: string
          matricula_id: string
        }
        Update: {
          clase_id?: string
          completada?: boolean
          completada_at?: string | null
          created_at?: string
          id?: string
          matricula_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_progreso_clase_id_fkey"
            columns: ["clase_id"]
            isOneToOne: false
            referencedRelation: "curso_clases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_progreso_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "curso_matriculas"
            referencedColumns: ["id"]
          },
        ]
      }
      cursos: {
        Row: {
          activo: boolean
          banner_url: string | null
          categoria: string | null
          created_at: string
          created_by: string | null
          cupo_max: number | null
          descripcion: string | null
          descripcion_html: string | null
          duracion_horas: number | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          instructor_bio: string | null
          instructor_nombre: string | null
          modalidad: string
          observaciones: string | null
          precio_lista: number | null
          requisitos_html: string | null
          slug: string
          titulo: string
          updated_at: string
          vigencia_meses: number
        }
        Insert: {
          activo?: boolean
          banner_url?: string | null
          categoria?: string | null
          created_at?: string
          created_by?: string | null
          cupo_max?: number | null
          descripcion?: string | null
          descripcion_html?: string | null
          duracion_horas?: number | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          instructor_bio?: string | null
          instructor_nombre?: string | null
          modalidad?: string
          observaciones?: string | null
          precio_lista?: number | null
          requisitos_html?: string | null
          slug: string
          titulo: string
          updated_at?: string
          vigencia_meses?: number
        }
        Update: {
          activo?: boolean
          banner_url?: string | null
          categoria?: string | null
          created_at?: string
          created_by?: string | null
          cupo_max?: number | null
          descripcion?: string | null
          descripcion_html?: string | null
          duracion_horas?: number | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          instructor_bio?: string | null
          instructor_nombre?: string | null
          modalidad?: string
          observaciones?: string | null
          precio_lista?: number | null
          requisitos_html?: string | null
          slug?: string
          titulo?: string
          updated_at?: string
          vigencia_meses?: number
        }
        Relationships: [
          {
            foreignKeyName: "cursos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dispatch_recupero_log: {
        Row: {
          corrida_at: string
          duracion_ms: number | null
          encolados: number
          errores: Json
          id: string
          procesados: number
        }
        Insert: {
          corrida_at?: string
          duracion_ms?: number | null
          encolados?: number
          errores?: Json
          id?: string
          procesados?: number
        }
        Update: {
          corrida_at?: string
          duracion_ms?: number | null
          encolados?: number
          errores?: Json
          id?: string
          procesados?: number
        }
        Relationships: []
      }
      dispatch_vencimientos_log: {
        Row: {
          canal: string | null
          corrida_at: string
          duracion_ms: number | null
          emails_encolados: number
          errores: Json
          id: string
          offset_dias: number | null
          resultado: string | null
          vencimiento_id: string | null
          vencimientos_procesados: number
        }
        Insert: {
          canal?: string | null
          corrida_at?: string
          duracion_ms?: number | null
          emails_encolados?: number
          errores?: Json
          id?: string
          offset_dias?: number | null
          resultado?: string | null
          vencimiento_id?: string | null
          vencimientos_procesados?: number
        }
        Update: {
          canal?: string | null
          corrida_at?: string
          duracion_ms?: number | null
          emails_encolados?: number
          errores?: Json
          id?: string
          offset_dias?: number | null
          resultado?: string | null
          vencimiento_id?: string | null
          vencimientos_procesados?: number
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_vencimientos_log_vencimiento_id_fkey"
            columns: ["vencimiento_id"]
            isOneToOne: false
            referencedRelation: "vencimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      email_plantillas: {
        Row: {
          activo: boolean
          color_acento: string
          created_at: string
          cta_label: string | null
          cta_url: string | null
          cuerpo: string
          firma: string | null
          id: string
          kicker: string
          mostrar_datos: boolean
          mostrar_logo: boolean
          tipo: string
          titulo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          color_acento?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          cuerpo?: string
          firma?: string | null
          id?: string
          kicker?: string
          mostrar_datos?: boolean
          mostrar_logo?: boolean
          tipo: string
          titulo?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          color_acento?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          cuerpo?: string
          firma?: string | null
          id?: string
          kicker?: string
          mostrar_datos?: boolean
          mostrar_logo?: boolean
          tipo?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_queue: {
        Row: {
          administracion_id: string | null
          attachments_jsonb: Json | null
          attempts: number
          cc_emails: string[]
          comprobante_id: string | null
          comprobante_ids: string[]
          consorcio_id: string | null
          created_at: string
          created_by: string | null
          enviado_at: string | null
          error_msg: string | null
          html_body: string | null
          id: string
          intento: number
          kind: string
          lote_id: string | null
          max_attempts: number
          max_intentos: number
          parte: number
          partes_total: number
          plantilla_tipo: string | null
          prioridad: number
          programado_para: string
          related_id: string | null
          related_table: string | null
          reply_to: string | null
          resend_id: string | null
          scheduled_at: string | null
          sending_started_at: string | null
          sent_at: string | null
          status: string
          subject: string | null
          template_slug: string | null
          to_email: string
          to_nombre: string | null
          ultimo_error: string | null
          updated_at: string
          variables: Json
          zip_size_bytes: number | null
        }
        Insert: {
          administracion_id?: string | null
          attachments_jsonb?: Json | null
          attempts?: number
          cc_emails?: string[]
          comprobante_id?: string | null
          comprobante_ids?: string[]
          consorcio_id?: string | null
          created_at?: string
          created_by?: string | null
          enviado_at?: string | null
          error_msg?: string | null
          html_body?: string | null
          id?: string
          intento?: number
          kind?: string
          lote_id?: string | null
          max_attempts?: number
          max_intentos?: number
          parte?: number
          partes_total?: number
          plantilla_tipo?: string | null
          prioridad?: number
          programado_para?: string
          related_id?: string | null
          related_table?: string | null
          reply_to?: string | null
          resend_id?: string | null
          scheduled_at?: string | null
          sending_started_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_slug?: string | null
          to_email: string
          to_nombre?: string | null
          ultimo_error?: string | null
          updated_at?: string
          variables?: Json
          zip_size_bytes?: number | null
        }
        Update: {
          administracion_id?: string | null
          attachments_jsonb?: Json | null
          attempts?: number
          cc_emails?: string[]
          comprobante_id?: string | null
          comprobante_ids?: string[]
          consorcio_id?: string | null
          created_at?: string
          created_by?: string | null
          enviado_at?: string | null
          error_msg?: string | null
          html_body?: string | null
          id?: string
          intento?: number
          kind?: string
          lote_id?: string | null
          max_attempts?: number
          max_intentos?: number
          parte?: number
          partes_total?: number
          plantilla_tipo?: string | null
          prioridad?: number
          programado_para?: string
          related_id?: string | null
          related_table?: string | null
          reply_to?: string | null
          resend_id?: string | null
          scheduled_at?: string | null
          sending_started_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          template_slug?: string | null
          to_email?: string
          to_nombre?: string | null
          ultimo_error?: string | null
          updated_at?: string
          variables?: Json
          zip_size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_queue_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "email_queue_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_facturacion"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_queue_template_slug_fkey"
            columns: ["template_slug"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["slug"]
          },
        ]
      }
      email_templates: {
        Row: {
          activo: boolean
          asunto: string
          body_html: string
          body_text: string | null
          created_at: string
          descripcion: string | null
          from_casilla: string
          id: string
          nombre: string
          reply_to: string | null
          slug: string
          updated_at: string
          variables: Json
        }
        Insert: {
          activo?: boolean
          asunto: string
          body_html: string
          body_text?: string | null
          created_at?: string
          descripcion?: string | null
          from_casilla?: string
          id?: string
          nombre: string
          reply_to?: string | null
          slug: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          activo?: boolean
          asunto?: string
          body_html?: string
          body_text?: string | null
          created_at?: string
          descripcion?: string | null
          from_casilla?: string
          id?: string
          nombre?: string
          reply_to?: string | null
          slug?: string
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      email_throttle: {
        Row: {
          key: string
          last_sent_at: string
          updated_at: string
        }
        Insert: {
          key: string
          last_sent_at?: string
          updated_at?: string
        }
        Update: {
          key?: string
          last_sent_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      examen_intentos: {
        Row: {
          aprobado: boolean | null
          examen_id: string
          id: string
          iniciado_at: string
          intento: number
          matricula_id: string
          nota: number | null
          respuestas: Json
          terminado_at: string | null
        }
        Insert: {
          aprobado?: boolean | null
          examen_id: string
          id?: string
          iniciado_at?: string
          intento?: number
          matricula_id: string
          nota?: number | null
          respuestas?: Json
          terminado_at?: string | null
        }
        Update: {
          aprobado?: boolean | null
          examen_id?: string
          id?: string
          iniciado_at?: string
          intento?: number
          matricula_id?: string
          nota?: number | null
          respuestas?: Json
          terminado_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "examen_intentos_examen_id_fkey"
            columns: ["examen_id"]
            isOneToOne: false
            referencedRelation: "curso_examenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "examen_intentos_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "curso_matriculas"
            referencedColumns: ["id"]
          },
        ]
      }
      formulario_adjuntos: {
        Row: {
          field_name: string
          filename_original: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          submission_id: string
          uploaded_at: string
        }
        Insert: {
          field_name: string
          filename_original: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          submission_id: string
          uploaded_at?: string
        }
        Update: {
          field_name?: string
          filename_original?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          submission_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "formulario_adjuntos_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "formulario_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      formulario_submissions: {
        Row: {
          administracion_id: string | null
          comprobante_id: string | null
          created_at: string
          cuit_detectado: string | null
          datos: Json
          email_contacto: string | null
          estado: string
          formulario_id: string
          id: string
          ip_address: unknown
          nombre_contacto: string | null
          observaciones_internas: string | null
          origen: string
          procesado_at: string | null
          procesado_por: string | null
          referer_url: string | null
          telefono_contacto: string | null
          tipo_persona: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          administracion_id?: string | null
          comprobante_id?: string | null
          created_at?: string
          cuit_detectado?: string | null
          datos: Json
          email_contacto?: string | null
          estado?: string
          formulario_id: string
          id?: string
          ip_address?: unknown
          nombre_contacto?: string | null
          observaciones_internas?: string | null
          origen?: string
          procesado_at?: string | null
          procesado_por?: string | null
          referer_url?: string | null
          telefono_contacto?: string | null
          tipo_persona?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          administracion_id?: string | null
          comprobante_id?: string | null
          created_at?: string
          cuit_detectado?: string | null
          datos?: Json
          email_contacto?: string | null
          estado?: string
          formulario_id?: string
          id?: string
          ip_address?: unknown
          nombre_contacto?: string | null
          observaciones_internas?: string | null
          origen?: string
          procesado_at?: string | null
          procesado_por?: string | null
          referer_url?: string | null
          telefono_contacto?: string | null
          tipo_persona?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "formulario_submissions_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_submissions_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_submissions_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "formulario_submissions_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formularios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formulario_submissions_procesado_por_fkey"
            columns: ["procesado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      formulario_versiones: {
        Row: {
          formulario_id: string
          guardado_at: string
          guardado_por: string | null
          id: string
          schema: Json
          version_num: number
        }
        Insert: {
          formulario_id: string
          guardado_at?: string
          guardado_por?: string | null
          id?: string
          schema: Json
          version_num: number
        }
        Update: {
          formulario_id?: string
          guardado_at?: string
          guardado_por?: string | null
          id?: string
          schema?: Json
          version_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "formulario_versiones_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formularios"
            referencedColumns: ["id"]
          },
        ]
      }
      formularios: {
        Row: {
          activo: boolean
          categoria: string
          cierre_at: string | null
          created_at: string
          created_by: string | null
          descripcion: string | null
          excel_modelo_url: string | null
          exige_aceptacion_terminos: boolean
          hero_imagen_url: string | null
          id: string
          mensaje_confirmacion: string
          notificar_a_emails: string[]
          orden: number
          pdf_descargable_url: string | null
          publico: boolean
          redirect_url_after: string | null
          schema: Json
          schema_draft: Json | null
          schema_draft_at: string | null
          servicio_id: string | null
          slug: string
          textos_legales: string | null
          titulo: string
          total_envios: number
          updated_at: string
          version_actual: number
        }
        Insert: {
          activo?: boolean
          categoria: string
          cierre_at?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          excel_modelo_url?: string | null
          exige_aceptacion_terminos?: boolean
          hero_imagen_url?: string | null
          id?: string
          mensaje_confirmacion?: string
          notificar_a_emails?: string[]
          orden?: number
          pdf_descargable_url?: string | null
          publico?: boolean
          redirect_url_after?: string | null
          schema: Json
          schema_draft?: Json | null
          schema_draft_at?: string | null
          servicio_id?: string | null
          slug: string
          textos_legales?: string | null
          titulo: string
          total_envios?: number
          updated_at?: string
          version_actual?: number
        }
        Update: {
          activo?: boolean
          categoria?: string
          cierre_at?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          excel_modelo_url?: string | null
          exige_aceptacion_terminos?: boolean
          hero_imagen_url?: string | null
          id?: string
          mensaje_confirmacion?: string
          notificar_a_emails?: string[]
          orden?: number
          pdf_descargable_url?: string | null
          publico?: boolean
          redirect_url_after?: string | null
          schema?: Json
          schema_draft?: Json | null
          schema_draft_at?: string | null
          servicio_id?: string | null
          slug?: string
          textos_legales?: string | null
          titulo?: string
          total_envios?: number
          updated_at?: string
          version_actual?: number
        }
        Relationships: [
          {
            foreignKeyName: "formularios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formularios_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      import_log: {
        Row: {
          archivo: string
          autor: string | null
          created_at: string
          errores: Json
          id: string
          insertados: number
          saltados: number
          total_filas: number
        }
        Insert: {
          archivo: string
          autor?: string | null
          created_at?: string
          errores?: Json
          id?: string
          insertados?: number
          saltados?: number
          total_filas?: number
        }
        Update: {
          archivo?: string
          autor?: string | null
          created_at?: string
          errores?: Json
          id?: string
          insertados?: number
          saltados?: number
          total_filas?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_log_autor_fkey"
            columns: ["autor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      items_comprobantes: {
        Row: {
          alicuota_iva: string
          bonificacion_porc: number
          cantidad: number
          comprobante_id: string
          consorcio_id: string | null
          created_at: string
          descripcion: string
          id: string
          iva: number
          orden: number
          precio_unitario: number
          servicio_id: string | null
          subtotal: number
          total: number
        }
        Insert: {
          alicuota_iva?: string
          bonificacion_porc?: number
          cantidad?: number
          comprobante_id: string
          consorcio_id?: string | null
          created_at?: string
          descripcion: string
          id?: string
          iva?: number
          orden?: number
          precio_unitario: number
          servicio_id?: string | null
          subtotal?: number
          total?: number
        }
        Update: {
          alicuota_iva?: string
          bonificacion_porc?: number
          cantidad?: number
          comprobante_id?: string
          consorcio_id?: string | null
          created_at?: string
          descripcion?: string
          id?: string
          iva?: number
          orden?: number
          precio_unitario?: number
          servicio_id?: string | null
          subtotal?: number
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "items_comprobantes_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_comprobantes_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "items_comprobantes_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_comprobantes_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      lotes_facturacion: {
        Row: {
          cerrado_at: string | null
          created_at: string
          created_by: string | null
          descripcion: string | null
          envio_estado: string | null
          estado: string
          id: string
          log: Json
          origen: string
          periodo: string
          total_anulados: number
          total_autorizados: number
          total_comprobantes: number
          total_fallidos: number
          updated_at: string
        }
        Insert: {
          cerrado_at?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          envio_estado?: string | null
          estado?: string
          id?: string
          log?: Json
          origen?: string
          periodo: string
          total_anulados?: number
          total_autorizados?: number
          total_comprobantes?: number
          total_fallidos?: number
          updated_at?: string
        }
        Update: {
          cerrado_at?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          envio_estado?: string | null
          estado?: string
          id?: string
          log?: Json
          origen?: string
          periodo?: string
          total_anulados?: number
          total_autorizados?: number
          total_comprobantes?: number
          total_fallidos?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lotes_facturacion_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      matricula_condiciones: {
        Row: {
          condicion_id: string
          created_at: string
          cumplida: boolean
          cumplida_at: string | null
          cumplida_por: string | null
          id: string
          matricula_id: string
          observaciones: string | null
          updated_at: string
        }
        Insert: {
          condicion_id: string
          created_at?: string
          cumplida?: boolean
          cumplida_at?: string | null
          cumplida_por?: string | null
          id?: string
          matricula_id: string
          observaciones?: string | null
          updated_at?: string
        }
        Update: {
          condicion_id?: string
          created_at?: string
          cumplida?: boolean
          cumplida_at?: string | null
          cumplida_por?: string | null
          id?: string
          matricula_id?: string
          observaciones?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matricula_condiciones_condicion_id_fkey"
            columns: ["condicion_id"]
            isOneToOne: false
            referencedRelation: "curso_condiciones_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matricula_condiciones_cumplida_por_fkey"
            columns: ["cumplida_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matricula_condiciones_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "curso_matriculas"
            referencedColumns: ["id"]
          },
        ]
      }
      movimiento_imputaciones: {
        Row: {
          administracion_id: string | null
          comprobante_id: string | null
          created_at: string
          created_by: string | null
          id: string
          monto_imputado: number
          movimiento_id: string
          nota: string | null
          updated_at: string
        }
        Insert: {
          administracion_id?: string | null
          comprobante_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          monto_imputado: number
          movimiento_id: string
          nota?: string | null
          updated_at?: string
        }
        Update: {
          administracion_id?: string | null
          comprobante_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          monto_imputado?: number
          movimiento_id?: string
          nota?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimiento_imputaciones_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_imputaciones_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_imputaciones_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "movimiento_imputaciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_imputaciones_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      movimientos: {
        Row: {
          adjunto_url: string | null
          administracion_id: string | null
          caja_id: string
          categoria_id: string | null
          comprobante_id: string | null
          consorcio_id: string | null
          created_at: string
          created_by: string | null
          descripcion: string | null
          estado: string
          fecha: string
          hash_dedup: string | null
          id: string
          monto: number
          motivo_pendiente: string | null
          movimiento_revertido_id: string | null
          origen: string
          partner_id_atribucion: string | null
          referencia: string | null
          revertido_at: string | null
          tipo: string
          transferencia_pair_id: string | null
          updated_at: string
        }
        Insert: {
          adjunto_url?: string | null
          administracion_id?: string | null
          caja_id: string
          categoria_id?: string | null
          comprobante_id?: string | null
          consorcio_id?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha?: string
          hash_dedup?: string | null
          id?: string
          monto: number
          motivo_pendiente?: string | null
          movimiento_revertido_id?: string | null
          origen?: string
          partner_id_atribucion?: string | null
          referencia?: string | null
          revertido_at?: string | null
          tipo: string
          transferencia_pair_id?: string | null
          updated_at?: string
        }
        Update: {
          adjunto_url?: string | null
          administracion_id?: string | null
          caja_id?: string
          categoria_id?: string | null
          comprobante_id?: string | null
          consorcio_id?: string | null
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha?: string
          hash_dedup?: string | null
          id?: string
          monto?: number
          motivo_pendiente?: string | null
          movimiento_revertido_id?: string | null
          origen?: string
          partner_id_atribucion?: string | null
          referencia?: string | null
          revertido_at?: string | null
          tipo?: string
          transferencia_pair_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas_con_saldo"
            referencedColumns: ["caja_id"]
          },
          {
            foreignKeyName: "movimientos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_finanzas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "movimientos_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_movimiento_revertido_id_fkey"
            columns: ["movimiento_revertido_id"]
            isOneToOne: false
            referencedRelation: "movimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimientos_partner_id_atribucion_fkey"
            columns: ["partner_id_atribucion"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      numeradores: {
        Row: {
          punto_venta: number
          tipo: string
          ultimo_numero: number
          updated_at: string
        }
        Insert: {
          punto_venta: number
          tipo: string
          ultimo_numero?: number
          updated_at?: string
        }
        Update: {
          punto_venta?: number
          tipo?: string
          ultimo_numero?: number
          updated_at?: string
        }
        Relationships: []
      }
      partner_atribuciones: {
        Row: {
          comprobante_id: string | null
          convenio_id: string
          created_at: string
          created_by: string | null
          id: string
          monto_atribuido: number
          monto_base: number
          movimiento_id: string | null
          observaciones: string | null
          partner_id: string
          porcentaje: number
          rendicion_id: string | null
          tipo: string
        }
        Insert: {
          comprobante_id?: string | null
          convenio_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          monto_atribuido: number
          monto_base: number
          movimiento_id?: string | null
          observaciones?: string | null
          partner_id: string
          porcentaje: number
          rendicion_id?: string | null
          tipo: string
        }
        Update: {
          comprobante_id?: string | null
          convenio_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          monto_atribuido?: number
          monto_base?: number
          movimiento_id?: string | null
          observaciones?: string | null
          partner_id?: string
          porcentaje?: number
          rendicion_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_atribuciones_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_atribuciones_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "partner_atribuciones_convenio_id_fkey"
            columns: ["convenio_id"]
            isOneToOne: false
            referencedRelation: "partner_convenios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_atribuciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_atribuciones_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_atribuciones_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_atribuciones_rendicion_id_fkey"
            columns: ["rendicion_id"]
            isOneToOne: false
            referencedRelation: "partner_rendiciones"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_convenios: {
        Row: {
          activo: boolean
          created_at: string
          created_by: string | null
          id: string
          moneda: string
          observaciones: string | null
          partner_id: string
          porc_costos: number
          porc_ingresos: number
          updated_at: string
          vigencia_desde: string
          vigencia_hasta: string | null
        }
        Insert: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          moneda?: string
          observaciones?: string | null
          partner_id: string
          porc_costos: number
          porc_ingresos: number
          updated_at?: string
          vigencia_desde: string
          vigencia_hasta?: string | null
        }
        Update: {
          activo?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          moneda?: string
          observaciones?: string | null
          partner_id?: string
          porc_costos?: number
          porc_ingresos?: number
          updated_at?: string
          vigencia_desde?: string
          vigencia_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_convenios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_convenios_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_rendiciones: {
        Row: {
          cancelada_at: string | null
          cancelada_por: string | null
          cerrada_at: string | null
          cerrada_por: string | null
          comprobante_id: string | null
          created_at: string
          created_by: string | null
          estado: string
          id: string
          motivo_cancelacion: string | null
          neto: number | null
          observaciones: string | null
          partner_id: string
          periodo_desde: string
          periodo_hasta: string
          total_costos_atribuidos: number
          total_costos_brutos: number
          total_ingresos_atribuidos: number
          total_ingresos_brutos: number
          updated_at: string
        }
        Insert: {
          cancelada_at?: string | null
          cancelada_por?: string | null
          cerrada_at?: string | null
          cerrada_por?: string | null
          comprobante_id?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          motivo_cancelacion?: string | null
          neto?: number | null
          observaciones?: string | null
          partner_id: string
          periodo_desde: string
          periodo_hasta: string
          total_costos_atribuidos?: number
          total_costos_brutos?: number
          total_ingresos_atribuidos?: number
          total_ingresos_brutos?: number
          updated_at?: string
        }
        Update: {
          cancelada_at?: string | null
          cancelada_por?: string | null
          cerrada_at?: string | null
          cerrada_por?: string | null
          comprobante_id?: string | null
          created_at?: string
          created_by?: string | null
          estado?: string
          id?: string
          motivo_cancelacion?: string | null
          neto?: number | null
          observaciones?: string | null
          partner_id?: string
          periodo_desde?: string
          periodo_hasta?: string
          total_costos_atribuidos?: number
          total_costos_brutos?: number
          total_ingresos_atribuidos?: number
          total_ingresos_brutos?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_rendiciones_cancelada_por_fkey"
            columns: ["cancelada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_rendiciones_cerrada_por_fkey"
            columns: ["cerrada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_rendiciones_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_rendiciones_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "partner_rendiciones_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_rendiciones_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          activo: boolean
          condicion_iva: string | null
          created_at: string
          created_by: string | null
          cuit: string | null
          domicilio: string | null
          email: string | null
          id: string
          nombre_legal: string
          observaciones: string | null
          slug: string
          telefono: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          condicion_iva?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          domicilio?: string | null
          email?: string | null
          id?: string
          nombre_legal: string
          observaciones?: string | null
          slug: string
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          condicion_iva?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          domicilio?: string | null
          email?: string | null
          id?: string
          nombre_legal?: string
          observaciones?: string | null
          slug?: string
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "partners_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      precio_audit: {
        Row: {
          accion: string
          autor: string | null
          created_at: string
          id: string
          monto_anterior: number | null
          monto_nuevo: number | null
          motivo: string | null
          servicio_id: string | null
          tabulador_precio_anterior_id: string | null
          tabulador_precio_nuevo_id: string | null
        }
        Insert: {
          accion: string
          autor?: string | null
          created_at?: string
          id?: string
          monto_anterior?: number | null
          monto_nuevo?: number | null
          motivo?: string | null
          servicio_id?: string | null
          tabulador_precio_anterior_id?: string | null
          tabulador_precio_nuevo_id?: string | null
        }
        Update: {
          accion?: string
          autor?: string | null
          created_at?: string
          id?: string
          monto_anterior?: number | null
          monto_nuevo?: number | null
          motivo?: string | null
          servicio_id?: string | null
          tabulador_precio_anterior_id?: string | null
          tabulador_precio_nuevo_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "precio_audit_autor_fkey"
            columns: ["autor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precio_audit_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precio_audit_tabulador_precio_anterior_id_fkey"
            columns: ["tabulador_precio_anterior_id"]
            isOneToOne: false
            referencedRelation: "tabulador_precios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "precio_audit_tabulador_precio_nuevo_id_fkey"
            columns: ["tabulador_precio_nuevo_id"]
            isOneToOne: false
            referencedRelation: "tabulador_precios"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          activo: boolean
          administracion_id: string | null
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          phone: string | null
          role: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          administracion_id?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          administracion_id?: string | null
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
        ]
      }
      push_notifications_queue: {
        Row: {
          click_url: string | null
          created_at: string
          cuerpo: string | null
          enviada_at: string | null
          error: string | null
          icono_url: string | null
          id: string
          intento: number
          max_intentos: number
          titulo: string
          user_id: string
        }
        Insert: {
          click_url?: string | null
          created_at?: string
          cuerpo?: string | null
          enviada_at?: string | null
          error?: string | null
          icono_url?: string | null
          id?: string
          intento?: number
          max_intentos?: number
          titulo: string
          user_id: string
        }
        Update: {
          click_url?: string | null
          created_at?: string
          cuerpo?: string | null
          enviada_at?: string | null
          error?: string | null
          icono_url?: string | null
          id?: string
          intento?: number
          max_intentos?: number
          titulo?: string
          user_id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys_auth: string
          keys_p256dh: string
          last_used_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys_auth: string
          keys_p256dh: string
          last_used_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys_auth?: string
          keys_p256dh?: string
          last_used_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      recupero_acciones: {
        Row: {
          administracion_id: string
          autor: string | null
          comprobante_id: string
          consorcio_id: string | null
          created_at: string
          dias_vencido: number | null
          email_queue_id: string | null
          enviado_at: string
          id: string
          monto_adeudado: number | null
          nivel: number
          observaciones: string | null
          plantilla_slug: string | null
        }
        Insert: {
          administracion_id: string
          autor?: string | null
          comprobante_id: string
          consorcio_id?: string | null
          created_at?: string
          dias_vencido?: number | null
          email_queue_id?: string | null
          enviado_at?: string
          id?: string
          monto_adeudado?: number | null
          nivel: number
          observaciones?: string | null
          plantilla_slug?: string | null
        }
        Update: {
          administracion_id?: string
          autor?: string | null
          comprobante_id?: string
          consorcio_id?: string | null
          created_at?: string
          dias_vencido?: number | null
          email_queue_id?: string | null
          enviado_at?: string
          id?: string
          monto_adeudado?: number | null
          nivel?: number
          observaciones?: string | null
          plantilla_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recupero_acciones_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recupero_acciones_autor_fkey"
            columns: ["autor"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recupero_acciones_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recupero_acciones_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "recupero_acciones_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recupero_acciones_email_queue_id_fkey"
            columns: ["email_queue_id"]
            isOneToOne: false
            referencedRelation: "email_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recupero_acciones_plantilla_slug_fkey"
            columns: ["plantilla_slug"]
            isOneToOne: false
            referencedRelation: "recupero_plantillas"
            referencedColumns: ["slug"]
          },
        ]
      }
      recupero_config: {
        Row: {
          activo_r1: boolean
          activo_r2: boolean
          activo_r3: boolean
          administracion_id: string | null
          created_at: string
          dias_r1: number
          dias_r2: number
          dias_r3: number
          email_destinatario_override: string | null
          id: string
          updated_at: string
        }
        Insert: {
          activo_r1?: boolean
          activo_r2?: boolean
          activo_r3?: boolean
          administracion_id?: string | null
          created_at?: string
          dias_r1?: number
          dias_r2?: number
          dias_r3?: number
          email_destinatario_override?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          activo_r1?: boolean
          activo_r2?: boolean
          activo_r3?: boolean
          administracion_id?: string | null
          created_at?: string
          dias_r1?: number
          dias_r2?: number
          dias_r3?: number
          email_destinatario_override?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recupero_config_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
        ]
      }
      recupero_plantillas: {
        Row: {
          activo: boolean
          asunto: string
          body: string
          created_at: string
          descripcion: string | null
          dias_desde_vencimiento_min: number
          id: string
          nivel: number
          slug: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          asunto: string
          body: string
          created_at?: string
          descripcion?: string | null
          dias_desde_vencimiento_min?: number
          id?: string
          nivel: number
          slug: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          asunto?: string
          body?: string
          created_at?: string
          descripcion?: string | null
          dias_desde_vencimiento_min?: number
          id?: string
          nivel?: number
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      sent_emails: {
        Row: {
          administracion_id: string | null
          asunto: string
          attachments_filenames: string[] | null
          attachments_meta: Json | null
          bounced_at: string | null
          cc: string | null
          clicked_at: string | null
          complained_at: string | null
          comprobante_id: string | null
          consorcio_id: string | null
          created_at: string
          created_by: string | null
          delivered_at: string | null
          enviado_at: string
          error_code: string | null
          error_msg: string | null
          estado: string
          events: Json
          from_casilla: string | null
          from_email: string
          html: string | null
          id: string
          importe_total: number | null
          last_event_at: string | null
          opened_at: string | null
          plantilla: string | null
          provider_msg_id: string | null
          reply_to: string | null
          resend_id: string | null
          solicitud_id: string | null
          template_slug: string | null
          to_email: string
          updated_at: string
          webhook_status: string | null
          zip_attached: boolean | null
        }
        Insert: {
          administracion_id?: string | null
          asunto: string
          attachments_filenames?: string[] | null
          attachments_meta?: Json | null
          bounced_at?: string | null
          cc?: string | null
          clicked_at?: string | null
          complained_at?: string | null
          comprobante_id?: string | null
          consorcio_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          enviado_at?: string
          error_code?: string | null
          error_msg?: string | null
          estado?: string
          events?: Json
          from_casilla?: string | null
          from_email?: string
          html?: string | null
          id?: string
          importe_total?: number | null
          last_event_at?: string | null
          opened_at?: string | null
          plantilla?: string | null
          provider_msg_id?: string | null
          reply_to?: string | null
          resend_id?: string | null
          solicitud_id?: string | null
          template_slug?: string | null
          to_email: string
          updated_at?: string
          webhook_status?: string | null
          zip_attached?: boolean | null
        }
        Update: {
          administracion_id?: string | null
          asunto?: string
          attachments_filenames?: string[] | null
          attachments_meta?: Json | null
          bounced_at?: string | null
          cc?: string | null
          clicked_at?: string | null
          complained_at?: string | null
          comprobante_id?: string | null
          consorcio_id?: string | null
          created_at?: string
          created_by?: string | null
          delivered_at?: string | null
          enviado_at?: string
          error_code?: string | null
          error_msg?: string | null
          estado?: string
          events?: Json
          from_casilla?: string | null
          from_email?: string
          html?: string | null
          id?: string
          importe_total?: number | null
          last_event_at?: string | null
          opened_at?: string | null
          plantilla?: string | null
          provider_msg_id?: string | null
          reply_to?: string | null
          resend_id?: string | null
          solicitud_id?: string | null
          template_slug?: string | null
          to_email?: string
          updated_at?: string
          webhook_status?: string | null
          zip_attached?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "sent_emails_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "sent_emails_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sent_emails_solicitud_id_fkey"
            columns: ["solicitud_id"]
            isOneToOne: false
            referencedRelation: "solicitudes"
            referencedColumns: ["id"]
          },
        ]
      }
      servicios: {
        Row: {
          activo: boolean
          campus_vigencia_meses: number | null
          categoria_id: string
          codigo: string
          created_at: string
          created_by: string | null
          descripcion: string | null
          formulario_publico_slug: string | null
          habilita_campus: boolean
          habilitado_formulario_publico: boolean
          id: string
          iva_alicuota: string
          nombre: string
          observaciones: string | null
          orden: number
          permite_multiples_consorcios: boolean
          precio_base: number
          precio_modo: string
          requiere_administracion: boolean
          requiere_consorcio: boolean
          sla_dias: number | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          campus_vigencia_meses?: number | null
          categoria_id: string
          codigo: string
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          formulario_publico_slug?: string | null
          habilita_campus?: boolean
          habilitado_formulario_publico?: boolean
          id?: string
          iva_alicuota?: string
          nombre: string
          observaciones?: string | null
          orden?: number
          permite_multiples_consorcios?: boolean
          precio_base?: number
          precio_modo: string
          requiere_administracion?: boolean
          requiere_consorcio?: boolean
          sla_dias?: number | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          campus_vigencia_meses?: number | null
          categoria_id?: string
          codigo?: string
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          formulario_publico_slug?: string | null
          habilita_campus?: boolean
          habilitado_formulario_publico?: boolean
          id?: string
          iva_alicuota?: string
          nombre?: string
          observaciones?: string | null
          orden?: number
          permite_multiples_consorcios?: boolean
          precio_base?: number
          precio_modo?: string
          requiere_administracion?: boolean
          requiere_consorcio?: boolean
          sla_dias?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "servicios_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_servicio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitud_derivaciones: {
        Row: {
          acceso_externo_token: string | null
          acceso_externo_url: string | null
          creada_por: string | null
          destinatario_email: string
          destinatario_nombre: string | null
          email_queue_id: string | null
          enviada_at: string
          id: string
          observaciones: string | null
          plantilla_email_slug: string | null
          solicitud_id: string
        }
        Insert: {
          acceso_externo_token?: string | null
          acceso_externo_url?: string | null
          creada_por?: string | null
          destinatario_email: string
          destinatario_nombre?: string | null
          email_queue_id?: string | null
          enviada_at?: string
          id?: string
          observaciones?: string | null
          plantilla_email_slug?: string | null
          solicitud_id: string
        }
        Update: {
          acceso_externo_token?: string | null
          acceso_externo_url?: string | null
          creada_por?: string | null
          destinatario_email?: string
          destinatario_nombre?: string | null
          email_queue_id?: string | null
          enviada_at?: string
          id?: string
          observaciones?: string | null
          plantilla_email_slug?: string | null
          solicitud_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitud_derivaciones_email_queue_id_fkey"
            columns: ["email_queue_id"]
            isOneToOne: false
            referencedRelation: "email_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitud_derivaciones_solicitud_id_fkey"
            columns: ["solicitud_id"]
            isOneToOne: false
            referencedRelation: "solicitudes"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes: {
        Row: {
          activada_at: string | null
          asignada_a: string | null
          cliente_id: string | null
          created_at: string
          derivada_at: string | null
          estado: string
          formulario_submission_id: string | null
          id: string
          motivo_descarte: string | null
          observaciones: string | null
          servicio_slug: string | null
          servicio_solicitado_id: string | null
          solicitante_email: string | null
          solicitante_nombre: string | null
          solicitante_telefono: string | null
          tramite_id: string | null
          updated_at: string
        }
        Insert: {
          activada_at?: string | null
          asignada_a?: string | null
          cliente_id?: string | null
          created_at?: string
          derivada_at?: string | null
          estado?: string
          formulario_submission_id?: string | null
          id?: string
          motivo_descarte?: string | null
          observaciones?: string | null
          servicio_slug?: string | null
          servicio_solicitado_id?: string | null
          solicitante_email?: string | null
          solicitante_nombre?: string | null
          solicitante_telefono?: string | null
          tramite_id?: string | null
          updated_at?: string
        }
        Update: {
          activada_at?: string | null
          asignada_a?: string | null
          cliente_id?: string | null
          created_at?: string
          derivada_at?: string | null
          estado?: string
          formulario_submission_id?: string | null
          id?: string
          motivo_descarte?: string | null
          observaciones?: string | null
          servicio_slug?: string | null
          servicio_solicitado_id?: string | null
          solicitante_email?: string | null
          solicitante_nombre?: string | null
          solicitante_telefono?: string | null
          tramite_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_formulario_submission_id_fkey"
            columns: ["formulario_submission_id"]
            isOneToOne: false
            referencedRelation: "formulario_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_servicio_solicitado_id_fkey"
            columns: ["servicio_solicitado_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      tabulador_precios: {
        Row: {
          administracion_id: string | null
          consorcio_id: string | null
          convenio: string | null
          created_at: string
          created_by: string | null
          id: string
          moneda: string
          motivo: string | null
          notas: string | null
          origen: string
          porcentaje_aplicado: number | null
          precio: number
          precio_anterior: number | null
          servicio_id: string
          vigente_desde: string
          vigente_hasta: string | null
        }
        Insert: {
          administracion_id?: string | null
          consorcio_id?: string | null
          convenio?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          moneda?: string
          motivo?: string | null
          notas?: string | null
          origen?: string
          porcentaje_aplicado?: number | null
          precio: number
          precio_anterior?: number | null
          servicio_id: string
          vigente_desde?: string
          vigente_hasta?: string | null
        }
        Update: {
          administracion_id?: string | null
          consorcio_id?: string | null
          convenio?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          moneda?: string
          motivo?: string | null
          notas?: string | null
          origen?: string
          porcentaje_aplicado?: number | null
          precio?: number
          precio_anterior?: number | null
          servicio_id?: string
          vigente_desde?: string
          vigente_hasta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tabulador_precios_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabulador_precios_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabulador_precios_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tabulador_precios_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_categorias_config: {
        Row: {
          color: string
          created_at: string
          icono: string | null
          id: string
          label: string
          orden: number
          servicio_id: string | null
          slug: string
        }
        Insert: {
          color?: string
          created_at?: string
          icono?: string | null
          id?: string
          label: string
          orden?: number
          servicio_id?: string | null
          slug: string
        }
        Update: {
          color?: string
          created_at?: string
          icono?: string | null
          id?: string
          label?: string
          orden?: number
          servicio_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_categorias_config_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_estados_config: {
        Row: {
          color: string
          created_at: string
          es_final: boolean
          id: string
          label: string
          orden: number
          servicio_id: string | null
          slug: string
        }
        Insert: {
          color?: string
          created_at?: string
          es_final?: boolean
          id?: string
          label: string
          orden?: number
          servicio_id?: string | null
          slug: string
        }
        Update: {
          color?: string
          created_at?: string
          es_final?: boolean
          id?: string
          label?: string
          orden?: number
          servicio_id?: string | null
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_estados_config_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_lineas: {
        Row: {
          alerta_en: string | null
          archivos_urls: string[]
          autor_id: string | null
          categoria: string
          created_at: string
          descripcion: string
          estado_asociado: string | null
          id: string
          tramite_id: string
        }
        Insert: {
          alerta_en?: string | null
          archivos_urls?: string[]
          autor_id?: string | null
          categoria: string
          created_at?: string
          descripcion: string
          estado_asociado?: string | null
          id?: string
          tramite_id: string
        }
        Update: {
          alerta_en?: string | null
          archivos_urls?: string[]
          autor_id?: string | null
          categoria?: string
          created_at?: string
          descripcion?: string
          estado_asociado?: string | null
          id?: string
          tramite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_lineas_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      tramite_adjuntos: {
        Row: {
          filename_original: string
          id: string
          mime_type: string | null
          size_bytes: number | null
          storage_path: string
          subido_por: string | null
          tramite_id: string
          uploaded_at: string
        }
        Insert: {
          filename_original: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path: string
          subido_por?: string | null
          tramite_id: string
          uploaded_at?: string
        }
        Update: {
          filename_original?: string
          id?: string
          mime_type?: string | null
          size_bytes?: number | null
          storage_path?: string
          subido_por?: string | null
          tramite_id?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tramite_adjuntos_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramite_adjuntos_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      tramite_comentarios: {
        Row: {
          autor_id: string | null
          autor_nombre: string
          autor_role: string
          contenido: string
          created_at: string
          id: string
          tramite_id: string
          visible_para: string
        }
        Insert: {
          autor_id?: string | null
          autor_nombre: string
          autor_role: string
          contenido: string
          created_at?: string
          id?: string
          tramite_id: string
          visible_para?: string
        }
        Update: {
          autor_id?: string | null
          autor_nombre?: string
          autor_role?: string
          contenido?: string
          created_at?: string
          id?: string
          tramite_id?: string
          visible_para?: string
        }
        Relationships: [
          {
            foreignKeyName: "tramite_comentarios_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramite_comentarios_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      tramite_eventos: {
        Row: {
          actor_id: string | null
          actor_nombre: string | null
          created_at: string
          data: Json
          id: string
          tipo: string
          tramite_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_nombre?: string | null
          created_at?: string
          data?: Json
          id?: string
          tipo: string
          tramite_id: string
        }
        Update: {
          actor_id?: string | null
          actor_nombre?: string | null
          created_at?: string
          data?: Json
          id?: string
          tipo?: string
          tramite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tramite_eventos_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramite_eventos_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      tramites: {
        Row: {
          administracion_id: string | null
          asignado_a: string | null
          categoria: string
          codigo: string
          comprobante_id: string | null
          consorcio_id: string | null
          created_at: string
          created_by: string | null
          cycle_closed_at: string | null
          descripcion: string | null
          documento_final_url: string | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string | null
          formulario_submission_id: string | null
          id: string
          parent_tracking_id: string | null
          periodo: string | null
          prioridad: string
          responsable_id: string | null
          resuelto_at: string | null
          resuelto_por: string | null
          servicio_id: string | null
          solicitante_email: string | null
          solicitante_nombre: string | null
          solicitante_telefono: string | null
          titulo: string
          total_adjuntos: number
          total_comentarios: number
          total_vistas: number
          ultima_actividad_at: string
          updated_at: string
          vence_at: string | null
        }
        Insert: {
          administracion_id?: string | null
          asignado_a?: string | null
          categoria: string
          codigo: string
          comprobante_id?: string | null
          consorcio_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_closed_at?: string | null
          descripcion?: string | null
          documento_final_url?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          formulario_submission_id?: string | null
          id?: string
          parent_tracking_id?: string | null
          periodo?: string | null
          prioridad?: string
          responsable_id?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          servicio_id?: string | null
          solicitante_email?: string | null
          solicitante_nombre?: string | null
          solicitante_telefono?: string | null
          titulo: string
          total_adjuntos?: number
          total_comentarios?: number
          total_vistas?: number
          ultima_actividad_at?: string
          updated_at?: string
          vence_at?: string | null
        }
        Update: {
          administracion_id?: string | null
          asignado_a?: string | null
          categoria?: string
          codigo?: string
          comprobante_id?: string | null
          consorcio_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_closed_at?: string | null
          descripcion?: string | null
          documento_final_url?: string | null
          estado?: string
          fecha_fin?: string | null
          fecha_inicio?: string | null
          formulario_submission_id?: string | null
          id?: string
          parent_tracking_id?: string | null
          periodo?: string | null
          prioridad?: string
          responsable_id?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          servicio_id?: string | null
          solicitante_email?: string | null
          solicitante_nombre?: string | null
          solicitante_telefono?: string | null
          titulo?: string
          total_adjuntos?: number
          total_comentarios?: number
          total_vistas?: number
          ultima_actividad_at?: string
          updated_at?: string
          vence_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tramites_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_asignado_a_fkey"
            columns: ["asignado_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "tramites_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_formulario_submission_id_fkey"
            columns: ["formulario_submission_id"]
            isOneToOne: false
            referencedRelation: "formulario_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_parent_tracking_id_fkey"
            columns: ["parent_tracking_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_responsable_id_fkey"
            columns: ["responsable_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_resuelto_por_fkey"
            columns: ["resuelto_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramites_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      vencimientos: {
        Row: {
          administracion_id: string
          alarmas_offsets: number[]
          alerta_10d_enviada: string | null
          alerta_20d_enviada: string | null
          alerta_30d_enviada: string | null
          consorcio_id: string | null
          created_at: string
          descripcion: string | null
          estado: string
          fecha_emision: string | null
          fecha_vencimiento: string
          id: string
          notificar_cliente: boolean
          observaciones: string | null
          origen: string
          renovado_por: string | null
          servicio_sugerido_id: string | null
          sujeto: string
          sujeto_id: string
          tipo: string
          tracking_id: string | null
          updated_at: string
        }
        Insert: {
          administracion_id: string
          alarmas_offsets?: number[]
          alerta_10d_enviada?: string | null
          alerta_20d_enviada?: string | null
          alerta_30d_enviada?: string | null
          consorcio_id?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_emision?: string | null
          fecha_vencimiento: string
          id?: string
          notificar_cliente?: boolean
          observaciones?: string | null
          origen?: string
          renovado_por?: string | null
          servicio_sugerido_id?: string | null
          sujeto: string
          sujeto_id: string
          tipo: string
          tracking_id?: string | null
          updated_at?: string
        }
        Update: {
          administracion_id?: string
          alarmas_offsets?: number[]
          alerta_10d_enviada?: string | null
          alerta_20d_enviada?: string | null
          alerta_30d_enviada?: string | null
          consorcio_id?: string | null
          created_at?: string
          descripcion?: string | null
          estado?: string
          fecha_emision?: string | null
          fecha_vencimiento?: string
          id?: string
          notificar_cliente?: boolean
          observaciones?: string | null
          origen?: string
          renovado_por?: string | null
          servicio_sugerido_id?: string | null
          sujeto?: string
          sujeto_id?: string
          tipo?: string
          tracking_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vencimientos_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_renovado_por_fkey"
            columns: ["renovado_por"]
            isOneToOne: false
            referencedRelation: "vencimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vencimientos_tracking_id_fkey"
            columns: ["tracking_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      vencimientos_config: {
        Row: {
          activo: boolean
          administracion_id: string | null
          created_at: string
          dias_alerta_1: number
          dias_alerta_2: number
          dias_alerta_3: number
          email_destinatario: string | null
          id: string
          sugerencia_servicio_slug: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          administracion_id?: string | null
          created_at?: string
          dias_alerta_1?: number
          dias_alerta_2?: number
          dias_alerta_3?: number
          email_destinatario?: string | null
          id?: string
          sugerencia_servicio_slug?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          administracion_id?: string | null
          created_at?: string
          dias_alerta_1?: number
          dias_alerta_2?: number
          dias_alerta_3?: number
          email_destinatario?: string | null
          id?: string
          sugerencia_servicio_slug?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vencimientos_config_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      cajas_con_saldo: {
        Row: {
          activo: boolean | null
          caja_id: string | null
          color: string | null
          icono: string | null
          moneda: string | null
          movs_pendientes: number | null
          nombre: string | null
          orden: number | null
          saldo: number | null
          tipo: string | null
        }
        Relationships: []
      }
      vw_accesos_externos_aperturas: {
        Row: {
          token: string | null
          total_aperturas: number | null
          ultima_apertura: string | null
        }
        Relationships: []
      }
      vw_agenda_unificada: {
        Row: {
          all_day: boolean | null
          category_hint: string | null
          color: string | null
          editable: boolean | null
          end_at: string | null
          estado: string | null
          fuente: string | null
          linked_admin_id: string | null
          linked_consorcio_id: string | null
          origen_id: string | null
          owner_id: string | null
          start_at: string | null
          title: string | null
        }
        Relationships: []
      }
      vw_comprobantes_para_avisar: {
        Row: {
          administracion_id: string | null
          comprobante_id: string | null
          consorcio_id: string | null
          dias_para_vto: number | null
          estado_cobranza: string | null
          fecha: string | null
          numero: number | null
          punto_venta: number | null
          receptor_razon_social: string | null
          saldo_pendiente: number | null
          tipo: string | null
          total: number | null
          vencimiento: string | null
        }
        Insert: {
          administracion_id?: string | null
          comprobante_id?: string | null
          consorcio_id?: string | null
          dias_para_vto?: never
          estado_cobranza?: string | null
          fecha?: string | null
          numero?: number | null
          punto_venta?: number | null
          receptor_razon_social?: string | null
          saldo_pendiente?: number | null
          tipo?: string | null
          total?: number | null
          vencimiento?: string | null
        }
        Update: {
          administracion_id?: string | null
          comprobante_id?: string | null
          consorcio_id?: string | null
          dias_para_vto?: never
          estado_cobranza?: string | null
          fecha?: string | null
          numero?: number | null
          punto_venta?: number | null
          receptor_razon_social?: string | null
          saldo_pendiente?: number | null
          tipo?: string | null
          total?: number | null
          vencimiento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comprobantes_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comprobantes_consorcio_id_fkey"
            columns: ["consorcio_id"]
            isOneToOne: false
            referencedRelation: "consorcios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ajuste_masivo_precios: {
        Args: {
          p_categoria_codigo?: string
          p_motivo?: string
          p_porcentaje?: number
          p_servicio_id?: string
        }
        Returns: {
          precio_anterior: number
          precio_nuevo: number
          servicio_id: string
          tabulador_anterior_id: string
          tabulador_nuevo_id: string
        }[]
      }
      anular_comprobante: {
        Args: { p_comprobante_id: string; p_motivo: string }
        Returns: string
      }
      apply_resend_event: {
        Args: {
          p_data: Json
          p_event_at: string
          p_event_type: string
          p_resend_id: string
        }
        Returns: {
          applied: boolean
          sent_email_id: string
        }[]
      }
      busqueda_global: {
        Args: { p_limit?: number; p_q: string }
        Returns: {
          id: string
          kind: string
          rank: number
          subtitulo: string
          titulo: string
          url_path: string
        }[]
      }
      comprobantes_morosos: {
        Args: { p_administracion_id?: string }
        Returns: {
          administracion_id: string
          administracion_nombre: string
          comprobante_id: string
          comprobante_numero: number
          comprobante_tipo: string
          consorcio_id: string
          consorcio_nombre: string
          dias_vencido: number
          estado_cobranza: string
          fecha: string
          nivel_sugerido: number
          punto_venta: number
          saldo_pendiente: number
          total: number
          ultima_accion_at: string
          ultima_accion_nivel: number
          vencimiento: string
        }[]
      }
      crear_comprobante_borrador_fiscal: {
        Args: {
          p_administracion_id: string
          p_comprobante_referencia_id: string
          p_concepto: string
          p_consorcio_id: string
          p_fecha: string
          p_items: Json
          p_observaciones: string
          p_punto_venta: number
          p_tipo: string
          p_vencimiento: string
        }
        Returns: string
      }
      crear_tramite_desde_submission: {
        Args: {
          p_asignado_a?: string
          p_categoria: string
          p_prioridad?: string
          p_submission_id: string
          p_titulo?: string
        }
        Returns: string
      }
      cuenta_corriente_extracto: {
        Args: { p_administracion_id: string; p_desde: string; p_hasta: string }
        Returns: {
          comprobante_id: string
          consorcio_nombre: string
          debe: number
          descripcion: string
          fecha: string
          haber: number
          imputacion_id: string
          movimiento_id: string
          saldo: number
          tipo: string
        }[]
      }
      cuenta_corriente_morosos: {
        Args: { p_limit?: number }
        Returns: {
          administracion_id: string
          administracion_nombre: string
          comprobantes_pendientes: number
          comprobantes_vencidos: number
          deuda_total: number
          mayor_dias_vencido: number
        }[]
      }
      cuenta_corriente_resumen: {
        Args: {
          p_administracion_id: string
          p_desde?: string
          p_hasta?: string
        }
        Returns: {
          comprobantes_pendientes: number
          comprobantes_vencidos: number
          deuda_total: number
          proximo_vencimiento: string
          saldo_actual: number
          saldo_inicial: number
          total_cobrado: number
          total_facturado: number
        }[]
      }
      cuenta_corriente_resumen_global: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: {
          administracion_id: string
          administracion_nombre: string
          comprobantes_pendientes: number
          comprobantes_vencidos: number
          deuda_total: number
          total_cobrado: number
          total_facturado: number
        }[]
      }
      curso_asignar_alumno: {
        Args: {
          p_administracion_id: string
          p_curso_id: string
          p_profile_id?: string
        }
        Returns: string
      }
      curso_marcar_clase_completada: {
        Args: { p_clase_id: string; p_matricula_id: string }
        Returns: undefined
      }
      curso_matricular: {
        Args: {
          p_administracion_id: string
          p_curso_id: string
          p_profile_id: string
        }
        Returns: string
      }
      curso_progreso_resumen: {
        Args: { p_matricula_id: string }
        Returns: Json
      }
      curso_registrar_pago: {
        Args: {
          p_caja_id: string
          p_matricula_id: string
          p_monto: number
          p_observaciones?: string
        }
        Returns: Json
      }
      curso_responder_examen: {
        Args: { p_intento_id: string; p_respuestas: Json }
        Returns: Json
      }
      desimputar_cobranza: {
        Args: { p_imputacion_id: string }
        Returns: string
      }
      disparar_recupero_manual: {
        Args: {
          p_comprobante_id: string
          p_nivel: number
          p_observaciones?: string
        }
        Returns: string
      }
      emitir_comprobante_manual: {
        Args: {
          p_administracion_id: string
          p_comprobante_referencia_id: string
          p_concepto: string
          p_consorcio_id: string
          p_fecha: string
          p_items: Json
          p_observaciones: string
          p_punto_venta: number
          p_tipo: string
          p_vencimiento: string
        }
        Returns: string
      }
      encolar_email: {
        Args: {
          p_administracion_id: string
          p_consorcio_id: string
          p_prioridad: number
          p_related_id: string
          p_related_table: string
          p_template: string
          p_to_email: string
          p_to_nombre: string
          p_variables: Json
        }
        Returns: string
      }
      encolar_push: {
        Args: {
          p_click_url?: string
          p_cuerpo?: string
          p_icono_url?: string
          p_titulo: string
          p_user_id: string
        }
        Returns: string
      }
      enqueue_emision_comprobante: {
        Args: { p_comprobante_id: string }
        Returns: string
      }
      generar_acceso_externo: {
        Args: {
          p_dias_validez?: number
          p_email_destinatario: string
          p_nombre_destinatario?: string
          p_observaciones?: string
          p_recurso_id: string
          p_recurso_tipo: string
        }
        Returns: string
      }
      gg_agenda_listar_unificada: {
        Args: { p_from: string; p_fuentes?: string[]; p_to: string }
        Returns: {
          all_day: boolean | null
          category_hint: string | null
          color: string | null
          editable: boolean | null
          end_at: string | null
          estado: string | null
          fuente: string | null
          linked_admin_id: string | null
          linked_consorcio_id: string | null
          origen_id: string | null
          owner_id: string | null
          start_at: string | null
          title: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "vw_agenda_unificada"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      gg_agenda_listar_vinculos: {
        Args: never
        Returns: {
          hint: string
          id: string
          label: string
          tipo: string
        }[]
      }
      gg_agenda_procesar_recordatorios: { Args: never; Returns: number }
      gg_agenda_seed_default_categories: {
        Args: { p_owner: string }
        Returns: undefined
      }
      gg_vencimientos_planificar_alertas: {
        Args: { p_fecha?: string }
        Returns: {
          administracion_id: string
          consorcio_id: string
          descripcion: string
          fecha_vencimiento: string
          notificar_cliente: boolean
          offset_dias: number
          tipo: string
          vencimiento_id: string
        }[]
      }
      import_comprobantes_batch: {
        Args: { p_archivo: string; p_filas: Json }
        Returns: Json
      }
      kpis_dashboard_global: { Args: { p_desde?: string }; Returns: Json }
      listar_eventos_agenda: {
        Args: {
          p_categoria?: string
          p_cliente?: string
          p_desde: string
          p_hasta: string
          p_incluir_completados?: boolean
          p_prioridad?: string
          p_responsable?: string
          p_servicio?: string
        }
        Returns: {
          cancelado_at: string
          categoria: string
          cliente_id: string
          cliente_nombre: string
          completado_at: string
          descripcion: string
          fecha_fin: string
          fecha_inicio: string
          id: string
          origen: string
          prioridad: string
          recordatorio_minutos_antes: number
          responsable_id: string
          responsable_nombre: string
          servicio_id: string
          servicio_nombre: string
          titulo: string
          todo_el_dia: boolean
          tramite_id: string
          vencimiento_id: string
        }[]
      }
      lote_consolidado_administracion: {
        Args: {
          p_administracion_id: string
          p_template: string
          p_variables: Json
        }
        Returns: string
      }
      marcar_renovado: {
        Args: { p_nueva_fecha_vencimiento: string; p_vencimiento_id: string }
        Returns: string
      }
      matricula_sync_examen: {
        Args: { p_matricula_id: string }
        Returns: undefined
      }
      matricula_tildar_condicion: {
        Args: {
          p_cumplida: boolean
          p_matricula_condicion_id: string
          p_observaciones?: string
        }
        Returns: undefined
      }
      normalizar_nombre: { Args: { p: string }; Returns: string }
      partner_anular_rendicion: {
        Args: { p_motivo: string; p_rendicion_id: string }
        Returns: string
      }
      partner_cerrar_rendicion: {
        Args: { p_rendicion_id: string }
        Returns: string
      }
      partner_crear_rendicion: {
        Args: { p_desde: string; p_hasta: string; p_partner_id: string }
        Returns: string
      }
      peek_proximo_numero: {
        Args: { p_punto_venta: number; p_tipo: string }
        Returns: number
      }
      proximos_vencimientos: {
        Args: { p_administracion_id?: string; p_dias?: number }
        Returns: {
          administracion_id: string
          administracion_nombre: string
          alerta_10d_enviada: string
          alerta_20d_enviada: string
          alerta_30d_enviada: string
          consorcio_id: string
          consorcio_nombre: string
          descripcion: string
          dias_restantes: number
          estado: string
          fecha_emision: string
          fecha_vencimiento: string
          id: string
          observaciones: string
          sugerencia_servicio_slug: string
          sujeto: string
          sujeto_id: string
          tipo: string
        }[]
      }
      registrar_apertura_acceso: {
        Args: { p_ip?: string; p_token: string; p_user_agent?: string }
        Returns: undefined
      }
      registrar_cobranza_comprobante: {
        Args: {
          p_caja_id: string
          p_categoria_id: string
          p_comprobante_id: string
          p_descripcion: string
          p_fecha: string
          p_monto: number
          p_referencia: string
        }
        Returns: string
      }
      reintentar_arca_job: { Args: { p_job_id: string }; Returns: string }
      reset_arca_jobs_colgados: {
        Args: { p_max_age_min?: number }
        Returns: number
      }
      resolver_precio_servicio: {
        Args: {
          p_administracion_id?: string
          p_consorcio_id?: string
          p_fecha?: string
          p_servicio_id: string
        }
        Returns: {
          modo: string
          origen: string
          precio_total: number
          precio_unitario: number
          tabulador_precio_id: string
          unidades: number
        }[]
      }
      restaurar_formulario_version: {
        Args: { p_formulario_id: string; p_version_num: number }
        Returns: string
      }
      restaurar_solicitud: { Args: { p_solicitud_id: string }; Returns: string }
      revocar_acceso_externo: { Args: { p_token: string }; Returns: undefined }
      solicitud_activar: {
        Args: {
          p_cliente_id?: string
          p_crear_cliente_input?: Json
          p_fecha_inicio?: string
          p_periodo?: string
          p_solicitud_id: string
        }
        Returns: string
      }
      solicitud_derivar: {
        Args: {
          p_destinatario_email: string
          p_destinatario_nombre: string
          p_observaciones?: string
          p_plantilla_slug?: string
          p_solicitud_id: string
        }
        Returns: string
      }
      solicitud_descartar: {
        Args: { p_motivo: string; p_solicitud_id: string }
        Returns: undefined
      }
      solicitud_marcar_en_revision: {
        Args: { p_observaciones?: string; p_solicitud_id: string }
        Returns: undefined
      }
      solicitud_responder: {
        Args: {
          p_asunto: string
          p_cuerpo: string
          p_from_casilla?: string
          p_solicitud_id: string
        }
        Returns: string
      }
      tracking_agregar_linea: {
        Args: {
          p_alerta_en?: string
          p_archivos_urls?: string[]
          p_categoria: string
          p_descripcion: string
          p_estado_asociado?: string
          p_tramite_id: string
        }
        Returns: string
      }
      tracking_cerrar: {
        Args: { p_documento_final_url: string; p_tramite_id: string }
        Returns: undefined
      }
      tracking_cerrar_ciclo: {
        Args: {
          p_alarmas_offsets: number[]
          p_notificar_cliente?: boolean
          p_proxima_fecha: string
          p_tracking_id: string
        }
        Returns: {
          alarmas_planificadas: string[]
          vencimiento_id: string
        }[]
      }
      tracking_historial_cliente: {
        Args: { p_administracion_id: string; p_servicio_slug: string }
        Returns: {
          administracion_id: string | null
          asignado_a: string | null
          categoria: string
          codigo: string
          comprobante_id: string | null
          consorcio_id: string | null
          created_at: string
          created_by: string | null
          cycle_closed_at: string | null
          descripcion: string | null
          documento_final_url: string | null
          estado: string
          fecha_fin: string | null
          fecha_inicio: string | null
          formulario_submission_id: string | null
          id: string
          parent_tracking_id: string | null
          periodo: string | null
          prioridad: string
          responsable_id: string | null
          resuelto_at: string | null
          resuelto_por: string | null
          servicio_id: string | null
          solicitante_email: string | null
          solicitante_nombre: string | null
          solicitante_telefono: string | null
          titulo: string
          total_adjuntos: number
          total_comentarios: number
          total_vistas: number
          ultima_actividad_at: string
          updated_at: string
          vence_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "tramites"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      tramite_incrementar_vistas: {
        Args: { p_tramite_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
