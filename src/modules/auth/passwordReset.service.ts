import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, BadRequest } from '@shared/errors.js';
import { mailerConfigured, sendMail } from '@shared/mailer.js';
import { loadEnv } from '../../config/env.js';
import { usersRepo } from './users.repo.js';
import { resetTokensRepo } from './resetTokens.repo.js';

const TOKEN_TTL_MIN = 30;
const MAX_PER_HOUR = 3;

const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

type Log = { warn: (obj: unknown, msg: string) => void };

export function passwordResetService(db: SupabaseClient) {
  const users = usersRepo(db);
  const tokens = resetTokensRepo(db);

  return {
    /**
     * Always resolves the same way whether or not the email is registered,
     * so the endpoint cannot be used to discover which addresses have
     * accounts. The mail is sent without awaiting for the same reason —
     * otherwise the slow SMTP round-trip would reveal it through timing.
     */
    async request(email: string, log?: Log): Promise<void> {
      if (!mailerConfigured()) {
        throw new AppError(
          503, 'MAIL_NOT_CONFIGURED', 'SMTP is not configured', undefined,
          'Reset lewat email belum tersedia. Hubungi support@rexapi.my.id.',
        );
      }

      const user = await users.findByEmail(email.toLowerCase());
      if (!user) return;

      const since = new Date(Date.now() - 60 * 60 * 1000);
      if ((await tokens.countRecent(user.id, since)) >= MAX_PER_HOUR) return;

      const raw = randomBytes(32).toString('base64url');
      await tokens.create(user.id, hashToken(raw), new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000));

      const link = `${loadEnv().PUBLIC_BASE_URL}/reset?token=${raw}`;
    const name = user.displayName || user.username;
    
    const text =
      `Halo ${name},\n\n` +
      `Kami menerima permintaan untuk mengatur ulang kata sandi akun Rex API kamu.\n\n` +
      `Gunakan tautan berikut untuk membuat kata sandi baru. Tautan ini berlaku selama ${TOKEN_TTL_MIN} menit:\n\n` +
      `${link}\n\n` +
      `Jika kamu tidak merasa melakukan permintaan ini, kamu bisa mengabaikan email ini. ` +
      `Kata sandi akunmu akan tetap sama.\n\n` +
      `Salam,\n` +
      `Rex API`;
    
    const html =
      `<p>Halo ${escapeHtml(name)},</p>` +
    
      `<p>Kami menerima permintaan untuk mengatur ulang kata sandi akun Rex API kamu.</p>` +
    
      `<p>Gunakan tombol di bawah untuk membuat kata sandi baru. ` +
      `Tautan ini berlaku selama <strong>${TOKEN_TTL_MIN} menit</strong>.</p>` +
    
      `<p style="margin:24px 0">` +
        `<a href="${link}" ` +
          `style="display:inline-block;padding:11px 20px;background:#1C1B19;` +
          `color:#F7F6F3;text-decoration:none;border-radius:10px;font-weight:600">` +
          `Atur ulang kata sandi` +
        `</a>` +
      `</p>` +
    
      `<p style="color:#6B675F;font-size:13px;line-height:1.6">` +
        `Jika kamu tidak merasa melakukan permintaan ini, abaikan email ini. ` +
        `Kata sandi akunmu akan tetap sama.` +
      `</p>` +
    
      `<p style="margin-top:28px">Salam,<br><strong>Rex API</strong></p>`;

      sendMail({ to: user.email, subject: 'Permintaan reset kata sandi — Rex API', text, html })
        .catch((err) => log?.warn({ err }, 'password reset mail failed'));
    },

    /** Tells the page whether to show the form, without consuming the token. */
    async check(raw: string): Promise<boolean> {
      return (await tokens.findValid(hashToken(raw))) !== null;
    },

    async reset(raw: string, newPassword: string): Promise<void> {
      const row = await tokens.findValid(hashToken(raw));
      if (!row) {
        throw BadRequest(
          'Invalid or expired reset token', undefined,
          'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.',
        );
      }
      await users.setPasswordHash(row.user_id, await bcrypt.hash(newPassword, 12));
      await tokens.consumeAllForUser(row.user_id);
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
