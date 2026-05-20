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
          error_msg: string | null
          html_body: string | null
          id: string
          kind: string
          lote_id: string | null
          max_attempts: number
          parte: number
          partes_total: number
          plantilla_tipo: string | null
          reply_to: string | null
          resend_id: string | null
          scheduled_at: string
          sending_started_at: string | null
          sent_at: string | null
          status: string
          subject: string
          to_email: string
          updated_at: string
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
          error_msg?: string | null
          html_body?: string | null
          id?: string
          kind?: string
          lote_id?: string | null
          max_attempts?: number
          parte?: number
          partes_total?: number
          plantilla_tipo?: string | null
          reply_to?: string | null
          resend_id?: string | null
          scheduled_at: string
          sending_started_at?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          to_email: string
          updated_at?: string
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
          error_msg?: string | null
          html_body?: string | null
          id?: string
          kind?: string
          lote_id?: string | null
          max_attempts?: number
          parte?: number
          partes_total?: number
          plantilla_tipo?: string | null
          reply_to?: string | null
          resend_id?: string | null
          scheduled_at?: string
          sending_started_at?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          to_email?: string
          updated_at?: string
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
          from_email: string
          html: string | null
          id: string
          importe_total: number | null
          last_event_at: string | null
          opened_at: string | null
          plantilla: string | null
          reply_to: string | null
          resend_id: string | null
          to_email: string
          updated_at: string
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
          from_email?: string
          html?: string | null
          id?: string
          importe_total?: number | null
          last_event_at?: string | null
          opened_at?: string | null
          plantilla?: string | null
          reply_to?: string | null
          resend_id?: string | null
          to_email: string
          updated_at?: string
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
          from_email?: string
          html?: string | null
          id?: string
          importe_total?: number | null
          last_event_at?: string | null
          opened_at?: string | null
          plantilla?: string | null
          reply_to?: string | null
          resend_id?: string | null
          to_email?: string
          updated_at?: string
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
      tabulador_precios: {
        Row: {
          administracion_id: string | null
          convenio: string | null
          created_at: string
          created_by: string | null
          id: string
          motivo: string | null
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
          convenio?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          motivo?: string | null
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
          convenio?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          motivo?: string | null
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
    }
    Functions: {
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
      desimputar_cobranza: {
        Args: { p_imputacion_id: string }
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
      normalizar_nombre: { Args: { p: string }; Returns: string }
      peek_proximo_numero: {
        Args: { p_punto_venta: number; p_tipo: string }
        Returns: number
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
