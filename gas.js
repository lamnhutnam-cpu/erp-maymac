// Netlify Function proxy → Google Apps Script
const GAS_URL = "https://script.google.com/macros/s/AKfycbyhrpVe2ezgBY5fmvf23fh0BUl2J11w8xe_5QpPe0PE18KPfx-0j8xVveybzQrSpg/exec";

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: "",
    };
  }

  try {
    const q = event.rawUrl.split("?")[1];
    const url = q ? `${GAS_URL}?${q}` : GAS_URL;

    // Node 18 trên Netlify có sẵn global fetch → KHÔNG cần node-fetch
    const res = await fetch(url, {
      method: event.httpMethod,
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: event.httpMethod === "POST" ? event.body : undefined,
    });

    const text = await res.text(); // GAS trả JSON string
    return {
      statusCode: res.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: false, error: String(err) }),
    };
  }
}
