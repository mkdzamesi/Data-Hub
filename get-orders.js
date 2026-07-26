// netlify/functions/get-orders.js
//
// Lets the admin page fetch orders from Supabase without exposing the
// service_role key to the browser. The admin page calls /api/orders
// with the admin password; this function checks it before returning data.
//
// Required environment variables:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY  - same as the webhook function
//   ADMIN_API_PASSWORD                  - a password of your choice, sent by the admin page

exports.handler = async (event) => {
  const password = event.headers["x-admin-password"];
  if (!process.env.ADMIN_API_PASSWORD || password !== process.env.ADMIN_API_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
  }

  try {
    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/orders?select=*&order=created_at.desc&limit=200`,
      {
        headers: {
          apikey: process.env.SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
      }
    );
    const orders = await res.json();
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orders),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to fetch orders" }) };
  }
};
