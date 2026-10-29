// Re-export the Supabase client as `db` so existing imports keep working.
// All data access uses: db.from('table').select().eq('col', val) etc.
export { db, getSupabase, checkSupabase, SupabaseNotConfiguredError } from '@/lib/supabase-server'
