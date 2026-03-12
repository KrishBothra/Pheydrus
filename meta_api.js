/**
 * Meta (Facebook) Ads API Integration
 * API Version: v20.0
 *
 * Docs: https://developers.facebook.com/docs/marketing-api/insights
 *
 * Required env vars:
 *   META_ACCESS_TOKEN   - Long-lived User or System User access token
 *   META_AD_ACCOUNT_ID  - e.g. act_123456789
 */

const META_API_VERSION = 'v20.0';
const META_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Fetch campaign-level insights for a given date range.
 *
 * @param {Object} options
 * @param {string} options.accessToken   - Meta access token
 * @param {string} options.adAccountId  - e.g. "act_123456789"
 * @param {string} options.datePreset   - e.g. "last_30d", "last_7d", "this_month"
 * @returns {Promise<Array>} Array of campaign insight objects
 */
export async function fetchMetaCampaignInsights({
  accessToken,
  adAccountId,
  datePreset = 'last_30d',
}) {
  const fields = [
    'campaign_name',
    'campaign_id',
    'status',
    'spend',
    'impressions',
    'clicks',
    'cpc',
    'cpm',
    'ctr',
    'actions',          // includes purchase events
    'action_values',    // revenue attributed by Meta pixel
    'cost_per_action_type',
  ].join(',');

  const params = new URLSearchParams({
    fields,
    date_preset: datePreset,
    level: 'campaign',
    access_token: accessToken,
  });

  const url = `${META_BASE_URL}/${adAccountId}/insights?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Meta API error: ${err.error?.message ?? res.statusText}`);
  }

  const { data } = await res.json();
  return transformMetaInsights(data);
}

/**
 * Fetch daily breakdown for sparkline / trend charts.
 */
export async function fetchMetaDailyBreakdown({
  accessToken,
  adAccountId,
  since,   // 'YYYY-MM-DD'
  until,   // 'YYYY-MM-DD'
}) {
  const fields = 'spend,impressions,clicks,actions,action_values';
  const params = new URLSearchParams({
    fields,
    time_range: JSON.stringify({ since, until }),
    time_increment: 1,
    level: 'account',
    access_token: accessToken,
  });

  const url = `${META_BASE_URL}/${adAccountId}/insights?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Meta daily breakdown failed: ${res.statusText}`);

  const { data } = await res.json();
  return data.map(d => ({
    date: d.date_start,
    spend: parseFloat(d.spend),
    impressions: parseInt(d.impressions),
    clicks: parseInt(d.clicks),
    revenue: extractActionValue(d.action_values, 'purchase'),
    conversions: extractActionCount(d.actions, 'purchase'),
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────

function transformMetaInsights(raw) {
  return raw.map(row => ({
    id: row.campaign_id,
    name: row.campaign_name,
    status: row.status ?? 'UNKNOWN',
    spend: parseFloat(row.spend ?? 0),
    impressions: parseInt(row.impressions ?? 0),
    clicks: parseInt(row.clicks ?? 0),
    ctr: parseFloat(row.ctr ?? 0),
    cpc: parseFloat(row.cpc ?? 0),
    cpm: parseFloat(row.cpm ?? 0),
    conversions: extractActionCount(row.actions, 'purchase'),
    revenue: extractActionValue(row.action_values, 'purchase'),
    // Derived metrics
    get roas() { return this.spend > 0 ? this.revenue / this.spend : 0; },
    get cpa() { return this.conversions > 0 ? this.spend / this.conversions : 0; },
  }));
}

function extractActionCount(actions = [], type = 'purchase') {
  const match = actions?.find(a => a.action_type === type || a.action_type === `offsite_conversion.fb_pixel_${type}`);
  return match ? parseInt(match.value) : 0;
}

function extractActionValue(actionValues = [], type = 'purchase') {
  const match = actionValues?.find(a => a.action_type === type || a.action_type === `offsite_conversion.fb_pixel_${type}`);
  return match ? parseFloat(match.value) : 0;
}
