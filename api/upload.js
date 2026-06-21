// Vercel Serverless Function: POST /api/upload
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://fevrpteyclbqrixoidie.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function removeBg(buffer, fileName) {
  const key = process.env.REMOVE_BG_API_KEY;
  if (!key) return buffer;
  try {
    const form = new FormData();
    form.append('image_file', new Blob([buffer]), fileName);
    form.append('size', 'auto');
    const r = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST', headers: { 'X-Api-Key': key }, body: form,
    });
    return r.ok ? Buffer.from(await r.arrayBuffer()) : buffer;
  } catch (e) { return buffer; }
}

async function processAndUpload(file, prefix) {
  const buf = Buffer.from(file.buffer);
  const processed = await removeBg(buf, file.originalname);
  const ts = Date.now();
  const p = `custom/${prefix}-${ts}.png`;
  const { error } = await supabase.storage.from('artworks').upload(p, processed, { contentType: 'image/png', upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from('artworks').getPublicUrl(p);
  return data.publicUrl;
}

// Must disable bodyParser for multer
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  upload.fields([
    { name: 'itemAImage', maxCount: 1 },
    { name: 'itemBImage', maxCount: 1 },
    { name: 'resultImage', maxCount: 1 },
  ])(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const { itemAImage, itemBImage, resultImage } = req.files || {};
      const fA = itemAImage?.[0], fB = itemBImage?.[0], fR = resultImage?.[0];
      const nA = (req.body.itemAName || '').trim();
      const nB = (req.body.itemBName || '').trim();
      const nR = (req.body.resultName || '').trim();

      if (!fA || !fB || !fR) return res.status(400).json({ error: '请上传三张图片' });
      if (!nA || !nB || !nR) return res.status(400).json({ error: '请填写名称' });

      const [urlA, urlB, urlR] = await Promise.all([
        processAndUpload(fA, 'a'),
        processAndUpload(fB, 'b'),
        processAndUpload(fR, 'r'),
      ]);

      const voice = `${nA}和${nB}碰在一起，变成了${nR}！`;
      const { data, error: dbErr } = await supabase.from('custom_pairs').insert({
        item_a_name: nA, item_a_image: urlA,
        item_b_name: nB, item_b_image: urlB,
        result_name: nR, result_image: urlR,
        voice_intro: voice,
      }).select().single();

      if (dbErr) return res.status(500).json({ error: dbErr.message });

      res.json({ success: true, pair: data, message: `🎉 ${voice}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}
