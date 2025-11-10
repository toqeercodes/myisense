export default async function handler(req, res) {
  // CORS headers
  const ALLOWED_ORIGIN = 'https://extensions.shopifycdn.com'; // Shopify checkout extension origin
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight OPTIONS
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    // Get variantId from query or POST body
    const { variantId, shop } = req.query || req.body;

    if (!shop || !variantId) {
      return res.status(400).json({ error: 'Missing shop or variantId' });
    }

    // Shopify Admin API call
    const response = await fetch(
      `https://admin.shopify.com/store/my-isense/api/2025-07/variants/32366749155388.json`,
      {
        headers: {
          'X-Shopify-Access-Token': '9c25f25569a11406d209f88a540fbc4e',
          'Content-Type': 'application/json',
        },
      }
    );

    const text = await response.text();

    if (!response.ok) {
      return res.status(response.status).send(text);
    }

    const data = JSON.parse(text);
    return res.status(200).json(data.variant ?? data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
