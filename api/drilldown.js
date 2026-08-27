// api/drilldown.js
// Read-only Meta Ads drill-down: campaign -> ad set -> ad, plus daily trend.
// Reuses the same auth cookie / Graph API access pattern as api/insights.js.

const GRAPH_VERSION = 'v21.0';

const VALID_PERIODS = [
  'today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'last_90d',
  'this_month', 'last_month',
];

const VALID_LEVELS = ['campaign', 'adset', 'ad'];

function isAuthorized(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) cookies[key] = value;
  });
  return Boolean(cookies.dashboard_auth) && cookies.dashboard_auth === process.env.SESSION_SECRET;
}

async function fetchGraph(path, params) {
  const url = new URL('https://graph.facebook.com/' + GRAPH_VERSION + '/' + path);
  Object.keys(params || {}).forEach((key) => {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.set(key, params[key]);
    }
  });
  url.searchParams.set('access_token', process.env.META_ACCESS_TOKEN);
  const resp = await fetch(url.toString());
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || json.error) {
    const message = (json.error && json.error.message) || ('HTTP ' + resp.status);
    throw new Error(message);
  }
  return json;
}

function extractActionValue(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const row = actions.find((a) => a.action_type === type);
  return row ? Number(row.value) || 0 : 0;
}

function sumActionValues(actions, types) {
  return types.reduce((sum, type) => sum + extractActionValue(actions, type), 0);
}

const LEAD_TYPES = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];
const PURCHASE_TYPES = ['purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase'];

function baseMetrics(row) {
  const actions = row.actions || [];
  return {
    spend: Number(row.spend) || 0,
    impressions: Number(row.impressions) || 0,
    reach: Number(row.reach) || 0,
    clicks: Number(row.clicks) || 0,
    ctr: Number(row.ctr) || 0,
    cpc: Number(row.cpc) || 0,
    cpm: Number(row.cpm) || 0,
    leads: sumActionValues(actions, LEAD_TYPES),
    purchases: sumActionValues(actions, PURCHASE_TYPES),
  };
}

function statusMapFrom(list) {
  const map = {};
  (list || []).forEach((item) => {
    map[item.id] = item.effective_status || item.status || null;
  });
  return map;
}

async function handleAdsets(req, res, period) {
  const campaignId = req.query.campaignId;
  if (!campaignId) {
    res.status(400).json({ error: 'campaignId é obrigatório.' });
    return;
  }
  const [insightsResp, adsetsResp] = await Promise.all([
    fetchGraph(campaignId + '/insights', {
      level: 'adset',
      date_preset: period,
      limit: 200,
      fields: 'adset_id,adset_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions',
    }).catch(() => ({ data: [] })),
    fetchGraph(campaignId + '/adsets', {
      fields: 'id,name,effective_status,status',
      limit: 500,
    }).catch(() => ({ data: [] })),
  ]);
  const statusMap = statusMapFrom(adsetsResp.data);
  const adsets = (insightsResp.data || []).map((row) => ({
    adsetId: row.adset_id,
    name: row.adset_name,
    effectiveStatus: statusMap[row.adset_id] || null,
    ...baseMetrics(row),
  }));
  adsets.sort((a, b) => b.spend - a.spend);
  res.status(200).json({ adsets });
}

async function handleAds(req, res, period) {
  const adsetId = req.query.adsetId;
  if (!adsetId) {
    res.status(400).json({ error: 'adsetId é obrigatório.' });
    return;
  }
  const [insightsResp, adsResp] = await Promise.all([
    fetchGraph(adsetId + '/insights', {
      level: 'ad',
      date_preset: period,
      limit: 500,
      fields: 'ad_id,ad_name,spend,impressions,reach,clicks,ctr,cpc,cpm,actions',
    }).catch(() => ({ data: [] })),
    fetchGraph(adsetId + '/ads', {
      fields: 'id,name,effective_status,status,creative{thumbnail_url,image_url}',
      limit: 500,
    }).catch(() => ({ data: [] })),
  ]);
  const statusMap = statusMapFrom(adsResp.data);
  const creativeMap = {};
  (adsResp.data || []).forEach((ad) => {
    if (ad.creative) {
      creativeMap[ad.id] = ad.creative.thumbnail_url || ad.creative.image_url || null;
    }
  });
  const ads = (insightsResp.data || []).map((row) => ({
    adId: row.ad_id,
    name: row.ad_name,
    effectiveStatus: statusMap[row.ad_id] || null,
    thumbnailUrl: creativeMap[row.ad_id] || null,
    ...baseMetrics(row),
  }));
  ads.sort((a, b) => b.spend - a.spend);
  res.status(200).json({ ads });
}

async function handleTrend(req, res, period) {
  const id = req.query.id;
  const level = req.query.level;
  if (!id || VALID_LEVELS.indexOf(level) === -1) {
    res.status(400).json({ error: 'id e level (campaign|adset|ad) são obrigatórios.' });
    return;
  }
  const insightsResp = await fetchGraph(id + '/insights', {
    level,
    date_preset: period,
    time_increment: 1,
    limit: 500,
    fields: 'date_start,spend,impressions,reach,clicks,actions',
  }).catch(() => ({ data: [] }));
  const points = (insightsResp.data || [])
    .map((row) => ({
      date: row.date_start,
      ...baseMetrics(row),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  res.status(200).json({ points });
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }
  if (!process.env.META_ACCESS_TOKEN) {
    res.status(500).json({ error: 'Servidor não configurado corretamente.' });
    return;
  }

  const period = VALID_PERIODS.indexOf(req.query.period) !== -1 ? req.query.period : 'last_30d';
  const resource = req.query.resource;

  try {
    if (resource === 'adsets') {
      await handleAdsets(req, res, period);
    } else if (resource === 'ads') {
      await handleAds(req, res, period);
    } else if (resource === 'trend') {
      await handleTrend(req, res, period);
    } else {
      res.status(400).json({ error: 'resource inválido (use adsets, ads ou trend).' });
    }
  } catch (err) {
    res.status(502).json({ error: 'Falha ao consultar a API do Meta: ' + err.message });
  }
};
