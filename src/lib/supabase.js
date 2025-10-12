import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://kyoowsarfopltjwmhksi.supabase.co'
const supabaseAnonKey = 'REDACTED_JWT'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
