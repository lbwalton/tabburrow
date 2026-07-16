/**
 * Client for the local Supabase stack's bundled mail catcher — used only by
 * t16-auth.spec.ts to fetch the real email `sendEmailCode` triggers and
 * extract its 6-digit OTP, so that spec drives an actual sign-in rather
 * than mocking the email step. Test-only: never imported by extension
 * source.
 *
 * `supabase/config.toml`'s `[inbucket]` section reserves port 54324 for
 * this, but `supabase status`'s CLI banner (v2.75.0) labels the tool
 * "Mailpit" — Supabase has swapped the underlying mail-catcher implementation
 * from Inbucket to Mailpit in recent CLI versions while keeping the old
 * config key name. Verified locally (`curl http://127.0.0.1:54324/api/v1/
 * messages` returns a Mailpit-shaped JSON body; Inbucket's `/api/v1/mailbox/
 * <name>` 404s), so this only implements the Mailpit API — `isMailpit()`
 * probes it once so a future CLI version swapping the mail catcher back (or
 * to something else) fails with a clear diagnostic instead of a confusing
 * timeout.
 */
const MAIL_BASE_URL = "http://127.0.0.1:54324";

interface MailpitMessageSummary {
  ID: string;
}
interface MailpitSearchResponse {
  messages: MailpitMessageSummary[];
}
interface MailpitMessageDetail {
  Text: string;
}

async function isMailpit(): Promise<boolean> {
  try {
    const res = await fetch(`${MAIL_BASE_URL}/api/v1/messages`);
    if (!res.ok) return false;
    const body = (await res.json()) as { messages?: unknown };
    return Array.isArray(body.messages);
  } catch {
    return false;
  }
}

/** Clears every message in the mail catcher — call before triggering a fresh OTP so a stale prior code for the same address can never be matched by accident. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAIL_BASE_URL}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

async function waitForNewestMessage(to: string, timeoutMs: number): Promise<MailpitMessageDetail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAIL_BASE_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    if (res.ok) {
      const body = (await res.json()) as MailpitSearchResponse;
      const newest = body.messages[0];
      if (newest) {
        const detailRes = await fetch(`${MAIL_BASE_URL}/api/v1/message/${newest.ID}`);
        if (detailRes.ok) return (await detailRes.json()) as MailpitMessageDetail;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email arrived for ${to} within ${timeoutMs}ms`);
}

const CODE_PATTERN = /enter the code:\s*(\d{6})/i;

/** Extracts the 6-digit OTP from Supabase's default magic-link email body ("Alternatively, enter the code: 123456") — verified against a real local send (see this file's module docstring). */
export function extractOtpCode(text: string): string {
  const match = CODE_PATTERN.exec(text);
  if (!match) throw new Error(`Could not find a 6-digit code in email body:\n${text}`);
  return match[1]!;
}

/** Waits for the OTP email `sendEmailCode(to)` triggers and returns its extracted 6-digit code. */
export async function waitForOtpCode(to: string, timeoutMs = 15_000): Promise<string> {
  if (!(await isMailpit())) {
    throw new Error(
      `Local mail catcher at ${MAIL_BASE_URL} did not respond as Mailpit — is \`supabase start\` running? See e2e/mail.ts.`,
    );
  }
  const message = await waitForNewestMessage(to, timeoutMs);
  return extractOtpCode(message.Text);
}
