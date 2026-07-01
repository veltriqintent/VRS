const GHL_UPSERT_URL = 'https://services.leadconnectorhq.com/contacts/upsert';
const MAX_CONTACTS_PER_REQUEST = 100;
const CONCURRENCY = 5;

function clean(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function toGhlContact(row, locationId) {
  const firstName = clean(row.first_name || row.firstName, 100);
  const lastName = clean(row.last_name || row.lastName, 100);
  const name = clean(row.full_name || row.name || [firstName, lastName].filter(Boolean).join(' '), 200);
  const email = clean(row.email, 320);
  const phone = clean(row.phone, 50);
  if (!email && !phone) return null;

  return {
    locationId,
    firstName,
    lastName,
    name,
    email,
    phone,
    address1: clean(row.address, 500),
    city: clean(row.city, 100),
    state: clean(row.state, 100),
    postalCode: clean(row.zip || row.postalCode, 30),
    country: clean(row.country || 'US', 2).toUpperCase(),
    source: clean(row.source || 'VELTRIQ VRS', 100),
    tags: ['VRS Lead', 'Audience Labs']
  };
}

async function upsertContact(contact, token) {
  const response = await fetch(GHL_UPSERT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Version: '2021-07-28',
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(contact)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    throw new Error(detail || `GHL returned ${response.status}`);
  }
  return { id: body.contact?.id || '', created: Boolean(body.new) };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    return res.status(503).json({
      error: 'GHL sync is not configured. Add GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID in Vercel.'
    });
  }

  const rows = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  if (!rows.length) return res.status(400).json({ error: 'No contacts were supplied' });
  if (rows.length > MAX_CONTACTS_PER_REQUEST) {
    return res.status(413).json({ error: `Send no more than ${MAX_CONTACTS_PER_REQUEST} contacts per request` });
  }

  const contacts = rows.map(row => toGhlContact(row, locationId)).filter(Boolean);
  const skipped = rows.length - contacts.length;
  const results = [];

  for (let index = 0; index < contacts.length; index += CONCURRENCY) {
    const batch = contacts.slice(index, index + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(contact => upsertContact(contact, token)));
    settled.forEach((result, offset) => {
      const contact = batch[offset];
      results.push(result.status === 'fulfilled'
        ? { ok: true, ...result.value }
        : { ok: false, contact: contact.email || contact.phone, error: result.reason.message });
    });
  }

  const successful = results.filter(result => result.ok);
  const failed = results.filter(result => !result.ok);
  return res.status(failed.length ? 207 : 200).json({
    ok: failed.length === 0,
    synced: successful.length,
    created: successful.filter(result => result.created).length,
    updated: successful.filter(result => !result.created).length,
    skipped,
    failed: failed.length,
    errors: failed.slice(0, 10)
  });
};
