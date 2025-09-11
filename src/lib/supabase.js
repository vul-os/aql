import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://zjaeljuzyuuaxprcfvrz.supabase.co'
const supabaseAnonKey = 'sb_secret_REDACTED'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Database types (expanded to include smart home devices)
export const Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          phone: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          phone?: string | null
        }
        Update: {
          full_name?: string | null
          phone?: string | null
        }
      }
      places: {
        Row: {
          id: string
          name: string
          address: string
          city: string
          state: string
          country: string
          postal_code: string | null
          latitude: number | null
          longitude: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          name: string
          address: string
          city: string
          state: string
          country?: string
          postal_code?: string | null
          latitude?: number | null
          longitude?: number | null
        }
        Update: {
          name?: string
          address?: string
          city?: string
          state?: string
          country?: string
          postal_code?: string | null
          latitude?: number | null
          longitude?: number | null
        }
      }
      place_members: {
        Row: {
          id: string
          place_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          place_id: string
          user_id: string
          role?: string
        }
        Update: {
          role?: string
        }
      }
      coverage_areas: {
        Row: {
          id: string
          name: string
          city: string
          state: string
          country: string
          postal_code: string | null
          latitude: number | null
          longitude: number | null
          radius_km: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          name: string
          city: string
          state: string
          country?: string
          postal_code?: string | null
          latitude?: number | null
          longitude?: number | null
          radius_km?: number
          is_active?: boolean
        }
        Update: {
          name?: string
          city?: string
          state?: string
          country?: string
          postal_code?: string | null
          latitude?: number | null
          longitude?: number | null
          radius_km?: number
          is_active?: boolean
        }
      }
      bots: {
        Row: {
          id: string
          place_id: string
          name: string
          type: string
          model: string | null
          serial_number: string | null
          status: string
          last_seen: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          place_id: string
          name: string
          type: string
          model?: string | null
          serial_number?: string | null
          status?: string
          last_seen?: string | null
        }
        Update: {
          name?: string
          type?: string
          model?: string | null
          serial_number?: string | null
          status?: string
          last_seen?: string | null
        }
      }
      bot_schedules: {
        Row: {
          id: string
          bot_id: string
          name: string
          schedule_type: string
          schedule_data: any
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          bot_id: string
          name: string
          schedule_type: string
          schedule_data: any
          is_active?: boolean
        }
        Update: {
          name?: string
          schedule_type?: string
          schedule_data?: any
          is_active?: boolean
        }
      }
      bot_sensors: {
        Row: {
          id: string
          bot_id: string
          sensor_type: string
          sensor_name: string
          value: number | null
          unit: string | null
          metadata: any | null
          recorded_at: string
        }
        Insert: {
          bot_id: string
          sensor_type: string
          sensor_name: string
          value?: number | null
          unit?: string | null
          metadata?: any | null
        }
        Update: {
          sensor_type?: string
          sensor_name?: string
          value?: number | null
          unit?: string | null
          metadata?: any | null
        }
      }
      bot_commands: {
        Row: {
          id: string
          bot_id: string
          command_type: string
          command_data: any | null
          status: string
          sent_at: string
          acknowledged_at: string | null
          created_by: string | null
        }
        Insert: {
          bot_id: string
          command_type: string
          command_data?: any | null
          status?: string
          created_by?: string | null
        }
        Update: {
          command_type?: string
          command_data?: any | null
          status?: string
          acknowledged_at?: string | null
        }
      }
      // Smart Home Device Tables
      device_types: {
        Row: {
          id: string
          name: string
          category: string
          description: string | null
          icon: string | null
          capabilities: any | null
          created_at: string
        }
        Insert: {
          name: string
          category: string
          description?: string | null
          icon?: string | null
          capabilities?: any | null
        }
        Update: {
          name?: string
          category?: string
          description?: string | null
          icon?: string | null
          capabilities?: any | null
        }
      }
      smart_devices: {
        Row: {
          id: string
          place_id: string
          device_type_id: string
          name: string
          room: string | null
          brand: string | null
          model: string | null
          serial_number: string | null
          mac_address: string | null
          ip_address: string | null
          status: string
          last_seen: string | null
          is_active: boolean
          metadata: any | null
          created_at: string
          updated_at: string
        }
        Insert: {
          place_id: string
          device_type_id: string
          name: string
          room?: string | null
          brand?: string | null
          model?: string | null
          serial_number?: string | null
          mac_address?: string | null
          ip_address?: string | null
          status?: string
          last_seen?: string | null
          is_active?: boolean
          metadata?: any | null
        }
        Update: {
          name?: string
          room?: string | null
          brand?: string | null
          model?: string | null
          serial_number?: string | null
          mac_address?: string | null
          ip_address?: string | null
          status?: string
          last_seen?: string | null
          is_active?: boolean
          metadata?: any | null
        }
      }
      device_states: {
        Row: {
          id: string
          device_id: string
          state_data: any
          recorded_at: string
        }
        Insert: {
          device_id: string
          state_data: any
        }
        Update: {
          state_data?: any
        }
      }
      device_commands: {
        Row: {
          id: string
          device_id: string
          command_type: string
          command_data: any | null
          status: string
          sent_at: string
          acknowledged_at: string | null
          created_by: string | null
          response_data: any | null
        }
        Insert: {
          device_id: string
          command_type: string
          command_data?: any | null
          status?: string
          created_by?: string | null
          response_data?: any | null
        }
        Update: {
          command_type?: string
          command_data?: any | null
          status?: string
          acknowledged_at?: string | null
          response_data?: any | null
        }
      }
      device_schedules: {
        Row: {
          id: string
          device_id: string
          name: string
          schedule_type: string
          schedule_data: any
          action_data: any
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          device_id: string
          name: string
          schedule_type: string
          schedule_data: any
          action_data: any
          is_active?: boolean
        }
        Update: {
          name?: string
          schedule_type?: string
          schedule_data?: any
          action_data?: any
          is_active?: boolean
        }
      }
      device_groups: {
        Row: {
          id: string
          place_id: string
          name: string
          description: string | null
          group_type: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          place_id: string
          name: string
          description?: string | null
          group_type?: string | null
        }
        Update: {
          name?: string
          description?: string | null
          group_type?: string | null
        }
      }
      device_group_members: {
        Row: {
          id: string
          group_id: string
          device_id: string
          created_at: string
        }
        Insert: {
          group_id: string
          device_id: string
        }
        Update: {}
      }
      scenes: {
        Row: {
          id: string
          place_id: string
          name: string
          description: string | null
          scene_data: any
          icon: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          place_id: string
          name: string
          description?: string | null
          scene_data: any
          icon?: string | null
          is_active?: boolean
        }
        Update: {
          name?: string
          description?: string | null
          scene_data?: any
          icon?: string | null
          is_active?: boolean
        }
      }
    }
  }
}
