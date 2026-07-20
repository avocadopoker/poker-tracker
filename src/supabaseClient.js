import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pbhtfddxmozijvntuxii.supabase.co'
const supabaseKey = 'sb_publishable_YHMpBF8sIpDX5ryA8Q1f7w_DsIQ3RpW'

export const supabase = createClient(supabaseUrl, supabaseKey)