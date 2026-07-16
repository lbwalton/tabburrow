# Setup notes (for LB, not self-hosters)

Operational one-off setup steps that don't belong in `SELF_HOSTING.md` (which
is written for someone else self-hosting TabBurrow) or in code comments.
Right now this covers exactly one thing: turning on Google sign-in.

## Google OAuth for Supabase Auth

**Status as of T16 (extension auth):** NOT done yet. The local Supabase
stack (`supabase/config.toml`) has an `[auth.external.google]` block, but it
is `enabled = false` with placeholder client id/secret — nobody has created
a real Google OAuth client for this project yet. Until this is done,
clicking "Sign in with Google" in the extension produces a clear "isn't set
up yet" error (see `lib/auth.ts`'s `signInWithGoogle`/`describeWebAuthFlowError`)
instead of crashing; email sign-in works today regardless.

### 1. Find the extension's identity redirect URL

Google needs the EXACT redirect URL Chrome's identity API will send it back
to. That's `chrome.identity.getRedirectURL()`, which resolves to:

```
https://<extension-id>.chromiumapp.org/
```

`<extension-id>` is stable for a **published** (Chrome Web Store) extension
(the id you'll see in `store-assets/`/the CWS listing once T25 ships it) —
NOT the id an unpacked `--load-extension` dev build gets, which changes per
machine/checkout path. Get the real id from
`chrome://extensions` → TabBurrow → "ID" once the CWS listing exists, or
from the CWS listing URL itself (`https://chrome.google.com/webstore/detail/<id>`).

### 2. Create the OAuth client in Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   either create a new project or pick an existing one for TabBurrow.
2. **APIs & Services → OAuth consent screen**: configure it (External user
   type for a public extension; app name "TabBurrow", support email, etc.).
   Add the `.../auth/userinfo.email` and `.../auth/userinfo.profile` scopes
   (Supabase Auth only needs email + basic profile).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. **Application type: Web application** (not "Chrome extension" — Supabase
   Auth's `/authorize` flow does the OAuth dance server-side as a regular
   web client; the extension never talks to Google directly).
5. **Authorized redirect URIs**: add the Supabase Auth callback URL, NOT the
   `chromiumapp.org` one from step 1:
   - Local dev stack: `http://127.0.0.1:54321/auth/v1/callback`
   - Hosted project: `https://<project-ref>.supabase.co/auth/v1/callback`

   (The `chromiumapp.org` URL from step 1 is what `supabase.auth
   .signInWithOAuth`'s `redirectTo` option carries — Supabase itself
   redirects there only AFTER completing the Google leg. Google only ever
   redirects back to Supabase.)
6. Save. Copy the generated **Client ID** and **Client Secret**.

### 3. Configure Supabase

**Local dev stack** (`supabase/config.toml`, already scaffolded by T16):

```toml
[auth.external.google]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
```

Set the two env vars (in the shell `supabase start` runs from, e.g. via the
root `.env` — the Supabase CLI reads `env(...)` references from the process
environment, not automatically from `.env`, so `export` them or run
`supabase start` via a wrapper that sources `.env` first) and restart the
stack:

```sh
export SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<client id from step 2>
export SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<client secret from step 2>
supabase stop && supabase start
```

**Hosted project:** Supabase Dashboard → Authentication → Providers →
Google → paste the client id/secret from step 2, toggle it on. No config.toml
edit needed for a hosted project (that file only drives the local CLI stack).

### 4. Verify

Manual only — see `apps/extension/e2e/MANUAL.md`'s Google OAuth section for
why this can't be driven from the Playwright harness (Chrome's identity
popup needs a human, and the harness doesn't have a Google account to
click through consent with anyway). Build the extension, open Settings,
click "Sign in with Google," and confirm: a real Google consent screen
appears, approving it lands back in the extension signed in (no dangling
tab left open), and the session survives closing/reopening the browser.
