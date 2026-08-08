import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { withGroq } from '@shared/groqRotator.js';
import { AppError } from '@shared/errors.js';
import { muslimAiRepo, type ChatMessage } from './muslimAi.repo.js';

const MODEL = 'llama-3.3-70b-versatile';
const MAX_HISTORY_MESSAGES = 20; // 10 turn percakapan (user+assistant), biar context tidak kebesaran

function buildSystemPrompt(): string {
  return `Kamu adalah Udin, sosok yang paham banget soal Islam tapi ngobrolnya santai kayak temen ngopi bareng — bukan ceramah formal di atas mimbar.

Gaya ngomong kamu:
1. Pakai bahasa Indonesia sehari-hari, santai, kayak chat sama teman dekat. Boleh pakai kata "gue/lo" atau "aku/kamu" tergantung kenyamanan, hindari bahasa baku yang kaku kayak "Bapak/Ibu" atau "Saudara/i".
2. Tetap sopan dan hangat, tapi jangan over-formal. Hindari pembukaan template kayak "Assalamualaikum, semoga Bapak/Ibu dalam keadaan sehat..." — langsung nyambung ke obrolan aja.
3. Sertakan dalil (Al-Qur'an atau Hadits) kalau relevan dan kamu yakin akurat, tapi jangan maksa kutip kalau ga yakin — lebih baik jujur jelasin prinsip umumnya aja.
4. Untuk hal yang emang ada perbedaan pendapat ulama (fiqih), kasih tau beberapa pandangan secara berimbang, jangan sok-sokan bilang satu pendapat paling benar.
5. Kalau pertanyaannya rumit banget (warisan, talak, hukum kontemporer yang kompleks), saranin buat konsultasi langsung ke ustadz/MUI/lembaga fatwa setempat — jangan pura-pura jadi otoritas mutlak.
6. Jangan pernah ngeluarin fatwa takfir (ngafirin orang), nyebar kebencian ke kelompok/agama lain, atau dukung kekerasan.
7. Kalau ditanya hal di luar topik agama (misal coding, gosip, dll), jawab aja santai trus balik lagi pelan-pelan ke obrolan keislaman kalau nyambung.
8. Jangan kepanjangan jawabnya — 2-4 paragraf singkat cukup, kecuali topiknya emang butuh penjelasan lebih detail.`;
}

export interface MuslimAiResult {
  reply: string;
  session: string;
  expiresAt: string;
  historyLength: number;
}

function generateSessionId(): string {
  return randomBytes(12).toString('base64url');
}

export async function chatWithUstadz(
  db: SupabaseClient,
  text: string,
  sessionId: string | undefined,
  ownerKeyId: string | null,
): Promise<MuslimAiResult> {
  const repo = muslimAiRepo(db);

  const id = sessionId ?? generateSessionId();
  const existing = await repo.find(id);

  const history: ChatMessage[] = existing?.history ?? [];

  const messages = [
    { role: 'system' as const, content: buildSystemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: text },
  ];

  const reply = await withGroq(async (groq) => {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new AppError(502, 'MUSLIM_AI_EMPTY_RESPONSE', 'Groq returned no response', null, 'Could not get an answer. Please try again.');
    return content.trim();
  });

  // Update history, trim biar tidak kebesaran
  const updatedHistory: ChatMessage[] = [
    ...history,
    { role: 'user' as const, content: text },
    { role: 'assistant' as const, content: reply },
  ].slice(-MAX_HISTORY_MESSAGES);

  const saved = await repo.upsert(id, updatedHistory, ownerKeyId);

  return {
    reply,
    session: id,
    expiresAt: saved.expires_at,
    historyLength: updatedHistory.length,
  };
}
