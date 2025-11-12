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
    const discounts = body.discounts; // optional array, e.g. [{ code: "SUMMER10" }]
    console.log("discounts: ", discounts);
    if (!Array.isArray(variant_ids) || variant_ids.length === 0) {
      return res.status(400).json({ error: 'Missing variant_ids array' });
    }

    const shop = 'my-isense.myshopify.com'; // replace with your shop
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

    // 1️⃣ Fetch all variants concurrently
    const fetches = variant_ids.map((id) =>
      fetch(`https://${shop}/admin/api/2025-07/variants/${id}.json`, {
        headers: {
          'X-Shopify-Access-Token': token,
          'Content-Type': 'application/json',
        },
      })
        .then(async (r) => {
          const txt = await r.text();
          if (!r.ok) return { id, error: txt };
          const payload = JSON.parse(txt);
          const variant = payload.variant ?? payload;

          const compareRaw =
            variant.compare_at_price ??
            variant.compareAtPrice ??
            variant.compareAtPriceV2?.amount ??
            null;
          const priceRaw = variant.price ?? variant.priceV2?.amount ?? null;
          const currency =
            variant.currency ??
            variant.currencyCode ??
            variant.priceV2?.currencyCode ??
            'USD';

          const compareN = parsePrice(compareRaw);
          const priceN = parsePrice(priceRaw);
          const savings = Math.max(0, compareN - priceN);

          return {
            id: variant.id ?? id,
            price: priceN,
            compare_at_price: compareN,
            currency,
            savings,
            rawVariant: variant,
          };
        })
        .catch((err) => ({ id, error: String(err) }))
    );

    const results = await Promise.all(fetches);

    // 2️⃣ Compute total savings from compare_at_price
    const totalSavings = results.reduce((acc, r) => {
      if (r && typeof r.savings === 'number') return acc + r.savings;
      return acc;
    }, 0);

    // 3️⃣ Handle discount code lookup
    let discountInfo = null;
    if (discounts && discounts.length > 0 && discounts[0].code) {
      console.log("here discounts: ", discounts[0].code);
      const discountCode = discounts[0].code.trim();
      console.log("here discountCode: ", discountCode);
      try {
        const lookupRes = await fetch(`https://${shop}/admin/api/2025-07/discount_codes/lookup.json?code=${discountCode}`, {
          headers: adminApiHeaders,
        });

        const lookupData = await lookupRes.json();
        const ruleId = lookupData?.discount_code?.price_rule_id;
        console.log("lookupData: ", lookupData);
        if (ruleId) {
          const ruleRes = await fetch(
            `https://${shop}/admin/api/2025-07/price_rules/${ruleId}.json`,
            {
              headers: {
                'X-Shopify-Access-Token': token,
                'Content-Type': 'application/json',
              },
            }
          );
          const ruleData = await ruleRes.json();
          const rule = ruleData.price_rule;

          // interpret discount rule
          discountInfo = {
            code: discountCode,
            value_type: rule.value_type, // 'percentage' or 'fixed_amount'
            value: parseFloat(rule.value), // usually negative
            target_type: rule.target_type,
          };
        }
      } catch (err) {
        console.error('Failed to fetch discount code info', err);
        discountInfo = { code: discounts[0].code, error: 'Lookup failed' };
      }
    }

    // 4️⃣ Apply discount rule if available
    let discountAmountTotal = 0;
    if (discountInfo && discountInfo.value && discountInfo.value_type) {
      const absValue = Math.abs(discountInfo.value);
      if (discountInfo.value_type === 'percentage') {
        // percentage off each variant
        discountAmountTotal = results.reduce((acc, r) => acc + r.price * (absValue / 100), 0);
      } else if (discountInfo.value_type === 'fixed_amount') {
        // fixed amount off per item
        discountAmountTotal = absValue * results.length;
      }
    }

    // 5️⃣ Final response
    return res.status(200).json({
      variants: results,
      totalSavings,
      discountInfo,
      discountAmountTotal
    });
  } catch (err) {
    console.error('Server error', err);
    return res.status(500).json({ error: err.message });
  }
}
