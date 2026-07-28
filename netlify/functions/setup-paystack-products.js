// functions/api/setup-paystack-products.js
// ONE-TIME USE. Visit:
//   https://YOUR-SITE.pages.dev/api/setup-paystack-products?key=YOUR_ADMIN_API_PASSWORD
// Required env vars: PAYSTACK_SECRET_KEY, ADMIN_API_PASSWORD

const NETWORKS = { mtn: "MTN", telecel: "Telecel", airteltigo: "AirtelTigo" };

const BUNDLES = {
  mtn: [
    { gb: 1, price: 6, validity: "120 days" },
    { gb: 2.5, price: 12, validity: "120 days" },
    { gb: 5, price: 22, validity: "120 days" },
    { gb: 10, price: 40, validity: "120 days" },
    { gb: 20, price: 75, validity: "120 days" },
    { gb: 50, price: 170, validity: "120 days" },
  ],
  telecel: [
    { gb: 1, price: 6, validity: "120 days" },
    { gb: 3, price: 15, validity: "120 days" },
    { gb: 6, price: 25, validity: "120 days" },
    { gb: 12, price: 45, validity: "120 days" },
    { gb: 25, price: 80, validity: "120 days" },
    { gb: 60, price: 180, validity: "120 days" },
  ],
  airteltigo: [
    { gb: 1.5, price: 6, validity: "120 days" },
    { gb: 3, price: 13, validity: "120 days" },
    { gb: 7, price: 24, validity: "120 days" },
    { gb: 15, price: 42, validity: "120 days" },
    { gb: 30, price: 78, validity: "120 days" },
    { gb: 75, price: 175, validity: "120 days" },
  ],
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  if (!env.ADMIN_API_PASSWORD || key !== env.ADMIN_API_PASSWORD) {
    return new Response("Unauthorized. Add ?key=YOUR_ADMIN_API_PASSWORD to the URL.", { status: 401 });
  }

  const results = [];

  for (const [netKey, list] of Object.entries(BUNDLES)) {
    for (const b of list) {
      const name = `${NETWORKS[netKey]} ${b.gb}GB (${b.validity})`;
      const description = `${NETWORKS[netKey]} data bundle - ${b.gb}GB, valid for ${b.validity}. Delivered instantly via Mobile Money payment.`;
      try {
        const res = await fetch("https://api.paystack.co/product", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
          },
          body: JSON.stringify({
            name,
            description,
            price: Math.round(b.price * 100),
            currency: "GHS",
            unlimited: true,
          }),
        });
        const data = await res.json();
        results.push({ name, ok: res.ok && data.status, message: data.message });
      } catch (err) {
        results.push({ name, ok: false, message: err.message });
      }
    }
  }

  const succeeded = results.filter((r) => r.ok).length;

  return new Response(JSON.stringify({ created: succeeded, total: results.length, results }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
