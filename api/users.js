module.exports = async function(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: 'Supabase environment variables are not configured' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    res.status(401).json({ error: 'Missing authorization token' });
    return;
  }

  try {
    const currentUserResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`
      }
    });

    if (!currentUserResponse.ok) {
      res.status(401).json({ error: 'Invalid authorization token' });
      return;
    }

    const currentUser = await currentUserResponse.json();
    const adminEmails = (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(email => email.trim().toLowerCase())
      .filter(Boolean);

    if (adminEmails.length > 0 && !adminEmails.includes(String(currentUser.email || '').toLowerCase())) {
      res.status(403).json({ error: 'You do not have permission to view users' });
      return;
    }

    const allUsers = [];
    let page = 1;
    const perPage = 1000;

    while (true) {
      const response = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`
        }
      });

      if (!response.ok) {
        const details = await response.text();
        let message = details || `Supabase admin request failed with ${response.status}`;
        try {
          const parsed = JSON.parse(details);
          message = parsed.msg || parsed.message || parsed.error || message;
        } catch (parseError) {
        }
        const lowerMessage = message.toLowerCase();
        if (response.status === 403 && (lowerMessage.includes('not_admin') || lowerMessage.includes('user not allowed'))) {
          message = 'Supabase rejected the API key as non-admin. Set SUPABASE_SERVICE_ROLE_KEY in Vercel to your Supabase service-role key, then redeploy.';
        }
        throw new Error(message);
      }

      const body = await response.json();
      const users = Array.isArray(body.users) ? body.users : [];
      allUsers.push(...users);

      if (users.length < perPage) break;
      page += 1;
    }

    res.status(200).json({
      users: allUsers.map(user => {
        const metadata = user.user_metadata || {};
        const appMetadata = user.app_metadata || {};

        return {
          id: user.id,
          email: user.email,
          phone: user.phone,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          confirmed_at: user.confirmed_at,
          banned_until: user.banned_until,
          full_name: metadata.full_name || metadata.name || '',
          company: metadata.company || '',
          metro_access: Array.isArray(metadata.metro_access) ? metadata.metro_access : [],
          data_type: metadata.data_type || '',
          access_expires_on: metadata.access_expires_on || '',
          role: appMetadata.role || metadata.role || ''
        };
      })
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
