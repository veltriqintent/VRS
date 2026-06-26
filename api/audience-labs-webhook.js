const crypto = require('crypto');

function firstValue(row, keys, fallback = '') {
  for (const key of keys) {
    const value = row && row[key];
    if (Array.isArray(value) && value.filter(Boolean).length) return value.filter(Boolean).join(', ');
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return fallback;
}

function verifySignature(req, rawBody) {
  const secret = process.env.AUDIENCE_LABS_WEBHOOK_SECRET;
  if (!secret) return true;
  const supplied = String(
    req.headers['x-audience-labs-signature']
    || req.headers['x-webhook-signature']
    || req.headers['x-signature']
    || ''
  ).replace(/^sha256=/i, '');
  if (!supplied) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeEvent(payload) {
  const person = payload.person || payload.contact || payload.profile || payload.identity || {};
  const event = payload.event || payload.data || payload;
  const merged = { ...payload, ...event, ...person };
  const firstName = firstValue(merged, ['first_name', 'firstName', 'FIRST_NAME', 'PERSONAL_FIRST_NAME']);
  const lastName = firstValue(merged, ['last_name', 'lastName', 'LAST_NAME', 'PERSONAL_LAST_NAME']);
  const fullName = firstValue(merged, ['full_name', 'fullName', 'name', 'FULL_NAME'])
    || [firstName, lastName].filter(Boolean).join(' ');
  const visitedAtValue = firstValue(merged, ['visited_at', 'event_time', 'timestamp', 'occurred_at', 'created_at'], new Date().toISOString());
  const parsedVisitedAt = new Date(visitedAtValue);
  const visitedAt = Number.isNaN(parsedVisitedAt.getTime()) ? new Date().toISOString() : parsedVisitedAt.toISOString();

  return {
    external_id: String(firstValue(merged, ['event_id', 'visitor_id', 'profile_id', 'id'], '') || '') || null,
    metro: String(firstValue(merged, ['metro', 'market'], process.env.DEFAULT_VRS_METRO || 'unknown')),
    first_name: String(firstName || ''),
    last_name: String(lastName || ''),
    full_name: String(fullName || ''),
    phone: String(firstValue(merged, ['phone', 'phone_number', 'mobile_phone', 'PHONE']) || ''),
    email: String(firstValue(merged, ['email', 'email_address', 'EMAIL']) || ''),
    address: String(firstValue(merged, ['address', 'street_address', 'PERSONAL_ADDRESS']) || ''),
    city: String(firstValue(merged, ['city', 'PERSONAL_CITY']) || ''),
    state: String(firstValue(merged, ['state', 'region', 'PERSONAL_STATE']) || ''),
    zip: String(firstValue(merged, ['zip', 'postal_code', 'PERSONAL_ZIP']) || ''),
    country: String(firstValue(merged, ['country', 'country_code'], 'US') || ''),
    source: String(firstValue(merged, ['source', 'utm_source', 'referrer'], 'VRS Data') || ''),
    page_url: String(firstValue(merged, ['page_url', 'url', 'landing_page']) || ''),
    page_title: String(firstValue(merged, ['page_title', 'title']) || ''),
    ip_address: String(firstValue(merged, ['ip_address', 'ip']) || ''),
    user_agent: String(firstValue(merged, ['user_agent'], '') || ''),
    device: String(firstValue(merged, ['device', 'device_type'], '') || ''),
    browser: String(firstValue(merged, ['browser', 'browser_name'], '') || ''),
    visit_count: Number(firstValue(merged, ['visit_count', 'visits', 'session_count'], 1)) || 1,
    visited_at: visitedAt,
    raw_payload: payload
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'VELTRIQ VRS Audience Labs webhook' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Supabase environment variables are not configured' });
  }

  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  if (!verifySignature(req, rawBody)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  try {
    const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const events = Array.isArray(parsed) ? parsed : Array.isArray(parsed.events) ? parsed.events : [parsed];
    const visitors = events.map(normalizeEvent);
    const response = await fetch(`${supabaseUrl}/rest/v1/vrs_visitors?on_conflict=external_id`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(visitors)
    });
    const body = await response.text();
    if (!response.ok) throw new Error(body || `Supabase returned ${response.status}`);
    return res.status(200).json({ ok: true, received: visitors.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
