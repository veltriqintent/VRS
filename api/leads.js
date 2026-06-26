module.exports = async function(req, res) {
    // 1. Get the requested metro from the URL
    const { metro } = req.query; 

    // 2. Grab the hidden keys from Vercel's Environment Variables
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    try {
        // 3. Make the secure request to Supabase from the server
        const response = await fetch(`${supabaseUrl}/rest/v1/${metro}?select=*&limit=100`, {
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Supabase Error: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // 4. Send the clean data back to your HTML page
        res.status(200).json(data);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
