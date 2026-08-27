const { isAuthorized } = require('./_auth');
const { put, get } = require('@vercel/blob');

// Nome fixo do arquivo salvo no Vercel Blob (store privado). Sempre sobrescrito
// (allowOverwrite), então existe sempre no máximo uma versão "atual" dos dados
// da aba de leads/planejamento.
const BLOB_PATHNAME = 'roadmap-data.json';

async function readSavedData() {
  const result = await get(BLOB_PATHNAME, { access: 'private' });
  if (!result) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

module.exports = async (req, res) => {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: 'Não autorizado.' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).json({ error: 'Armazenamento não configurado (BLOB_READ_WRITE_TOKEN ausente).' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const data = await readSavedData();
      res.status(200).json({ data });
    } catch (err) {
      res.status(502).json({ error: `Falha ao carregar dados salvos: ${err.message}` });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') body = JSON.parse(body || '{}');
      if (!body || typeof body !== 'object' || !Array.isArray(body.months)) {
        res.status(400).json({ error: 'Corpo inválido: esperado um objeto com "months".' });
        return;
      }
      await put(BLOB_PATHNAME, JSON.stringify(body), {
        access: 'private',
        contentType: 'application/json',
        allowOverwrite: true,
      });
      res.status(200).json({ ok: true, updatedAt: new Date().toISOString() });
    } catch (err) {
      res.status(502).json({ error: `Falha ao salvar dados: ${err.message}` });
    }
    return;
  }

  res.status(405).json({ error: 'Método não suportado.' });
};
