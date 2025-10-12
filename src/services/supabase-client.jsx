import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://kyoowsarfopltjwmhksi.supabase.co';
const supabaseKey = 'REDACTED_JWT'

export let supabase = createClient(supabaseUrl, supabaseKey);
