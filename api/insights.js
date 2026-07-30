function isAuthorized(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const idx = c.indexOf('=');
      if (idx === -1) return [c.trim(), ''];
      return [c.slice(0, idx).trim(), c.slice(idx + 1).trim()];
    })
  );
  const secret = process.env.SESSION_SECRET;
  return Boolean(secret) && cookies.dashboard_auth === secret;
}

const GRAPH_VERSION = 'v21.0';

const VALID_PERIODS = new Set([
  'today',
  'yesterday',
  'last_7d',
  'last_14d',
  'last_30d',
  'last_90d',
  'this_month',
  'last_month',
]);

async function fetchGraph(path, params) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  const resp = await fetch(url.toString());
  const json = await resp.json();
  if (!resp.ok || json.error) {
    const message = json.error ? json.error.message : `Erro HTTP ${resp.status}`;
    throw new Error(message);
  }
  return json;
}

function extractActionValue(actions, type) {
  if (!Array.isArray(actions)) return 0;
  const found = actions.find((a) => a.action_type === type);
  return found ? Number(found.value) : 0;
}

// Escolhe o melhor anúncio de uma campanha: maior alcance e, em empate, mais cliques.
function pickBestAd(ads) {
  return ads.slice().sort((a, b) => {
    if (b.reach !== a.reach) return b.reach - a.reach;
    return b.clicks - a.clicks;
  })[0];
}

module.exports = async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.AD_ACCOUNT_ID; // formato: act_XXXXXXXXXXX

  if (!token || !adAccountId) {
    res.status(500).json({ error: 'Servidor não configurado corretamente (token ou conta ausente).' });
    return;
  }

  const period = VALID_PERIODS.has(req.query.period) ? req.query.period : 'last_30d';

  const accountFields = [
    'spend',
    'impressions',
    'reach',
    'clicks',
    'ctr',
    'cpc',
    'cpm',
    'actions',
    'cost_per_action_type',
  ].join(',');

  const campaignFields = [
    'campaign_id',
    'campaign_name',
    'spend',
    'impressions',
    'reach',
    'clicks',
    'ctr',
    'cpc',
    'cpm',
    'actions',
  ].join(',');

  const adFields = [
    'ad_id',
    'ad_name',
    'campaign_id',
    'reach',
    'clicks',
    'spend',
    'impressions',
  ].join(',');

  try {
    const [accountInfo, accountInsights, campaignInsights, adInsights] = await Promise.all([
      fetchGraph(adAccountId, {
        access_token: token,
        fields: 'name,currency,account_status',
      }),
      fetchGraph(`${adAccountId}/insights`, {
        access_token: token,
        fields: accountFields,
        date_preset: period,
        level: 'account',
      }),
      fetchGraph(`${adAccountId}/insights`, {
        access_token: token,
        fields: campaignFields,
        date_preset: period,
        level: 'campaign',
        limit: 100,
      }),
      fetchGraph(`${adAccountId}/insights`, {
        access_token: token,
        fields: adFields,
        date_preset: period,
        level: 'ad',
        limit: 500,
      }).catch(() => ({ data: [] })), // se falhar, seguimos sem criativos
    ]);

    const summaryRow = (accountInsights.data && accountInsights.data[0]) || {};
    const summary = {
      spend: Number(summaryRow.spend || 0),
      impressions: Number(summaryRow.impressions || 0),
      reach: Number(summaryRow.reach || 0),
      clicks: Number(summaryRow.clicks || 0),
      ctr: Number(summaryRow.ctr || 0),
      cpc: Number(summaryRow.cpc || 0),
      cpm: Number(summaryRow.cpm || 0),
      leads: extractActionValue(summaryRow.actions, 'lead'),
      purchases: extractActionValue(summaryRow.actions, 'purchase') ||
        extractActionValue(summaryRow.actions, 'offsite_conversion.fb_pixel_purchase'),
      messagingConversations: extractActionValue(summaryRow.actions, 'onsite_conversion.messaging_conversation_started_7d'),
    };

    const campaigns = (campaignInsights.data || []).map((row) => ({
      campaignId: row.campaign_id,
      name: row.campaign_name,
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      reach: Number(row.reach || 0),
      clicks: Number(row.clicks || 0),
      ctr: Number(row.ctr || 0),
      cpc: Number(row.cpc || 0),
      cpm: Number(row.cpm || 0),
      leads: extractActionValue(row.actions, 'lead'),
      purchases: extractActionValue(row.actions, 'purchase') ||
        extractActionValue(row.actions, 'offsite_conversion.fb_pixel_purchase'),
    })).sort((a, b) => b.spend - a.spend);

    // Agrupa os anúncios por campanha e escolhe o de melhor alcance/cliques em cada uma.
    const adsByCampaign = {};
    (adInsights.data || []).forEach((row) => {
      const cId = row.campaign_id;
      if (!cId) return;
      if (!adsByCampaign[cId]) adsByCampaign[cId] = [];
      adsByCampaign[cId].push({
        adId: row.ad_id,
        adName: row.ad_name,
        reach: Number(row.reach || 0),
        clicks: Number(row.clicks || 0),
        spend: Number(row.spend || 0),
        impressions: Number(row.impressions || 0),
      });
    });

    const bestAdByCampaign = {};
    Object.keys(adsByCampaign).forEach((cId) => {
      const best = pickBestAd(adsByCampaign[cId]);
      if (best) bestAdByCampaign[cId] = best;
    });

    // Busca a miniatura do criativo de cada anúncio vencedor (em paralelo, sem derrubar a resposta se uma falhar).
    const creativeEntries = Object.entries(bestAdByCampaign);
    const creativeResults = await Promise.allSettled(
      creativeEntries.map(([, ad]) =>
        fetchGraph(`${ad.adId}`, {
          access_token: token,
          fields: 'creative{thumbnail_url,image_url}',
        })
      )
    );

    const thumbnailByCampaign = {};
    creativeEntries.forEach(([cId], idx) => {
      const result = creativeResults[idx];
      if (result.status === 'fulfilled') {
        const creative = result.value.creative || {};
        thumbnailByCampaign[cId] = creative.image_url || creative.thumbnail_url || null;
      } else {
        thumbnailByCampaign[cId] = null;
      }
    });

    campaigns.forEach((c) => {
      const best = bestAdByCampaign[c.campaignId];
      if (best) {
        c.topCreative = {
          adName: best.adName,
          reach: best.reach,
          clicks: best.clicks,
          thumbnailUrl: thumbnailByCampaign[c.campaignId] || null,
        };
      } else {
        c.topCreative = null;
      }
    });

    res.status(200).json({
      account: {
        name: accountInfo.name,
        currency: accountInfo.currency,
        status: accountInfo.account_status,
      },
      period,
      summary,
      campaigns,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(502).json({ error: `Falha ao consultar a API do Meta: ${err.message}` });
  }
};
