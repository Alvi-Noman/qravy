/**
 * Email utilities (hybrid)
 * - Production (or EMAIL_PROVIDER=resend): Resend API over HTTPS (works on Render)
 * - Development (or EMAIL_PROVIDER=gmail): Gmail SMTP via Nodemailer
 * - Dev fallback: logs email if SMTP isn't configured
 */

import logger from './logger.js';

// ──────────────────────────────────────────────────────────────────────────────
// Provider selection
// ──────────────────────────────────────────────────────────────────────────────
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const PROVIDER = (process.env.EMAIL_PROVIDER || (isProd ? 'resend' : 'gmail')).toLowerCase();

/** Exported helper so we can print this at server boot as well */
export function logEmailBootInfo() {
  const hasResendKey = Boolean(process.env.RESEND_API_KEY);
  logger.info(
    `[EMAIL-BOOT] NODE_ENV=${NODE_ENV} provider=${PROVIDER} hasResendKey=${hasResendKey}`
  );
}
// Also log once on module load (in case we forget to call the helper)
logEmailBootInfo();

// ──────────────────────────────────────────────────────────────────────────────
// RESEND (HTTPS API)
// Env: RESEND_API_KEY, EMAIL_FROM (and optional EMAIL_REPLY_TO)
// NOTE: production cannot send from @gmail.com; use a verified domain address,
// or use onboarding@resend.dev while testing.
// ──────────────────────────────────────────────────────────────────────────────
import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const RESEND_REPLY_TO = process.env.EMAIL_REPLY_TO || undefined;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ──────────────────────────────────────────────────────────────────────────────
// GMAIL SMTP (DEV)
// Env: SMTP_HOST, SMTP_PORT, SMTP_SECURE('true'|'false'),
//      SMTP_USER, SMTP_PASS, SMTP_FROM
// ──────────────────────────────────────────────────────────────────────────────
import nodemailer, { Transporter } from 'nodemailer';

function isSmtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      (process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === 'false') &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  );
}

function buildSmtpTransporter(): Transporter | null {
  if (!isSmtpConfigured()) {
    if (isProd) {
      logger.error('[SMTP] Missing configuration in production.');
    } else {
      logger.warn('[SMTP] Not fully configured. Using DEV fallback (no email will be sent).');
    }
    return null;
  }

  const port = Number(process.env.SMTP_PORT);
  const secure = process.env.SMTP_SECURE === 'true';

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure, // 465:true (SSL), 587:false (STARTTLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS, // 16-char Gmail App Password (no spaces)
    },

    // Harden timeouts (fail fast)
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,

    // Pool to reduce TLS handshakes
    pool: true,
    maxConnections: 2,
    maxMessages: 20,
  });

  return transporter;
}

const smtpTransporter: Transporter | null = PROVIDER === 'gmail' ? buildSmtpTransporter() : null;

// ──────────────────────────────────────────────────────────────────────────────
/** format nodemailer-ish errors for readable logs */
function formatMailError(err: unknown): string {
  const e = err as {
    code?: string;
    responseCode?: number;
    command?: string;
    message?: string;
    response?: string;
    name?: string;
  };
  const parts = [
    e?.name ? `name=${e.name}` : '',
    e?.code ? `code=${e.code}` : '',
    e?.responseCode ? `responseCode=${e.responseCode}` : '',
    e?.command ? `command=${e.command}` : '',
    e?.message ? `message=${e.message}` : '',
    e?.response ? `response=${e.response}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

// ──────────────────────────────────────────────────────────────────────────────
// Core send helper — picks provider
// ──────────────────────────────────────────────────────────────────────────────
async function sendEmailCore(to: string, subject: string, html: string): Promise<void> {
  logger.info(`[EMAIL-SEND] provider=${PROVIDER} to=${to} subj="${subject}"`);

  // Prefer Resend in prod (or when explicitly selected)
  if (PROVIDER === 'resend') {
    if (!resend) throw new Error('RESEND_API_KEY missing');

    const { error } = await resend.emails.send({
      from: RESEND_FROM,
      to,
      subject,
      html,
      replyTo: RESEND_REPLY_TO,
    });

    if (error) {
      // Resend gives structured errors
      logger.error(`Resend send failed: ${formatMailError(error)}`);
      throw new Error(error.message);
    }

    logger.info(`Email sent via Resend → ${to} (${subject})`);
    return;
  }

  // SMTP (dev/local)
  if (smtpTransporter) {
    try {
      await smtpTransporter.sendMail({
        from: process.env.SMTP_FROM,
        to,
        subject,
        html,
        ...(RESEND_REPLY_TO ? { replyTo: RESEND_REPLY_TO } : {}),
      });
      logger.info(`Email sent via SMTP → ${to} (${subject})`);
      return;
    } catch (err) {
      logger.error(`SMTP send failed: ${formatMailError(err)}`);
      throw err;
    }
  }

  // Dev fallback: log the email if SMTP not configured
  if (!isProd) {
    logger.warn(`[DEV EMAIL FALLBACK]
From: ${process.env.SMTP_FROM ?? RESEND_FROM}
To:   ${to}
Subj: ${subject}
---- HTML ----
${html}
--------------`);
    return;
  }

  throw new Error('No email provider configured');
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────
export async function sendMagicLinkEmail(to: string, magicLink: string) {
  const subject = 'Your Magic Login Link';
  const html = `<p>Click <a href="${magicLink}">here</a> to log in. This link will expire in 15 minutes.</p>`;
  await sendEmailCore(to, subject, html);
}

export async function sendSessionNotificationEmail(
  to: string,
  deviceInfo: string,
  ip: string,
  event: 'login' | 'revoked'
) {
  const subject = event === 'login' ? 'New Device Login Detected' : 'You Were Logged Out From Another Device';
  const action = event === 'login' ? 'logged in from a new device' : 'you were logged out from another device';

  const html = `
    <p>Your account was ${action}:</p>
    <ul>
      <li><strong>Device:</strong> ${deviceInfo}</li>
      <li><strong>IP Address:</strong> ${ip}</li>
      <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
    </ul>
    <p>If this wasn't you, please secure your account immediately.</p>
  `;

  await sendEmailCore(to, subject, html);
}

export async function sendAdminInviteEmail(to: string, inviteLink: string, tenantName: string) {
  const subject = `Admin Access Invitation from ${tenantName}`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#222">
      <h2 style="color:#111;margin-bottom:8px;">You're invited as an Admin</h2>
      <p>${tenantName} has granted you <strong>Admin Access</strong> across all branches.</p>
      <p>You’ll have full control over menus, locations, and users — everything an Owner can, except billing.</p>
      <p style="margin-top:16px;">
        <a href="${inviteLink}"
           style="display:inline-block;background:#111;color:#fff;padding:10px 18px;
           border-radius:6px;text-decoration:none;">Accept Invitation</a>
      </p>
      <p style="margin-top:12px;font-size:13px;color:#666;">
        Or copy and paste this link in your browser:<br/>
        <span style="color:#333">${inviteLink}</span>
      </p>
    </div>
  `;
  await sendEmailCore(to, subject, html);
}
