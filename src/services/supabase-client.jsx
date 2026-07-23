import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL || (typeof window !== 'undefined' ? (window.__env?.VITE_SUPABASE_URL || window.__env?.SUPABASE_URL) : undefined);
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || (typeof window !== 'undefined' ? (window.__env?.VITE_SUPABASE_ANON_KEY || window.__env?.SUPABASE_ANON_KEY) : undefined);

export const supabase = createClient(supabaseUrl, supabaseKey);
