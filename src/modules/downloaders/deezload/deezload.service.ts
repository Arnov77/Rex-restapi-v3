import axios from 'axios';
import { BadRequest } from '@shared/errors.js';
import { loadEnv } from '../../../config/env.js';

export interface DeezloadResult {
  success: boolean;
  file_path: string;
  file_name: string;
  file_token: string;
  title: string | null;
  description: string | null;
}

export async function downloadDeezload(
  query: string,
  artist?: string,
): Promise<DeezloadResult> {
  try {
    const { data } = await axios.post<DeezloadResult>(
      loadEnv().DEEZLOAD_INTERNAL_URL ?? 'http://127.0.0.1:8001/download',
      {
        query,
        artist,
      },
      {
        timeout: 180000,
        headers: {
          'X-Internal-Secret': loadEnv().DEEZLOAD_INTERNAL_SECRET,
        },
      },
    );

    return data;
  } catch (err: any) {
    throw BadRequest(
      err?.response?.data?.detail ??
        'Failed to download from DeezLoad',
    );
  }
}