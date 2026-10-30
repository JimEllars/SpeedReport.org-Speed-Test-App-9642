import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createHandler } from './handler.js';

const { AXIM_INTERNAL_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT = '8787' } = process.env;
for (const [k, v] of Object.entries({ AXIM_INTERNAL_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) {
    console.error(`Missing required env var ${k}`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const store = {
  async upsertLead(row) {
    const { error } = await supabase.from('leads').upsert(row, { onConflict: 'test_id' });
    if (error) throw error;
  },
};

http.createServer(createHandler({ internalKey: AXIM_INTERNAL_KEY, store })).listen(Number(PORT), () => {
  console.info(`AXiM Core listening on :${PORT}`);
});
