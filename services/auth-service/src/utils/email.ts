/**
 * Email utilities (hybrid)
 * - Production (or EMAIL_PROVIDER=resend): Resend API over HTTPS (works on Render)
 * - Development (or EMAIL_PROVIDER=gmail): Gmail SMTP via Nodemailer
 * - Dev fallback: logs email if SMTP isn't configured
 */

import logger from './logger.js';
import { Resend } from 'resend';
import nodemailer, { Transporter } from 'nodemailer';

// ──────────────────────────────────────────────────────────────────────────────
// Provider selection
// ──────────────────────────────────────────────────────────────────────────────
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';
const PROVIDER = (process.env.EMAIL_PROVIDER || (isProd ? 'resend' : 'gmail')).toLowerCase();

/** Exported helper so we can print this at server boot as well */
export function logEmailBootInfo() {
  const hasResendKey = Boolean(process.env.RESEND_API_KEY);
  logger.info(`[EMAIL-BOOT] NODE_ENV=${NODE_ENV} provider=${PROVIDER} hasResendKey=${hasResendKey}`);
}
logEmailBootInfo();

// ──────────────────────────────────────────────────────────────────────────────
// RESEND (HTTPS API)
// Env: RESEND_API_KEY, EMAIL_FROM (and optional EMAIL_REPLY_TO)
// NOTE: in production do not send from @gmail.com; use verified domain.
// ──────────────────────────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';
const RESEND_REPLY_TO = process.env.EMAIL_REPLY_TO || undefined;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ──────────────────────────────────────────────────────────────────────────────
// GMAIL SMTP (DEV)
// Env: SMTP_HOST, SMTP_PORT, SMTP_SECURE('true'|'false'),
//      SMTP_USER, SMTP_PASS, SMTP_FROM
// ──────────────────────────────────────────────────────────────────────────────
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
    secure, // 465:true SSL, 587:false STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Timeouts + pool
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
    pool: true,
    maxConnections: 2,
    maxMessages: 20,
  });

  return transporter;
}

const smtpTransporter: Transporter | null = PROVIDER === 'gmail' ? buildSmtpTransporter() : null;

// ──────────────────────────────────────────────────────────────────────────────
/** format nodemailer-ish / resend-ish errors for readable logs */
function formatMailError(err: unknown): string {
  const e = err as Record<string, string | number | undefined>;
  return Object.entries(e)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join(' | ');
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
      logger.error(`Resend send failed: ${formatMailError(error)}`);
      throw new Error((error as any).message || 'Resend send failed');
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
// Design System — Shell + Components (responsive + dark mode)
// Brand knobs via env:
//   BRAND_NAME, BRAND_LOGO_URL, BRAND_PRIMARY, BRAND_ACCENT, SUPPORT_EMAIL, APP_DOMAIN, HERO_IMAGE_URL
// ──────────────────────────────────────────────────────────────────────────────
const BRAND_NAME = process.env.BRAND_NAME || 'Qravy';
const BRAND_LOGO = process.env.BRAND_LOGO_URL || 'https://i.imgur.com/pI3F6pG.png';
const BRAND_PRIMARY = (process.env.BRAND_PRIMARY || '#111111').trim();
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@qravy.com';
const APP_DOMAIN = process.env.APP_DOMAIN || 'app.qravy.com';

function renderShell(opts: {
  preheader: string;
  title: string;
  primaryButtonLabel?: string;
  primaryButtonHref?: string;
  bodyHtml: string;
  secondaryNoteHtml?: string;
}) {
  const {
    preheader,
    title,
    primaryButtonLabel,
    primaryButtonHref,
    bodyHtml,
    secondaryNoteHtml,
  } = opts;

  return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { background-color: #ffffff; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
    table { border-collapse: collapse; }
    .main-table { max-width: 560px; margin: 0 auto; padding: 48px 24px; }
    .logo-img { border-radius: 6px; display: inline-block; vertical-align: middle; }
    .brand-name { font-size: 16px; font-weight: 600; color: #18181b; margin-left: 8px; vertical-align: middle; }
    .title { font-size: 20px; font-weight: 600; color: #18181b; margin: 32px 0 16px 0; letter-spacing: -0.4px; }
    .text { font-size: 14px; line-height: 24px; color: #444446; margin: 0 0 16px 0; }
    .btn { display: inline-block; background-color: ${BRAND_PRIMARY}; color: #ffffff; font-size: 14px; font-weight: 500; text-decoration: none; border-radius: 6px; padding: 10px 18px; line-height: 20px; text-align: center; }
    .divider { border-top: 1px solid #e4e4e7; margin: 32px 0; }
    .footer { font-size: 12px; line-height: 18px; color: #71717a; margin-top: 32px; }
    .footer a { color: #18181b; text-decoration: underline; }
    @media (prefers-color-scheme: dark) {
      body { background-color: #09090b !important; }
      .brand-name, .title { color: #f4f4f5 !important; }
      .text { color: #d4d4d8 !important; }
      .btn { background-color: #f4f4f5 !important; color: #09090b !important; }
      .divider { border-top-color: #27272a !important; }
      .footer { color: #a1a1aa !important; }
      .footer a { color: #f4f4f5 !important; }
    }
  </style>
</head>
<body>
  <span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all;">${preheader}</span>
  
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; padding: 48px 24px 64px 24px; text-align: left;">
          <!-- Logo & Brand -->
          <tr>
            <td>
              <a href="https://${APP_DOMAIN}" style="text-decoration: none; display: inline-block;">
                <img class="logo-img" src="${BRAND_LOGO}" width="28" height="28" alt="${BRAND_NAME}">
                <span class="brand-name">${BRAND_NAME}</span>
              </a>
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td>
              <h1 class="title">${title}</h1>
            </td>
          </tr>

          <!-- Body Content -->
          <tr>
            <td class="text">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Main CTA Button -->
          ${primaryButtonHref && primaryButtonLabel ? `
          <tr>
            <td style="padding: 12px 0 24px 0;">
              <a href="${primaryButtonHref}" class="btn">${primaryButtonLabel}</a>
            </td>
          </tr>` : ''}

          <!-- Divider & Secondary Details -->
          ${secondaryNoteHtml ? `
          <tr>
            <td>
              <div class="divider"></div>
              <div class="footer">
                ${secondaryNoteHtml}
              </div>
            </td>
          </tr>` : ''}

          <!-- Footer Copyright -->
          <tr>
            <td>
              <div class="divider" style="margin: 24px 0 16px 0;"></div>
              <div class="footer" style="margin-top: 0;">
                © ${new Date().getFullYear()} ${BRAND_NAME}. <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

function buildMagicLinkEmail(magicLink: string, otpCode?: string, ttlMinutes = 15) {
  const displayUrl = magicLink.replace(/^https?:\/\//, '');
  const otpBlock = otpCode ? `
    <div style="margin: 24px 0; padding: 24px; background-color: #f4f4f5; border-radius: 8px; text-align: center; max-width: 360px;">
      <span style="display: block; margin-bottom: 8px; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; color: #71717a;">Temporary Passcode</span>
      <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #18181b; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; display: block; margin: 12px 0;">${otpCode}</span>
      <span style="display: block; font-size: 12px; color: #71717a; line-height: 18px;">Enter this code on the login page to sign in, or click the button below to sign in directly.</span>
    </div>
  ` : '';

  const bodyHtml = `
    <p style="margin: 0 0 16px 0;">We received a request to access your ${BRAND_NAME} account.</p>
    ${otpBlock}
    <p style="margin: 24px 0 16px 0;">If you prefer, you can click the button below to sign in instantly without entering the code:</p>
  `;

  const secondaryNoteHtml = `
    This link and passcode will expire in ${ttlMinutes} minutes. If you did not request this email, you can safely ignore it. If you have any questions, reply to this email or contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color: #18181b; text-decoration: underline;">${SUPPORT_EMAIL}</a>.
  `;

  return renderShell({
    preheader: `Your secure sign-in link and passcode for ${BRAND_NAME}.`,
    title: `Sign in to ${BRAND_NAME}`,
    primaryButtonLabel: 'Sign in instantly',
    primaryButtonHref: magicLink,
    bodyHtml,
    secondaryNoteHtml,
  });
}

function buildAdminInviteEmail(inviteLink: string, tenantName: string) {
  const displayUrl = inviteLink.replace(/^https?:\/\//, '');
  const bodyHtml = `
    <p style="margin: 0 0 16px 0;"><strong>${tenantName}</strong> has invited you to join their team as an <strong>Admin</strong> on ${BRAND_NAME}.</p>
    <p style="margin: 0 0 16px 0;">As an admin, you will be able to manage menus, customize availability, view orders, and invite other team members.</p>
    <p style="margin: 0 0 16px 0;">Click the button below to accept the invitation and set up your account:</p>
  `;

  const secondaryNoteHtml = `
    If you were not expecting this invitation, you can safely ignore this email. Need help? Contact us at <a href="mailto:${SUPPORT_EMAIL}" style="color: #18181b; text-decoration: underline;">${SUPPORT_EMAIL}</a>.
  `;

  return renderShell({
    preheader: `You have been invited to join ${tenantName} on ${BRAND_NAME}.`,
    title: 'Accept your invitation',
    primaryButtonLabel: 'Accept Invitation',
    primaryButtonHref: inviteLink,
    bodyHtml,
    secondaryNoteHtml,
  });
}

export async function sendMagicLinkEmail(to: string, magicLink: string, otpCode?: string) {
  const subject = `Your secure sign-in link • ${BRAND_NAME}`;
  const html = buildMagicLinkEmail(magicLink, otpCode, 15);
  await sendEmailCore(to, subject, html);
}

export async function sendAdminInviteEmail(to: string, inviteLink: string, tenantName: string) {
  const subject = `Admin Invitation from ${tenantName} • ${BRAND_NAME}`;
  const html = buildAdminInviteEmail(inviteLink, tenantName);
  await sendEmailCore(to, subject, html);
}

export async function sendSessionNotificationEmail(
  to: string,
  deviceInfo: string,
  ip: string,
  event: 'login' | 'revoked'
) {
  const subject = event === 'login' ? 'New login to your Qravy account' : 'Logged out from device';
  const actionText = event === 'login' ? 'logged in from a new device' : 'logged out from a device';

  const bodyHtml = `
    <p style="margin: 0 0 16px 0;">Your ${BRAND_NAME} account was ${actionText}:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin: 20px 0; font-size: 14px; line-height: 24px; color: #444446;">
      <tr>
        <td style="padding-right: 16px; font-weight: 500; color: #71717a;">Device:</td>
        <td style="color: #18181b;">${deviceInfo}</td>
      </tr>
      <tr>
        <td style="padding-right: 16px; font-weight: 500; color: #71717a;">IP Address:</td>
        <td style="color: #18181b;">${ip}</td>
      </tr>
      <tr>
        <td style="padding-right: 16px; font-weight: 500; color: #71717a;">Time:</td>
        <td style="color: #18181b;">${new Date().toLocaleString()}</td>
      </tr>
    </table>
  `;

  const secondaryNoteHtml = `
    If you did not authorize this activity, please contact support immediately at <a href="mailto:${SUPPORT_EMAIL}" style="color: #18181b; text-decoration: underline;">${SUPPORT_EMAIL}</a>.
  `;

  const html = renderShell({
    preheader: subject,
    title: subject,
    bodyHtml,
    secondaryNoteHtml,
  });

  await sendEmailCore(to, subject, html);
}
