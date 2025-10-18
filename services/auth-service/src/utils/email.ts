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
const BRAND_ACCENT = (process.env.BRAND_ACCENT || '#0ea5e9').trim(); // nice cyan accent fallback
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@qravy.com';
const APP_DOMAIN = process.env.APP_DOMAIN || 'app.qravy.com';
const HERO_IMAGE_URL =
  process.env.HERO_IMAGE_URL ||
  'https://images.unsplash.com/photo-1526318472351-c75fcf070305?q=80&w=1200&auto=format&fit=crop'; // subtle texture/food vibe

function bulletproofButton(label: string, href: string, bg: string, textColor = '#ffffff') {
  // Outlook VML + standard anchor
  return `
  <!--[if mso]>
    <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" arcsize="12%" strokecolor="${bg}" strokeweight="1px" fillcolor="${bg}" style="height:48px;v-text-anchor:middle;width:280px;">
      <w:anchorlock/>
      <center style="color:${textColor}; font-family:Arial,sans-serif; font-size:16px; font-weight:700;">
        ${label}
      </center>
    </v:roundrect>
  <![endif]-->
  <!--[if !mso]><!-- -->
  <a href="${href}"
     style="display:inline-block; background:${bg}; color:${textColor}; font:700 16px/48px Inter,Segoe UI,Roboto,Arial,sans-serif; text-decoration:none; border-radius:10px; padding:0 22px; border:1px solid ${bg};">
    ${label}
  </a>
  <!--<![endif]-->
  `.trim();
}

function renderShell(opts: {
  preheader: string;
  title: string;
  heroTag?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  primaryButtonLabel?: string;
  primaryButtonHref?: string;
  bodyHtml: string; // already sanitized/controlled
  secondaryNoteHtml?: string;
}) {
  const {
    preheader,
    title,
    heroTag = '',
    heroTitle = '',
    heroSubtitle = '',
    primaryButtonLabel,
    primaryButtonHref,
    bodyHtml,
    secondaryNoteHtml,
  } = opts;

  const cta =
    primaryButtonHref && primaryButtonLabel
      ? bulletproofButton(primaryButtonLabel, primaryButtonHref, BRAND_PRIMARY)
      : '';

  return `
<!doctype html>
<html lang="en" data-color-mode="light">
<head>
  <meta charset="utf-8">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title}</title>
  <style>
    .preheader { display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; }
    @media (max-width: 600px) {
      .container { width:100% !important; }
      .px-32 { padding-left:24px !important; padding-right:24px !important; }
      .py-32 { padding-top:24px !important; padding-bottom:24px !important; }
      .mobile-center { text-align:center !important; }
      .btn { width:100% !important; }
    }
    @media (prefers-color-scheme: dark) {
      body, table, td { background:#0b0b0c !important; }
      .card { background:#111214 !important; border-color:#1b1c1f !important; }
      .muted, .footer, .copy { color:#b9bcc2 !important; }
      .strong { color:#ffffff !important; }
      .shadow { box-shadow:none !important; }
      .divider { border-top-color:#232428 !important; }
      .brand { color:#ffffff !important; }
    }
  </style>
  <!--[if mso]>
    <style> * { font-family: Arial, sans-serif !important; } </style>
  <![endif]-->
</head>
<body style="margin:0; padding:0; background:#f6f7f9;">
  <span class="preheader">${preheader}</span>

  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7f9;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px; max-width:600px;">
          <!-- Header / Brand -->
          <tr>
            <td align="left" class="px-32 mobile-center" style="padding:8px 32px 16px;">
              <a href="https://${APP_DOMAIN}" style="text-decoration:none;">
                <img src="${BRAND_LOGO}" width="36" height="36" alt="${BRAND_NAME} logo" style="border:0; display:inline-block; vertical-align:middle; border-radius:8px;">
                <span class="brand" style="font:700 18px/1.2 Inter,Segoe UI,Roboto,Arial,sans-serif; color:#111; margin-left:10px; vertical-align:middle;">${BRAND_NAME}</span>
              </a>
            </td>
          </tr>

          <!-- Hero with gradient -->
          <tr>
            <td class="px-32" style="padding:0 32px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-radius:16px; overflow:hidden; background:linear-gradient(135deg, ${BRAND_PRIMARY} 0%, ${BRAND_ACCENT} 100%);">
                <tr>
                  <td background="${HERO_IMAGE_URL}" style="background-image:url('${HERO_IMAGE_URL}'); background-size:cover; background-position:center; padding:32px;">
                    <div style="background:rgba(0,0,0,0.35); padding:20px; border-radius:12px;">
                      ${heroTag ? `<div style="display:inline-block; padding:6px 10px; border-radius:999px; background:rgba(255,255,255,0.2); color:#fff; font:600 12px Inter,Arial; letter-spacing:.4px; text-transform:uppercase;">${heroTag}</div>` : ''}
                      ${heroTitle ? `<h1 style="margin:10px 0 6px; font:800 24px/1.2 Inter,Arial; color:#fff;">${heroTitle}</h1>` : ''}
                      ${heroSubtitle ? `<p style="margin:0; font:400 14px/22px Inter,Arial; color:#e7f6ff;">${heroSubtitle}</p>` : ''}
                      ${cta ? `<div style="margin-top:16px;">${cta}</div>` : ''}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td class="px-32" style="padding:20px 32px 40px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" class="card shadow" style="background:#ffffff; border:1px solid #eceef1; border-radius:16px; overflow:hidden;">
                <tr>
                  <td class="py-32 px-32" style="padding:28px 32px;">
                    <div class="copy" style="font:400 16px/26px Inter,Segoe UI,Roboto,Arial,sans-serif; color:#2c2f36;">
                      ${bodyHtml}
                    </div>

                    ${secondaryNoteHtml ? `
                    <div class="divider" style="border-top:1px solid #eceef1; margin:24px 0;"></div>
                    <div class="muted" style="font:400 13px/20px Inter,Arial; color:#5a6070;">
                      ${secondaryNoteHtml}
                    </div>` : ''}

                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="px-32 footer" style="padding:0 32px 24px; font:400 12px/18px Inter,Segoe UI,Roboto,Arial,sans-serif; color:#7b8090;">
              © ${new Date().getFullYear()} ${BRAND_NAME}. Need help? <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_PRIMARY}; text-decoration:none;">${SUPPORT_EMAIL}</a>.
              You’re receiving this because of activity related to ${APP_DOMAIN}.
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

// ──────────────────────────────────────────────────────────────────────────────
// Specific templates (Magic Link + Admin Invite)
// ──────────────────────────────────────────────────────────────────────────────
function buildMagicLinkEmail(magicLink: string, ttlMinutes = 15) {
  const displayUrl = magicLink.replace(/^https?:\/\//, '');
  const bodyHtml = `
    <p>Use the magic button above to sign in securely. This link expires in <strong>${ttlMinutes} minutes</strong>.</p>
    <p style="margin:14px 0 0; font-size:13px; color:#5a6070;">Having trouble with the button? Copy and paste this URL into your browser:</p>
    <p style="word-break:break-all; margin:6px 0 0;"><a href="${magicLink}" style="color:${BRAND_PRIMARY}; text-decoration:none;">${displayUrl}</a></p>
  `;
  const secondaryNoteHtml = `
    Didn’t request this? You can safely ignore this email. If you’re concerned, contact us at
    <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_PRIMARY}; text-decoration:none;">${SUPPORT_EMAIL}</a>.
  `;

  return renderShell({
    preheader: `Your secure sign-in link for ${BRAND_NAME}. Expires in ${ttlMinutes} minutes.`,
    title: `${BRAND_NAME} • Magic sign-in`,
    heroTag: 'Secure access',
    heroTitle: 'Sign in with a magic link',
    heroSubtitle: `Fast, passwordless access to ${APP_DOMAIN}`,
    primaryButtonLabel: 'Open Magic Link',
    primaryButtonHref: magicLink,
    bodyHtml,
    secondaryNoteHtml,
  });
}

function buildAdminInviteEmail(inviteLink: string, tenantName: string) {
  const displayUrl = inviteLink.replace(/^https?:\/\//, '');
  const bodyHtml = `
    <p><strong>${tenantName}</strong> invited you to join as an <strong>Admin</strong>.</p>
    <ul style="margin:10px 0 0 20px; padding:0; color:#2c2f36;">
      <li>Manage menus, items, and categories</li>
      <li>Control locations and availability</li>
      <li>Invite and manage team members</li>
    </ul>
    <p style="margin:16px 0 0;">Click the button above to accept. If it doesn’t work, paste this URL:</p>
    <p style="word-break:break-all; margin:6px 0 0;"><a href="${inviteLink}" style="color:${BRAND_PRIMARY}; text-decoration:none;">${displayUrl}</a></p>
  `;
  const secondaryNoteHtml = `
    If you weren’t expecting this invitation, you can ignore this email. Questions?
    <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_PRIMARY}; text-decoration:none;">${SUPPORT_EMAIL}</a>.
  `;

  return renderShell({
    preheader: `Admin access invitation from ${tenantName} on ${BRAND_NAME}.`,
    title: `${BRAND_NAME} • Admin Invitation`,
    heroTag: 'Team access',
    heroTitle: 'You’re invited as an Admin',
    heroSubtitle: `Join ${tenantName} on ${BRAND_NAME}`,
    primaryButtonLabel: 'Accept Invitation',
    primaryButtonHref: inviteLink,
    bodyHtml,
    secondaryNoteHtml,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────
export async function sendMagicLinkEmail(to: string, magicLink: string) {
  const subject = `Your secure sign-in link • ${BRAND_NAME}`;
  const html = buildMagicLinkEmail(magicLink, 15);
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
  const subject = event === 'login' ? 'New Device Login Detected' : 'You Were Logged Out From Another Device';
  const action = event === 'login' ? 'logged in from a new device' : 'you were logged out from another device';

  const bodyHtml = `
    <p>Your account was ${action}:</p>
    <ul style="margin:10px 0 0 20px; padding:0;">
      <li><strong>Device:</strong> ${deviceInfo}</li>
      <li><strong>IP Address:</strong> ${ip}</li>
      <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
    </ul>
  `;
  const secondaryNoteHtml = `
    If this wasn't you, please secure your account immediately. Need help?
    <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND_PRIMARY}; text-decoration:none;">${SUPPORT_EMAIL}</a>.
  `;

  const html = renderShell({
    preheader: subject,
    title: `${BRAND_NAME} • Security Notice`,
    heroTag: 'Security',
    heroTitle: subject,
    heroSubtitle: 'Account activity notification',
    bodyHtml,
    secondaryNoteHtml,
  });

  await sendEmailCore(to, subject, html);
}
