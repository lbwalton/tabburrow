#!/usr/bin/env node
// TabBurrow — Stripe product/price/webhook provisioner.
//
// WHY THIS EXISTS: Stripe keeps test-mode and live-mode (and every separate
// account) as fully isolated data stores. Products, prices, and webhook
// endpoints created in one never appear in another — there is no "migrate"
// button (see LAUNCH.md / Stripe's go-live checklist). So whenever TabBurrow
// moves to a new Stripe account or flips from test to live, the exact same
// PRO product, its monthly + yearly prices, and the stripe-webhook endpoint
// have to be recreated. This script does that idempotently against whatever
// account the STRIPE_SECRET_KEY belongs to, and prints the four Edge Function
// secrets to set afterward.
//
// Zero dependencies: talks to Stripe's REST API with Node's built-in fetch
// (Node 18+). No `stripe` SDK install, nothing added to the repo's deps.
//
// USAGE (run TEST first, verify a purchase, then LIVE):
//   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs
//   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe.mjs
//
// Optional env:
//   SUPABASE_PROJECT_REF   Supabase project ref for the webhook URL
//                          (default: kaktkbnqkqxfhwrerhjh — the hosted
//                          "Tab-Burrow" project). Self-hosters set their own.
//   WEBHOOK_URL            Full webhook URL, overrides SUPABASE_PROJECT_REF.
//
// Re-running is safe: it finds the existing product/prices/webhook (by
// metadata, price lookup_key, and webhook URL) and reuses them instead of
// making duplicates.

const API = "https://api.stripe.com/v1";

// ---- What we provision (single source of truth) ---------------------------
// Prices are $3.99/month and $29/year in USD (LAUNCH.md positioning). Stripe
// amounts are in the currency's smallest unit, so cents.
const PRODUCT = {
  name: "TabBurrow PRO",
  description:
    "Cloud sync across devices, shareable collections, and cloud AI organizing.",
  // Lets re-runs (and future accounts) find "our" product without guessing by name.
  metadata: { app: "tabburrow", kind: "pro" },
};

const PRICES = [
  {
    envVar: "STRIPE_PRICE_MONTHLY",
    lookupKey: "tabburrow_pro_monthly",
    nickname: "TabBurrow PRO — Monthly",
    unitAmount: 399, // $3.99
    interval: "month",
  },
  {
    envVar: "STRIPE_PRICE_YEARLY",
    lookupKey: "tabburrow_pro_yearly",
    nickname: "TabBurrow PRO — Yearly",
    unitAmount: 2900, // $29.00
    interval: "year",
  },
];

const CURRENCY = "usd";

// The stripe-webhook Edge Function only acts on these three (every other type
// is answered 200 {ignored:true}); see supabase/functions/stripe-webhook/index.ts.
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

const DEFAULT_PROJECT_REF = "kaktkbnqkqxfhwrerhjh";

// ---- Tiny Stripe REST client ----------------------------------------------

/**
 * Form-encodes a nested params object into Stripe's bracket syntax, e.g.
 * {metadata:{app:"tabburrow"}, recurring:{interval:"month"}, enabled_events:["a","b"]}
 * -> metadata[app]=tabburrow&recurring[interval]=month&enabled_events[]=a&enabled_events[]=b
 */
function encode(obj, prefix = "", out = []) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const field = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      for (const item of value) out.push(`${encodeURIComponent(`${field}[]`)}=${encodeURIComponent(item)}`);
    } else if (typeof value === "object") {
      encode(value, field, out);
    } else {
      out.push(`${encodeURIComponent(field)}=${encodeURIComponent(value)}`);
    }
  }
  return out.join("&");
}

async function stripe(method, path, params) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params ? encode(params) : undefined,
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json?.error?.message ?? JSON.stringify(json);
    throw new Error(`Stripe ${method} ${path} -> ${res.status}: ${msg}`);
  }
  return json;
}

// ---- Find-or-create steps (all idempotent) --------------------------------

async function findOrCreateProduct() {
  // Product list can't filter by metadata server-side, so pull active
  // products and match our tag client-side. Fine for a single-product account.
  const { data } = await stripe("GET", "/products?limit=100&active=true");
  const existing = data.find(
    (p) => p.metadata?.app === "tabburrow" && p.metadata?.kind === "pro",
  );
  if (existing) {
    console.log(`  product   reused   ${existing.id}  (${existing.name})`);
    return existing;
  }
  const created = await stripe("POST", "/products", {
    name: PRODUCT.name,
    description: PRODUCT.description,
    metadata: PRODUCT.metadata,
  });
  console.log(`  product   created  ${created.id}  (${created.name})`);
  return created;
}

async function findOrCreatePrice(product, spec) {
  // lookup_key is the stable, human-set handle that survives across accounts.
  const { data } = await stripe(
    "GET",
    `/prices?lookup_keys[]=${encodeURIComponent(spec.lookupKey)}&active=true&limit=1`,
  );
  const existing = data[0];
  if (existing) {
    const dollars = (existing.unit_amount / 100).toFixed(2);
    const mismatch =
      existing.unit_amount !== spec.unitAmount ||
      existing.recurring?.interval !== spec.interval ||
      existing.product !== product.id;
    console.log(
      `  price     reused   ${existing.id}  ($${dollars}/${existing.recurring?.interval})` +
        (mismatch ? "  ⚠ differs from spec — left as-is (prices are immutable)" : ""),
    );
    return existing;
  }
  const created = await stripe("POST", "/prices", {
    product: product.id,
    currency: CURRENCY,
    unit_amount: spec.unitAmount,
    recurring: { interval: spec.interval },
    lookup_key: spec.lookupKey,
    nickname: spec.nickname,
  });
  console.log(
    `  price     created  ${created.id}  ($${(spec.unitAmount / 100).toFixed(2)}/${spec.interval})`,
  );
  return created;
}

async function findOrCreateWebhook(url) {
  const { data } = await stripe("GET", "/webhook_endpoints?limit=100");
  const existing = data.find((w) => w.url === url && w.status !== "disabled");
  if (existing) {
    // Stripe only returns the signing secret in the create response, never on
    // read — so a reused endpoint can't hand us STRIPE_WEBHOOK_SECRET.
    console.log(`  webhook   reused   ${existing.id}  ${url}`);
    return { endpoint: existing, secret: null };
  }
  const created = await stripe("POST", "/webhook_endpoints", {
    url,
    enabled_events: WEBHOOK_EVENTS,
    description: "TabBurrow — plan entitlement (checkout + subscription lifecycle)",
  });
  console.log(`  webhook   created  ${created.id}  ${url}`);
  return { endpoint: created, secret: created.secret };
}

// ---- Main -----------------------------------------------------------------

const SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!SECRET_KEY) {
  console.error("ERROR: set STRIPE_SECRET_KEY (the target account's secret key).");
  console.error("  STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs");
  process.exit(1);
}

const MODE = SECRET_KEY.includes("_live_")
  ? "LIVE"
  : SECRET_KEY.includes("_test_")
    ? "TEST"
    : "UNKNOWN";

const webhookUrl =
  process.env.WEBHOOK_URL ??
  `https://${process.env.SUPABASE_PROJECT_REF ?? DEFAULT_PROJECT_REF}.supabase.co/functions/v1/stripe-webhook`;

async function main() {
  console.log(`\n=== TabBurrow Stripe setup — MODE: ${MODE} ===`);
  if (MODE === "UNKNOWN") {
    console.log("  (key prefix isn't sk_test_/sk_live_ — a restricted key? proceeding.)");
  }
  console.log(`  webhook target: ${webhookUrl}\n`);

  const product = await findOrCreateProduct();
  const priceIds = {};
  for (const spec of PRICES) {
    const price = await findOrCreatePrice(product, spec);
    priceIds[spec.envVar] = price.id;
  }
  const { secret: webhookSecret } = await findOrCreateWebhook(webhookUrl);

  // ---- What to set on the Edge Functions ----------------------------------
  const modeWord = MODE === "LIVE" ? "live" : MODE === "TEST" ? "test" : "this account's";
  console.log(`\n=== Set these on Supabase (${modeWord} values) ===`);
  console.log("  supabase secrets set \\");
  // Deliberately a PLACEHOLDER, not the real key: never print a secret to the
  // terminal (scrollback/logs), and never print a TRUNCATED key that could be
  // pasted verbatim and silently set an invalid STRIPE_SECRET_KEY.
  console.log(`    STRIPE_SECRET_KEY='<paste the FULL ${MODE === "LIVE" ? "sk_live_" : "sk_test_"} key here>' \\`);
  console.log(
    `    STRIPE_WEBHOOK_SECRET=${webhookSecret ?? "whsec_...(reuse: reveal/roll it in the Stripe dashboard → Webhooks)"} \\`,
  );
  console.log(`    STRIPE_PRICE_MONTHLY=${priceIds.STRIPE_PRICE_MONTHLY} \\`);
  console.log(`    STRIPE_PRICE_YEARLY=${priceIds.STRIPE_PRICE_YEARLY}`);

  if (!webhookSecret) {
    console.log(
      "\n  NOTE: the webhook endpoint already existed, so its signing secret\n" +
        "  wasn't returned. Reveal it (or click 'Roll secret') in the Stripe\n" +
        "  dashboard → Developers → Webhooks → that endpoint, and use that value.",
    );
  }
  console.log(
    "\n  Reminder: secrets are read at runtime — no redeploy needed, but the\n" +
      "  Edge Functions must already be deployed to this project. SITE_URL should\n" +
      "  stay https://tabburrow.com.\n",
  );
}

main().catch((err) => {
  console.error(`\nFAILED: ${err.message}\n`);
  process.exit(1);
});
