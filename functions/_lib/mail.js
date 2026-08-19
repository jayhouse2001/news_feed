// Magic-link delivery. Resend is the only outbound dependency in the app; if
// it is not configured the link is logged instead, which keeps local
// development working without a mail account.

export async function sendLoginMail(env, email, link) {
  const from = env.MAIL_FROM || 'onboarding@resend.dev';
  if (!env.RESEND_API_KEY) {
    console.log('[dev] login link for', email, '->', link);
    return { delivered: false, dev: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: '뉴스 피드 로그인',
      text: [
        '아래 주소를 열면 로그인됩니다.',
        '',
        link,
        '',
        '15분 뒤에 만료되고, 한 번만 쓸 수 있습니다.',
        '요청한 적이 없다면 이 메일은 무시하세요.',
      ].join('\n'),
      html: loginHtml(link),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('resend failed', res.status, body);
    throw new Error('메일을 보내지 못했습니다.');
  }
  return { delivered: true };
}

// Inline styles only: mail clients strip <style> blocks, and the button has to
// survive that as a readable link rather than disappearing.
function loginHtml(link) {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f3f5f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
<h1 style="margin:0 0 6px;font-size:19px;color:#23272f">뉴스 피드 로그인</h1>
<p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#6c7480">
아래 버튼을 누르면 바로 로그인됩니다. 비밀번호는 없습니다.</p>
<a href="${link}" style="display:block;padding:13px;border-radius:10px;background:#2e5fcc;color:#fff;font-size:15px;font-weight:600;text-align:center;text-decoration:none">로그인하기</a>
<p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#9aa2af">
15분 뒤에 만료되고 한 번만 쓸 수 있습니다.<br>
요청한 적이 없다면 이 메일을 무시하세요.</p>
<p style="margin:14px 0 0;font-size:11px;color:#c2c8d0;word-break:break-all">${link}</p>
</div></body></html>`;
}
