# Chrome Web Store: Privacy practices & Distribution

Copy-paste answers for the two form-based tabs in the Developer Dashboard that
`listing.md` does not cover. Every answer here is derived from the real
manifest (`apps/extension/wxt.config.ts`) and extension source, so it matches
what a reviewer sees in the install prompt. If a field on the live dashboard
doesn't match a heading here, the dashboard is the source of truth (Google
reworks this form periodically) — tell me and I'll reconcile it.

Status: draft, not yet submitted.

---

## Privacy practices tab

### Single purpose (required)

```
TabBurrow saves the tabs and links you choose into local-first collections,
then lets you organize, search, and restore them. Optionally, signing in adds
cloud sync across devices and AI-assisted organizing.
```

### Permission justifications (required, one per declared permission)

The shipped manifest declares: `tabs`, `storage`, `favicon`, `identity`,
`alarms`, plus the host permission `https://*.supabase.co/*`. (The
`http://127.0.0.1:54321/*` loopback host is dev/e2e-only and is stripped from
production builds — it will not appear in the uploaded package, so there is no
justification to write for it.)

**`tabs`**
```
Reading the URL and title of your open tabs is the extension's core action:
you click Save to store the current tab, all open tabs, or your highlighted
selection into a collection, and the automatic session snapshots record which
windows and tabs are open so you can restore them after a crash. TabBurrow
uses only the tab URL and title; it never reads page content.
```

**`storage`**
```
Used to persist your signed-in session and settings on your device via
chrome.storage. When you sign in for PRO cloud sync, the Supabase auth session
and PKCE verifier are stored here so you stay signed in between browser
restarts. (Your collections, links, and session snapshots live in the
browser's IndexedDB, not in this permission.)
```

**`favicon`**
```
Used to display each saved link's site icon next to its title in the popup and
dashboard, via Chrome's _favicon/ API, so saved links are visually
recognizable. It reads only the favicon for URLs you have already saved.
```

**`identity`**
```
Used only when you choose to sign in for PRO features. chrome.identity
.launchWebAuthFlow runs the Google OAuth / email magic-link flow and returns
the redirect, which is exchanged for a Supabase session. No sign-in happens
unless you initiate it; the extension is fully usable signed-out.
```

**`alarms`**
```
Used to run two periodic background jobs on a timer: an automatic session
snapshot of your open windows every five minutes (so an accidental close or a
crash never loses your tabs), and, for signed-in PRO users, a periodic
cloud-sync check. chrome.alarms is used instead of timers so the jobs survive
the service worker being suspended.
```

**Host permission — `https://*.supabase.co/*`**
```
The extension talks to a Supabase backend for the optional signed-in features:
authentication, cloud sync of your collections and links, and the cloud
AI-organize function. The wildcard covers both TabBurrow's hosted backend and
any self-hosted Supabase project, since TabBurrow is open source and can be
pointed at your own backend. No request is made to any Supabase host until you
sign in.
```

### Are you using remote code? (required)

**No, I am not using remote code.**

```
All executable code is bundled in the package. The extension calls its Supabase
backend over HTTPS for data (auth, sync, AI-organize), but it never loads or
executes remotely hosted JavaScript, and it declares no externally_connectable
or remote script sources. The on-device AI path uses Chrome's built-in
Gemini Nano (the Prompt API / LanguageModel), which is part of the browser,
not code TabBurrow downloads.
```

### Data usage — what the extension collects

Check these categories and use the notes as the "how it's used" explanation.

| Category | Collected? | Why / note |
|---|---|---|
| Personally identifiable information | **Yes** | Only if you sign in: your email address, for your account. |
| Authentication information | **Yes** | Only if you sign in: the OAuth / magic-link session token that keeps you logged in. |
| Web history | **Yes** | The URLs and titles of the tabs you choose to save (and the session snapshots of open tabs). Stored locally; synced only if you sign in. |
| Website content | **No** | TabBurrow never reads or transmits page text, images, or files. The AI path sends only saved link **titles and URLs**, never page content. |
| Financial and payment information | **No** | PRO billing happens on the website via Stripe, which collects card data directly; the extension never sees or stores card details. |
| Location | **No** | |
| Health information | **No** | |
| Personal communications | **No** | |
| User activity (clicks, keystrokes, mouse, network monitoring) | **No** | |

> Note on "Financial information": if the dashboard interprets this at the
> product level rather than the extension package level, and you'd rather
> over-disclose, you can check it and note "subscription status only; card
> details handled by Stripe on the website." The extension binary itself
> collects none of it, so leaving it unchecked is accurate and is the
> recommended answer.

### Data usage — required certifications (three checkboxes)

Check **all three** — they are all true for TabBurrow:

1. ☑ **I do not sell or transfer user data to third parties outside of the
   approved use cases.** (Titles+URLs go to Anthropic and data goes to Supabase
   only as service providers, to deliver the feature you asked for — an
   approved use case. Nothing is sold.)
2. ☑ **I do not use or transfer user data for purposes unrelated to my item's
   single purpose.**
3. ☑ **I do not use or transfer user data to determine creditworthiness or for
   lending purposes.**

### Privacy policy URL (required)

```
https://tabburrow.com/privacy
```

- Source of the prose: `apps/web/app/(marketing)/privacy/page.tsx`.
- **Blocker before submit:** this URL must resolve publicly. The site domain
  in `apps/web/lib/site-config.ts` is `https://tabburrow.com`, and
  `CHROME_STORE_URL` is still `"#"`, which suggests the marketing site may not
  be deployed yet. Confirm `https://tabburrow.com/privacy` returns the page in
  a normal browser (no auth wall, no 404) before you submit — Google fetches it
  during review and rejects an unreachable policy URL.

---

## Distribution tab

| Field | Value | Note |
|---|---|---|
| **Visibility** | **Public** | Decided 2026-07-27. Anyone can find it in store search/browse. |
| **Payments** | **Free** | The extension is free. PRO is billed on the website through Stripe, not through Chrome Web Store payments (which Google has deprecated anyway). Do not attach a CWS price. |
| **Distribution regions** | **All regions** | No geographic or legal reason to restrict. |
| **Mature content** | **No** | |
| **Google Analytics for the listing** | Optional | Leave off unless you want CWS traffic stats; unrelated to the extension's own no-analytics stance. |

---

## Test instructions tab (Access section)

Core features are NOT gated behind login, and auth is Google OAuth / email
magic-link only (no password login), so:

- **Username / Password:** leave **both blank** — no shareable password account
  exists and none is needed to review the core product.
- **Additional instructions (max 500 chars):**

```
No account is needed to test TabBurrow's core features, so no login credentials apply. After install, click the toolbar icon, then "1-click Save" to save the current tab (or "Save all tabs"). Open the dashboard (Alt+Shift+B) to organize, search, snapshot windows, and import/export bookmarks: all local, works offline. Optional PRO features (cloud sync, shareable pages, cloud AI organize) sign in via Google OAuth or an email magic link only; no password login, so no shareable test account.
```

(492/500 chars.) Then click **Save changes**.

---

## Pre-submit checklist

- [ ] `https://tabburrow.com/privacy` resolves publicly (see blocker above).
- [ ] Uploaded ZIP is a **production** build (no `127.0.0.1` host permission —
      `wxt build` default excludes it; do NOT build with
      `WXT_INCLUDE_LOCAL_HOSTS=1`).
- [ ] Manifest `name` matches `listing.md`'s Title
      ("TabBurrow: Tab & Bookmark Manager").
- [ ] Single purpose, all permission justifications, remote-code = No, data
      categories, three certifications, and privacy policy URL all filled in on
      the Privacy practices tab.
- [ ] Distribution tab: Free, visibility set, all regions.
- [ ] A support/contact email is set on the account (Chrome requires one; the
      privacy policy points contact to the GitHub repo).
