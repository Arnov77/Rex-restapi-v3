export function shortlinksRepo(db) {
    const table = () => db.from('shortlinks');
    return {
        async findById(id) {
            const { data, error } = await table()
                .select('*')
                .eq('id', id)
                .maybeSingle();
            if (error)
                throw error;
            return data;
        },
        async findByUserId(userId) {
            const { data, error } = await table()
                .select('*')
                .eq('user_id', userId)
                .order('created_at', { ascending: false });
            if (error)
                throw error;
            return data ?? [];
        },
        async findByApiKeyId(apiKeyId) {
            const { data, error } = await table()
                .select('*')
                .eq('api_key_id', apiKeyId)
                .order('created_at', { ascending: false });
            if (error)
                throw error;
            return data ?? [];
        },
        async create(record) {
            const { data, error } = await table()
                .insert(record)
                .select()
                .single();
            if (error)
                throw error;
            return data;
        },
        async delete(id) {
            const { error } = await table().delete().eq('id', id);
            if (error)
                throw error;
        },
        async incrementClick(id) {
            const { error } = await db.rpc('shortlink_click', { p_id: id });
            if (error)
                throw error;
        },
    };
}
//# sourceMappingURL=shortlinks.repo.js.map