import nodemailer, { type Transporter } from 'nodemailer';
import { loadEnv } from '../config/env.js';

let transport: Transporter | null = null;

/** SMTP is optional; callers check this and degrade instead of crashing. */
export function mailerConfigured(): boolean {
  const e = loadEnv();
  return Boolean(e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS);
}

function getTransport(): Transporter {
  if (transport) return transport;
  const e = loadEnv();
  transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
  });
  return transport;
}

export async function sendMail(opts: { to: string; subject: string; text: string; html?: string }) {
  const e = loadEnv();
  await getTransport().sendMail({ from: e.SMTP_FROM || e.SMTP_USER, ...opts });
}
