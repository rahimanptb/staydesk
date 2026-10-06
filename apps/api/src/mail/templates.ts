import { brand } from '@staydesk/config';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function layout(heading: string, paragraphs: string[], action?: { label: string; url: string }) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#1f5e8c;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#475569">If the button does not work, copy this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : '';
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;background:#f6f8fa;padding:24px">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:28px">
<p style="margin:0 0 20px;font-weight:600">${escapeHtml(brand.productName)}</p>
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>${body}${button}
<p style="margin:24px 0 0;font-size:12px;color:#64748b">You received this email because of activity on your ${escapeHtml(brand.productName)} account.</p>
</div></body></html>`;
}

function text(paragraphs: string[], action?: { label: string; url: string }) {
  return [...paragraphs, ...(action ? [`${action.label}: ${action.url}`] : [])].join('\n\n');
}

export function invitationEmail(input: {
  organizationName: string;
  inviterName: string | null;
  url: string;
  expiresInHours: number;
}): RenderedEmail {
  const who = input.inviterName ? `${input.inviterName} has invited you` : 'You have been invited';
  const paragraphs = [
    `${who} to join ${input.organizationName} on ${brand.productName}.`,
    `This invitation expires in ${input.expiresInHours} hours.`,
  ];
  const action = { label: 'Accept invitation', url: input.url };
  return {
    subject: `You're invited to ${input.organizationName} on ${brand.productName}`,
    text: text(paragraphs, action),
    html: layout('You have been invited', paragraphs, action),
  };
}

export function passwordResetEmail(input: {
  url: string;
  expiresInMinutes: number;
}): RenderedEmail {
  const paragraphs = [
    'We received a request to reset your password.',
    `The link expires in ${input.expiresInMinutes} minutes. If you did not ask for this, you can ignore this email; your password stays the same.`,
  ];
  const action = { label: 'Choose a new password', url: input.url };
  return {
    subject: `Reset your ${brand.productName} password`,
    text: text(paragraphs, action),
    html: layout('Reset your password', paragraphs, action),
  };
}

export function passwordChangedEmail(): RenderedEmail {
  const paragraphs = [
    'Your password was just changed and all your other sessions were signed out.',
    'If this was not you, reset your password immediately and contact your administrator.',
  ];
  return {
    subject: `Your ${brand.productName} password was changed`,
    text: text(paragraphs),
    html: layout('Your password was changed', paragraphs),
  };
}
