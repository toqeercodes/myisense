export default async function handler(req, res) {
  const { shop, variantId } = req.query;

  if (!shop || !variantId) {
    return res.status(400).json({ error: 'Missing shop or variantId' });
  }

  try {
    const response = await fetch(`https://${shop}/admin/api/2025-07/variants/${variantId}.json`, {
      headers: {
        'X-Shopify-Access-Token': '9c25f25569a11406d209f88a540fbc4e',
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).send(body);
    }

    const data = await response.json();
    return res.status(200).json(data.variant ?? data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
