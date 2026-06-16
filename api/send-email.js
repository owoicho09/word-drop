/**
 * api/send-email.js — Vercel serverless function for sending emails via Resend.
 *
 * POST /api/send-email
 * Body: { action: 'welcome', email, displayName }
 *       { action: 'guest' }
 *
 * 'welcome' → sends a branded welcome email to the new player AND notifies the owner.
 * 'guest'   → notifies the owner that a new guest started a game.
 *
 * RESEND_API_KEY, EMAIL_FROM, and NOTIFY_EMAIL must be set as environment variables
 * in the Vercel dashboard (Project → Settings → Environment Variables).
 * They are intentionally NOT exposed to client-side JavaScript.
 */

async function callResend({ apiKey, from, to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Email templates ───────────────────────────────────────────────────────────

function welcomeHtml(displayName, email) {
  const safeDisplayName = displayName.replace(/[<>&"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;',
  }[c]));
  const safeEmail = email.replace(/[<>&"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;',
  }[c]));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Welcome to WordDrop</title>
</head>
<body style="margin:0;padding:0;background:#faf7f2;font-family:'Segoe UI',system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#faf7f2;padding:36px 16px">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" role="presentation"
           style="max-width:560px;width:100%;background:#ffffff;border-radius:24px;overflow:hidden;
                  box-shadow:0 4px 32px rgba(28,16,23,.10)">

      <!-- ── Header ──────────────────────────────────────────────────── -->
      <tr><td style="background:linear-gradient(140deg,#6d28d9 0%,#4f46e5 100%);
                     padding:40px 40px 36px;text-align:center">
        <p style="margin:0 0 4px;font-size:11px;font-weight:800;letter-spacing:.18em;
                  text-transform:uppercase;color:rgba(255,255,255,.65)">Word Search · 60 Seconds</p>
        <h1 style="margin:0;font-size:38px;font-weight:900;letter-spacing:-.04em;
                   color:#ffffff;line-height:1">WordDrop</h1>
      </td></tr>

      <!-- ── Body ────────────────────────────────────────────────────── -->
      <tr><td style="padding:40px 40px 8px">
        <h2 style="margin:0 0 10px;font-size:22px;font-weight:800;color:#1c1017;line-height:1.2">
          Welcome aboard, ${safeDisplayName}!
        </h2>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#4b3f5a">
          Your account is set up and ready to go. Jump in and see how many words
          you can find before the clock runs out — then share your grid with friends
          to see who scores higher.
        </p>

        <!-- Tip card -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
               style="background:#f3f0ff;border-radius:14px;margin-bottom:32px">
          <tr><td style="padding:18px 22px">
            <p style="margin:0 0 6px;font-size:11px;font-weight:800;letter-spacing:.12em;
                      text-transform:uppercase;color:#7c3aed">How to play</p>
            <p style="margin:0;font-size:14px;line-height:1.55;color:#3b2f6e">
              Trace letters in <strong>any direction</strong> — left, right, up, down,
              and diagonals. Every hidden word is at least 4 letters. Use the lightbulb
              hint if you're stuck, but you only get one per game!
            </p>
          </td></tr>
        </table>

        <!-- CTA -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
               style="margin-bottom:36px">
          <tr><td align="center">
            <a href="https://worddrop.vercel.app"
               style="display:inline-block;padding:15px 48px;background:#6d28d9;
                      color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;
                      border-radius:50px;letter-spacing:.01em">
              Play WordDrop &rarr;
            </a>
          </td></tr>
        </table>
      </td></tr>

      <!-- ── Footer ──────────────────────────────────────────────────── -->
      <tr><td style="padding:20px 40px 28px;border-top:1px solid #ede5db;text-align:center">
        <p style="margin:0 0 4px;font-size:12px;color:#9e8fa8">
          Registered with <strong style="color:#6b6079">${safeEmail}</strong>
        </p>
        <p style="margin:0;font-size:11px;color:#c4b8d0;line-height:1.5">
          You're receiving this because you just created a WordDrop account.<br/>
          No further emails will be sent unless you request them.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function notifyHtml({ type, displayName, email, timestamp }) {
  const isGuest     = type === 'guest';
  const playerLabel = isGuest ? 'Guest Player' : 'Registered Player';
  const badgeStyle  = isGuest
    ? 'background:#f3f4f6;color:#374151;border:1px solid #e5e7eb'
    : 'background:#f3f0ff;color:#6d28d9;border:1px solid #ddd6fe';

  const safeName  = (displayName || '—').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
  const safeEmail = (email       || '—').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>New ${playerLabel} — WordDrop</title>
</head>
<body style="margin:0;padding:0;background:#f1f0ee;font-family:'Segoe UI',system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f1f0ee;padding:36px 16px">
  <tr><td align="center">
    <table width="460" cellpadding="0" cellspacing="0" role="presentation"
           style="max-width:460px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;
                  box-shadow:0 4px 24px rgba(0,0,0,.09)">

      <!-- Header -->
      <tr><td style="background:#1c1017;padding:22px 32px;text-align:center">
        <p style="margin:0 0 2px;font-size:10px;font-weight:800;letter-spacing:.2em;
                  text-transform:uppercase;color:#9e8fa8">WordDrop · Dashboard</p>
        <h1 style="margin:0;font-size:18px;font-weight:900;color:#ffffff">
          New ${playerLabel}
        </h1>
      </td></tr>

      <!-- Stats table -->
      <tr><td style="padding:24px 32px 8px">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
          <tr>
            <td style="padding:11px 0;border-bottom:1px solid #ede5db;
                       font-size:11px;font-weight:700;text-transform:uppercase;
                       letter-spacing:.09em;color:#9e8fa8;width:40%">Type</td>
            <td style="padding:11px 0;border-bottom:1px solid #ede5db;text-align:right">
              <span style="display:inline-block;padding:3px 12px;border-radius:20px;
                           font-size:11px;font-weight:700;${badgeStyle}">${playerLabel}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:11px 0;border-bottom:1px solid #ede5db;
                       font-size:11px;font-weight:700;text-transform:uppercase;
                       letter-spacing:.09em;color:#9e8fa8">Name</td>
            <td style="padding:11px 0;border-bottom:1px solid #ede5db;text-align:right;
                       font-size:14px;font-weight:600;color:#1c1017">${safeName}</td>
          </tr>
          <tr>
            <td style="padding:11px 0;border-bottom:1px solid #ede5db;
                       font-size:11px;font-weight:700;text-transform:uppercase;
                       letter-spacing:.09em;color:#9e8fa8">Email</td>
            <td style="padding:11px 0;border-bottom:1px solid #ede5db;text-align:right;
                       font-size:13px;color:#4b3f5a">${safeEmail}</td>
          </tr>
          <tr>
            <td style="padding:11px 0;font-size:11px;font-weight:700;text-transform:uppercase;
                       letter-spacing:.09em;color:#9e8fa8">Time</td>
            <td style="padding:11px 0;text-align:right;font-size:13px;color:#4b3f5a">${timestamp}</td>
          </tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:16px 32px 24px;text-align:center">
        <p style="margin:0;font-size:11px;color:#c4b8d0">
          WordDrop owner notification · only you receive this.
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const EMAIL_FROM     = process.env.EMAIL_FROM     || 'noreply@korelabs.cloud';
  const NOTIFY_EMAIL   = process.env.NOTIFY_EMAIL   || 'michaelogaje033@gmail.com';

  if (!RESEND_API_KEY) {
    console.error('[WordDrop] RESEND_API_KEY is not set');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const from = `WordDrop <${EMAIL_FROM}>`;
  const { action, email = '', displayName = '' } = req.body ?? {};

  const timestamp = new Date().toLocaleString('en-US', {
    timeZone:  'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  try {
    if (action === 'welcome') {
      // Welcome email → new player
      await callResend({
        apiKey:  RESEND_API_KEY,
        from,
        to:      email,
        subject: `Welcome to WordDrop, ${displayName}! 🎮`,
        html:    welcomeHtml(displayName, email),
      });

      // Owner notification → registered player
      await callResend({
        apiKey:  RESEND_API_KEY,
        from,
        to:      NOTIFY_EMAIL,
        subject: `WordDrop — New player: ${displayName}`,
        html:    notifyHtml({ type: 'registered', displayName, email, timestamp }),
      });

      return res.status(200).json({ ok: true });
    }

    if (action === 'guest') {
      // Owner notification → guest player
      await callResend({
        apiKey:  RESEND_API_KEY,
        from,
        to:      NOTIFY_EMAIL,
        subject: 'WordDrop — New guest player',
        html:    notifyHtml({ type: 'guest', displayName: null, email: null, timestamp }),
      });

      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Invalid action. Expected "welcome" or "guest".' });
  } catch (err) {
    console.error('[WordDrop] send-email error:', err);
    return res.status(500).json({ error: err.message });
  }
}
