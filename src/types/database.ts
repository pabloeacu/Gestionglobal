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
          clave_fiscal_arca: string | null
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
          legajo_rpac: string | null
          localidad: string | null
          madre_apellido_nombre: string | null
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
          padre_apellido_nombre: string | null
          provincia: string | null
          responsable_apellido: string | null
          responsable_dni: string | null
          responsable_nombre: string | null
          telefono: string | null
          updated_at: string
          user_id: string | null
          whatsapp: string | null
        }
        Insert: {
          activo?: boolean
          clave_fiscal_arca?: string | null
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
          legajo_rpac?: string | null
          localidad?: string | null
          madre_apellido_nombre?: string | null
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
          padre_apellido_nombre?: string | null
          provincia?: string | null
          responsable_apellido?: string | null
          responsable_dni?: string | null
          responsable_nombre?: string | null
          telefono?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp?: string | null
        }
        Update: {
          activo?: boolean
          clave_fiscal_arca?: string | null
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
          legajo_rpac?: string | null
          localidad?: string | null
          madre_apellido_nombre?: string | null
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
          padre_apellido_nombre?: string | null
          provincia?: string | null
          responsable_apellido?: string | null
          responsable_dni?: string | null
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
      arca_emisores: {
        Row: {
          activo: boolean
          ambiente: string
          cert_alias: string | null
          cert_b64: string | null
          cert_p12_b64: string | null
          cert_password: string | null
          cert_subido_at: string | null
          cert_valido_desde: string | null
          cert_valido_hasta: string | null
          condicion_iva: string
          created_at: string
          csr_b64: string | null
          csr_generado_at: string | null
          cuit: string | null
          domicilio_fiscal: string | null
          es_default: boolean
          id: string
          key_b64: string | null
          logo_url: string | null
          nombre: string
          punto_venta_default: number
          razon_social: string
          ultimo_test_at: string | null
          ultimo_test_latencia_ms: number | null
          ultimo_test_msg: string | null
          ultimo_test_ok: boolean | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          ambiente?: string
          cert_alias?: string | null
          cert_b64?: string | null
          cert_p12_b64?: string | null
          cert_password?: string | null
          cert_subido_at?: string | null
          cert_valido_desde?: string | null
          cert_valido_hasta?: string | null
          condicion_iva?: string
          created_at?: string
          csr_b64?: string | null
          csr_generado_at?: string | null
          cuit?: string | null
          domicilio_fiscal?: string | null
          es_default?: boolean
          id?: string
          key_b64?: string | null
          logo_url?: string | null
          nombre: string
          punto_venta_default?: number
          razon_social: string
          ultimo_test_at?: string | null
          ultimo_test_latencia_ms?: number | null
          ultimo_test_msg?: string | null
          ultimo_test_ok?: boolean | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          ambiente?: string
          cert_alias?: string | null
          cert_b64?: string | null
          cert_p12_b64?: string | null
          cert_password?: string | null
          cert_subido_at?: string | null
          cert_valido_desde?: string | null
          cert_valido_hasta?: string | null
          condicion_iva?: string
          created_at?: string
          csr_b64?: string | null
          csr_generado_at?: string | null
          cuit?: string | null
          domicilio_fiscal?: string | null
          es_default?: boolean
          id?: string
          key_b64?: string | null
          logo_url?: string | null
          nombre?: string
          punto_venta_default?: number
          razon_social?: string
          ultimo_test_at?: string | null
          ultimo_test_latencia_ms?: number | null
          ultimo_test_msg?: string | null
          ultimo_test_ok?: boolean | null
          updated_at?: string
        }
        Relationships: []
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
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: number
          payload_after: Json | null
          payload_before: Json | null
          row_pk: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: number
          payload_after?: Json | null
          payload_before?: Json | null
          row_pk?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: number
          payload_after?: Json | null
          payload_before?: Json | null
          row_pk?: string | null
          table_name?: string
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
          es_default: boolean
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
          es_default?: boolean
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
          es_default?: boolean
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
      certificado_esquemas: {
        Row: {
          color_acento: string
          color_dorado: string
          created_at: string
          created_by: string | null
          descripcion: string | null
          destinatario_bloque: string | null
          es_default: boolean
          firma_1_cargo: string
          firma_1_img_url: string | null
          firma_1_nombre: string
          firma_2_cargo: string
          firma_2_img_url: string | null
          firma_2_nombre: string
          id: string
          leyenda_legal: string
          lugar: string | null
          marca_logo_url: string | null
          nombre: string
          sello_logo_url: string | null
          sigla_texto: string
          texto_cuerpo: string | null
          texto_descriptivo: string
          tipo: string
          updated_at: string
          visible_firma_1: boolean
          visible_firma_2: boolean
          visible_leyenda_legal: boolean
          visible_marca_logo: boolean
          visible_sello: boolean
          visible_sigla: boolean
          visible_texto_descriptivo: boolean
          visible_watermark: boolean
          watermark_url: string | null
        }
        Insert: {
          color_acento?: string
          color_dorado?: string
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          destinatario_bloque?: string | null
          es_default?: boolean
          firma_1_cargo?: string
          firma_1_img_url?: string | null
          firma_1_nombre?: string
          firma_2_cargo?: string
          firma_2_img_url?: string | null
          firma_2_nombre?: string
          id?: string
          leyenda_legal?: string
          lugar?: string | null
          marca_logo_url?: string | null
          nombre: string
          sello_logo_url?: string | null
          sigla_texto?: string
          texto_cuerpo?: string | null
          texto_descriptivo?: string
          tipo?: string
          updated_at?: string
          visible_firma_1?: boolean
          visible_firma_2?: boolean
          visible_leyenda_legal?: boolean
          visible_marca_logo?: boolean
          visible_sello?: boolean
          visible_sigla?: boolean
          visible_texto_descriptivo?: boolean
          visible_watermark?: boolean
          watermark_url?: string | null
        }
        Update: {
          color_acento?: string
          color_dorado?: string
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          destinatario_bloque?: string | null
          es_default?: boolean
          firma_1_cargo?: string
          firma_1_img_url?: string | null
          firma_1_nombre?: string
          firma_2_cargo?: string
          firma_2_img_url?: string | null
          firma_2_nombre?: string
          id?: string
          leyenda_legal?: string
          lugar?: string | null
          marca_logo_url?: string | null
          nombre?: string
          sello_logo_url?: string | null
          sigla_texto?: string
          texto_cuerpo?: string | null
          texto_descriptivo?: string
          tipo?: string
          updated_at?: string
          visible_firma_1?: boolean
          visible_firma_2?: boolean
          visible_leyenda_legal?: boolean
          visible_marca_logo?: boolean
          visible_sello?: boolean
          visible_sigla?: boolean
          visible_texto_descriptivo?: boolean
          visible_watermark?: boolean
          watermark_url?: string | null
        }
        Relationships: []
      }
      certificados: {
        Row: {
          administracion_id: string | null
          alumno_profile_id: string | null
          celebracion_vista_at: string | null
          codigo: string
          created_at: string
          curso_id: string | null
          emitido_at: string
          enviado_email_at: string | null
          esquema_snapshot: Json | null
          id: string
          instructor_nombre: string | null
          matricula_id: string | null
          nota_examen: number | null
          payload_snapshot: Json
          pdf_storage_path: string | null
          prospecto_id: string | null
          revocado_at: string | null
          revocado_motivo: string | null
          tema: number
          updated_at: string
          verificacion_hash: string
          webinar_id: string | null
        }
        Insert: {
          administracion_id?: string | null
          alumno_profile_id?: string | null
          celebracion_vista_at?: string | null
          codigo: string
          created_at?: string
          curso_id?: string | null
          emitido_at?: string
          enviado_email_at?: string | null
          esquema_snapshot?: Json | null
          id?: string
          instructor_nombre?: string | null
          matricula_id?: string | null
          nota_examen?: number | null
          payload_snapshot?: Json
          pdf_storage_path?: string | null
          prospecto_id?: string | null
          revocado_at?: string | null
          revocado_motivo?: string | null
          tema?: number
          updated_at?: string
          verificacion_hash: string
          webinar_id?: string | null
        }
        Update: {
          administracion_id?: string | null
          alumno_profile_id?: string | null
          celebracion_vista_at?: string | null
          codigo?: string
          created_at?: string
          curso_id?: string | null
          emitido_at?: string
          enviado_email_at?: string | null
          esquema_snapshot?: Json | null
          id?: string
          instructor_nombre?: string | null
          matricula_id?: string | null
          nota_examen?: number | null
          payload_snapshot?: Json
          pdf_storage_path?: string | null
          prospecto_id?: string | null
          revocado_at?: string | null
          revocado_motivo?: string | null
          tema?: number
          updated_at?: string
          verificacion_hash?: string
          webinar_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificados_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificados_alumno_profile_id_fkey"
            columns: ["alumno_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificados_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificados_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: true
            referencedRelation: "curso_matriculas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificados_prospecto_id_fkey"
            columns: ["prospecto_id"]
            isOneToOne: false
            referencedRelation: "prospectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificados_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "vw_administracion_webinars"
            referencedColumns: ["webinar_id"]
          },
          {
            foreignKeyName: "certificados_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      cj_documentos: {
        Row: {
          color_acento: string
          created_at: string
          created_by: string | null
          cuerpo_html: string
          destinatario_email: string | null
          destinatario_nombre: string
          firma: string | null
          id: string
          kicker: string
          last_emailed_at: string | null
          last_emailed_to: string | null
          mostrar_logo: boolean
          pdf_generated_at: string | null
          pdf_storage_path: string | null
          tema: string
          titulo: string
          updated_at: string
        }
        Insert: {
          color_acento?: string
          created_at?: string
          created_by?: string | null
          cuerpo_html?: string
          destinatario_email?: string | null
          destinatario_nombre: string
          firma?: string | null
          id?: string
          kicker?: string
          last_emailed_at?: string | null
          last_emailed_to?: string | null
          mostrar_logo?: boolean
          pdf_generated_at?: string | null
          pdf_storage_path?: string | null
          tema: string
          titulo: string
          updated_at?: string
        }
        Update: {
          color_acento?: string
          created_at?: string
          created_by?: string | null
          cuerpo_html?: string
          destinatario_email?: string | null
          destinatario_nombre?: string
          firma?: string | null
          id?: string
          kicker?: string
          last_emailed_at?: string | null
          last_emailed_to?: string | null
          mostrar_logo?: boolean
          pdf_generated_at?: string | null
          pdf_storage_path?: string | null
          tema?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      cliente_oportunidad_eventos: {
        Row: {
          administracion_id: string
          codigo: string
          last_shown_at: string | null
          snoozed_until: string | null
          updated_at: string
        }
        Insert: {
          administracion_id: string
          codigo: string
          last_shown_at?: string | null
          snoozed_until?: string | null
          updated_at?: string
        }
        Update: {
          administracion_id?: string
          codigo?: string
          last_shown_at?: string | null
          snoozed_until?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cliente_oportunidad_eventos_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
        ]
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
          emisor_id: string | null
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
          partner_factura_pdf_url: string | null
          partner_facturado_at: string | null
          partner_numero_externo: string | null
          partner_observacion: string | null
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
          emisor_id?: string | null
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
          partner_factura_pdf_url?: string | null
          partner_facturado_at?: string | null
          partner_numero_externo?: string | null
          partner_observacion?: string | null
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
          emisor_id?: string | null
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
          partner_factura_pdf_url?: string | null
          partner_facturado_at?: string | null
          partner_numero_externo?: string | null
          partner_observacion?: string | null
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
            foreignKeyName: "comprobantes_emisor_id_fkey"
            columns: ["emisor_id"]
            isOneToOne: false
            referencedRelation: "arca_emisores"
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
      comunicaciones: {
        Row: {
          audiencia: Json
          banner_estilo: string
          canal_banner: boolean
          canal_email: boolean
          canal_push: boolean
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_url: string | null
          cuerpo_html: string | null
          cuerpo_md: string
          enviado_at: string | null
          enviado_por: string | null
          estado: string
          id: string
          titulo: string
          total_destinatarios: number
          updated_at: string
          visible_desde: string
          visible_hasta: string | null
        }
        Insert: {
          audiencia?: Json
          banner_estilo?: string
          canal_banner?: boolean
          canal_email?: boolean
          canal_push?: boolean
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          cuerpo_html?: string | null
          cuerpo_md: string
          enviado_at?: string | null
          enviado_por?: string | null
          estado?: string
          id?: string
          titulo: string
          total_destinatarios?: number
          updated_at?: string
          visible_desde?: string
          visible_hasta?: string | null
        }
        Update: {
          audiencia?: Json
          banner_estilo?: string
          canal_banner?: boolean
          canal_email?: boolean
          canal_push?: boolean
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          cuerpo_html?: string | null
          cuerpo_md?: string
          enviado_at?: string | null
          enviado_por?: string | null
          estado?: string
          id?: string
          titulo?: string
          total_destinatarios?: number
          updated_at?: string
          visible_desde?: string
          visible_hasta?: string | null
        }
        Relationships: []
      }
      comunicaciones_destinatarios: {
        Row: {
          administracion_id: string
          comunicacion_id: string
          created_at: string
          email_enqueued_at: string | null
          email_to: string | null
          id: string
          push_enqueued_at: string | null
          user_id: string | null
          visto_at: string | null
        }
        Insert: {
          administracion_id: string
          comunicacion_id: string
          created_at?: string
          email_enqueued_at?: string | null
          email_to?: string | null
          id?: string
          push_enqueued_at?: string | null
          user_id?: string | null
          visto_at?: string | null
        }
        Update: {
          administracion_id?: string
          comunicacion_id?: string
          created_at?: string
          email_enqueued_at?: string | null
          email_to?: string | null
          id?: string
          push_enqueued_at?: string | null
          user_id?: string | null
          visto_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comunicaciones_destinatarios_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comunicaciones_destinatarios_comunicacion_id_fkey"
            columns: ["comunicacion_id"]
            isOneToOne: false
            referencedRelation: "comunicaciones"
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
          landing_cover_enabled: boolean
          localidad: string | null
          logo_url: string | null
          nombre_fantasia: string
          pago_mp_alias: string | null
          pago_mp_cuit_cuil: string | null
          pago_mp_cvu: string | null
          pago_mp_titular: string | null
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
          landing_cover_enabled?: boolean
          localidad?: string | null
          logo_url?: string | null
          nombre_fantasia?: string
          pago_mp_alias?: string | null
          pago_mp_cuit_cuil?: string | null
          pago_mp_cvu?: string | null
          pago_mp_titular?: string | null
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
          landing_cover_enabled?: boolean
          localidad?: string | null
          logo_url?: string | null
          nombre_fantasia?: string
          pago_mp_alias?: string | null
          pago_mp_cuit_cuil?: string | null
          pago_mp_cvu?: string | null
          pago_mp_titular?: string | null
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
      constancias: {
        Row: {
          administracion_id: string | null
          alumno_profile_id: string | null
          codigo: string
          created_at: string
          curso_id: string
          destinatario_final: string | null
          emitida_por: string | null
          enviado_a: string | null
          enviado_email_at: string | null
          esquema_snapshot: Json
          id: string
          matricula_id: string
          payload_snapshot: Json
          pdf_storage_path: string | null
          texto_final: string
          updated_at: string
        }
        Insert: {
          administracion_id?: string | null
          alumno_profile_id?: string | null
          codigo: string
          created_at?: string
          curso_id: string
          destinatario_final?: string | null
          emitida_por?: string | null
          enviado_a?: string | null
          enviado_email_at?: string | null
          esquema_snapshot?: Json
          id?: string
          matricula_id: string
          payload_snapshot?: Json
          pdf_storage_path?: string | null
          texto_final: string
          updated_at?: string
        }
        Update: {
          administracion_id?: string | null
          alumno_profile_id?: string | null
          codigo?: string
          created_at?: string
          curso_id?: string
          destinatario_final?: string | null
          emitida_por?: string | null
          enviado_a?: string | null
          enviado_email_at?: string | null
          esquema_snapshot?: Json
          id?: string
          matricula_id?: string
          payload_snapshot?: Json
          pdf_storage_path?: string | null
          texto_final?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "constancias_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "constancias_alumno_profile_id_fkey"
            columns: ["alumno_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "constancias_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "constancias_emitida_por_fkey"
            columns: ["emitida_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "constancias_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "curso_matriculas"
            referencedColumns: ["id"]
          },
        ]
      }
      csp_reports: {
        Row: {
          blocked_uri: string
          disposition: string | null
          document_uri: string | null
          effective_directive: string | null
          first_seen: string
          hits: number
          id: string
          last_seen: string
          line_number: number | null
          sample: Json | null
          source_file: string | null
          status_code: number | null
          violated_directive: string
        }
        Insert: {
          blocked_uri?: string
          disposition?: string | null
          document_uri?: string | null
          effective_directive?: string | null
          first_seen?: string
          hits?: number
          id?: string
          last_seen?: string
          line_number?: number | null
          sample?: Json | null
          source_file?: string | null
          status_code?: number | null
          violated_directive: string
        }
        Update: {
          blocked_uri?: string
          disposition?: string | null
          document_uri?: string | null
          effective_directive?: string | null
          first_seen?: string
          hits?: number
          id?: string
          last_seen?: string
          line_number?: number | null
          sample?: Json | null
          source_file?: string | null
          status_code?: number | null
          violated_directive?: string
        }
        Relationships: []
      }
      curso_bibliografia: {
        Row: {
          archivo_url: string | null
          autor: string | null
          created_at: string
          curso_id: string
          descripcion: string | null
          despublicar_at: string | null
          id: string
          publicado: boolean
          publicar_at: string | null
          titulo: string
          url: string | null
        }
        Insert: {
          archivo_url?: string | null
          autor?: string | null
          created_at?: string
          curso_id: string
          descripcion?: string | null
          despublicar_at?: string | null
          id?: string
          publicado?: boolean
          publicar_at?: string | null
          titulo: string
          url?: string | null
        }
        Update: {
          archivo_url?: string | null
          autor?: string | null
          created_at?: string
          curso_id?: string
          descripcion?: string | null
          despublicar_at?: string | null
          id?: string
          publicado?: boolean
          publicar_at?: string | null
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
          despublicar_at: string | null
          duracion_min: number | null
          id: string
          instructor_foto_url: string | null
          material_url: string | null
          modulo_id: string
          orden: number
          publicado: boolean
          publicar_at: string | null
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
          despublicar_at?: string | null
          duracion_min?: number | null
          id?: string
          instructor_foto_url?: string | null
          material_url?: string | null
          modulo_id: string
          orden?: number
          publicado?: boolean
          publicar_at?: string | null
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
          despublicar_at?: string | null
          duracion_min?: number | null
          id?: string
          instructor_foto_url?: string | null
          material_url?: string | null
          modulo_id?: string
          orden?: number
          publicado?: boolean
          publicar_at?: string | null
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
          descripcion: string | null
          docente_cv_url: string | null
          docente_foto_url: string | null
          docente_nombre: string | null
          etiqueta: string
          examen_id: string | null
          id: string
          modalidad: string | null
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
          descripcion?: string | null
          docente_cv_url?: string | null
          docente_foto_url?: string | null
          docente_nombre?: string | null
          etiqueta: string
          examen_id?: string | null
          id?: string
          modalidad?: string | null
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
          descripcion?: string | null
          docente_cv_url?: string | null
          docente_foto_url?: string | null
          docente_nombre?: string | null
          etiqueta?: string
          examen_id?: string | null
          id?: string
          modalidad?: string | null
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
          auto_presente: boolean
          encuentro_id: string
          fuente: string
          id: string
          marcada_at: string
          marcada_por: string | null
          matricula_id: string
          presente: boolean
          salido_at: string | null
          tiempo_conectado_seg: number
          umbral_cumplido: boolean
          unido_at: string | null
        }
        Insert: {
          auto_presente?: boolean
          encuentro_id: string
          fuente?: string
          id?: string
          marcada_at?: string
          marcada_por?: string | null
          matricula_id: string
          presente?: boolean
          salido_at?: string | null
          tiempo_conectado_seg?: number
          umbral_cumplido?: boolean
          unido_at?: string | null
        }
        Update: {
          auto_presente?: boolean
          encuentro_id?: string
          fuente?: string
          id?: string
          marcada_at?: string
          marcada_por?: string | null
          matricula_id?: string
          presente?: boolean
          salido_at?: string | null
          tiempo_conectado_seg?: number
          umbral_cumplido?: boolean
          unido_at?: string | null
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
      curso_encuentro_zoom_eventos: {
        Row: {
          created_at: string
          encuentro_id: string
          evento: string
          id: string
          matricula_id: string | null
          ocurrido_at: string
          raw_payload: Json | null
        }
        Insert: {
          created_at?: string
          encuentro_id: string
          evento: string
          id?: string
          matricula_id?: string | null
          ocurrido_at: string
          raw_payload?: Json | null
        }
        Update: {
          created_at?: string
          encuentro_id?: string
          evento?: string
          id?: string
          matricula_id?: string | null
          ocurrido_at?: string
          raw_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "curso_encuentro_zoom_eventos_encuentro_id_fkey"
            columns: ["encuentro_id"]
            isOneToOne: false
            referencedRelation: "curso_encuentros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_encuentro_zoom_eventos_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: false
            referencedRelation: "curso_matriculas"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_encuentros: {
        Row: {
          asistencia_reconciliada_at: string | null
          condicion_id: string | null
          created_at: string
          curso_id: string
          descripcion: string | null
          duracion_min: number
          fecha_hora: string | null
          finalizado_at: string | null
          grabacion_play_url: string | null
          grabacion_url: string | null
          id: string
          iniciado_at: string | null
          link_zoom: string | null
          orden: number
          plataforma: string
          sesion_compartida_id: string | null
          titulo: string
          updated_at: string
          webex_join_url: string | null
          webex_meeting_id: string | null
          webex_meeting_number: string | null
          webex_password: string | null
          webex_start_url: string | null
          webex_status: string | null
          zoom_join_url: string | null
          zoom_meeting_id: number | null
          zoom_password: string | null
          zoom_start_url: string | null
          zoom_status: string
        }
        Insert: {
          asistencia_reconciliada_at?: string | null
          condicion_id?: string | null
          created_at?: string
          curso_id: string
          descripcion?: string | null
          duracion_min?: number
          fecha_hora?: string | null
          finalizado_at?: string | null
          grabacion_play_url?: string | null
          grabacion_url?: string | null
          id?: string
          iniciado_at?: string | null
          link_zoom?: string | null
          orden?: number
          plataforma?: string
          sesion_compartida_id?: string | null
          titulo: string
          updated_at?: string
          webex_join_url?: string | null
          webex_meeting_id?: string | null
          webex_meeting_number?: string | null
          webex_password?: string | null
          webex_start_url?: string | null
          webex_status?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: number | null
          zoom_password?: string | null
          zoom_start_url?: string | null
          zoom_status?: string
        }
        Update: {
          asistencia_reconciliada_at?: string | null
          condicion_id?: string | null
          created_at?: string
          curso_id?: string
          descripcion?: string | null
          duracion_min?: number
          fecha_hora?: string | null
          finalizado_at?: string | null
          grabacion_play_url?: string | null
          grabacion_url?: string | null
          id?: string
          iniciado_at?: string | null
          link_zoom?: string | null
          orden?: number
          plataforma?: string
          sesion_compartida_id?: string | null
          titulo?: string
          updated_at?: string
          webex_join_url?: string | null
          webex_meeting_id?: string | null
          webex_meeting_number?: string | null
          webex_password?: string | null
          webex_start_url?: string | null
          webex_status?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: number | null
          zoom_password?: string | null
          zoom_start_url?: string | null
          zoom_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_encuentros_condicion_id_fkey"
            columns: ["condicion_id"]
            isOneToOne: false
            referencedRelation: "curso_condiciones_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_encuentros_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: false
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_encuentros_sesion_compartida_id_fkey"
            columns: ["sesion_compartida_id"]
            isOneToOne: false
            referencedRelation: "encuentro_sesiones_compartidas"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_encuesta_respuestas: {
        Row: {
          created_at: string
          encuesta_id: string
          id: string
          matricula_id: string
          permite_publicar: boolean
          publicado: boolean
          publicado_at: string | null
          publicado_por: string | null
          respuestas: Json
          testimonio_comentario: string | null
          testimonio_foto_url: string | null
          testimonio_nombre: string | null
        }
        Insert: {
          created_at?: string
          encuesta_id: string
          id?: string
          matricula_id: string
          permite_publicar?: boolean
          publicado?: boolean
          publicado_at?: string | null
          publicado_por?: string | null
          respuestas?: Json
          testimonio_comentario?: string | null
          testimonio_foto_url?: string | null
          testimonio_nombre?: string | null
        }
        Update: {
          created_at?: string
          encuesta_id?: string
          id?: string
          matricula_id?: string
          permite_publicar?: boolean
          publicado?: boolean
          publicado_at?: string | null
          publicado_por?: string | null
          respuestas?: Json
          testimonio_comentario?: string | null
          testimonio_foto_url?: string | null
          testimonio_nombre?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curso_encuesta_respuestas_encuesta_id_fkey"
            columns: ["encuesta_id"]
            isOneToOne: false
            referencedRelation: "curso_encuestas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curso_encuesta_respuestas_matricula_id_fkey"
            columns: ["matricula_id"]
            isOneToOne: true
            referencedRelation: "curso_matriculas"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_encuestas: {
        Row: {
          activa: boolean
          created_at: string
          created_by: string | null
          curso_id: string
          descripcion: string | null
          id: string
          requerida_para_cert: boolean
          schema: Json
          titulo: string
          updated_at: string
        }
        Insert: {
          activa?: boolean
          created_at?: string
          created_by?: string | null
          curso_id: string
          descripcion?: string | null
          id?: string
          requerida_para_cert?: boolean
          schema?: Json
          titulo?: string
          updated_at?: string
        }
        Update: {
          activa?: boolean
          created_at?: string
          created_by?: string | null
          curso_id?: string
          descripcion?: string | null
          id?: string
          requerida_para_cert?: boolean
          schema?: Json
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_encuestas_curso_id_fkey"
            columns: ["curso_id"]
            isOneToOne: true
            referencedRelation: "cursos"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_examen_secciones: {
        Row: {
          created_at: string
          descripcion: string | null
          examen_id: string
          id: string
          orden: number
          titulo: string
        }
        Insert: {
          created_at?: string
          descripcion?: string | null
          examen_id: string
          id?: string
          orden?: number
          titulo: string
        }
        Update: {
          created_at?: string
          descripcion?: string | null
          examen_id?: string
          id?: string
          orden?: number
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "curso_examen_secciones_examen_id_fkey"
            columns: ["examen_id"]
            isOneToOne: false
            referencedRelation: "curso_examenes"
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
          completada_at: string | null
          created_at: string
          curso_id: string
          estado: string
          fuente: string | null
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
          completada_at?: string | null
          created_at?: string
          curso_id: string
          estado?: string
          fuente?: string | null
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
          completada_at?: string | null
          created_at?: string
          curso_id?: string
          estado?: string
          fuente?: string | null
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
      curso_modulo_material: {
        Row: {
          archivo_url: string | null
          created_at: string
          descripcion: string | null
          id: string
          modulo_id: string
          titulo: string
          url: string | null
        }
        Insert: {
          archivo_url?: string | null
          created_at?: string
          descripcion?: string | null
          id?: string
          modulo_id: string
          titulo: string
          url?: string | null
        }
        Update: {
          archivo_url?: string | null
          created_at?: string
          descripcion?: string | null
          id?: string
          modulo_id?: string
          titulo?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "curso_modulo_material_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "curso_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      curso_modulos: {
        Row: {
          created_at: string
          curso_id: string
          descripcion: string | null
          despublicar_at: string | null
          docente_bio: string | null
          docente_cv_url: string | null
          docente_foto_url: string | null
          docente_nombre: string | null
          icono_url: string | null
          id: string
          orden: number
          publicado: boolean
          publicar_at: string | null
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          curso_id: string
          descripcion?: string | null
          despublicar_at?: string | null
          docente_bio?: string | null
          docente_cv_url?: string | null
          docente_foto_url?: string | null
          docente_nombre?: string | null
          icono_url?: string | null
          id?: string
          orden?: number
          publicado?: boolean
          publicar_at?: string | null
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          curso_id?: string
          descripcion?: string | null
          despublicar_at?: string | null
          docente_bio?: string | null
          docente_cv_url?: string | null
          docente_foto_url?: string | null
          docente_nombre?: string | null
          icono_url?: string | null
          id?: string
          orden?: number
          publicado?: boolean
          publicar_at?: string | null
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
          explicacion: string | null
          id: string
          orden: number
          puntaje: number
          seccion_id: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          enunciado: string
          examen_id: string
          explicacion?: string | null
          id?: string
          orden?: number
          puntaje?: number
          seccion_id?: string | null
          tipo?: string
        }
        Update: {
          created_at?: string
          enunciado?: string
          examen_id?: string
          explicacion?: string | null
          id?: string
          orden?: number
          puntaje?: number
          seccion_id?: string | null
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
          {
            foreignKeyName: "curso_preguntas_seccion_id_fkey"
            columns: ["seccion_id"]
            isOneToOne: false
            referencedRelation: "curso_examen_secciones"
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
          cert_emite_auto: boolean
          cert_esquema_id: string | null
          created_at: string
          created_by: string | null
          cupo_max: number | null
          descripcion: string | null
          descripcion_html: string | null
          despublicar_at: string | null
          dias_acceso_post: number
          duracion_horas: number | null
          enlace_descripcion: string | null
          enlace_titulo: string | null
          enlace_url: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: string
          instructor_bio: string | null
          instructor_foto_url: string | null
          instructor_nombre: string | null
          modalidad: string
          observaciones: string | null
          precio_lista: number | null
          presencia_minima_pct: number
          programa_url: string | null
          publicar_at: string | null
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
          cert_emite_auto?: boolean
          cert_esquema_id?: string | null
          created_at?: string
          created_by?: string | null
          cupo_max?: number | null
          descripcion?: string | null
          descripcion_html?: string | null
          despublicar_at?: string | null
          dias_acceso_post?: number
          duracion_horas?: number | null
          enlace_descripcion?: string | null
          enlace_titulo?: string | null
          enlace_url?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          instructor_bio?: string | null
          instructor_foto_url?: string | null
          instructor_nombre?: string | null
          modalidad?: string
          observaciones?: string | null
          precio_lista?: number | null
          presencia_minima_pct?: number
          programa_url?: string | null
          publicar_at?: string | null
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
          cert_emite_auto?: boolean
          cert_esquema_id?: string | null
          created_at?: string
          created_by?: string | null
          cupo_max?: number | null
          descripcion?: string | null
          descripcion_html?: string | null
          despublicar_at?: string | null
          dias_acceso_post?: number
          duracion_horas?: number | null
          enlace_descripcion?: string | null
          enlace_titulo?: string | null
          enlace_url?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: string
          instructor_bio?: string | null
          instructor_foto_url?: string | null
          instructor_nombre?: string | null
          modalidad?: string
          observaciones?: string | null
          precio_lista?: number | null
          presencia_minima_pct?: number
          programa_url?: string | null
          publicar_at?: string | null
          requisitos_html?: string | null
          slug?: string
          titulo?: string
          updated_at?: string
          vigencia_meses?: number
        }
        Relationships: [
          {
            foreignKeyName: "cursos_cert_esquema_id_fkey"
            columns: ["cert_esquema_id"]
            isOneToOne: false
            referencedRelation: "certificado_esquemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cursos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disertantes: {
        Row: {
          activo: boolean
          bio: string | null
          created_at: string
          created_by: string | null
          cv_url: string | null
          foto_url: string | null
          id: string
          nombre: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          bio?: string | null
          created_at?: string
          created_by?: string | null
          cv_url?: string | null
          foto_url?: string | null
          id?: string
          nombre: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          bio?: string | null
          created_at?: string
          created_by?: string | null
          cv_url?: string | null
          foto_url?: string | null
          id?: string
          nombre?: string
          updated_at?: string
        }
        Relationships: []
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
          color_acento: string
          created_at: string
          cta_text: string | null
          cta_url: string | null
          cuerpo_html_visual: string
          descripcion: string | null
          firma: string | null
          from_casilla: string
          id: string
          incluir_tabla_envio: boolean
          kicker: string
          layout_version: string
          mostrar_logo: boolean
          nombre: string
          reply_to: string | null
          slug: string
          titulo_visual: string
          updated_at: string
          variables: Json
        }
        Insert: {
          activo?: boolean
          asunto: string
          body_html: string
          body_text?: string | null
          color_acento?: string
          created_at?: string
          cta_text?: string | null
          cta_url?: string | null
          cuerpo_html_visual?: string
          descripcion?: string | null
          firma?: string | null
          from_casilla?: string
          id?: string
          incluir_tabla_envio?: boolean
          kicker?: string
          layout_version?: string
          mostrar_logo?: boolean
          nombre: string
          reply_to?: string | null
          slug: string
          titulo_visual?: string
          updated_at?: string
          variables?: Json
        }
        Update: {
          activo?: boolean
          asunto?: string
          body_html?: string
          body_text?: string | null
          color_acento?: string
          created_at?: string
          cta_text?: string | null
          cta_url?: string | null
          cuerpo_html_visual?: string
          descripcion?: string | null
          firma?: string | null
          from_casilla?: string
          id?: string
          incluir_tabla_envio?: boolean
          kicker?: string
          layout_version?: string
          mostrar_logo?: boolean
          nombre?: string
          reply_to?: string | null
          slug?: string
          titulo_visual?: string
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
      encuentro_sesiones_compartidas: {
        Row: {
          created_at: string
          created_by: string | null
          descripcion: string | null
          docente_cv_url: string | null
          docente_foto_url: string | null
          docente_nombre: string | null
          duracion_min: number
          fecha_hora: string | null
          finalizado_at: string | null
          grabacion_play_url: string | null
          grabacion_url: string | null
          id: string
          iniciado_at: string | null
          plataforma: string
          titulo: string
          updated_at: string
          webex_join_url: string | null
          webex_meeting_id: string | null
          webex_meeting_number: string | null
          webex_password: string | null
          webex_start_url: string | null
          webex_status: string | null
          zoom_join_url: string | null
          zoom_meeting_id: number | null
          zoom_password: string | null
          zoom_start_url: string | null
          zoom_status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          docente_cv_url?: string | null
          docente_foto_url?: string | null
          docente_nombre?: string | null
          duracion_min?: number
          fecha_hora?: string | null
          finalizado_at?: string | null
          grabacion_play_url?: string | null
          grabacion_url?: string | null
          id?: string
          iniciado_at?: string | null
          plataforma?: string
          titulo: string
          updated_at?: string
          webex_join_url?: string | null
          webex_meeting_id?: string | null
          webex_meeting_number?: string | null
          webex_password?: string | null
          webex_start_url?: string | null
          webex_status?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: number | null
          zoom_password?: string | null
          zoom_start_url?: string | null
          zoom_status?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          descripcion?: string | null
          docente_cv_url?: string | null
          docente_foto_url?: string | null
          docente_nombre?: string | null
          duracion_min?: number
          fecha_hora?: string | null
          finalizado_at?: string | null
          grabacion_play_url?: string | null
          grabacion_url?: string | null
          id?: string
          iniciado_at?: string | null
          plataforma?: string
          titulo?: string
          updated_at?: string
          webex_join_url?: string | null
          webex_meeting_id?: string | null
          webex_meeting_number?: string | null
          webex_password?: string | null
          webex_start_url?: string | null
          webex_status?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: number | null
          zoom_password?: string | null
          zoom_start_url?: string | null
          zoom_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "encuentro_sesiones_compartidas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      errores_runtime: {
        Row: {
          count: number
          fingerprint: string
          first_seen: string
          id: string
          last_seen: string
          message: string
          payload: Json | null
          resuelto_at: string | null
          stack: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          count?: number
          fingerprint: string
          first_seen?: string
          id?: string
          last_seen?: string
          message: string
          payload?: Json | null
          resuelto_at?: string | null
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          count?: number
          fingerprint?: string
          first_seen?: string
          id?: string
          last_seen?: string
          message?: string
          payload?: Json | null
          resuelto_at?: string | null
          stack?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
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
          webinar_id: string | null
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
          webinar_id?: string | null
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
          webinar_id?: string | null
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
          {
            foreignKeyName: "formularios_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "vw_administracion_webinars"
            referencedColumns: ["webinar_id"]
          },
          {
            foreignKeyName: "formularios_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      frases_diarias: {
        Row: {
          autor: string | null
          frase: string
          mes_dia: string
        }
        Insert: {
          autor?: string | null
          frase: string
          mes_dia: string
        }
        Update: {
          autor?: string | null
          frase?: string
          mes_dia?: string
        }
        Relationships: []
      }
      frases_dispatch_log: {
        Row: {
          dispatched_at: string
          fecha: string
          mes_dia: string
          total_users: number
        }
        Insert: {
          dispatched_at?: string
          fecha: string
          mes_dia: string
          total_users: number
        }
        Update: {
          dispatched_at?: string
          fecha?: string
          mes_dia?: string
          total_users?: number
        }
        Relationships: []
      }
      health_flow_alerts: {
        Row: {
          check_key: string
          id: string
          last_error: string | null
          last_seen_at: string
          origen_run_id: string | null
          push_dispatched_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          started_at: string
        }
        Insert: {
          check_key: string
          id?: string
          last_error?: string | null
          last_seen_at?: string
          origen_run_id?: string | null
          push_dispatched_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          started_at?: string
        }
        Update: {
          check_key?: string
          id?: string
          last_error?: string | null
          last_seen_at?: string
          origen_run_id?: string | null
          push_dispatched_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "health_flow_alerts_origen_run_id_fkey"
            columns: ["origen_run_id"]
            isOneToOne: false
            referencedRelation: "health_flow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      health_flow_runs: {
        Row: {
          checks: Json
          duration_ms: number
          id: string
          origen: string
          overall_status: string
          run_at: string
        }
        Insert: {
          checks?: Json
          duration_ms?: number
          id?: string
          origen?: string
          overall_status: string
          run_at?: string
        }
        Update: {
          checks?: Json
          duration_ms?: number
          id?: string
          origen?: string
          overall_status?: string
          run_at?: string
        }
        Relationships: []
      }
      historico_banco: {
        Row: {
          caja_id: string
          conciliado_at: string | null
          created_at: string
          descripcion: string
          egreso: number
          fecha: string
          hash_dedup: string
          id: string
          ignorada_at: string | null
          ignorada_motivo: string | null
          ingreso: number
          lote_id: string | null
          movimiento_id: string | null
          observaciones: string | null
          saldo: number | null
        }
        Insert: {
          caja_id: string
          conciliado_at?: string | null
          created_at?: string
          descripcion: string
          egreso?: number
          fecha: string
          hash_dedup: string
          id?: string
          ignorada_at?: string | null
          ignorada_motivo?: string | null
          ingreso?: number
          lote_id?: string | null
          movimiento_id?: string | null
          observaciones?: string | null
          saldo?: number | null
        }
        Update: {
          caja_id?: string
          conciliado_at?: string | null
          created_at?: string
          descripcion?: string
          egreso?: number
          fecha?: string
          hash_dedup?: string
          id?: string
          ignorada_at?: string | null
          ignorada_motivo?: string | null
          ingreso?: number
          lote_id?: string | null
          movimiento_id?: string | null
          observaciones?: string | null
          saldo?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "historico_banco_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_banco_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas_con_saldo"
            referencedColumns: ["caja_id"]
          },
          {
            foreignKeyName: "historico_banco_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "historico_banco_lotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_banco_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos"
            referencedColumns: ["id"]
          },
        ]
      }
      historico_banco_lotes: {
        Row: {
          archivo_nombre: string | null
          caja_id: string
          id: string
          importado_at: string
          importado_por: string | null
          lineas_duplicadas: number
          lineas_importadas: number
          lineas_total: number
          observaciones: string | null
        }
        Insert: {
          archivo_nombre?: string | null
          caja_id: string
          id?: string
          importado_at?: string
          importado_por?: string | null
          lineas_duplicadas?: number
          lineas_importadas?: number
          lineas_total?: number
          observaciones?: string | null
        }
        Update: {
          archivo_nombre?: string | null
          caja_id?: string
          id?: string
          importado_at?: string
          importado_por?: string | null
          lineas_duplicadas?: number
          lineas_importadas?: number
          lineas_total?: number
          observaciones?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "historico_banco_lotes_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "historico_banco_lotes_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas_con_saldo"
            referencedColumns: ["caja_id"]
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
      movimiento_adjuntos: {
        Row: {
          filename_original: string
          id: string
          mime_type: string | null
          movimiento_id: string
          size_bytes: number | null
          storage_path: string
          subido_por: string | null
          uploaded_at: string
        }
        Insert: {
          filename_original: string
          id?: string
          mime_type?: string | null
          movimiento_id: string
          size_bytes?: number | null
          storage_path: string
          subido_por?: string | null
          uploaded_at?: string
        }
        Update: {
          filename_original?: string
          id?: string
          mime_type?: string | null
          movimiento_id?: string
          size_bytes?: number | null
          storage_path?: string
          subido_por?: string | null
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "movimiento_adjuntos_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimiento_adjuntos_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          identificado_at: string | null
          identificado_by: string | null
          lote_historico_id: string | null
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
          identificado_at?: string | null
          identificado_by?: string | null
          lote_historico_id?: string | null
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
          identificado_at?: string | null
          identificado_by?: string | null
          lote_historico_id?: string | null
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
            foreignKeyName: "movimientos_lote_historico_id_fkey"
            columns: ["lote_historico_id"]
            isOneToOne: false
            referencedRelation: "movimientos_lotes_historico"
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
      movimientos_lotes_historico: {
        Row: {
          archivo_nombre: string | null
          created_at: string
          created_by: string | null
          id: string
          observaciones: string | null
          total_duplicadas: number
          total_errores: number
          total_importadas: number
          total_lineas: number
        }
        Insert: {
          archivo_nombre?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          observaciones?: string | null
          total_duplicadas?: number
          total_errores?: number
          total_importadas?: number
          total_lineas?: number
        }
        Update: {
          archivo_nombre?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          observaciones?: string | null
          total_duplicadas?: number
          total_errores?: number
          total_importadas?: number
          total_lineas?: number
        }
        Relationships: [
          {
            foreignKeyName: "movimientos_lotes_historico_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notificaciones_internas: {
        Row: {
          archivado_at: string | null
          created_at: string
          cuerpo: string | null
          id: string
          leido_at: string | null
          payload: Json | null
          tipo: string
          titulo: string
          url: string | null
          user_id: string
        }
        Insert: {
          archivado_at?: string | null
          created_at?: string
          cuerpo?: string | null
          id?: string
          leido_at?: string | null
          payload?: Json | null
          tipo: string
          titulo: string
          url?: string | null
          user_id: string
        }
        Update: {
          archivado_at?: string | null
          created_at?: string
          cuerpo?: string | null
          id?: string
          leido_at?: string | null
          payload?: Json | null
          tipo?: string
          titulo?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
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
      pagos_reportados: {
        Row: {
          administracion_id: string
          archivo_path: string | null
          comprobante_id: string | null
          created_at: string
          estado: string
          fecha_pago: string
          id: string
          medio: string
          monto: number
          motivo_rechazo: string | null
          movimiento_id: string | null
          nota: string | null
          referencia: string | null
          reportado_por: string | null
          revisado_at: string | null
          revisado_por: string | null
          tracking_linea_id: string | null
          tramite_id: string | null
          updated_at: string
        }
        Insert: {
          administracion_id: string
          archivo_path?: string | null
          comprobante_id?: string | null
          created_at?: string
          estado?: string
          fecha_pago: string
          id?: string
          medio?: string
          monto: number
          motivo_rechazo?: string | null
          movimiento_id?: string | null
          nota?: string | null
          referencia?: string | null
          reportado_por?: string | null
          revisado_at?: string | null
          revisado_por?: string | null
          tracking_linea_id?: string | null
          tramite_id?: string | null
          updated_at?: string
        }
        Update: {
          administracion_id?: string
          archivo_path?: string | null
          comprobante_id?: string | null
          created_at?: string
          estado?: string
          fecha_pago?: string
          id?: string
          medio?: string
          monto?: number
          motivo_rechazo?: string | null
          movimiento_id?: string | null
          nota?: string | null
          referencia?: string | null
          reportado_por?: string | null
          revisado_at?: string | null
          revisado_por?: string | null
          tracking_linea_id?: string | null
          tramite_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pagos_reportados_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_reportados_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_reportados_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "pagos_reportados_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_atribuciones: {
        Row: {
          comprobante_id: string | null
          convenio_id: string
          created_at: string
          created_by: string | null
          id: string
          imputacion_id: string | null
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
          imputacion_id?: string | null
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
          imputacion_id?: string | null
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
            foreignKeyName: "partner_atribuciones_imputacion_id_fkey"
            columns: ["imputacion_id"]
            isOneToOne: false
            referencedRelation: "movimiento_imputaciones"
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
          emisor_id: string | null
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
          emisor_id?: string | null
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
          emisor_id?: string | null
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
          {
            foreignKeyName: "partners_emisor_id_fkey"
            columns: ["emisor_id"]
            isOneToOne: false
            referencedRelation: "arca_emisores"
            referencedColumns: ["id"]
          },
        ]
      }
      patrones_conciliacion: {
        Row: {
          administracion_id: string | null
          categoria_id: string | null
          creado_por: string | null
          created_at: string
          descripcion_pattern: string
          id: string
          ultimo_uso_at: string | null
          usos_count: number
        }
        Insert: {
          administracion_id?: string | null
          categoria_id?: string | null
          creado_por?: string | null
          created_at?: string
          descripcion_pattern: string
          id?: string
          ultimo_uso_at?: string | null
          usos_count?: number
        }
        Update: {
          administracion_id?: string | null
          categoria_id?: string | null
          creado_por?: string | null
          created_at?: string
          descripcion_pattern?: string
          id?: string
          ultimo_uso_at?: string | null
          usos_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "patrones_conciliacion_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "patrones_conciliacion_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_finanzas"
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
          onboarding_checklist: Json
          partner_id: string | null
          phone: string | null
          pwa_installed_at: string | null
          pwa_last_seen_at: string | null
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
          onboarding_checklist?: Json
          partner_id?: string | null
          phone?: string | null
          pwa_installed_at?: string | null
          pwa_last_seen_at?: string | null
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
          onboarding_checklist?: Json
          partner_id?: string | null
          phone?: string | null
          pwa_installed_at?: string | null
          pwa_last_seen_at?: string | null
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
          {
            foreignKeyName: "profiles_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      prospectos: {
        Row: {
          convertido_a_administracion_id: string | null
          convertido_at: string | null
          creado_por: string | null
          created_at: string
          email: string
          id: string
          nombre: string
          observaciones: string | null
          origen: string
          telefono: string | null
          updated_at: string
        }
        Insert: {
          convertido_a_administracion_id?: string | null
          convertido_at?: string | null
          creado_por?: string | null
          created_at?: string
          email: string
          id?: string
          nombre: string
          observaciones?: string | null
          origen?: string
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          convertido_a_administracion_id?: string | null
          convertido_at?: string | null
          creado_por?: string | null
          created_at?: string
          email?: string
          id?: string
          nombre?: string
          observaciones?: string | null
          origen?: string
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospectos_convertido_a_administracion_id_fkey"
            columns: ["convertido_a_administracion_id"]
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
      salud_alertas_log: {
        Row: {
          enviado_at: string
          id: number
          kind: string
          message: string
          severity: string
        }
        Insert: {
          enviado_at?: string
          id?: number
          kind: string
          message: string
          severity: string
        }
        Update: {
          enviado_at?: string
          id?: number
          kind?: string
          message?: string
          severity?: string
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
          dsn_msg_id: string | null
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
          dsn_msg_id?: string | null
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
          dsn_msg_id?: string | null
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
      servicio_vouchers: {
        Row: {
          activo: boolean
          alcance: string
          codigo: string
          created_at: string
          created_by: string | null
          descuento_pct: number
          expira_at: string | null
          id: string
          max_usos: number | null
          observaciones: string | null
          servicio_id: string
          updated_at: string
          usos_count: number
        }
        Insert: {
          activo?: boolean
          alcance?: string
          codigo: string
          created_at?: string
          created_by?: string | null
          descuento_pct: number
          expira_at?: string | null
          id?: string
          max_usos?: number | null
          observaciones?: string | null
          servicio_id: string
          updated_at?: string
          usos_count?: number
        }
        Update: {
          activo?: boolean
          alcance?: string
          codigo?: string
          created_at?: string
          created_by?: string | null
          descuento_pct?: number
          expira_at?: string | null
          id?: string
          max_usos?: number | null
          observaciones?: string | null
          servicio_id?: string
          updated_at?: string
          usos_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "servicio_vouchers_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
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
          precio_cliente: number | null
          precio_modo: string
          precio_publico: number | null
          requiere_administracion: boolean
          requiere_consorcio: boolean
          sla_dias: number | null
          updated_at: string
          vigencia_meses: number | null
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
          precio_cliente?: number | null
          precio_modo: string
          precio_publico?: number | null
          requiere_administracion?: boolean
          requiere_consorcio?: boolean
          sla_dias?: number | null
          updated_at?: string
          vigencia_meses?: number | null
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
          precio_cliente?: number | null
          precio_modo?: string
          precio_publico?: number | null
          requiere_administracion?: boolean
          requiere_consorcio?: boolean
          sla_dias?: number | null
          updated_at?: string
          vigencia_meses?: number | null
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
          adjuntos_jsonb: Json
          caja_id: string | null
          categoria_finanzas_id: string | null
          creada_por: string | null
          destinatario_email: string
          destinatario_nombre: string | null
          email_queue_id: string | null
          enviada_at: string
          id: string
          monto_pago_gestoria: number | null
          movimiento_id: string | null
          observaciones: string | null
          plantilla_email_slug: string | null
          solicitud_id: string
        }
        Insert: {
          acceso_externo_token?: string | null
          acceso_externo_url?: string | null
          adjuntos_jsonb?: Json
          caja_id?: string | null
          categoria_finanzas_id?: string | null
          creada_por?: string | null
          destinatario_email: string
          destinatario_nombre?: string | null
          email_queue_id?: string | null
          enviada_at?: string
          id?: string
          monto_pago_gestoria?: number | null
          movimiento_id?: string | null
          observaciones?: string | null
          plantilla_email_slug?: string | null
          solicitud_id: string
        }
        Update: {
          acceso_externo_token?: string | null
          acceso_externo_url?: string | null
          adjuntos_jsonb?: Json
          caja_id?: string | null
          categoria_finanzas_id?: string | null
          creada_por?: string | null
          destinatario_email?: string
          destinatario_nombre?: string | null
          email_queue_id?: string | null
          enviada_at?: string
          id?: string
          monto_pago_gestoria?: number | null
          movimiento_id?: string | null
          observaciones?: string | null
          plantilla_email_slug?: string | null
          solicitud_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitud_derivaciones_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitud_derivaciones_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas_con_saldo"
            referencedColumns: ["caja_id"]
          },
          {
            foreignKeyName: "solicitud_derivaciones_categoria_finanzas_id_fkey"
            columns: ["categoria_finanzas_id"]
            isOneToOne: false
            referencedRelation: "categorias_finanzas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitud_derivaciones_email_queue_id_fkey"
            columns: ["email_queue_id"]
            isOneToOne: false
            referencedRelation: "email_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitud_derivaciones_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "movimientos"
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
          bonificacion_100: boolean | null
          cliente_id: string | null
          comprobante_id: string | null
          created_at: string
          derivada_at: string | null
          estado: string
          formulario_submission_id: string | null
          id: string
          motivo_descarte: string | null
          motivo_rechazo: string | null
          observaciones: string | null
          origen_canal: string
          precio_aplicado: number | null
          precio_final: number | null
          rechazada_at: string | null
          rechazada_por: string | null
          servicio_slug: string | null
          servicio_solicitado_id: string | null
          solicitante_email: string | null
          solicitante_nombre: string | null
          solicitante_telefono: string | null
          tramite_id: string | null
          updated_at: string
          voucher_codigo: string | null
          voucher_descuento_pct: number | null
          voucher_id: string | null
        }
        Insert: {
          activada_at?: string | null
          asignada_a?: string | null
          bonificacion_100?: boolean | null
          cliente_id?: string | null
          comprobante_id?: string | null
          created_at?: string
          derivada_at?: string | null
          estado?: string
          formulario_submission_id?: string | null
          id?: string
          motivo_descarte?: string | null
          motivo_rechazo?: string | null
          observaciones?: string | null
          origen_canal?: string
          precio_aplicado?: number | null
          precio_final?: number | null
          rechazada_at?: string | null
          rechazada_por?: string | null
          servicio_slug?: string | null
          servicio_solicitado_id?: string | null
          solicitante_email?: string | null
          solicitante_nombre?: string | null
          solicitante_telefono?: string | null
          tramite_id?: string | null
          updated_at?: string
          voucher_codigo?: string | null
          voucher_descuento_pct?: number | null
          voucher_id?: string | null
        }
        Update: {
          activada_at?: string | null
          asignada_a?: string | null
          bonificacion_100?: boolean | null
          cliente_id?: string | null
          comprobante_id?: string | null
          created_at?: string
          derivada_at?: string | null
          estado?: string
          formulario_submission_id?: string | null
          id?: string
          motivo_descarte?: string | null
          motivo_rechazo?: string | null
          observaciones?: string | null
          origen_canal?: string
          precio_aplicado?: number | null
          precio_final?: number | null
          rechazada_at?: string | null
          rechazada_por?: string | null
          servicio_slug?: string | null
          servicio_solicitado_id?: string | null
          solicitante_email?: string | null
          solicitante_nombre?: string | null
          solicitante_telefono?: string | null
          tramite_id?: string | null
          updated_at?: string
          voucher_codigo?: string | null
          voucher_descuento_pct?: number | null
          voucher_id?: string | null
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
            foreignKeyName: "solicitudes_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "comprobantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_comprobante_id_fkey"
            columns: ["comprobante_id"]
            isOneToOne: false
            referencedRelation: "vw_comprobantes_para_avisar"
            referencedColumns: ["comprobante_id"]
          },
          {
            foreignKeyName: "solicitudes_formulario_submission_id_fkey"
            columns: ["formulario_submission_id"]
            isOneToOne: false
            referencedRelation: "formulario_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_rechazada_por_fkey"
            columns: ["rechazada_por"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          {
            foreignKeyName: "solicitudes_voucher_id_fkey"
            columns: ["voucher_id"]
            isOneToOne: false
            referencedRelation: "servicio_vouchers"
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
          alarma_dispatched_at: string | null
          alerta_en: string | null
          archivos_urls: string[]
          autor_id: string | null
          categoria: string
          created_at: string
          descarte_motivo: string | null
          descripcion: string
          estado_asociado: string | null
          gestor_descripcion_original: string | null
          gestor_label: string | null
          id: string
          moderacion_estado: string | null
          moderada_at: string | null
          moderada_por: string | null
          postergada_motivo: string | null
          postergada_veces: number
          tramite_id: string
          visible_cliente: boolean
        }
        Insert: {
          alarma_dispatched_at?: string | null
          alerta_en?: string | null
          archivos_urls?: string[]
          autor_id?: string | null
          categoria: string
          created_at?: string
          descarte_motivo?: string | null
          descripcion: string
          estado_asociado?: string | null
          gestor_descripcion_original?: string | null
          gestor_label?: string | null
          id?: string
          moderacion_estado?: string | null
          moderada_at?: string | null
          moderada_por?: string | null
          postergada_motivo?: string | null
          postergada_veces?: number
          tramite_id: string
          visible_cliente?: boolean
        }
        Update: {
          alarma_dispatched_at?: string | null
          alerta_en?: string | null
          archivos_urls?: string[]
          autor_id?: string | null
          categoria?: string
          created_at?: string
          descarte_motivo?: string | null
          descripcion?: string
          estado_asociado?: string | null
          gestor_descripcion_original?: string | null
          gestor_label?: string | null
          id?: string
          moderacion_estado?: string | null
          moderada_at?: string | null
          moderada_por?: string | null
          postergada_motivo?: string | null
          postergada_veces?: number
          tramite_id?: string
          visible_cliente?: boolean
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
      tramite_pedidos_doc: {
        Row: {
          cerrado_at: string | null
          cerrado_por: string | null
          creado_at: string
          creado_por: string | null
          descripcion: string
          enviado_para_revision_at: string | null
          estado: string
          id: string
          tramite_id: string
        }
        Insert: {
          cerrado_at?: string | null
          cerrado_por?: string | null
          creado_at?: string
          creado_por?: string | null
          descripcion: string
          enviado_para_revision_at?: string | null
          estado?: string
          id?: string
          tramite_id: string
        }
        Update: {
          cerrado_at?: string | null
          cerrado_por?: string | null
          creado_at?: string
          creado_por?: string | null
          descripcion?: string
          enviado_para_revision_at?: string | null
          estado?: string
          id?: string
          tramite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tramite_pedidos_doc_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramite_pedidos_doc_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramite_pedidos_doc_tramite_id_fkey"
            columns: ["tramite_id"]
            isOneToOne: false
            referencedRelation: "tramites"
            referencedColumns: ["id"]
          },
        ]
      }
      tramite_pedidos_doc_items: {
        Row: {
          archivo_mime: string | null
          archivo_nombre: string | null
          archivo_path: string | null
          archivo_size_bytes: number | null
          descripcion: string
          estado: string
          id: string
          observaciones_rev: string | null
          orden: number
          pedido_id: string
          respuesta_texto: string | null
          revisado_at: string | null
          revisado_por: string | null
          subido_at: string | null
          subido_por: string | null
        }
        Insert: {
          archivo_mime?: string | null
          archivo_nombre?: string | null
          archivo_path?: string | null
          archivo_size_bytes?: number | null
          descripcion: string
          estado?: string
          id?: string
          observaciones_rev?: string | null
          orden?: number
          pedido_id: string
          respuesta_texto?: string | null
          revisado_at?: string | null
          revisado_por?: string | null
          subido_at?: string | null
          subido_por?: string | null
        }
        Update: {
          archivo_mime?: string | null
          archivo_nombre?: string | null
          archivo_path?: string | null
          archivo_size_bytes?: number | null
          descripcion?: string
          estado?: string
          id?: string
          observaciones_rev?: string | null
          orden?: number
          pedido_id?: string
          respuesta_texto?: string | null
          revisado_at?: string | null
          revisado_por?: string | null
          subido_at?: string | null
          subido_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tramite_pedidos_doc_items_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "tramite_pedidos_doc"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramite_pedidos_doc_items_revisado_por_fkey"
            columns: ["revisado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tramite_pedidos_doc_items_subido_por_fkey"
            columns: ["subido_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tramites: {
        Row: {
          administracion_id: string | null
          asignado_a: string | null
          categoria: string
          cierre_satisfactorio: boolean | null
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
          motivo_cierre: string | null
          parent_tracking_id: string | null
          periodo: string | null
          prioridad: string
          reabierto_count: number
          requiere_docs_cliente: boolean
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
          ultima_reapertura_at: string | null
          ultima_reapertura_motivo: string | null
          updated_at: string
          vence_at: string | null
        }
        Insert: {
          administracion_id?: string | null
          asignado_a?: string | null
          categoria: string
          cierre_satisfactorio?: boolean | null
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
          motivo_cierre?: string | null
          parent_tracking_id?: string | null
          periodo?: string | null
          prioridad?: string
          reabierto_count?: number
          requiere_docs_cliente?: boolean
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
          ultima_reapertura_at?: string | null
          ultima_reapertura_motivo?: string | null
          updated_at?: string
          vence_at?: string | null
        }
        Update: {
          administracion_id?: string | null
          asignado_a?: string | null
          categoria?: string
          cierre_satisfactorio?: boolean | null
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
          motivo_cierre?: string | null
          parent_tracking_id?: string | null
          periodo?: string | null
          prioridad?: string
          reabierto_count?: number
          requiere_docs_cliente?: boolean
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
          ultima_reapertura_at?: string | null
          ultima_reapertura_motivo?: string | null
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
      tramix_cache: {
        Row: {
          consultado_at: string
          estado_hash: string | null
          legajo: string
          payload: Json
        }
        Insert: {
          consultado_at?: string
          estado_hash?: string | null
          legajo: string
          payload: Json
        }
        Update: {
          consultado_at?: string
          estado_hash?: string | null
          legajo?: string
          payload?: Json
        }
        Relationships: []
      }
      tramix_detalle_cache: {
        Row: {
          consultado_at: string
          payload: Json
          ref_key: string
        }
        Insert: {
          consultado_at?: string
          payload: Json
          ref_key: string
        }
        Update: {
          consultado_at?: string
          payload?: Json
          ref_key?: string
        }
        Relationships: []
      }
      tramix_documentos_cache: {
        Row: {
          bajado_at: string
          content_type: string | null
          doc_key: string
          nombre: string | null
          storage_path: string
        }
        Insert: {
          bajado_at?: string
          content_type?: string | null
          doc_key: string
          nombre?: string | null
          storage_path: string
        }
        Update: {
          bajado_at?: string
          content_type?: string | null
          doc_key?: string
          nombre?: string | null
          storage_path?: string
        }
        Relationships: []
      }
      tramix_query_log: {
        Row: {
          administracion_id: string | null
          at: string
          id: number
          legajo: string | null
          resultado: string | null
          user_id: string | null
        }
        Insert: {
          administracion_id?: string | null
          at?: string
          id?: never
          legajo?: string | null
          resultado?: string | null
          user_id?: string | null
        }
        Update: {
          administracion_id?: string | null
          at?: string
          id?: never
          legajo?: string | null
          resultado?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      tramix_session: {
        Row: {
          aceptado_at: string | null
          cookie: string | null
          expira_estimada_at: string | null
          id: string
          updated_at: string
        }
        Insert: {
          aceptado_at?: string | null
          cookie?: string | null
          expira_estimada_at?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          aceptado_at?: string | null
          cookie?: string | null
          expira_estimada_at?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tramix_throttle: {
        Row: {
          circuito_abierto_hasta: string | null
          fallos_recientes: number
          id: string
          last_hit_at: string | null
          updated_at: string
        }
        Insert: {
          circuito_abierto_hasta?: string | null
          fallos_recientes?: number
          id?: string
          last_hit_at?: string | null
          updated_at?: string
        }
        Update: {
          circuito_abierto_hasta?: string | null
          fallos_recientes?: number
          id?: string
          last_hit_at?: string | null
          updated_at?: string
        }
        Relationships: []
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
          motivo_pausa: string | null
          notificar_cliente: boolean
          observaciones: string | null
          origen: string
          pausado_at: string | null
          pausado_por: string | null
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
          motivo_pausa?: string | null
          notificar_cliente?: boolean
          observaciones?: string | null
          origen?: string
          pausado_at?: string | null
          pausado_por?: string | null
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
          motivo_pausa?: string | null
          notificar_cliente?: boolean
          observaciones?: string | null
          origen?: string
          pausado_at?: string | null
          pausado_por?: string | null
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
      vistas_guardadas: {
        Row: {
          created_at: string
          es_default: boolean
          filtros: Json
          id: string
          modulo: string
          nombre: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          es_default?: boolean
          filtros?: Json
          id?: string
          modulo: string
          nombre: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          es_default?: boolean
          filtros?: Json
          id?: string
          modulo?: string
          nombre?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      webinar_acceso_tokens: {
        Row: {
          created_at: string
          ip_ultima: string | null
          primera_visita_at: string | null
          revocado_at: string | null
          token: string
          total_visitas: number
          ultima_visita_at: string | null
          user_agent_ultima: string | null
          vence_at: string
          webinar_inscripto_id: string
        }
        Insert: {
          created_at?: string
          ip_ultima?: string | null
          primera_visita_at?: string | null
          revocado_at?: string | null
          token: string
          total_visitas?: number
          ultima_visita_at?: string | null
          user_agent_ultima?: string | null
          vence_at: string
          webinar_inscripto_id: string
        }
        Update: {
          created_at?: string
          ip_ultima?: string | null
          primera_visita_at?: string | null
          revocado_at?: string | null
          token?: string
          total_visitas?: number
          ultima_visita_at?: string | null
          user_agent_ultima?: string | null
          vence_at?: string
          webinar_inscripto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_acceso_tokens_webinar_inscripto_id_fkey"
            columns: ["webinar_inscripto_id"]
            isOneToOne: false
            referencedRelation: "vw_administracion_webinars"
            referencedColumns: ["inscripto_id"]
          },
          {
            foreignKeyName: "webinar_acceso_tokens_webinar_inscripto_id_fkey"
            columns: ["webinar_inscripto_id"]
            isOneToOne: false
            referencedRelation: "webinar_inscriptos"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_inscriptos: {
        Row: {
          administracion_id: string | null
          asistio: boolean
          bienvenida_email_enviada_at: string | null
          canal: string
          email_snapshot: string
          formulario_submission_id: string | null
          gracias_email_enviado_at: string | null
          id: string
          inscripto_at: string
          joined_at: string | null
          left_at: string | null
          nombre_snapshot: string
          profile_id: string | null
          prospecto_id: string | null
          recordatorio_1h_enviado_at: string | null
          recordatorio_24h_enviado_at: string | null
          telefono_snapshot: string | null
          tiempo_conectado_seg: number
          webinar_id: string
        }
        Insert: {
          administracion_id?: string | null
          asistio?: boolean
          bienvenida_email_enviada_at?: string | null
          canal: string
          email_snapshot: string
          formulario_submission_id?: string | null
          gracias_email_enviado_at?: string | null
          id?: string
          inscripto_at?: string
          joined_at?: string | null
          left_at?: string | null
          nombre_snapshot: string
          profile_id?: string | null
          prospecto_id?: string | null
          recordatorio_1h_enviado_at?: string | null
          recordatorio_24h_enviado_at?: string | null
          telefono_snapshot?: string | null
          tiempo_conectado_seg?: number
          webinar_id: string
        }
        Update: {
          administracion_id?: string | null
          asistio?: boolean
          bienvenida_email_enviada_at?: string | null
          canal?: string
          email_snapshot?: string
          formulario_submission_id?: string | null
          gracias_email_enviado_at?: string | null
          id?: string
          inscripto_at?: string
          joined_at?: string | null
          left_at?: string | null
          nombre_snapshot?: string
          profile_id?: string | null
          prospecto_id?: string | null
          recordatorio_1h_enviado_at?: string | null
          recordatorio_24h_enviado_at?: string | null
          telefono_snapshot?: string | null
          tiempo_conectado_seg?: number
          webinar_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webinar_inscriptos_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_inscriptos_formulario_submission_id_fkey"
            columns: ["formulario_submission_id"]
            isOneToOne: false
            referencedRelation: "formulario_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_inscriptos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_inscriptos_prospecto_id_fkey"
            columns: ["prospecto_id"]
            isOneToOne: false
            referencedRelation: "prospectos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_inscriptos_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "vw_administracion_webinars"
            referencedColumns: ["webinar_id"]
          },
          {
            foreignKeyName: "webinar_inscriptos_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
        ]
      }
      webinar_zoom_eventos: {
        Row: {
          created_at: string
          evento: string
          id: string
          ocurrido_at: string
          payload: Json | null
          webinar_id: string
          webinar_inscripto_id: string | null
        }
        Insert: {
          created_at?: string
          evento: string
          id?: string
          ocurrido_at: string
          payload?: Json | null
          webinar_id: string
          webinar_inscripto_id?: string | null
        }
        Update: {
          created_at?: string
          evento?: string
          id?: string
          ocurrido_at?: string
          payload?: Json | null
          webinar_id?: string
          webinar_inscripto_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webinar_zoom_eventos_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "vw_administracion_webinars"
            referencedColumns: ["webinar_id"]
          },
          {
            foreignKeyName: "webinar_zoom_eventos_webinar_id_fkey"
            columns: ["webinar_id"]
            isOneToOne: false
            referencedRelation: "webinars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinar_zoom_eventos_webinar_inscripto_id_fkey"
            columns: ["webinar_inscripto_id"]
            isOneToOne: false
            referencedRelation: "vw_administracion_webinars"
            referencedColumns: ["inscripto_id"]
          },
          {
            foreignKeyName: "webinar_zoom_eventos_webinar_inscripto_id_fkey"
            columns: ["webinar_inscripto_id"]
            isOneToOne: false
            referencedRelation: "webinar_inscriptos"
            referencedColumns: ["id"]
          },
        ]
      }
      webinars: {
        Row: {
          arancel_monto: number | null
          arancel_nota: string | null
          banner_url: string | null
          cert_emite: boolean
          cert_esquema_id: string | null
          creado_por: string | null
          created_at: string
          cupo_presencial: number | null
          cupo_zoom: number | null
          descripcion: string | null
          docentes: Json
          duracion_min: number
          es_arancelado: boolean
          fecha_hora: string
          finalizado_at: string | null
          flyer_url: string | null
          formulario_id: string | null
          grabacion_url: string | null
          id: string
          iniciado_at: string | null
          modalidad: string
          plataforma: string
          publicado: boolean
          status: string
          tipo: string
          titulo: string
          ubicacion_direccion: string | null
          ubicacion_instrucciones: string | null
          ubicacion_localidad: string | null
          ubicacion_lugar: string | null
          ubicacion_mapa_url: string | null
          updated_at: string
          webex_join_url: string | null
          webex_meeting_id: string | null
          webex_password: string | null
          youtube_live_url: string | null
          zoom_join_url: string | null
          zoom_meeting_id: number | null
          zoom_meeting_number: string | null
          zoom_password: string | null
          zoom_start_url: string | null
        }
        Insert: {
          arancel_monto?: number | null
          arancel_nota?: string | null
          banner_url?: string | null
          cert_emite?: boolean
          cert_esquema_id?: string | null
          creado_por?: string | null
          created_at?: string
          cupo_presencial?: number | null
          cupo_zoom?: number | null
          descripcion?: string | null
          docentes?: Json
          duracion_min?: number
          es_arancelado?: boolean
          fecha_hora: string
          finalizado_at?: string | null
          flyer_url?: string | null
          formulario_id?: string | null
          grabacion_url?: string | null
          id?: string
          iniciado_at?: string | null
          modalidad?: string
          plataforma?: string
          publicado?: boolean
          status?: string
          tipo?: string
          titulo: string
          ubicacion_direccion?: string | null
          ubicacion_instrucciones?: string | null
          ubicacion_localidad?: string | null
          ubicacion_lugar?: string | null
          ubicacion_mapa_url?: string | null
          updated_at?: string
          webex_join_url?: string | null
          webex_meeting_id?: string | null
          webex_password?: string | null
          youtube_live_url?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: number | null
          zoom_meeting_number?: string | null
          zoom_password?: string | null
          zoom_start_url?: string | null
        }
        Update: {
          arancel_monto?: number | null
          arancel_nota?: string | null
          banner_url?: string | null
          cert_emite?: boolean
          cert_esquema_id?: string | null
          creado_por?: string | null
          created_at?: string
          cupo_presencial?: number | null
          cupo_zoom?: number | null
          descripcion?: string | null
          docentes?: Json
          duracion_min?: number
          es_arancelado?: boolean
          fecha_hora?: string
          finalizado_at?: string | null
          flyer_url?: string | null
          formulario_id?: string | null
          grabacion_url?: string | null
          id?: string
          iniciado_at?: string | null
          modalidad?: string
          plataforma?: string
          publicado?: boolean
          status?: string
          tipo?: string
          titulo?: string
          ubicacion_direccion?: string | null
          ubicacion_instrucciones?: string | null
          ubicacion_localidad?: string | null
          ubicacion_lugar?: string | null
          ubicacion_mapa_url?: string | null
          updated_at?: string
          webex_join_url?: string | null
          webex_meeting_id?: string | null
          webex_password?: string | null
          youtube_live_url?: string | null
          zoom_join_url?: string | null
          zoom_meeting_id?: number | null
          zoom_meeting_number?: string | null
          zoom_password?: string | null
          zoom_start_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webinars_cert_esquema_id_fkey"
            columns: ["cert_esquema_id"]
            isOneToOne: false
            referencedRelation: "certificado_esquemas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webinars_formulario_id_fkey"
            columns: ["formulario_id"]
            isOneToOne: false
            referencedRelation: "formularios"
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
      vw_administracion_webinars: {
        Row: {
          administracion_id: string | null
          asistio: boolean | null
          canal: string | null
          duracion_min: number | null
          fecha_hora: string | null
          grabacion_url: string | null
          inscripto_at: string | null
          inscripto_id: string | null
          joined_at: string | null
          left_at: string | null
          tiempo_conectado_seg: number | null
          titulo: string | null
          webinar_id: string | null
          webinar_status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webinar_inscriptos_administracion_id_fkey"
            columns: ["administracion_id"]
            isOneToOne: false
            referencedRelation: "administraciones"
            referencedColumns: ["id"]
          },
        ]
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
      _comunicacion_resolver_audiencia: {
        Args: { p_audiencia: Json }
        Returns: {
          administracion_id: string
        }[]
      }
      actualizar_gerente: {
        Args: { p_full_name: string; p_role: string; p_user_id: string }
        Returns: string
      }
      admin_login_email: {
        Args: { p_administracion_id: string }
        Returns: string
      }
      admin_precheck_identidad: {
        Args: { p_cuit?: string; p_dni?: string; p_excluir_id?: string }
        Returns: Json
      }
      administracion_credito_disponible: {
        Args: { p_admin_id: string }
        Returns: number
      }
      administracion_dar_de_baja: {
        Args: { p_administracion_id: string }
        Returns: undefined
      }
      administracion_reactivar: {
        Args: { p_administracion_id: string }
        Returns: undefined
      }
      administracion_webinars: {
        Args: { p_administracion_id: string }
        Returns: {
          asistio: boolean
          canal: string
          duracion_min: number
          fecha_hora: string
          grabacion_url: string
          inscripto_at: string
          inscripto_id: string
          tiempo_conectado_seg: number
          titulo: string
          webinar_id: string
          webinar_status: string
        }[]
      }
      administraciones_con_deuda: { Args: never; Returns: string[] }
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
      alumno_encuentros_hoy: {
        Args: never
        Returns: {
          curso_slug: string
          curso_titulo: string
          duracion_min: number
          encuentro_id: string
          encuentro_titulo: string
          fecha_hora: string
          join_url: string
          modulo: string
          plataforma: string
        }[]
      }
      analitica_cobranzas_mensual: {
        Args: { p_meses?: number }
        Returns: {
          cantidad: number
          mes: string
          total: number
        }[]
      }
      analitica_facturacion_mensual: {
        Args: { p_meses?: number }
        Returns: {
          cantidad: number
          mes: string
          total: number
        }[]
      }
      analitica_funnel: {
        Args: { p_dias?: number }
        Returns: {
          cantidad: number
          etapa: string
          orden: number
        }[]
      }
      analitica_mix_servicios: {
        Args: { p_dias?: number }
        Returns: {
          cantidad: number
          nombre: string
          servicio_id: string
          total: number
        }[]
      }
      analitica_top_clientes: {
        Args: { p_dias?: number; p_limit?: number }
        Returns: {
          administracion_id: string
          nombre: string
          total_comprobantes: number
          total_facturado: number
        }[]
      }
      anular_comprobante: {
        Args: { p_comprobante_id: string; p_motivo: string }
        Returns: string
      }
      anular_comprobante_preview: {
        Args: { p_comprobante_id: string }
        Returns: Json
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
      arca_emisor_default: {
        Args: never
        Returns: {
          activo: boolean
          ambiente: string
          cert_alias: string | null
          cert_b64: string | null
          cert_p12_b64: string | null
          cert_password: string | null
          cert_subido_at: string | null
          cert_valido_desde: string | null
          cert_valido_hasta: string | null
          condicion_iva: string
          created_at: string
          csr_b64: string | null
          csr_generado_at: string | null
          cuit: string | null
          domicilio_fiscal: string | null
          es_default: boolean
          id: string
          key_b64: string | null
          logo_url: string | null
          nombre: string
          punto_venta_default: number
          razon_social: string
          ultimo_test_at: string | null
          ultimo_test_latencia_ms: number | null
          ultimo_test_msg: string | null
          ultimo_test_ok: boolean | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "arca_emisores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      arca_emisor_set_default: {
        Args: { p_emisor_id: string }
        Returns: undefined
      }
      audit_log_listar: {
        Args: {
          p_action_filter?: string
          p_actor_filter?: string
          p_desde?: string
          p_hasta?: string
          p_limit?: number
          p_offset?: number
          p_table_filter?: string
        }
        Returns: {
          action: string
          actor_email: string
          actor_id: string
          created_at: string
          id: number
          payload_after: Json
          payload_before: Json
          row_pk: string
          table_name: string
        }[]
      }
      audit_log_resumen: {
        Args: never
        Returns: {
          table_name: string
          total: number
          ultimos_7d: number
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
      cerrar_mi_sesion: { Args: { p_session_id: string }; Returns: boolean }
      cert_marcar_celebracion_vista: {
        Args: { p_cert_id: string }
        Returns: undefined
      }
      certificado_registrar_pdf: {
        Args: { p_cert_id: string; p_path: string }
        Returns: undefined
      }
      cj_documento_actualizar: {
        Args: {
          p_color_acento: string
          p_cuerpo_html: string
          p_destinatario_email: string
          p_destinatario_nombre: string
          p_firma: string
          p_id: string
          p_kicker: string
          p_mostrar_logo: boolean
          p_tema: string
          p_titulo: string
        }
        Returns: {
          color_acento: string
          created_at: string
          created_by: string | null
          cuerpo_html: string
          destinatario_email: string | null
          destinatario_nombre: string
          firma: string | null
          id: string
          kicker: string
          last_emailed_at: string | null
          last_emailed_to: string | null
          mostrar_logo: boolean
          pdf_generated_at: string | null
          pdf_storage_path: string | null
          tema: string
          titulo: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cj_documentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cj_documento_crear: {
        Args: {
          p_color_acento: string
          p_cuerpo_html: string
          p_destinatario_email: string
          p_destinatario_nombre: string
          p_firma: string
          p_kicker: string
          p_mostrar_logo: boolean
          p_tema: string
          p_titulo: string
        }
        Returns: {
          color_acento: string
          created_at: string
          created_by: string | null
          cuerpo_html: string
          destinatario_email: string | null
          destinatario_nombre: string
          firma: string | null
          id: string
          kicker: string
          last_emailed_at: string | null
          last_emailed_to: string | null
          mostrar_logo: boolean
          pdf_generated_at: string | null
          pdf_storage_path: string | null
          tema: string
          titulo: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cj_documentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cj_documento_eliminar: { Args: { p_id: string }; Returns: undefined }
      cj_documento_get: {
        Args: { p_id: string }
        Returns: {
          color_acento: string
          created_at: string
          created_by: string | null
          cuerpo_html: string
          destinatario_email: string | null
          destinatario_nombre: string
          firma: string | null
          id: string
          kicker: string
          last_emailed_at: string | null
          last_emailed_to: string | null
          mostrar_logo: boolean
          pdf_generated_at: string | null
          pdf_storage_path: string | null
          tema: string
          titulo: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cj_documentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cj_documento_marcar_enviado: {
        Args: { p_id: string; p_to: string }
        Returns: undefined
      }
      cj_documento_marcar_pdf: {
        Args: { p_id: string; p_storage_path: string }
        Returns: {
          color_acento: string
          created_at: string
          created_by: string | null
          cuerpo_html: string
          destinatario_email: string | null
          destinatario_nombre: string
          firma: string | null
          id: string
          kicker: string
          last_emailed_at: string | null
          last_emailed_to: string | null
          mostrar_logo: boolean
          pdf_generated_at: string | null
          pdf_storage_path: string | null
          tema: string
          titulo: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cj_documentos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cj_documentos_listar: {
        Args: never
        Returns: {
          created_at: string
          destinatario_email: string
          destinatario_nombre: string
          id: string
          last_emailed_at: string
          last_emailed_to: string
          pdf_generated_at: string
          pdf_storage_path: string
          tema: string
          titulo: string
        }[]
      }
      cliente_catalogo_formularios: {
        Args: never
        Returns: {
          categoria: string
          descripcion: string
          formulario_id: string
          slug: string
          titulo: string
        }[]
      }
      cliente_certs_celebrar: {
        Args: never
        Returns: {
          cert_id: string
          codigo: string
          curso_id: string
          curso_titulo: string
          emitido_at: string
          link_portal: string
          link_verificacion: string
          origen: string
          webinar_id: string
        }[]
      }
      cliente_ctacte_extracto: {
        Args: { p_admin_id?: string; p_desde?: string; p_hasta?: string }
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
      cliente_deuda_neta: {
        Args: { p_administracion_id: string }
        Returns: {
          pendientes_count: number
          proximo_vencimiento: string
          total: number
          vencidos_count: number
        }[]
      }
      cliente_evento_detalle: { Args: { p_webinar_id: string }; Returns: Json }
      cliente_listar_pagos_comprobante: {
        Args: { p_comprobante_id: string }
        Returns: {
          caja_nombre: string
          created_at: string
          fecha: string
          imputacion_id: string
          monto_imputado: number
          movimiento_id: string
          referencia: string
        }[]
      }
      cliente_marcar_tracking_leido: {
        Args: { p_tramite_id: string }
        Returns: number
      }
      cliente_oportunidad_marcar_mostrada: {
        Args: { p_codigos: string[] }
        Returns: undefined
      }
      cliente_oportunidad_posponer: {
        Args: { p_codigo: string }
        Returns: undefined
      }
      cliente_perfil_datos_formulario: { Args: never; Returns: Json }
      cliente_portal_dashboard: { Args: never; Returns: Json }
      cliente_tracking_avances_nuevos_count: { Args: never; Returns: number }
      cliente_tracking_lineas: {
        Args: { p_tramite_id: string }
        Returns: {
          archivos_urls: string[]
          autor_nombre: string
          categoria_color: string
          categoria_icono: string
          categoria_label: string
          categoria_slug: string
          created_at: string
          descripcion: string
          id: string
        }[]
      }
      cliente_tramites_listar: {
        Args: { p_solo_abiertos?: boolean }
        Returns: {
          categoria: string
          codigo: string
          consorcio_id: string
          created_at: string
          estado: string
          horas_desde_actividad: number
          id: string
          prioridad: string
          servicio_id: string
          titulo: string
          total_adjuntos: number
          total_comentarios: number
          ultima_actividad_at: string
          vence_at: string
        }[]
      }
      cliente_webinar_inscribirme: {
        Args: { p_webinar_id: string }
        Returns: string
      }
      cliente_webinars_listar: { Args: never; Returns: Json }
      cobro_estado: {
        Args: { t: Database["public"]["Tables"]["tramites"]["Row"] }
        Returns: string
      }
      cobro_pendiente: {
        Args: { t: Database["public"]["Tables"]["tramites"]["Row"] }
        Returns: boolean
      }
      comprobante_pendiente: {
        Args: { t: Database["public"]["Tables"]["tramites"]["Row"] }
        Returns: boolean
      }
      comprobante_transformar_a_fiscal: {
        Args: { p_comprobante_id: string; p_nuevo_tipo: string }
        Returns: string
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
      comunicacion_enviar: { Args: { p_id: string }; Returns: Json }
      comunicacion_marcar_vista: {
        Args: { p_comunicacion_id: string }
        Returns: undefined
      }
      comunicacion_preview_destinatarios: {
        Args: { p_audiencia: Json }
        Returns: {
          administracion_id: string
          email: string
          nombre: string
          tiene_user: boolean
        }[]
      }
      comunicaciones_vigentes_cliente: {
        Args: never
        Returns: {
          banner_estilo: string
          cta_label: string
          cta_url: string
          cuerpo_md: string
          enviado_at: string
          id: string
          titulo: string
          visto_at: string
        }[]
      }
      constancia_registrar_pdf: {
        Args: { p_constancia_id: string; p_path: string }
        Returns: undefined
      }
      convertir_prospecto_a_cliente: {
        Args: { p_administracion_id: string; p_prospecto_id: string }
        Returns: undefined
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
      crear_webinar: {
        Args: {
          p_cupo_zoom?: number
          p_descripcion: string
          p_duracion_min?: number
          p_fecha_hora: string
          p_formulario_id?: string
          p_modalidad?: string
          p_plataforma?: string
          p_tipo?: string
          p_titulo: string
          p_youtube_live_url?: string
        }
        Returns: string
      }
      csp_report_registrar: {
        Args: {
          p_blocked: string
          p_disposition: string
          p_document: string
          p_effective: string
          p_line: number
          p_sample: Json
          p_source: string
          p_status: number
          p_violated: string
        }
        Returns: undefined
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
          saldo_a_favor: number
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
          saldo_a_favor: number
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
      curso_desasignar_alumno: {
        Args: { p_matricula_id: string }
        Returns: string
      }
      curso_duplicar: { Args: { p_curso_id: string }; Returns: string }
      curso_encuentro_reconciliar_asistencia: {
        Args: { p_encuentro_id: string; p_participantes: Json }
        Returns: Json
      }
      curso_encuentro_set_zoom: {
        Args: {
          p_duracion_min?: number
          p_encuentro_id: string
          p_join_url: string
          p_meeting_id: number
          p_password: string
          p_start_url: string
        }
        Returns: undefined
      }
      curso_encuentro_zoom_estado: {
        Args: { p_estado: string; p_meeting_id: number; p_ocurrido_at?: string }
        Returns: string
      }
      curso_encuentro_zoom_evento: {
        Args: {
          p_evento: string
          p_matricula_id: string
          p_meeting_id: number
          p_ocurrido_at: string
          p_payload?: Json
        }
        Returns: string
      }
      curso_encuentro_zoom_evento_por_email: {
        Args: {
          p_email: string
          p_evento: string
          p_meeting_id: number
          p_ocurrido_at: string
          p_payload?: Json
        }
        Returns: string
      }
      curso_encuentro_zoom_grabacion: {
        Args: {
          p_grabacion_play_url?: string
          p_grabacion_url: string
          p_meeting_id: number
        }
        Returns: string
      }
      curso_examen_rendir: { Args: { p_examen_id: string }; Returns: Json }
      curso_iniciar_intento: {
        Args: { p_examen_id: string; p_matricula_id: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "examen_intentos"
          isOneToOne: true
          isSetofReturn: false
        }
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
      db_health_metrics: { Args: never; Returns: Json }
      derivacion_reavisar_gestoria: {
        Args: { p_mensaje?: string; p_tramite_id: string }
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
      docs_cliente_pendientes: {
        Args: never
        Returns: {
          cliente_nombre: string
          creado_at: string
          descripcion: string
          items_subidos: number
          pedido_id: string
          tramite_codigo: string
          tramite_id: string
        }[]
      }
      email_template_actualizar_visual: {
        Args: {
          p_asunto?: string
          p_color_acento: string
          p_cta_text: string
          p_cta_url: string
          p_cuerpo_html_visual: string
          p_firma: string
          p_incluir_tabla_envio: boolean
          p_kicker: string
          p_mostrar_logo: boolean
          p_slug: string
          p_titulo_visual: string
        }
        Returns: {
          activo: boolean
          asunto: string
          body_html: string
          body_text: string | null
          color_acento: string
          created_at: string
          cta_text: string | null
          cta_url: string | null
          cuerpo_html_visual: string
          descripcion: string | null
          firma: string | null
          from_casilla: string
          id: string
          incluir_tabla_envio: boolean
          kicker: string
          layout_version: string
          mostrar_logo: boolean
          nombre: string
          reply_to: string | null
          slug: string
          titulo_visual: string
          updated_at: string
          variables: Json
        }
        SetofOptions: {
          from: "*"
          to: "email_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      emitir_certificado: { Args: { p_matricula_id: string }; Returns: string }
      emitir_certificado_si_corresponde: {
        Args: { p_matricula_id: string }
        Returns: string
      }
      emitir_certificado_webinar: {
        Args: { p_profile_id: string; p_webinar_id: string }
        Returns: string
      }
      emitir_certificados_evento: {
        Args: { p_webinar_id: string }
        Returns: string[]
      }
      emitir_certificados_webinar_lote: {
        Args: { p_webinar_id: string }
        Returns: number
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
      emitir_constancia: {
        Args: {
          p_destinatario_final?: string
          p_esquema_id: string
          p_matricula_id: string
          p_texto_final: string
        }
        Returns: Json
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
      encuentro_compartir_con_curso: {
        Args: { p_curso_destino_id: string; p_encuentro_id: string }
        Returns: Json
      }
      encuentro_descompartir: {
        Args: { p_encuentro_id: string }
        Returns: Json
      }
      encuentro_sesion_zoom_estado: {
        Args: { p_estado: string; p_meeting_id: number; p_ocurrido_at?: string }
        Returns: string
      }
      encuentro_sesion_zoom_evento: {
        Args: {
          p_evento: string
          p_matricula_id: string
          p_meeting_id: number
          p_ocurrido_at: string
          p_payload?: Json
        }
        Returns: number
      }
      encuentro_sesion_zoom_grabacion: {
        Args: {
          p_grabacion_play_url?: string
          p_grabacion_url: string
          p_meeting_id: number
        }
        Returns: string
      }
      encuesta_emular_de_curso: {
        Args: { p_curso_destino: string; p_curso_origen: string }
        Returns: string
      }
      encuesta_listar_emulables: {
        Args: never
        Returns: {
          curso_id: string
          curso_titulo: string
          n_preguntas: number
        }[]
      }
      encuesta_marcar_publicado: {
        Args: { p_publicado: boolean; p_respuesta_id: string }
        Returns: undefined
      }
      encuesta_responder: {
        Args: {
          p_matricula_id: string
          p_respuestas: Json
          p_testimonio?: Json
        }
        Returns: string
      }
      enqueue_emision_comprobante: {
        Args: { p_comprobante_id: string }
        Returns: string
      }
      errores_capturar: {
        Args: {
          p_fingerprint: string
          p_message: string
          p_payload?: Json
          p_stack?: string
          p_url?: string
          p_user_agent?: string
        }
        Returns: string
      }
      errores_listar: {
        Args: { p_limit?: number; p_solo_no_resueltos?: boolean }
        Returns: {
          count: number
          fingerprint: string
          first_seen: string
          id: string
          last_seen: string
          message: string
          resuelto_at: string
          stack: string
          url: string
          user_agent: string
          user_email: string
          user_id: string
        }[]
      }
      errores_marcar_resuelto: { Args: { p_id: string }; Returns: boolean }
      fusionar_administraciones: {
        Args: { p_destino: string; p_origen: string }
        Returns: Json
      }
      fz_anular_movimiento: {
        Args: { p_motivo?: string; p_movimiento_id: string }
        Returns: undefined
      }
      fz_caja_actualizar: {
        Args: {
          p_alias?: string
          p_banco_entidad?: string
          p_caja_id: string
          p_cbu?: string
          p_color?: string
          p_es_default?: boolean
          p_icono?: string
          p_nombre: string
          p_numero_cuenta?: string
          p_orden?: number
          p_tipo?: string
        }
        Returns: string
      }
      fz_caja_archivar: { Args: { p_caja_id: string }; Returns: undefined }
      fz_caja_crear: {
        Args: {
          p_alias?: string
          p_banco_entidad?: string
          p_cbu?: string
          p_color?: string
          p_icono?: string
          p_moneda?: string
          p_nombre: string
          p_numero_cuenta?: string
          p_tipo: string
        }
        Returns: string
      }
      fz_caja_eliminar: { Args: { p_caja_id: string }; Returns: string }
      fz_caja_marcar_default: { Args: { p_caja_id: string }; Returns: string }
      fz_caja_reactivar: { Args: { p_caja_id: string }; Returns: undefined }
      fz_categoria_actualizar: {
        Args: {
          p_categoria_id: string
          p_color?: string
          p_icono?: string
          p_nombre: string
          p_tipo: string
        }
        Returns: undefined
      }
      fz_categoria_archivar: {
        Args: { p_categoria_id: string }
        Returns: undefined
      }
      fz_categoria_crear: {
        Args: {
          p_color?: string
          p_icono?: string
          p_nombre: string
          p_tipo: string
        }
        Returns: string
      }
      fz_categoria_reactivar: {
        Args: { p_categoria_id: string }
        Returns: undefined
      }
      fz_conciliacion_kpis: {
        Args: { p_caja_id?: string }
        Returns: {
          conciliadas: number
          ignoradas: number
          pendientes: number
          total_lineas: number
        }[]
      }
      fz_conciliar_manual: {
        Args: { p_historico_id: string; p_movimiento_id: string }
        Returns: undefined
      }
      fz_crear_mov_desde_historico: {
        Args: {
          p_administracion_id?: string
          p_categoria_id?: string
          p_descripcion_custom?: string
          p_guardar_patron?: boolean
          p_historico_id: string
        }
        Returns: string
      }
      fz_crear_movimiento_manual: {
        Args: {
          p_administracion_id?: string
          p_caja_id: string
          p_categoria_id?: string
          p_comprobante_imputar_a_id?: string
          p_consorcio_id?: string
          p_descripcion?: string
          p_fecha: string
          p_monto: number
          p_partner_id_atribucion?: string
          p_referencia?: string
          p_sin_identificar?: boolean
          p_tipo: string
        }
        Returns: string
      }
      fz_crear_transferencia: {
        Args: {
          p_caja_destino_id: string
          p_caja_origen_id: string
          p_descripcion?: string
          p_fecha: string
          p_monto: number
          p_referencia?: string
        }
        Returns: string
      }
      fz_dashboard_kpis: {
        Args: never
        Returns: {
          cajas_activas: number
          egresos_mes: number
          ingresos_mes: number
          movs_pendientes: number
          saldo_total: number
        }[]
      }
      fz_desidentificar_movimiento: {
        Args: { p_movimiento_id: string }
        Returns: undefined
      }
      fz_identificar_movimiento: {
        Args: {
          p_administracion_id?: string
          p_categoria_id?: string
          p_comprobante_id?: string
          p_descripcion?: string
          p_monto_imputar?: number
          p_movimiento_id: string
          p_partner_id_atribucion?: string
        }
        Returns: Json
      }
      fz_ignorar_linea_historico: {
        Args: { p_historico_id: string; p_motivo?: string }
        Returns: undefined
      }
      fz_importar_historico_lote: {
        Args: {
          p_archivo_nombre?: string
          p_caja_id: string
          p_lineas: Json
          p_observaciones?: string
        }
        Returns: Json
      }
      fz_importar_historico_masivo: {
        Args: {
          p_archivo_nombre?: string
          p_dry_run?: boolean
          p_lineas: Json
          p_observaciones?: string
        }
        Returns: Json
      }
      fz_listar_cajas_admin: {
        Args: { p_incluir_archivadas?: boolean }
        Returns: {
          activo: boolean
          alias: string
          banco_entidad: string
          caja_id: string
          cantidad_movimientos: number
          cbu: string
          color: string
          created_at: string
          es_default: boolean
          icono: string
          moneda: string
          nombre: string
          numero_cuenta: string
          orden: number
          saldo: number
          tipo: string
        }[]
      }
      fz_listar_categorias_admin: {
        Args: { p_incluir_archivadas?: boolean }
        Returns: {
          activo: boolean
          cantidad_movimientos: number
          categoria_id: string
          color: string
          created_at: string
          icono: string
          nombre: string
          tipo: string
        }[]
      }
      fz_listar_historico_pendientes: {
        Args: { p_caja_id: string; p_limit?: number; p_offset?: number }
        Returns: {
          caja_id: string
          caja_nombre: string
          conciliado_at: string
          descripcion: string
          egreso: number
          fecha: string
          id: string
          ignorada_at: string
          ingreso: number
          monto_efectivo: number
          observaciones: string
          saldo: number
          tipo_efectivo: string
          total_count: number
        }[]
      }
      fz_listar_lotes_historico: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          archivo_nombre: string
          created_at: string
          created_by_nombre: string
          lote_id: string
          observaciones: string
          total_duplicadas: number
          total_errores: number
          total_importadas: number
          total_lineas: number
        }[]
      }
      fz_listar_movimientos: {
        Args: {
          p_caja_id?: string
          p_fecha_desde?: string
          p_fecha_hasta?: string
          p_incluir_anulados?: boolean
          p_incluir_revertidos?: boolean
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_tipo?: string
        }
        Returns: {
          adjuntos_count: number
          administracion_id: string
          administracion_nombre: string
          caja_color: string
          caja_id: string
          caja_nombre: string
          categoria_id: string
          categoria_nombre: string
          descripcion: string
          estado: string
          fecha: string
          id: string
          identificado_at: string
          monto: number
          movimiento_revertido_id: string
          origen: string
          referencia: string
          revertido_at: string
          tipo: string
          total_count: number
          transferencia_pair_id: string
        }[]
      }
      fz_reporte_balance_mensual: {
        Args: { p_anio?: number; p_solo_activas?: boolean }
        Returns: {
          caja_color: string
          caja_id: string
          caja_nombre: string
          caja_tipo: string
          egresos: number
          ingresos: number
          mes_label: string
          mes_num: number
          saldo_final: number
          saldo_inicial: number
        }[]
      }
      fz_reporte_comparativo: {
        Args: { p_anio?: number }
        Returns: {
          egresos_actual: number
          egresos_anterior: number
          egresos_var_pct: number
          ingresos_actual: number
          ingresos_anterior: number
          ingresos_var_pct: number
          mes_label: string
          mes_num: number
          neto_actual: number
          neto_anterior: number
        }[]
      }
      fz_reporte_flujo_caja: {
        Args: { p_anio?: number; p_caja_id?: string }
        Returns: {
          egresos: number
          ingresos: number
          mes_inicio: string
          mes_label: string
          mes_num: number
          neto: number
          saldo_acumulado: number
        }[]
      }
      fz_reporte_pyg: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: {
          cantidad_movimientos: number
          categoria_color: string
          categoria_id: string
          categoria_nombre: string
          categoria_tipo: string
          tipo_movimiento: string
          total: number
        }[]
      }
      fz_revertir_movimiento: {
        Args: { p_motivo?: string; p_movimiento_id: string }
        Returns: string
      }
      fz_sugerir_matches: {
        Args: { p_historico_id: string }
        Returns: {
          administracion_nombre: string
          categoria_nombre: string
          descripcion: string
          dias_diff: number
          fecha: string
          monto: number
          movimiento_id: string
          score: number
          tipo: string
        }[]
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
      gerencia_alarmas_hoy: {
        Args: never
        Returns: {
          alerta_en: string
          categoria: string
          descripcion: string
          linea_id: string
          postergada_veces: number
          tramite_codigo: string
          tramite_id: string
          tramite_titulo: string
          vencida: boolean
        }[]
      }
      gerencia_proximos_seguimientos: {
        Args: { p_dias?: number }
        Returns: {
          administracion_nombre: string
          alerta_en: string
          categoria: string
          descripcion: string
          dias_restantes: number
          linea_id: string
          tramite_codigo: string
          tramite_id: string
          tramite_titulo: string
        }[]
      }
      gerente_editar_avance_tracking: {
        Args: { p_descripcion: string; p_linea_id: string }
        Returns: string
      }
      gestion_gerente_eliminar: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      gestion_usuarios_listar: {
        Args: never
        Returns: {
          administracion_id: string
          administracion_nombre: string
          avatar_url: string
          created_at: string
          email: string
          email_confirmed: boolean
          full_name: string
          last_sign_in_at: string
          push_activo: boolean
          push_subs_count: number
          pwa_installed_at: string
          pwa_last_seen_at: string
          role: string
          user_id: string
        }[]
      }
      gestor_acceso_ref: {
        Args: { p_token: string }
        Returns: {
          cliente_nombre: string
          servicio_nombre: string
          tramite_codigo: string
        }[]
      }
      gestor_cargar_avance: {
        Args: {
          p_archivos_urls?: string[]
          p_descripcion: string
          p_token: string
        }
        Returns: string
      }
      gestor_listar_avances: {
        Args: { p_token: string }
        Returns: {
          archivos_urls: string[]
          autor_nombre: string
          categoria_color: string
          categoria_icono: string
          categoria_label: string
          categoria_slug: string
          created_at: string
          descripcion: string
          id: string
        }[]
      }
      gestor_obtener_info_solicitud: {
        Args: { p_token: string }
        Returns: Json
      }
      gestor_upload_path_ok: { Args: { p_name: string }; Returns: boolean }
      gestoria_destinatarios_recientes: {
        Args: never
        Returns: {
          email: string
          nombre: string
        }[]
      }
      get_landing_cover_status: { Args: never; Returns: boolean }
      get_public_whatsapp: { Args: never; Returns: string }
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
      gg_campus_emitir_certificados_pendientes: { Args: never; Returns: number }
      gg_campus_tema_certificado: {
        Args: { p_curso_id: string }
        Returns: number
      }
      gg_campus_vencer_matriculas: { Args: never; Returns: undefined }
      gg_encuentros_recordatorio_diario: { Args: never; Returns: Json }
      gg_profile_marcar_pwa: {
        Args: { p_installed: boolean }
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
      gg_webinars_disparar_recordatorios: { Args: never; Returns: Json }
      health_check_cron_jobs_status: {
        Args: { p_jobnames: string[] }
        Returns: {
          active: boolean
          jobname: string
        }[]
      }
      health_check_fn_contains: {
        Args: { p_fn_name: string; p_needle: string; p_schema: string }
        Returns: boolean
      }
      health_check_trigger_existe: {
        Args: { p_table: string; p_trigger_name_like: string }
        Returns: {
          trigger_name: string
        }[]
      }
      health_flow_alert_resolve: { Args: { p_id: string }; Returns: boolean }
      health_flow_alerts_active: {
        Args: never
        Returns: {
          check_key: string
          id: string
          last_error: string
          last_seen_at: string
          origen_run_id: string
          severity: string
          started_at: string
        }[]
      }
      health_flow_alerts_garbage_collect: { Args: never; Returns: number }
      health_flow_record_run: {
        Args: {
          p_checks: Json
          p_duration_ms: number
          p_origen?: string
          p_overall_status: string
        }
        Returns: string
      }
      health_flow_runs_recent: {
        Args: { p_limit?: number }
        Returns: {
          checks: Json
          duration_ms: number
          id: string
          origen: string
          overall_status: string
          run_at: string
        }[]
      }
      import_comprobantes_batch: {
        Args: { p_archivo: string; p_filas: Json }
        Returns: Json
      }
      imputar_credito_a_comprobante: {
        Args: {
          p_comprobante_id: string
          p_monto: number
          p_movimiento_id: string
        }
        Returns: Json
      }
      inscribir_a_webinar: {
        Args: {
          p_email: string
          p_modalidad_preferida?: string
          p_nombre: string
          p_submission_id?: string
          p_telefono?: string
          p_webinar_id: string
        }
        Returns: Json
      }
      is_visible_for_alumno: {
        Args: {
          p_despublicar_at: string
          p_publicado: boolean
          p_publicar_at: string
        }
        Returns: boolean
      }
      kpis_dashboard_global: { Args: { p_desde?: string }; Returns: Json }
      list_webinar_kpis: {
        Args: never
        Returns: {
          en_vivo: number
          finalizados: number
          proximos: number
          total_inscriptos: number
        }[]
      }
      listar_creditos_administracion: {
        Args: { p_administracion_id: string }
        Returns: {
          comprobante_origen: string
          comprobante_origen_estado: string
          comprobante_origen_id: string
          descripcion: string
          fecha: string
          monto: number
          movimiento_id: string
          origen_detalle: string
          origen_tipo: string
          saldo_disponible: number
        }[]
      }
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
      marcar_renovados_masivo: {
        Args: { p_ids: string[]; p_nuevas_fechas: string[] }
        Returns: {
          nuevo_id: string
          original_id: string
        }[]
      }
      matricula_cumple_encuesta: {
        Args: { p_matricula_id: string }
        Returns: boolean
      }
      matricula_sync_encuesta: {
        Args: { p_matricula_id: string }
        Returns: undefined
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
      mis_sesiones_activas: {
        Args: never
        Returns: {
          created_at: string
          es_actual: boolean
          id: string
          ip: unknown
          not_after: string
          refreshed_at: string
          updated_at: string
          user_agent: string
        }[]
      }
      normalizar_nombre: { Args: { p: string }; Returns: string }
      notif_archivar: { Args: { p_id: string }; Returns: boolean }
      notif_archivar_todas: { Args: never; Returns: number }
      notif_listar: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_solo_no_leidas?: boolean
        }
        Returns: {
          created_at: string
          cuerpo: string
          id: string
          leido_at: string
          payload: Json
          tipo: string
          titulo: string
          url: string
        }[]
      }
      notif_marcar_leida: { Args: { p_id: string }; Returns: boolean }
      notif_marcar_todas_leidas: { Args: never; Returns: number }
      notif_no_leidas_count: { Args: never; Returns: number }
      notificar_usuario: {
        Args: {
          p_cuerpo: string
          p_payload?: Json
          p_tipo: string
          p_titulo: string
          p_url?: string
          p_user_id: string
        }
        Returns: string
      }
      notify_all_gerentes: {
        Args: {
          p_cuerpo?: string
          p_email_vars?: Json
          p_evento_codigo: string
          p_payload?: Json
          p_prioridad?: number
          p_related_id?: string
          p_related_table?: string
          p_send_email?: boolean
          p_template_slug?: string
          p_titulo: string
          p_url?: string
        }
        Returns: number
      }
      onboarding_checklist_set: {
        Args: { p_key: string; p_value: boolean }
        Returns: Json
      }
      pago_conciliar: {
        Args: {
          p_caja_id: string
          p_categoria_id: string
          p_comprobante_id?: string
          p_fecha?: string
          p_monto?: number
          p_pago_id: string
          p_partner_id_atribucion?: string
          p_permitir_excedente?: boolean
        }
        Returns: string
      }
      pago_rechazar: {
        Args: { p_motivo: string; p_pago_id: string }
        Returns: undefined
      }
      pago_reportar: {
        Args: {
          p_archivo_path: string
          p_comprobante_id: string
          p_fecha_pago: string
          p_medio: string
          p_monto: number
          p_nota: string
          p_referencia: string
          p_tracking_linea_id: string
          p_tramite_id: string
        }
        Returns: string
      }
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
      partner_marcar_facturado: {
        Args: {
          p_comprobante_id: string
          p_numero_externo: string
          p_observacion?: string
          p_pdf_url?: string
        }
        Returns: string
      }
      partner_mis_comprobantes: {
        Args: never
        Returns: {
          emitido_arca: boolean
          estado: string
          estado_cobranza: string
          fecha: string
          id: string
          numero: number
          partner_facturado_at: string
          partner_numero_externo: string
          punto_venta: number
          receptor_razon_social: string
          tipo: string
          total: number
          vencimiento: string
        }[]
      }
      partner_mis_rendiciones: {
        Args: never
        Returns: {
          estado: string
          id: string
          periodo_desde: string
          periodo_hasta: string
          total_costos_atribuidos: number
          total_costos_brutos: number
          total_ingresos_atribuidos: number
          total_ingresos_brutos: number
        }[]
      }
      partner_rendicion_movimientos: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: {
          atribucion_id: string
          cliente_nombre: string
          comprobante_label: string
          fecha: string
          monto_atribuido: number
          monto_base: number
          porcentaje: number
          saldo_running: number
          servicio_nombre: string
          tipo: string
        }[]
      }
      partner_sabana: {
        Args: { p_desde?: string; p_hasta?: string; p_partner_id?: string }
        Returns: {
          adjuntos_count: number
          chip: string
          cliente_nombre: string
          comprobante_id: string
          comprobante_label: string
          comprobante_saldo: number
          comprobante_total: number
          descripcion: string
          fecha: string
          movimiento_id: string
          operacion_monto: number
          participacion_monto: number
          porcentaje: number
          saldo_participacion: number
          tipo: string
        }[]
      }
      peek_proximo_numero: {
        Args: { p_punto_venta: number; p_tipo: string }
        Returns: number
      }
      posible_duplicado: {
        Args: { t: Database["public"]["Tables"]["tramites"]["Row"] }
        Returns: boolean
      }
      postergar_alarma_tracking: {
        Args: { p_dias: number; p_linea_id: string; p_motivo?: string }
        Returns: string
      }
      prospecto_eventos: {
        Args: { p_prospecto_id: string }
        Returns: {
          asistio: boolean
          canal: string
          fecha_hora: string
          titulo: string
          webinar_id: string
        }[]
      }
      prospectos_listado: {
        Args: { p_webinar_id?: string }
        Returns: {
          cliente_activo: boolean
          cliente_estado: string
          convertido: boolean
          convertido_a_administracion_id: string
          convertido_at: string
          created_at: string
          email: string
          eventos_asistidos: number
          eventos_total: number
          id: string
          nombre: string
          observaciones: string
          origen: string
          telefono: string
          ultimo_evento_at: string
          updated_at: string
        }[]
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
          motivo_pausa: string
          observaciones: string
          pausado_at: string
          sugerencia_servicio_slug: string
          sujeto: string
          sujeto_id: string
          tipo: string
          tracking_id: string
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
          p_partner_id_atribucion?: string
          p_permitir_excedente?: boolean
          p_referencia: string
        }
        Returns: string
      }
      reintentar_arca_job: { Args: { p_job_id: string }; Returns: string }
      reset_arca_jobs_colgados: {
        Args: { p_max_age_min?: number }
        Returns: number
      }
      resolver_esquema_curso: { Args: { p_curso_id: string }; Returns: Json }
      resolver_esquema_webinar: {
        Args: { p_webinar_id: string }
        Returns: Json
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
      revocar_certificado: {
        Args: { p_id: string; p_motivo: string }
        Returns: undefined
      }
      set_landing_cover: { Args: { p_enabled: boolean }; Returns: boolean }
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
          p_dias_validez?: number
          p_observaciones?: string
          p_plantilla_slug?: string
          p_solicitud_id: string
        }
        Returns: string
      }
      solicitud_derivar_v2: {
        Args: {
          p_adjuntos?: Json
          p_destinatario_email: string
          p_destinatario_nombre: string
          p_dias_validez?: number
          p_monto_pago?: number
          p_observaciones?: string
          p_plantilla_slug?: string
          p_solicitud_id: string
        }
        Returns: string
      }
      solicitud_derivar_v3: {
        Args: {
          p_adjuntos?: Json
          p_caja_id?: string
          p_categoria_id?: string
          p_destinatario_email: string
          p_destinatario_nombre: string
          p_dias_validez?: number
          p_monto_pago?: number
          p_observaciones?: string
          p_plantilla_slug?: string
          p_solicitud_id: string
        }
        Returns: Json
      }
      solicitud_descartar: {
        Args: { p_motivo: string; p_solicitud_id: string }
        Returns: undefined
      }
      solicitud_guardar_observaciones: {
        Args: { p_observaciones?: string; p_solicitud_id: string }
        Returns: undefined
      }
      solicitud_marcar_en_revision: {
        Args: { p_observaciones?: string; p_solicitud_id: string }
        Returns: undefined
      }
      solicitud_match_cliente: {
        Args: { p_submission_id: string }
        Returns: {
          administracion_id: string
          administracion_nombre: string
          cuit: string
          email: string
          match_por: string
        }[]
      }
      solicitud_pedir_docs_revision: {
        Args: { p_mensaje: string; p_solicitud_id: string }
        Returns: undefined
      }
      solicitud_rechazar: {
        Args: { p_motivo: string; p_solicitud_id: string }
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
          p_visible_cliente?: boolean
        }
        Returns: string
      }
      tracking_cerrar: {
        Args: {
          p_documento_final_url?: string
          p_motivo_cierre: string
          p_observaciones?: string
          p_satisfactorio: boolean
          p_tramite_id: string
        }
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
          cierre_satisfactorio: boolean | null
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
          motivo_cierre: string | null
          parent_tracking_id: string | null
          periodo: string | null
          prioridad: string
          reabierto_count: number
          requiere_docs_cliente: boolean
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
          ultima_reapertura_at: string | null
          ultima_reapertura_motivo: string | null
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
      tracking_moderacion_pendientes: {
        Args: never
        Returns: {
          archivos_urls: string[]
          cliente_nombre: string
          created_at: string
          descripcion: string
          gestor_label: string
          linea_id: string
          servicio_nombre: string
          tramite_codigo: string
          tramite_id: string
        }[]
      }
      tracking_moderar_gestor_avance: {
        Args: {
          p_accion: string
          p_archivos_urls?: string[]
          p_descripcion?: string
          p_estado_asociado?: string
          p_linea_id: string
          p_motivo?: string
        }
        Returns: undefined
      }
      tracking_reabrir: {
        Args: {
          p_motivo: string
          p_notificar_cliente?: boolean
          p_tramite_id: string
        }
        Returns: undefined
      }
      tramite_avisar_cancelacion: {
        Args: { p_tramite_id: string }
        Returns: Json
      }
      tramite_cancelar: {
        Args: {
          p_anular_comprobante?: boolean
          p_motivo?: string
          p_tramite_id: string
        }
        Returns: Json
      }
      tramite_cobro_resumen: { Args: { p_tramite_id: string }; Returns: Json }
      tramite_docs_cliente: {
        Args: { p_tramite_id: string }
        Returns: {
          bucket: string
          nombre: string
          origen: string
          path: string
        }[]
      }
      tramite_incrementar_vistas: {
        Args: { p_tramite_id: string }
        Returns: undefined
      }
      tramite_pedido_doc_aprobar_item: {
        Args: { p_item_id: string }
        Returns: undefined
      }
      tramite_pedido_doc_crear: {
        Args: { p_descripcion: string; p_items: string[]; p_tramite_id: string }
        Returns: string
      }
      tramite_pedido_doc_enviar_revision: {
        Args: { p_pedido_id: string }
        Returns: Json
      }
      tramite_pedido_doc_rechazar_item: {
        Args: { p_item_id: string; p_motivo: string }
        Returns: undefined
      }
      tramite_pedido_doc_responder_texto_item: {
        Args: { p_item_id: string; p_texto: string }
        Returns: undefined
      }
      tramite_pedido_doc_subir_item: {
        Args: {
          p_archivo_mime: string
          p_archivo_nombre: string
          p_archivo_path: string
          p_archivo_size: number
          p_item_id: string
        }
        Returns: undefined
      }
      tramite_post_cancelacion_info: {
        Args: { p_tramite_id: string }
        Returns: Json
      }
      tramix_gate: {
        Args: { p_force?: boolean; p_legajo: string; p_user: string }
        Returns: Json
      }
      tramix_record: {
        Args: {
          p_administracion: string
          p_legajo: string
          p_resultado: string
          p_user: string
        }
        Returns: undefined
      }
      vencimiento_eliminar: { Args: { p_id: string }; Returns: undefined }
      vencimiento_pausar: {
        Args: { p_id: string; p_motivo?: string }
        Returns: undefined
      }
      vencimiento_reanudar: { Args: { p_id: string }; Returns: undefined }
      verificar_certificado: { Args: { p_codigo: string }; Returns: Json }
      vistas_borrar: { Args: { p_id: string }; Returns: boolean }
      vistas_guardar: {
        Args: {
          p_es_default?: boolean
          p_filtros: Json
          p_modulo: string
          p_nombre: string
        }
        Returns: string
      }
      vistas_listar: {
        Args: { p_modulo: string }
        Returns: {
          created_at: string
          es_default: boolean
          filtros: Json
          id: string
          nombre: string
        }[]
      }
      vistas_set_default: { Args: { p_id: string }; Returns: boolean }
      voucher_incrementar_uso: {
        Args: { p_voucher_id: string }
        Returns: undefined
      }
      voucher_validar: {
        Args: {
          p_codigo: string
          p_es_cliente?: boolean
          p_servicio_id: string
        }
        Returns: Json
      }
      webex_encuentro_ended: {
        Args: { p_ended_at?: string; p_webex_meeting_id: string }
        Returns: string
      }
      webex_encuentro_started: {
        Args: { p_started_at?: string; p_webex_meeting_id: string }
        Returns: string
      }
      webex_participant_joined: {
        Args: {
          p_customer_key: string
          p_display_name?: string
          p_joined_at: string
          p_webex_meeting_id: string
        }
        Returns: string
      }
      webex_participant_left: {
        Args: {
          p_customer_key: string
          p_left_at: string
          p_webex_meeting_id: string
        }
        Returns: string
      }
      webinar_captacion_resumen: {
        Args: { p_webinar_id: string }
        Returns: Json
      }
      webinar_duplicar: { Args: { p_webinar_id: string }; Returns: string }
      webinar_inscripcion_activa: { Args: never; Returns: Json }
      webinar_marcar_asistencia: {
        Args: { p_asistio: boolean; p_inscripto_id: string }
        Returns: undefined
      }
      webinar_set_zoom: {
        Args: {
          p_duracion_min?: number
          p_join_url: string
          p_meeting_id: number
          p_meeting_number?: string
          p_password: string
          p_start_url: string
          p_webinar_id: string
        }
        Returns: undefined
      }
      webinar_zoom_evento: {
        Args: {
          p_evento: string
          p_inscripto_id: string
          p_ocurrido_at: string
          p_payload?: Json
          p_zoom_meeting_id: number
        }
        Returns: undefined
      }
      zoom_encuentros_pendientes_reconciliar: {
        Args: never
        Returns: {
          encuentro_id: string
          zoom_meeting_id: number
        }[]
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
