export default async function handler(req, res) {
  // CORS for Shopify Checkout Extensions
  const ALLOWED_ORIGIN = "https://extensions.shopifycdn.com";
  const corsHeaders = {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  // Apply CORS headers to the actual request
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    
    // --- FIX 1: Look for 'variantsWithQuantity' ---
    const variantsWithQuantity = body.variantsWithQuantity || [];
    
    if (!Array.isArray(variantsWithQuantity) || variantsWithQuantity.length === 0) {
      return res
        .status(400)
        .json({ error: "Missing variantsWithQuantity array" });
    }

    const shop = "my-isense.myshopify.com";
    const token = process.env.SHOPIFY_TOKEN || "9c25f25569a11406d209f88a540fbc4e";

    const parsePrice = (v) => {
      if (v == null) return 0;
      if (typeof v === "number") return v;
      const cleaned = String(v).replace(/[^0-9.-]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : 0;
    };

    // 1️⃣ Fetch all variants concurrently
    // --- FIX 2: Use 'variant_id' and 'quantity' from the correct input ---
    const fetches = variantsWithQuantity.map(({ variant_id, quantity }) =>
      fetch(`https://${shop}/admin/api/2025-07/variants/${variant_id}.json`, {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
      })
        .then(async (r) => {
          const txt = await r.text();
          if (!r.ok) return { id: variant_id, error: txt };
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
            "USD";

          const compareN = parsePrice(compareRaw);
          const priceN = parsePrice(priceRaw);

          // multiply by quantity
          const totalComparePrice = compareN * quantity;
          const totalPrice = priceN * quantity;
          const totalSavings = Math.max(0, totalComparePrice - totalPrice);

          return {
            id: variant.id ?? variant_id,
            price: priceN,
            compare_at_price: compareN,
            currency,
            savings: totalSavings, // This is the savings for this line item
            rawVariant: variant,
          };
        })
        .catch((err) => ({ id: variant_id, error: String(err) }))
    );

    const results = await Promise.all(fetches);

    // 2️⃣ Compute total savings from compare_at_price
    const totalSavings = results.reduce((acc, r) => {
      if (r && typeof r.savings === "number") return acc + r.savings;
      return acc;
    }, 0);

    // 5️⃣ Final response
    return res.status(200).json({
      variants: results,
      totalSavings, // This is ONLY the compare-at-price savings
    });
  } catch (err) {
    console.error("Server error", err);
    return res.status(500).json({ error: err.message });
  }
}
