import nodemailer from 'nodemailer';
import logger from './logger.js'; // Use your shared Winston logger

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send a magic link email for login
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

// Send a session notification email (new device login or session revoked)
export async function sendSessionNotificationEmail(
  to: string,
  deviceInfo: string,
  ip: string,
  event: 'login' | 'revoked'
) {
  const subject =
    event === 'login'
      ? 'New Device Login Detected'
      : 'You Were Logged Out From Another Device';

  const action =
    event === 'login'
      ? 'logged in from a new device'
      : 'you were logged out from another device';

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