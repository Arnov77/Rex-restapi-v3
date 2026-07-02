import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal, BadRequest, NotFound } from '@shared/errors.js';

export interface randomStickerPack {
  id: string;
  name: string;
  label: string | null;
  active: boolean;
  added_by: string | null;
  created_at: string;
}

export function randomStickerPacksRepo(db: SupabaseClient) {
  return {
    /** Active pack names only — used by the random-sticker service. */
    async listActiveNames(): Promise<string[]> {
      const { data, error } = await db
        .from('meme_sticker_packs')
        .select('name')
        .eq('active', true);
      if (error) throw Internal(`randomStickerPacks.listActiveNames: ${error.message}`);
      return (data ?? []).map((r: { name: string }) => r.name);
    },

    /** Full list (active + inactive) — used by the admin panel. */
    async list(): Promise<randomStickerPack[]> {
      const { data, error } = await db
        .from('meme_sticker_packs')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw Internal(`randomStickerPacks.list: ${error.message}`);
      return (data ?? []) as randomStickerPack[];
    },

    async add(name: string, label: string | undefined, addedBy: string | undefined): Promise<randomStickerPack> {
      const { data, error } = await db
        .from('meme_sticker_packs')
        .insert({ name, label: label ?? null, added_by: addedBy ?? null })
        .select('*')
        .single();
      if (error) {
        if (error.code === '23505') throw BadRequest(`Pack "${name}" already exists`);
        throw Internal(`randomStickerPacks.add: ${error.message}`);
      }
      return data as randomStickerPack;
    },

    async setActive(id: string, active: boolean): Promise<randomStickerPack> {
      const { data, error } = await db
        .from('meme_sticker_packs')
        .update({ active })
        .eq('id', id)
        .select('*')
        .maybeSingle();
      if (error) throw Internal(`randomStickerPacks.setActive: ${error.message}`);
      if (!data) throw NotFound('Pack not found');
      return data as randomStickerPack;
    },

    async remove(id: string): Promise<void> {
      const { error, count } = await db
        .from('meme_sticker_packs')
        .delete({ count: 'exact' })
        .eq('id', id);
      if (error) throw Internal(`randomStickerPacks.remove: ${error.message}`);
      if (!count) throw NotFound('Pack not found');
    },
  };
}
