import type { SupabaseClient } from '@supabase/supabase-js';

export interface ShortlinkRecord {
  id: string;
  url: string;
  user_id: string | null;
  api_key_id: string | null;
  clicks: number;
  created_at: string;
  expires_at: string | null;
}

export function shortlinksRepo(db: SupabaseClient) {
  const table = () => db.from('shortlinks');

  return {
    async findById(id: string): Promise<ShortlinkRecord | null> {
      const { data, error } = await table()
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    async findByUserId(userId: string): Promise<ShortlinkRecord[]> {
      const { data, error } = await table()
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },

    async findByApiKeyId(apiKeyId: string): Promise<ShortlinkRecord[]> {
      const { data, error } = await table()
        .select('*')
        .eq('api_key_id', apiKeyId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },

    async create(record: Omit<ShortlinkRecord, 'clicks' | 'created_at'>): Promise<ShortlinkRecord> {
      const { data, error } = await table()
        .insert(record)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async delete(id: string): Promise<void> {
      const { error } = await table().delete().eq('id', id);
      if (error) throw error;
    },

    async incrementClick(id: string): Promise<void> {
      const { error } = await db.rpc('shortlink_click', { p_id: id });
      if (error) throw error;
    },
  };
}
