/**
 * Data Transform Layer
 * Combines Meta Ads + SamCart data into unified dashboard metrics.
 *
 * UTM stitching: SamCart orders carry utm_source / utm_campaign
 * from query params at checkout. We match these to Meta campaign
 * names (or IDs) to attribute SamCart revenue back to Meta spend.
 */

/**
 * Combine Meta campaign data with SamCart orders via UTM attribution.
 *
 * @param {Array} metaCampaigns  - from fetchMetaCampaignInsights()
 * @param {Array} samcartOrders  - from fetchSamCartOrders()
 * @returns {Array} Enriched campaign rows with attributed SC revenue
 */
export function attributeSamCartToMeta(metaCampaigns, samcartOrders) {
  // Build lookup: campaign_name -> samcart revenue
  const scRevenueByCampaign = {};
  const scConvByCampaign = {};

  for (const order of samcartOrders) {
    if (order.status !== 'paid') continue;
    const key = (order.utmCampaign ?? '').toLowerCase();
    if (!key) continue;
    scRevenueByCampaign[key] = (scRevenueByCampaign[key] ?? 0) + order.amount;
    scConvByCampaign[key] = (scConvByCampaign[key] ?? 0) + 1;
  }

  return metaCampaigns.map(camp => {
    const key = camp.name.toLowerCase();
    const scRevenue = scRevenueByCampaign[key] ?? 0;
    const scConversions = scConvByCampaign[key] ?? 0;

    // Prefer direct SC revenue if UTM attribution is available,
    // else fall back to Meta pixel reported action_values.
    const attributedRevenue = scRevenue > 0 ? scRevenue : camp.revenue;

    return {
      ...camp,
      samcartRevenue: scRevenue,
      samcartConversions: scConversions,
      attributedRevenue,
      attributedROAS: camp.spend > 0 ? attributedRevenue / camp.spend : 0,
      attributedCPA: scConversions > 0 ? camp.spend / scConversions : camp.cpa,
    };
  });
}

/**
 * Build top-level KPI summary across both platforms.
 *
 * @param {Array}  metaCampaigns - enriched campaigns from attributeSamCartToMeta()
 * @param {Object} samcartKPIs   - from calcSamCartKPIs()
 * @param {Array}  prevMeta      - previous period campaigns (optional, for delta %)
 * @param {Object} prevSC        - previous period KPIs (optional)
 */
export function buildKPISummary(metaCampaigns, samcartKPIs, prevMeta = null, prevSC = null) {
  const totalSpend = sum(metaCampaigns, 'spend');
  const totalImpressions = sum(metaCampaigns, 'impressions');
  const totalClicks = sum(metaCampaigns, 'clicks');
  const totalMetaConversions = sum(metaCampaigns, 'conversions');
  const blendedRevenue = samcartKPIs.netRevenue;
  const blendedROAS = totalSpend > 0 ? blendedRevenue / totalSpend : 0;
  const cpa = totalMetaConversions > 0 ? totalSpend / totalMetaConversions : 0;
  const ctr = totalImpressions > 0 ? totalClicks / totalImpressions * 100 : 0;

  const kpis = {
    // Spend
    totalSpend,
    totalSpendDelta: pctDelta(totalSpend, prevMeta ? sum(prevMeta, 'spend') : null),

    // Revenue (SamCart net)
    totalRevenue: blendedRevenue,
    totalRevenueDelta: pctDelta(blendedRevenue, prevSC?.netRevenue),

    // ROAS
    blendedROAS,
    blendedROASDelta: pctDelta(blendedROAS, prevMeta && prevSC
      ? prevSC.netRevenue / sum(prevMeta, 'spend') : null),

    // CPA
    cpa,
    cpaDelta: pctDelta(cpa, prevMeta
      ? sum(prevMeta, 'spend') / sum(prevMeta, 'conversions') : null),

    // Reach
    totalImpressions,
    totalClicks,
    ctr,

    // SamCart
    gmv: samcartKPIs.gmv,
    netRevenue: samcartKPIs.netRevenue,
    refunds: samcartKPIs.refunds,
    aov: samcartKPIs.aov,
    orderCount: samcartKPIs.orderCount,
    mrr: samcartKPIs.mrr,
  };

  return kpis;
}

/**
 * Build funnel data combining Meta reach → click → conv → SC purchase.
 */
export function buildFunnel(metaCampaigns, samcartKPIs) {
  const impressions = sum(metaCampaigns, 'impressions');
  const clicks = sum(metaCampaigns, 'clicks');
  const metaConversions = sum(metaCampaigns, 'conversions');
  const scOrders = samcartKPIs.orderCount;

  return [
    { stage: 'Impressions', value: impressions, pct: 100 },
    { stage: 'Clicks', value: clicks, pct: pct(clicks, impressions) },
    { stage: 'Meta Conversions', value: metaConversions, pct: pct(metaConversions, clicks) },
    { stage: 'SamCart Orders', value: scOrders, pct: pct(scOrders, metaConversions) },
  ];
}

// ── Utils ─────────────────────────────────────────────────────────────────

function sum(arr, key) {
  return arr.reduce((s, x) => s + (x[key] ?? 0), 0);
}

function pct(part, whole) {
  return whole > 0 ? +(part / whole * 100).toFixed(2) : 0;
}

function pctDelta(current, previous) {
  if (previous == null || previous === 0) return null;
  return +((current - previous) / previous * 100).toFixed(1);
}
