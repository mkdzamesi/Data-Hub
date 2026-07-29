// netlify/functions/paystack-webhook.js
//
// Receives payment events from Paystack, verifies they're genuine,
// automatically delivers the bundle(s) via the BundleHub API, stores
// the order (with fulfillment result) in Supabase, and emails you a
// notification.
//
// Required environment variables (set these in Netlify:
// Site settings -> Environment variables):
//   PAYSTACK_SECRET_KEY   - your Paystack secret key (starts with sk_live_ or sk_test_)
//   BUNDLESGHANA_API_KEY  - your BundleHub API key (starts with bh_live_)
//   SUPABASE_URL          - your Supabase project URL
//   SUPABASE_SERVICE_KEY  - your Supabase service_role key (or new sb_secret_ key)
//   RESEND_API_KEY        - your Resend API key (optional - skips email if missing)
//   NOTIFY_EMAIL          - the email address you want notified (optional)

const crypto = require("crypto");

const BUNDLEHUB_URL = "https://bzedcpcndayurevnzajp.supabase.co/functions/v1/developer-api";

// Our site's network keys -> BundleHub's expected network values.
const NETWORK_MAP = {
  mtn: "mtn",
  telecel: "telecel",
  airteltigo: "ishare", // BundleHub calls AirtelTigo "ishare"
};

// BundleHub wants a 10-digit local number starting with 0 (e.g. 0244123456).
function normalizePhone(raw) {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("233")) digits = "0" + digits.slice(3);
  if (digits.length === 9) digits = "0" + digits;
  return digits;
}

async function bundleHubRequest(body) {
  const res = await fetch(BUNDLEHUB_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.BUNDLESGHANA_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok && data.success, data };
}

async function fulfillOrder(items, phone, paystackRef) {
  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const network = NETWORK_MAP[item.network] || item.network;
    const { ok, data } = await bundleHubRequest({
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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  const signature = event.headers["x-paystack-signature"];
  const rawBody = event.body;

  const hash = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  if (hash !== signature) {
    return { statusCode: 401, body: "Invalid signature" };
  }

  const payload = JSON.parse(rawBody);

  if (payload.event !== "charge.success") {
    return { statusCode: 200, body: "Ignored (not a successful charge)" };
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
  if (items.length > 0 && process.env.BUNDLESGHANA_API_KEY) {
    try {
      fulfillmentResults = await fulfillOrder(items, phone, data.reference);
      const allOk = fulfillmentResults.every((r) => r.ok);
      fulfillmentStatus = allOk ? "delivered" : "partial_or_failed";
    } catch (err) {
      console.error("BundleHub fulfillment error", err);
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
    fulfillment_detail: JSON.stringify(fulfillmentResults.map((r) => ({
      network: r.item.network,
      gb: r.item.gb,
      ok: r.ok,
      message: r.data?.message || r.data?.error || "",
    }))),
  };

  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(order),
    });
    if (!res.ok) {
      console.error("Supabase insert failed", await res.text());
    }
  } catch (err) {
    console.error("Supabase error", err);
  }

  if (process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL) {
    try {
      const fulfillLine =
        fulfillmentStatus === "delivered"
          ? "Bundle(s) delivered automatically via BundleHub."
          : `Fulfillment status: ${fulfillmentStatus} — check admin dashboard.`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: "Praise Data Hub <orders@resend.dev>",
          to: [process.env.NOTIFY_EMAIL],
          subject: `New order: GH₵ ${order.total} — ${order.ref} (${fulfillmentStatus})`,
          text: `New paid order.\n\nRef: ${order.ref}\nPhone: ${order.phone}\nItems: ${order.items}\nTotal: GH₵ ${order.total}\n\n${fulfillLine}`,
        }),
      });
    } catch (err) {
      console.error("Email error", err);
    }
  }

  return { statusCode: 200, body: "OK" };
};
