// Vercel Serverless Function: DELETE/PUT /api/pairs/:id
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://fevrpteyclbqrixoidie.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing id' });

  if (req.method === 'DELETE') {
    const { error } = await supabase.from('custom_pairs').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  if (req.method === 'PUT') {
    const { item_a_name, item_b_name, result_name } = req.body || {};
    const updates = {};
    if (item_a_name) updates.item_a_name = item_a_name;
    if (item_b_name) updates.item_b_name = item_b_name;
    if (result_name) updates.result_name = result_name;
    updates.voice_intro = `${updates.item_a_name || ''}和${updates.item_b_name || ''}碰在一起，变成了${updates.result_name || ''}！`;
    const { error } = await supabase.from('custom_pairs').update(updates).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
