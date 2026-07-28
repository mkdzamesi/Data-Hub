// functions/api/paystack-webhook.js
// Cloudflare Pages Function — lives at the URL /api/paystack-webhook automatically
// (no redirects config needed, Cloudflare routes by file path).
//
// Required environment variables (set in Cloudflare dashboard:
// Workers & Pages -> your project -> Settings -> Environment variables):
//   PAYSTACK_SECRET_KEY, BUNDLESGHANA_API_KEY,
//   SUPABASE_URL, SUPABASE_SERVICE_KEY,
//   RESEND_API_KEY, NOTIFY_EMAIL

const BUNDLEHUB_URL = "https://bzedcpcndayurevnzajp.supabase.co/functions/v1/developer-api";

const NETWORK_MAP = { mtn: "mtn", telecel: "telecel", airteltigo: "ishare" };

function normalizePhone(raw) {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("233")) digits = "0" + digits.slice(3);
  if (digits.length === 9) digits = "0" + digits;
  return digits;
}

// Cloudflare Workers use the Web Crypto API, not Node's `crypto` module.
async function verifyPaystackSignature(secret, rawBody, signatureHeader) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const hashHex = [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hashHex === signatureHeader;
}

async function bundleHubRequest(apiKey, body) {
  const res = await fetch(BUNDLEHUB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok && data.success, data };
}

async function fulfillOrder(apiKey, items, phone, paystackRef) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const network = NETWORK_MAP[item.network] || item.network;
    const { ok, data } = await bundleHubRequest(apiKey, {
      action: "place_order",
      network,
      recipient: normalizePhone(phone),
      package_size: item.gb,
      order_id: `${paystackRef}-${i + 1}`,
    });
    results.push({ item, ok, data });
  }
  return results;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  const valid = await verifyPaystackSignature(env.PAYSTACK_SECRET_KEY, rawBody, signature);
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  if (payload.event !== "charge.success") {
    return new Response("Ignored (not a successful charge)", { status: 200 });
  }

  const data = payload.data;
  const phone = data.metadata?.phone || "";
  let items = [];
  try {
    items = JSON.parse(data.metadata?.items || "[]");
  } catch (e) {
    items = [];
  }

  let fulfillmentResults = [];
  let fulfillmentStatus = "skipped";
  if (items.length > 0 && env.BUNDLESGHANA_API_KEY) {
    try {
      fulfillmentResults = await fulfillOrder(env.BUNDLESGHANA_API_KEY, items, phone, data.reference);
      fulfillmentStatus = fulfillmentResults.every((r) => r.ok) ? "delivered" : "partial_or_failed";
    } catch (err) {
      fulfillmentStatus = "error";
    }
  }

  const order = {
    ref: data.reference,
    email: data.customer?.email || "",
    phone,
    momo: data.metadata?.momo || "",
    items: data.metadata?.bundles || "",
    total: data.amount / 100,
    currency: data.currency,
    status: data.status,
    paid_at: data.paid_at,
    fulfillment_status: fulfillmentStatus,
    fulfillment_detail: JSON.stringify(
      fulfillmentResults.map((r) => ({
        network: r.item.network,
        gb: r.item.gb,
        ok: r.ok,
        message: r.data?.message || r.data?.error || "",
      }))
    ),
  };

  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(order),
    });
  } catch (err) {
    // swallow - still return 200 to Paystack so it doesn't retry forever
  }

  if (env.RESEND_API_KEY && env.NOTIFY_EMAIL) {
    try {
      const fulfillLine =
        fulfillmentStatus === "delivered"
          ? "Bundle(s) delivered automatically via BundleHub."
          : `Fulfillment status: ${fulfillmentStatus} — check admin dashboard.`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "Praise Data Hub <orders@resend.dev>",
          to: [env.NOTIFY_EMAIL],
          subject: `New order: GH₵ ${order.total} — ${order.ref} (${fulfillmentStatus})`,
          text: `New paid order.\n\nRef: ${order.ref}\nPhone: ${order.phone}\nItems: ${order.items}\nTotal: GH₵ ${order.total}\n\n${fulfillLine}`,
        }),
      });
    } catch (err) {
      // non-fatal
    }
  }

  return new Response("OK", { status: 200 });
}
