/**
 * Email utilities
 * Handles all outgoing emails including magic links, session notifications, and admin invites.
 */

import nodemailer from 'nodemailer';
import logger from './logger.js'; // shared Winston logger

/**
 * Configure SMTP transporter
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ———————————————————————————————————————————————————————————————
// Magic link (existing)
// ———————————————————————————————————————————————————————————————

/**
 * Send a magic login link to the user.
 * @param {string} to - Recipient email address.
 * @param {string} magicLink - Magic login URL.
 */
export async function sendMagicLinkEmail(to: string, magicLink: string) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: 'Your Magic Login Link',
      html: `<p>Click <a href="${magicLink}">here</a> to log in. This link will expire in 15 minutes.</p>`,
    });
    logger.info(`Magic link email sent to ${to}`);
  } catch (err) {
    logger.error(`Failed to send magic link email to ${to}: ${(err as Error).message}`);
    throw err;
  }
}

// ———————————————————————————————————————————————————————————————
// Session notification (existing)
// ———————————————————————————————————————————————————————————————

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
  const subject =
    event === 'login' ? 'New Device Login Detected' : 'You Were Logged Out From Another Device';
  const action =
    event === 'login' ? 'logged in from a new device' : 'you were logged out from another device';

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      html: `
        <p>Your account was ${action}:</p>
        <ul>
          <li><strong>Device:</strong> ${deviceInfo}</li>
          <li><strong>IP Address:</strong> ${ip}</li>
          <li><strong>Time:</strong> ${new Date().toLocaleString()}</li>
        </ul>
        <p>If this wasn't you, please secure your account immediately.</p>
      `,
    });
    logger.info(`Session notification email sent to ${to}`);
  } catch (err) {
    logger.error(`Failed to send session notification email to ${to}: ${(err as Error).message}`);
    throw err;
  }
}

// ———————————————————————————————————————————————————————————————
// Admin Invite Email (new)
// ———————————————————————————————————————————————————————————————

/**
 * Send an admin access invitation email.
 * @param {string} to - Recipient email address.
 * @param {string} inviteLink - Invitation URL for accepting admin access.
 * @param {string} tenantName - Name of the tenant (restaurant).
 */
export async function sendAdminInviteEmail(to: string, inviteLink: string, tenantName: string) {
  try {
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

    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: `Admin Access Invitation from ${tenantName}`,
      html,
    });

    logger.info(`Admin invite email sent to ${to}`);
  } catch (err) {
    logger.error(`Failed to send admin invite email to ${to}: ${(err as Error).message}`);
    throw err;
  }
}
