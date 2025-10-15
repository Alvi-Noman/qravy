/**
 * Email utilities
 * Handles all outgoing emails including magic links, session notifications, and admin invites.
 */

import nodemailer, { Transporter } from 'nodemailer';
import logger from './logger.js'; // shared Winston logger

// -----------------------------------------------------------------------------
// Transport bootstrap with fail-fast timeouts + pooling
// -----------------------------------------------------------------------------

const isProd = process.env.NODE_ENV === 'production';

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

function buildTransporter(): Transporter | null {
  if (!isSmtpConfigured()) {
    if (isProd) {
      // In production we require SMTP to be configured
      logger.error('[SMTP] Missing configuration in production.');
    } else {
      // In dev, we allow fallback below
      logger.warn('[SMTP] Not fully configured. Using DEV fallback (no email will be sent).');
    }
    return null;
  }

  const port = Number(process.env.SMTP_PORT);
  const secure = process.env.SMTP_SECURE === 'true';

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure, // true for 465 (SSL), false for 587 (STARTTLS)
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS, // Gmail App Password (NO SPACES) or provider password
    },

    // ---- Harden against hangs (fail fast) ----
    connectionTimeout: 10_000, // 10s to connect
    greetingTimeout: 8_000,    // 8s to receive server greeting
    socketTimeout: 15_000,     // 15s idle socket timeout

    // ---- Pool connections to reduce TLS handshakes ----
    pool: true,
    maxConnections: 2,
    maxMessages: 20,

    // If your provider has proper certs (Gmail/SendGrid/Mailgun), keep default TLS checks.
    // tls: { rejectUnauthorized: true },
  });

  return transporter;
}

const transporter = buildTransporter();

// Small helper to format nodemailer errors for logs
function formatMailError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; command?: string; message?: string; response?: string };
  const parts = [
    e?.code ? `code=${e.code}` : '',
    e?.responseCode ? `responseCode=${e.responseCode}` : '',
    e?.command ? `command=${e.command}` : '',
    e?.message ? `message=${e.message}` : '',
    e?.response ? `response=${e.response}` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

// Centralized sender with DEV fallback when SMTP is not configured and not production
async function sendOrLogDev(to: string, subject: string, html: string): Promise<void> {
  // In development, if SMTP isn't configured, just log and return OK
  if (!transporter && !isProd) {
    logger.warn(`[DEV EMAIL FALLBACK] Would send email:
  From: ${process.env.SMTP_FROM ?? '(unset)'}
  To:   ${to}
  Subj: ${subject}
  ---- HTML ----
  ${html}
  --------------`);
    return;
  }

  // In production (or when SMTP configured), attempt real send
  if (!transporter) {
    const msg = 'SMTP not configured';
    logger.error(`[SMTP] ${msg}`);
    throw new Error(msg);
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html,
    });
    logger.info(`Email sent to ${to} (subject="${subject}")`);
  } catch (err) {
    logger.error(`Failed to send email to ${to}: ${formatMailError(err)}`);
    throw err;
  }
}

// -----------------------------------------------------------------------------
// Magic link
// -----------------------------------------------------------------------------

/**
 * Send a magic login link to the user.
 * @param {string} to - Recipient email address.
 * @param {string} magicLink - Magic login URL.
 */
export async function sendMagicLinkEmail(to: string, magicLink: string) {
  const subject = 'Your Magic Login Link';
  const html = `<p>Click <a href="${magicLink}">here</a> to log in. This link will expire in 15 minutes.</p>`;
  await sendOrLogDev(to, subject, html);
}

// -----------------------------------------------------------------------------
// Session notification
// -----------------------------------------------------------------------------

/**
 * Send a notification email for new device login or session revocation.
 * @param {string} to - Recipient email address.
 * @param {string} deviceInfo - Device information (browser/OS).
 * @param {string} ip - IP address of the device.
 * @param {'login' | 'revoked'} event - Type of session event.
 */
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

  await sendOrLogDev(to, subject, html);
}

// -----------------------------------------------------------------------------
// Admin Invite Email
// -----------------------------------------------------------------------------

/**
 * Send an admin access invitation email.
 * @param {string} to - Recipient email address.
 * @param {string} inviteLink - Invitation URL for accepting admin access.
 * @param {string} tenantName - Name of the tenant (restaurant).
 */
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

  await sendOrLogDev(to, subject, html);
}
