import { fail } from './errors.mjs';
export function createStaffEmail({ env, fetchImpl = globalThis.fetch }) {
  return async ({ to, subject, text }) => {
    try {
      if (!env.RESEND_API_KEY) throw Error();
      const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: "Dayana's Sweet <info@dayanassweet.com>", to: [to], subject, text }) });
      if (!response.ok) throw Error();
      await response.body?.cancel();
    } catch { throw fail(502, 'EMAIL_FAILED', 'No se pudo enviar el correo. Inténtalo otra vez.'); }
  };
}
