// Sends email over SMTP (works with Gmail app passwords, Brevo, Resend SMTP, SendGrid, etc.).
let transport;
async function sendMail({ to, subject, text, html }) {
  if (process.env.BIS_DRY_RUN === 'true') {
    console.log('[mail] DRY RUN ->', to, '|', subject);
    return;
  }
  if (!process.env.SMTP_HOST) throw new Error('SMTP_HOST is not set');
  if (!transport) {
    transport = require('nodemailer').createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
}
module.exports = { sendMail };
