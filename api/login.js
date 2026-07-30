module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body = req.body;
  if (!body || typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch (e) {
      body = {};
    }
  }

  const { password } = body || {};
  const expected = process.env.DASHBOARD_PASSWORD;
  const secret = process.env.SESSION_SECRET;

  if (!expected || !secret) {
    res.status(500).json({ error: 'Servidor não configurado corretamente.' });
    return;
  }

  if (password !== expected) {
    res.status(401).json({ error: 'Senha incorreta.' });
    return;
  }

  const maxAge = 60 * 60 * 24 * 30; // 30 dias
  res.setHeader(
    'Set-Cookie',
    `dashboard_auth=${secret}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
  res.status(200).json({ ok: true });
};
