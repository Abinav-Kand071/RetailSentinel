import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://umqehqusjhivtnzavqpm.supabase.co";

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtcWVocXVzamhpdnRuemF2cXBtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc0MTQ1NjAsImV4cCI6MjEwMjk5MDU2MH0.B7HfVxCczEbi-t7y5Olv9TZEw7k7iKDwq7g6A7E0j8s";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
