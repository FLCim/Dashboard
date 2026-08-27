// drilldown.js
// Read-only drill-down (campanha -> conjunto de anúncios -> anúncio) para a aba
// "Métricas Meta Ads". Não altera dados no Meta Ads Manager, apenas exibe.
// Também injeta a seleção de vínculo Projeto/Meta <-> campanha do Meta Ads,
// sincronizada com a aba "Leads & Planejamento" (Roadmap).
(function () {
  'use strict';

  function fmtCurrencyLocal(value, currency) {
    if (typeof window.fmtCurrency === 'function') return window.fmtCurrency(value, currency);
    try {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(value || 0);
    } catch (e) {
      return (value || 0).toFixed(2);
    }
  }
  function fmtNumberLocal(value) {
    if (typeof window.fmtNumber === 'function') return window.fmtNumber(value);
    return new Intl.NumberFormat('pt-BR').format(Math.round(value || 0));
  }
  function fmtPercentLocal(value) {
    if (typeof window.fmtPercent === 'function') return window.fmtPercent(value);
    return (value || 0).toFixed(2).replace('.', ',') + '%';
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const STATUS_LABELS = {
    ACTIVE: { label: 'Ativa', cls: 'dd-status-active' },
    PAUSED: { label: 'Pausada', cls: 'dd-status-paused' },
    CAMPAIGN_PAUSED: { label: 'Pausada', cls: 'dd-status-paused' },
    ADSET_PAUSED: { label: 'Pausada', cls: 'dd-status-paused' },
    ARCHIVED: { label: 'Arquivada', cls: 'dd-status-off' },
    DELETED: { label: 'Removida', cls: 'dd-status-off' },
    DISAPPROVED: { label: 'Reprovada', cls: 'dd-status-issue' },
    PENDING_REVIEW: { label: 'Em análise', cls: 'dd-status-issue' },
    PREAPPROVED: { label: 'Em análise', cls: 'dd-status-issue' },
    PENDING_BILLING_INFO: { label: 'Em análise', cls: 'dd-status-issue' },
    WITH_ISSUES: { label: 'Em análise', cls: 'dd-status-issue' },
    IN_PROCESS: { label: 'Em análise', cls: 'dd-status-issue' },
  };
  function statusInfoLocal(status) {
    return STATUS_LABELS[status] || (status ? { label: status, cls: 'dd-status-off' } : { label: 'Status indisponível', cls: 'dd-status-off' });
  }

  function injectStyles() {
    const css = '\n'
      + '.dd-caret { display:inline-block; width:14px; text-align:center; color:var(--muted,#6b7280); cursor:pointer; user-select:none; margin-right:4px; transition: transform .15s ease; }\n'
      + '.dd-caret.dd-open { transform: rotate(90deg); }\n'
      + 'tr[data-campaign-id] { cursor: pointer; }\n'
      + '.dd-trend-btn { border:none; background:transparent; cursor:pointer; font-size:13px; margin-left:6px; opacity:.75; }\n'
      + '.dd-trend-btn:hover { opacity:1; }\n'
      + '.dd-panel-row > td { background: rgba(0,0,0,0.02); padding: 10px 14px 16px 30px !important; }\n'
      + '.dd-table { width:100%; border-collapse:collapse; font-size:12.5px; }\n'
      + '.dd-table th { text-align:left; font-weight:600; color:var(--muted,#6b7280); padding:6px 8px; border-bottom:1px solid var(--border,#e3e6ea); white-space:nowrap; }\n'
      + '.dd-table td { padding:6px 8px; border-bottom:1px solid var(--border,#e3e6ea); vertical-align:middle; }\n'
      + '.dd-table tr[data-adset-id], .dd-table tr[data-ad-id] { cursor:pointer; }\n'
      + '.dd-name-cell { display:flex; align-items:center; gap:2px; }\n'
      + '.dd-status-dot { display:inline-block; width:7px; height:7px; border-radius:50%; margin-right:6px; flex:none; }\n'
      + '.dd-status-active { background:#35c97a; }\n'
      + '.dd-status-paused { background:#f5a623; }\n'
      + '.dd-status-off { background:#6b7280; }\n'
      + '.dd-status-issue { background:#ff6b6b; }\n'
      + '.dd-loading, .dd-error, .dd-empty { padding:10px 4px; color:var(--muted,#6b7280); font-size:12.5px; }\n'
      + '.dd-error { color:#ff6b6b; }\n'
      + '.dd-ad-thumb { width:28px; height:28px; object-fit:cover; border-radius:4px; margin-right:6px; flex:none; }\n'
      + '.dd-ad-thumb-empty { width:28px; height:28px; border-radius:4px; background:var(--border,#e3e6ea); margin-right:6px; flex:none; }\n'
      + '.dd-trend-wrap { padding: 8px 4px 14px; }\n'
      + '.dd-trend-wrap canvas { max-height:180px; }\n'
      + '.dd-link-wrap { margin-top:6px; }\n'
      + '.dd-link-select { width:100%; max-width:260px; background:var(--card,#fff); color:var(--text,#1c2230); border:1px solid var(--border,#e3e6ea); border-radius:6px; padding:4px 6px; font-size:11.5px; font-family:inherit; }\n';
    const style = document.createElement('style');
    style.setAttribute('data-dd-styles', '1');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function currentPeriod() {
    const el = document.getElementById('period-select');
    return el ? el.value : 'last_30d';
  }
  function currentCurrency() {
    return window.__dashCurrency || 'BRL';
  }

  async function fetchJson(url) {
    const resp = await fetch(url);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || ('Erro ' + resp.status));
    return data;
  }

  function metricCells(row) {
    const currency = currentCurrency();
    return ''
      + '<td>' + fmtCurrencyLocal(row.spend, currency) + '</td>'
      + '<td>' + fmtNumberLocal(row.impressions) + '</td>'
      + '<td>' + fmtNumberLocal(row.reach) + '</td>'
      + '<td>' + fmtNumberLocal(row.clicks) + '</td>'
      + '<td>' + fmtPercentLocal(row.ctr) + '</td>'
      + '<td>' + fmtCurrencyLocal(row.cpc, currency) + '</td>'
      + '<td>' + fmtNumberLocal((row.leads || 0) + (row.purchases || 0)) + '</td>';
  }

  function tableHeadHtml() {
    return '<thead><tr>'
      + '<th>Nome</th><th>Investimento</th><th>Impressões</th><th>Alcance</th>'
      + '<th>Cliques</th><th>CTR</th><th>CPC</th><th>Leads</th>'
      + '</tr></thead>';
  }

  function trendButtonHtml(level, id) {
    return '<button type="button" class="dd-trend-btn" data-level="' + level + '" data-id="' + escapeHtml(id) + '" title="Ver tendência diária">📈</button>';
  }

  function adsetRowHtml(adset) {
    const status = statusInfoLocal(adset.effectiveStatus);
    return '<tr data-adset-id="' + escapeHtml(adset.adsetId) + '">'
      + '<td><div class="dd-name-cell"><span class="dd-caret">▶</span>'
      + '<span class="dd-status-dot ' + status.cls + '" title="' + status.label + '"></span>'
      + '<span>' + escapeHtml(adset.name) + '</span>'
      + trendButtonHtml('adset', adset.adsetId)
      + '</div></td>'
      + metricCells(adset)
      + '</tr>';
  }

  function adRowHtml(ad) {
    const status = statusInfoLocal(ad.effectiveStatus);
    const thumb = ad.thumbnailUrl
      ? '<img class="dd-ad-thumb" src="' + escapeHtml(ad.thumbnailUrl) + '" alt="" />'
      : '<span class="dd-ad-thumb-empty"></span>';
    return '<tr data-ad-id="' + escapeHtml(ad.adId) + '">'
      + '<td><div class="dd-name-cell">' + thumb
      + '<span class="dd-status-dot ' + status.cls + '" title="' + status.label + '"></span>'
      + '<span>' + escapeHtml(ad.name) + '</span>'
      + trendButtonHtml('ad', ad.adId)
      + '</div></td>'
      + metricCells(ad)
      + '</tr>';
  }

  function buildPanelRow(colspan, innerHtml) {
    const tr = document.createElement('tr');
    tr.className = 'dd-panel-row';
    const td = document.createElement('td');
    td.colSpan = colspan;
    td.innerHTML = innerHtml;
    tr.appendChild(td);
    return tr;
  }

  function setCaret(row, open) {
    const caret = row.querySelector('.dd-caret');
    if (!caret) return;
    caret.textContent = open ? '▼' : '▶';
    caret.classList.toggle('dd-open', open);
  }

  async function toggleChildren(row, panelSelector, colspan, loadFn) {
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains(panelSelector)) {
      existing.remove();
      setCaret(row, false);
      return;
    }
    setCaret(row, true);
    const panel = buildPanelRow(colspan, '<div class="dd-loading">Carregando…</div>');
    panel.classList.add(panelSelector);
    row.parentNode.insertBefore(panel, row.nextSibling);
    try {
      const html = await loadFn();
      panel.querySelector('td').innerHTML = html;
    } catch (err) {
      panel.querySelector('td').innerHTML = '<div class="dd-error">' + escapeHtml(err.message) + '</div>';
    }
  }

  async function loadAdsetsHtml(campaignId) {
    const data = await fetchJson('/api/drilldown?resource=adsets&campaignId=' + encodeURIComponent(campaignId) + '&period=' + encodeURIComponent(currentPeriod()));
    const adsets = data.adsets || [];
    if (!adsets.length) return '<div class="dd-empty">Nenhum conjunto de anúncios com dados nesse período.</div>';
    return '<table class="dd-table">' + tableHeadHtml() + '<tbody>' + adsets.map(adsetRowHtml).join('') + '</tbody></table>';
  }

  async function loadAdsHtml(adsetId) {
    const data = await fetchJson('/api/drilldown?resource=ads&adsetId=' + encodeURIComponent(adsetId) + '&period=' + encodeURIComponent(currentPeriod()));
    const ads = data.ads || [];
    if (!ads.length) return '<div class="dd-empty">Nenhum anúncio com dados nesse período.</div>';
    return '<table class="dd-table">' + tableHeadHtml() + '<tbody>' + ads.map(adRowHtml).join('') + '</tbody></table>';
  }

  async function toggleTrend(btn) {
    const level = btn.getAttribute('data-level');
    const id = btn.getAttribute('data-id');
    const row = btn.closest('tr');
    const existing = row.nextElementSibling;
    if (existing && existing.classList.contains('dd-trend-row') && existing.getAttribute('data-trend-for') === id) {
      existing.remove();
      return;
    }
    if (existing && existing.classList.contains('dd-trend-row')) existing.remove();
    const colspan = row.closest('table').classList.contains('dd-table') ? 8 : 9;
    const panel = buildPanelRow(colspan, '<div class="dd-loading">Carregando tendência…</div>');
    panel.classList.add('dd-trend-row');
    panel.setAttribute('data-trend-for', id);
    row.parentNode.insertBefore(panel, row.nextSibling);
    try {
      const data = await fetchJson('/api/drilldown?resource=trend&level=' + encodeURIComponent(level) + '&id=' + encodeURIComponent(id) + '&period=' + encodeURIComponent(currentPeriod()));
      const points = data.points || [];
      if (!points.length) {
        panel.querySelector('td').innerHTML = '<div class="dd-empty">Sem dados diários nesse período.</div>';
        return;
      }
      const canvasId = 'dd-trend-canvas-' + Math.random().toString(36).slice(2);
      panel.querySelector('td').innerHTML = '<div class="dd-trend-wrap"><canvas id="' + canvasId + '"></canvas></div>';
      const ctx = document.getElementById(canvasId).getContext('2d');
      const labels = points.map((p) => p.date);
      new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Investimento',
              data: points.map((p) => p.spend),
              borderColor: '#4f8cff',
              backgroundColor: 'transparent',
              yAxisID: 'y',
              tension: 0.25,
            },
            {
              label: 'Leads',
              data: points.map((p) => (p.leads || 0) + (p.purchases || 0)),
              borderColor: '#35c97a',
              backgroundColor: 'transparent',
              yAxisID: 'y1',
              tension: 0.25,
            },
          ],
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          scales: {
            y: { position: 'left', ticks: { color: '#6b7280' }, grid: { color: '#e3e6ea' } },
            y1: { position: 'right', ticks: { color: '#6b7280' }, grid: { display: false } },
            x: { ticks: { color: '#6b7280' }, grid: { color: '#e3e6ea' } },
          },
          plugins: { legend: { labels: { color: '#1c2230' } } },
        },
      });
    } catch (err) {
      panel.querySelector('td').innerHTML = '<div class="dd-error">' + escapeHtml(err.message) + '</div>';
    }
  }

  // ---- Vínculo Projeto/Meta (Roadmap) <-> campanha do Meta Ads ----

  function getLinkOptions() {
    const blocks = document.querySelectorAll('.campaign-block');
    const opts = [];
    blocks.forEach((block) => {
      const monthId = block.getAttribute('data-month');
      const key = block.getAttribute('data-key');
      if (!monthId || !key) return;
      const nameInput = block.querySelector('.campaign-name-input');
      const monthCard = block.closest('.month-card');
      const monthNameEl = monthCard ? monthCard.querySelector('.m-name') : null;
      const monthLabel = monthNameEl ? monthNameEl.textContent.trim() : monthId;
      const campLabel = nameInput ? nameInput.value : key;
      opts.push({ monthId: monthId, key: key, label: monthLabel + ' — ' + campLabel });
    });
    return opts;
  }

  function findRoadmapSelectFor(campaignId) {
    if (!campaignId) return null;
    const sels = document.querySelectorAll('.meta-link-select');
    for (let i = 0; i < sels.length; i++) {
      if (sels[i].value === campaignId) return sels[i];
    }
    return null;
  }

  function refreshLinkSelectOptions(select, campaignId) {
    const opts = getLinkOptions();
    const current = findRoadmapSelectFor(campaignId);
    const currentVal = current ? (current.getAttribute('data-link-month') + '::' + current.getAttribute('data-link-key')) : '';
    const prevSelection = select.value;
    select.innerHTML = '<option value="">Vincular a Projeto/Meta…</option>' +
      opts.map((o) => {
        const val = o.monthId + '::' + o.key;
        return '<option value="' + escapeHtml(val) + '"' + (val === currentVal ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
      }).join('');
    if (!currentVal && prevSelection) select.value = prevSelection;
  }

  function applyLink(campaignId, monthId, key) {
    // Impede que a mesma campanha do Meta Ads fique vinculada a mais de um slot do Roadmap.
    document.querySelectorAll('.meta-link-select').forEach((sel) => {
      if (sel.value === campaignId) {
        sel.value = '';
        sel.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    if (monthId && key) {
      const target = document.querySelector('.meta-link-select[data-link-month="' + monthId + '"][data-link-key="' + key + '"]');
      if (target) {
        target.value = campaignId;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    document.dispatchEvent(new CustomEvent('roadmap:updated'));
  }

  function decorateCampaignRows() {
    const body = document.getElementById('campaigns-body');
    if (!body) return;
    body.querySelectorAll('tr[data-campaign-id]').forEach((row) => {
      if (row.querySelector('.dd-caret')) return; // already decorated
      const nameRow = row.querySelector('.campaign-name-row');
      if (!nameRow) return;
      const caret = document.createElement('span');
      caret.className = 'dd-caret';
      caret.textContent = '▶';
      nameRow.insertBefore(caret, nameRow.firstChild);
      const trendBtn = document.createElement('button');
      trendBtn.type = 'button';
      trendBtn.className = 'dd-trend-btn';
      trendBtn.title = 'Ver tendência diária';
      trendBtn.setAttribute('data-level', 'campaign');
      trendBtn.setAttribute('data-id', row.getAttribute('data-campaign-id'));
      trendBtn.textContent = '📈';
      nameRow.appendChild(trendBtn);

      const nameTd = nameRow.closest('td');
      if (nameTd && !nameTd.querySelector('.dd-link-select')) {
        const campaignId = row.getAttribute('data-campaign-id');
        const linkWrap = document.createElement('div');
        linkWrap.className = 'dd-link-wrap';
        const select = document.createElement('select');
        select.className = 'dd-link-select';
        select.setAttribute('data-campaign-id', campaignId);
        select.addEventListener('click', (e) => e.stopPropagation());
        refreshLinkSelectOptions(select, campaignId);
        linkWrap.appendChild(select);
        nameTd.appendChild(linkWrap);
      }
    });
  }

  function init() {
    injectStyles();
    const body = document.getElementById('campaigns-body');
    if (!body) return;

    const observer = new MutationObserver(decorateCampaignRows);
    observer.observe(body, { childList: true });
    decorateCampaignRows();

    body.addEventListener('click', function (e) {
      const trendBtn = e.target.closest('.dd-trend-btn');
      if (trendBtn) {
        e.stopPropagation();
        toggleTrend(trendBtn);
        return;
      }
      const adRow = e.target.closest('tr[data-ad-id]');
      if (adRow) {
        return; // ad is a leaf node; nothing further to expand
      }
      const adsetRow = e.target.closest('tr[data-adset-id]');
      if (adsetRow) {
        toggleChildren(adsetRow, 'dd-ads-panel', 8, function () {
          return loadAdsHtml(adsetRow.getAttribute('data-adset-id'));
        });
        return;
      }
      const campaignRow = e.target.closest('tr[data-campaign-id]');
      if (campaignRow) {
        toggleChildren(campaignRow, 'dd-adsets-panel', 9, function () {
          return loadAdsetsHtml(campaignRow.getAttribute('data-campaign-id'));
        });
      }
    });

    body.addEventListener('change', function (e) {
      const linkSelect = e.target.closest('.dd-link-select');
      if (!linkSelect) return;
      const campaignId = linkSelect.getAttribute('data-campaign-id');
      const parts = linkSelect.value ? linkSelect.value.split('::') : [];
      applyLink(campaignId, parts[0] || '', parts[1] || '');
    });

    document.addEventListener('roadmap:updated', function () {
      document.querySelectorAll('.dd-link-select').forEach((sel) => {
        refreshLinkSelectOptions(sel, sel.getAttribute('data-campaign-id'));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
