import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal } from '@shared/errors.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MuslimAiSession {
  id: string;
  history: ChatMessage[];
  owner_key_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 jam

export function muslimAiRepo(db: SupabaseClient) {
  return {
    /** Ambil session kalau masih ada dan belum expired. Null kalau tidak ketemu/sudah expired. */
    async find(id: string): Promise<MuslimAiSession | null> {
      const { data, error } = await db
        .from('muslim_ai_sessions')
        .select('*')
        .eq('id', id)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle<MuslimAiSession>();
      if (error) throw Internal(`muslimAi.find: ${error.message}`);
      return data ?? null;
    },

    /**
     * Simpan history baru + reset TTL ke 24 jam dari sekarang.
     * Atomic lewat RPC supaya tidak ada race condition antar request bersamaan.
     */
    async upsert(id: string, history: ChatMessage[], ownerKeyId: string | null): Promise<MuslimAiSession> {
      const { data, error } = await db.rpc('upsert_muslim_ai_session', {
        p_id: id,
        p_history: history,
        p_owner_key: ownerKeyId,
        p_ttl_seconds: SESSION_TTL_SECONDS,
      });
      if (error) throw Internal(`muslimAi.upsert: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw Internal('muslimAi.upsert: empty result');
      return row as MuslimAiSession;
    },

    async delete(id: string): Promise<void> {
      const { error } = await db.from('muslim_ai_sessions').delete().eq('id', id);
      if (error) throw Internal(`muslimAi.delete: ${error.message}`);
    },
  };
}
