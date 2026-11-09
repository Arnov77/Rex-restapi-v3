import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyBaseLogger } from 'fastify';

import { withGroq } from '@shared/groqRotator.js';
import { withBandelbanget } from '@shared/bandelbangetRotator.js';

import { AppError } from '@shared/errors.js';
import { buildSystemPrompt, type SystemPromptConfig } from './heru.presets.js';

const BANDELBANGET_MODEL = 'glm-5.3';
const FALLBACK_MODEL = 'qwen/qwen3.6-27b';

const MAX_HISTORY_MESSAGES = 20;
const SESSION_TTL_SECONDS = 24 * 60 * 60;

async function callBandelbanget(messages: any[]): Promise<string> {
  return withBandelbanget(async (client) => {
    const completion = await client.chat.completions.create({
      model: BANDELBANGET_MODEL,
      messages,
      temperature: 0.85,
      max_tokens: 512,
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new AppError(502, 'HERU_EMPTY_RESPONSE', 'Bandelbanget returned no response');
    return content.trim();
  });
}

function stripThinking(content: string): string {
  let cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, ''); // jaga-jaga tag terbuka tanpa penutup
  return cleaned.trim();
}

async function callGroq(messages: any[]): Promise<string> {
  return withGroq(async (groq) => {
    const completion = await groq.chat.completions.create({
      model: FALLBACK_MODEL,
      messages,
      temperature: 0.85,
      max_tokens: 1024,
      reasoning_effort: 'default',
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new AppError(502, 'HERU_EMPTY_RESPONSE', 'Groq returned no response');
    const cleaned = stripThinking(content);
    if (!cleaned) throw new AppError(502, 'HERU_EMPTY_RESPONSE', 'Groq returned only thinking content');
    return cleaned;
  });
}

export interface HeruResult {
  reply: string;
  session: string;
  expiresAt: string;
  historyLength: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface SessionRow {
  id: string;
  history: ChatMessage[];
  expires_at: string;
}

function generateSessionId(): string {
  return randomBytes(12).toString('base64url');
}

async function findSession(db: SupabaseClient, id: string): Promise<SessionRow | null> {
  const { data, error } = await db
    .from('heru_sessions')
    .select('*')
    .eq('id', id)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle<SessionRow>();
  if (error) throw new AppError(500, 'HERU_DB_ERROR', error.message);
  return data ?? null;
}

async function upsertSession(
  db: SupabaseClient,
  id: string,
  history: ChatMessage[],
  ownerKeyId: string | null,
): Promise<SessionRow> {
  const { data, error } = await db.rpc('upsert_heru_session', {
    p_id: id,
    p_history: history,
    p_owner_key: ownerKeyId,
    p_ttl_seconds: SESSION_TTL_SECONDS,
  });
  if (error) throw new AppError(500, 'HERU_DB_ERROR', error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new AppError(500, 'HERU_DB_ERROR', 'empty upsert result');
  return row as SessionRow;
}

export async function chatWithHeru(
  db: SupabaseClient,
  text: string,
  sessionId: string | undefined,
  config?: SystemPromptConfig,
  ownerKeyId: string | null = null,
  log?: FastifyBaseLogger,
): Promise<HeruResult> {
  const id = sessionId ?? generateSessionId();
  const existing = await findSession(db, id);
  const history: ChatMessage[] = existing?.history ?? [];

  const systemPrompt = buildSystemPrompt(config);

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: text },
  ];

  let reply: string;
  try {
    reply = await callBandelbanget(messages);
  } catch (err) {
    // Fallback ke Groq untuk semua error Bandelbanget
    const isBandelbangetError =
      err instanceof AppError &&
      (err.code === 'BANDELBANGET_ALL_KEYS_EXHAUSTED' ||
       err.code === 'BANDELBANGET_NOT_CONFIGURED');

    const isNetworkError = !(err instanceof AppError);

    if (isBandelbangetError || isNetworkError) {
      // Catat penyebab asli sebelum fallback, biar tidak tiba-tiba pindah model
      log?.warn(
        {
          provider: 'bandelbanget',
          model: BANDELBANGET_MODEL,
          fallbackTo: FALLBACK_MODEL,
          errCode: err instanceof AppError ? err.code : 'UNKNOWN',
          errStatus: err instanceof AppError ? err.statusCode : undefined,
          errMessage: err instanceof Error ? err.message : String(err),
        },
        'Bandelbanget failed, falling back to Groq',
      );
      reply = await callGroq(messages);
    } else {
      throw err;
    }
  }

  const updatedHistory: ChatMessage[] = [
    ...history,
    { role: 'user' as const, content: text },
    { role: 'assistant' as const, content: reply },
  ].slice(-MAX_HISTORY_MESSAGES);

  const saved = await upsertSession(db, id, updatedHistory, ownerKeyId);

  return {
    reply,
    session: id,
    expiresAt: saved.expires_at,
    historyLength: updatedHistory.length,
  };
}