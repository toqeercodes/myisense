export default async function handler(req, res) {
  // CORS for Shopify Checkout Extensions
  const ALLOWED_ORIGIN = 'https://extensions.shopifycdn.com';
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const variant_ids = body.variant_ids || body.variantIds || [];
    const discounts = body.discounts; // This is the array: [{ code: 'UNLOCK' }]
    console.log("discounts: ", discounts);
    if (!Array.isArray(variant_ids) || variant_ids.length === 0) {
      return res.status(400).json({ error: 'Missing variant_ids array' });
    }

    const shop = 'my-isense.myshopify.com';
    const token = process.env.SHOPIFY_TOKEN || '9c25f25569a11406d209f88a540fbc4e';
    const adminApiHeaders = {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    };

    const parsePrice = (v) => {
      if (v == null) return 0;
      if (typeof v === 'number') return v;
      const cleaned = String(v).replace(/[^0-9.\-]/g, '');
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    };

    // --- 1. Fetch Variant Compare-At Savings ---
    const fetches = variant_ids.map((id) =>
      fetch(`https://${shop}/admin/api/2025-07/variants/${id}.json`, {
        headers: adminApiHeaders,
      })
        .then(async (r) => {
          // ... (your existing variant parsing logic)
          const txt = await r.text();
          if (!r.ok) return { id, error: txt };
          const payload = JSON.parse(txt);
          const variant = payload.variant ?? payload;
          const compareRaw = variant.compare_at_price ?? variant.compareAtPrice ?? variant.compareAtPriceV2?.amount ?? null;
          const priceRaw = variant.price ?? variant.priceV2?.amount ?? null;
          const compareN = parsePrice(compareRaw);
          const priceN = parsePrice(priceRaw);
          const savings = Math.max(0, compareN - priceN);
          return { id: variant.id ?? id, savings };
        })
        .catch((err) => ({ id, error: String(err) }))
    );
    const results = await Promise.all(fetches);
    const compareAtSavings = results.reduce((acc, r) => {
      if (r && typeof r.savings === 'number') return acc + r.savings;
      return acc;
    }, 0);

    // --- 2. Fetch Discount Code Savings (NEW) ---
    let discountCodeSavings = 0;
    if (discounts && Array.isArray(discounts) && discounts.length > 0) {
      console.log("if discounts: ", discounts);
      try {
        const discountCode = discounts[0].code; // Get the code "UNLOCK"
        
        // Step A: Look up the discount code to get its price_rule_id
        const lookupRes = await fetch(`https://${shop}/admin/api/2025-07/discount_codes/lookup.json?code=${discountCode}`, {
          headers: adminApiHeaders,
        });
        
        if (lookupRes.ok) {
          const lookupData = await lookupRes.json();
          const priceRuleId = lookupData.discount_code.price_rule_id;
          console.log("priceRuleId : ", priceRuleId);
          // Step B: Get the Price Rule to find its value
          const priceRuleRes = await fetch(`https://${shop}/admin/api/2025-07/price_rules/${priceRuleId}.json`, {
            headers: adminApiHeaders,
          });

          if (priceRuleRes.ok) {
            const priceRuleData = await priceRuleRes.json();
            const priceRule = priceRuleData.price_rule;
            console.log("priceRule : ", priceRule);
            // Only count fixed amounts for this logic
            if (priceRule.value_type === 'fixed_amount') {
              // Value is stored as a negative string, e.g., "-100.00"
              discountCodeSavings = parsePrice(priceRule.value) * -1;
            }
          }
        }
      } catch (err) {
        console.error('Error fetching discount code:', err);
        // Don't fail the request, just log the error
      }
    }

    // --- 3. Add both savings together ---
    const totalSavings = compareAtSavings + discountCodeSavings;
    
    return res.status(200).json({ variants: results, totalSavings: totalSavings });

  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ error: err.message });
  }
}
