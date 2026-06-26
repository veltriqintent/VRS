(function () {
  const EMPTY_VALUES = new Set(['', 'null', 'undefined', 'nan', 'n/a', 'none']);

  function firstValue(row, keys, fallback = '') {
    for (const key of keys) {
      const value = row && row[key];
      if (Array.isArray(value)) {
        const joined = value.filter(Boolean).join(', ');
        if (joined) return joined;
      } else if (value !== null && value !== undefined && !EMPTY_VALUES.has(String(value).trim().toLowerCase())) {
        return value;
      }
    }
    return fallback;
  }

  function normalizeDate(value) {
    if (!value) return new Date().toISOString();
    const text = String(value);
    const parsed = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  function normalizeVisitor(row, metro) {
    const firstName = firstValue(row, ['first_name', 'FIRST_NAME', 'PERSONAL_FIRST_NAME', 'OWNER_FIRST_NAME']);
    const lastName = firstValue(row, ['last_name', 'LAST_NAME', 'PERSONAL_LAST_NAME', 'OWNER_LAST_NAME']);
    const fullName = firstValue(row, ['full_name', 'FULL_NAME', 'PERSONAL_FULL_NAME', 'OWNER_NAME', 'NAME', 'name'])
      || [firstName, lastName].filter(Boolean).join(' ');
    const email = firstValue(row, ['email', 'EMAIL', 'PERSONAL_VERIFIED_EMAIL', 'PERSONAL_VERIFIED_EMAILS']);
    const phone = firstValue(row, ['phone', 'PHONE', 'SKIPTRACE_WIRELESS_NUMBERS', 'SKIPTRACE_LANDLINE_NUMBERS']);
    const visitedAt = normalizeDate(firstValue(row, [
      'visited_at', 'event_time', 'timestamp', 'time_stamp', 'created_at', 'ingested_at'
    ]));

    return {
      ...row,
      id: String(firstValue(row, ['id', 'event_id', 'visitor_id'], `${email || phone || fullName || 'visitor'}-${visitedAt}`)),
      metro: firstValue(row, ['metro', 'market'], metro),
      first_name: String(firstName || ''),
      last_name: String(lastName || ''),
      full_name: String(fullName || ''),
      email: String(email || ''),
      phone: String(phone || ''),
      address: String(firstValue(row, ['address', 'PERSONAL_ADDRESS', 'street_address']) || ''),
      city: String(firstValue(row, ['city', 'PERSONAL_CITY']) || ''),
      state: String(firstValue(row, ['state', 'PERSONAL_STATE']) || ''),
      zip: String(firstValue(row, ['zip', 'postal_code', 'PERSONAL_ZIP']) || ''),
      lat: Number(firstValue(row, ['lat', 'latitude', 'LAT', 'LATITUDE'], 0)) || 0,
      lon: Number(firstValue(row, ['lon', 'lng', 'longitude', 'LON', 'LNG', 'LONGITUDE'], 0)) || 0,
      country: String(firstValue(row, ['country', 'PERSONAL_COUNTRY'], 'US') || ''),
      source: String(firstValue(row, ['source', 'utm_source', 'referrer', 'referer'], 'VRS Data') || ''),
      page_url: String(firstValue(row, ['page_url', 'url', 'landing_page', 'website_url']) || ''),
      page_title: String(firstValue(row, ['page_title', 'title']) || ''),
      ip_address: String(firstValue(row, ['ip_address', 'ip']) || ''),
      device: String(firstValue(row, ['device', 'device_type']) || ''),
      browser: String(firstValue(row, ['browser', 'browser_name']) || ''),
      visit_count: Number(firstValue(row, ['visit_count', 'visits', 'session_count'], 1)) || 1,
      identified: Boolean(fullName || email || phone),
      has_phone: Boolean(phone),
      has_email: Boolean(email),
      visited_at: visitedAt,
      ingested_at: visitedAt
    };
  }

  async function loadVisitors(sb, metro) {
    if (Array.isArray(window.VRS_LOCAL_VISITORS)) {
      return window.VRS_LOCAL_VISITORS.map(row => normalizeVisitor(row, metro || 'all_visitors'));
    }

    if (!sb) return [];

    const visitorQuery = sb
      .from('vrs_visitors')
      .select('*')
      .order('visited_at', { ascending: false });

    const visitorResponse = metro === 'all_visitors'
      ? await visitorQuery
      : await visitorQuery.eq('metro', metro);

    if (!visitorResponse.error) {
      return (visitorResponse.data || []).map(row => normalizeVisitor(row, metro));
    }

    if (metro === 'all_visitors') return [];

    const repairTable = metro + '_repair';
    const replacementTable = metro + '_replacement';
    const [repairResponse, replacementResponse] = await Promise.all([
      sb.from(repairTable).select('*'),
      sb.from(replacementTable).select('*')
    ]);

    return [...(repairResponse.data || []), ...(replacementResponse.data || [])]
      .map(row => normalizeVisitor(row, metro))
      .sort((a, b) => new Date(b.visited_at) - new Date(a.visited_at));
  }
  function previewVisitors() {
    const now = Date.now();
    const zones = [
      { zip: '44333', state: 'OH', lat: 41.1398, lon: -81.6360, identified: 18, anonymous: 7 },
      { zip: '44720', state: 'OH', lat: 40.8951, lon: -81.4100, identified: 16, anonymous: 5 },
      { zip: '44313', state: 'OH', lat: 41.1284, lon: -81.5729, identified: 14, anonymous: 6 },
      { zip: '44221', state: 'OH', lat: 41.1339, lon: -81.4846, identified: 12, anonymous: 4 },
      { zip: '44708', state: 'OH', lat: 40.8121, lon: -81.4317, identified: 10, anonymous: 5 },
      { zip: '44224', state: 'OH', lat: 41.1766, lon: -81.4320, identified: 8, anonymous: 3 }
    ];
    const firstNames = ['Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Alex', 'Jamie', 'Avery'];
    const lastNames = ['Reed', 'Parker', 'Lane', 'Brooks', 'Hayes', 'Stone', 'Cole', 'Wells'];
    const pages = ['/pricing', '/quote-request', '/services', '/contact', '/visitor-recovery'];
    const rows = [];
    let index = 0;
    const pushRow = (zone, identified, hoursAgo, seed) => {
      const visitedAt = new Date(now - hoursAgo * 3600000).toISOString();
      const first = identified ? firstNames[seed % firstNames.length] : '';
      const last = identified ? lastNames[(seed + 3) % lastNames.length] : '';
      const email = identified && seed % 3 !== 0 ? first.toLowerCase() + '.' + last.toLowerCase() + '@example.com' : '';
      const phone = identified && seed % 4 !== 0 ? '(330) 555-' + String(1000 + seed).slice(-4) : '';
      rows.push({
        id: 'vrs-preview-' + index,
        metro: 'all_visitors',
        first_name: first,
        last_name: last,
        full_name: [first, last].filter(Boolean).join(' '),
        email,
        phone,
        address: identified ? String(1200 + seed) + ' Recovery Visit Rd' : '',
        city: '',
        state: zone.state,
        zip: zone.zip,
        country: 'US',
        source: 'VRS VRS Data',
        page_url: 'https://example.com' + pages[seed % pages.length],
        page_title: (pages[seed % pages.length].replace('/', '').replace('-', ' ') || 'homepage'),
        lat: zone.lat + (Math.random() - 0.5) * 0.018,
        lon: zone.lon + (Math.random() - 0.5) * 0.018,
        visit_count: 1 + (seed % 4),
        identified,
        has_phone: Boolean(phone),
        has_email: Boolean(email),
        visited_at: visitedAt,
        ingested_at: visitedAt,
        skiptrace_match_score: identified ? Math.min(99, 82 + (seed % 16)) : Math.min(91, 68 + (seed % 18))
      });
      index += 1;
    };
    zones.forEach((zone, zoneIndex) => {
      for (let i = 0; i < zone.identified; i += 1) pushRow(zone, true, 0.35 + ((index * 2.7 + zoneIndex) % 23), index + zoneIndex);
      for (let i = 0; i < zone.anonymous; i += 1) pushRow(zone, false, 0.75 + ((index * 3.1 + zoneIndex) % 23), index + zoneIndex);
    });
    for (let day = 1; day < 30; day += 1) {
      const dailyVolume = 4 + ((day * 7) % 9);
      for (let i = 0; i < dailyVolume; i += 1) pushRow(zones[(day + i) % zones.length], (i + day) % 4 !== 0, (day * 24) + 2 + ((i * 5) % 18), i + day);
    }
    return rows;
  }
  function csvCell(value) {
    if (value && typeof value === 'object') value = JSON.stringify(value);
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function downloadCsv(rows, filename) {
    if (!rows.length) return false;
    const preferred = [
      'visited_at', 'full_name', 'first_name', 'last_name', 'phone', 'email',
      'address', 'city', 'state', 'zip', 'country', 'metro', 'visit_count',
      'source', 'page_url', 'page_title', 'device', 'browser', 'ip_address'
    ];
    const allKeys = new Set();
    rows.forEach(row => Object.keys(row).forEach(key => {
      if (!['raw_payload', 'identified', 'has_phone', 'has_email', 'ingested_at'].includes(key)) allKeys.add(key);
    }));
    const headers = [
      ...preferred.filter(key => allKeys.has(key)),
      ...[...allKeys].filter(key => !preferred.includes(key)).sort()
    ];
    const csv = [
      headers.map(csvCell).join(','),
      ...rows.map(row => headers.map(key => csvCell(row[key])).join(','))
    ].join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
    return true;
  }

  window.VRS = { firstValue, normalizeVisitor, loadVisitors, previewVisitors, downloadCsv };
})();
