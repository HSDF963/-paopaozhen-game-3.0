// 跑跑镇 3.0 - 游戏服务器
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// 读取 .env
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)/);
  if (m) env[m[1]] = m[2].trim();
});

const PORT = env.PORT || 3003;
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const REMOVE_BG_KEY = env.REMOVE_BG_API_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// 文件上传配置
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

/* ===== 抠图函数 ===== */
async function removeBackground(buffer, fileName) {
  if (!REMOVE_BG_KEY) { console.log('remove.bg 未配置，使用原图'); return buffer; }
  try {
    const form = new FormData();
    form.append('image_file', new Blob([buffer]), fileName);
    form.append('size', 'auto');
    const rbRes = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST', headers: { 'X-Api-Key': REMOVE_BG_KEY }, body: form,
    });
    if (rbRes.ok) { console.log('remove.bg 成功:', fileName); return Buffer.from(await rbRes.arrayBuffer()); }
    const err = await rbRes.json().catch(() => ({}));
    console.warn('remove.bg 失败:', err);
    return buffer;
  } catch (e) { console.warn('remove.bg 异常:', e.message); return buffer; }
}

/* ===== 上传 API ===== */
app.post('/api/upload', upload.fields([
  { name: 'itemAImage', maxCount: 1 },
  { name: 'itemBImage', maxCount: 1 },
  { name: 'resultImage', maxCount: 1 },
]), async (req, res) => {
  try {
    const itemAFile = req.files?.itemAImage?.[0];
    const itemBFile = req.files?.itemBImage?.[0];
    const resultFile = req.files?.resultImage?.[0];
    const itemAName = (req.body.itemAName || '').trim();
    const itemBName = (req.body.itemBName || '').trim();
    const resultName = (req.body.resultName || '').trim();

    if (!itemAFile || !itemBFile || !resultFile) return res.status(400).json({ error: '请上传三张图片' });
    if (!itemAName || !itemBName || !resultName) return res.status(400).json({ error: '请填写名称' });

    // 并行处理三张图
    const [imgA, imgB, imgR] = await Promise.all([
      (async () => {
        const buf = await removeBackground(itemAFile.buffer, itemAFile.originalname);
        const ts = Date.now();
        const path = `custom/a-${ts}.png`;
        const { error } = await supabase.storage.from('artworks').upload(path, buf, { contentType: 'image/png', upsert: true });
        if (error) throw new Error(`上传失败: ${error.message}`);
        const { data } = supabase.storage.from('artworks').getPublicUrl(path);
        return data.publicUrl;
      })(),
      (async () => {
        const buf = await removeBackground(itemBFile.buffer, itemBFile.originalname);
        const ts = Date.now() + 1;
        const path = `custom/b-${ts}.png`;
        const { error } = await supabase.storage.from('artworks').upload(path, buf, { contentType: 'image/png', upsert: true });
        if (error) throw new Error(`上传失败: ${error.message}`);
        const { data } = supabase.storage.from('artworks').getPublicUrl(path);
        return data.publicUrl;
      })(),
      (async () => {
        const buf = await removeBackground(resultFile.buffer, resultFile.originalname);
        const ts = Date.now() + 2;
        const path = `custom/r-${ts}.png`;
        const { error } = await supabase.storage.from('artworks').upload(path, buf, { contentType: 'image/png', upsert: true });
        if (error) throw new Error(`上传失败: ${error.message}`);
        const { data } = supabase.storage.from('artworks').getPublicUrl(path);
        return data.publicUrl;
      })(),
    ]);

    const voiceIntro = `${itemAName}和${itemBName}碰在一起，变成了${resultName}！`;

    // 写入数据库
    const { data: insertData, error: dbErr } = await supabase
      .from('custom_pairs')
      .insert({
        item_a_name: itemAName, item_a_image: imgA,
        item_b_name: itemBName, item_b_image: imgB,
        result_name: resultName, result_image: imgR,
        voice_intro: voiceIntro,
      })
      .select()
      .single();

    if (dbErr) {
      console.error('DB insert error:', dbErr);
      return res.status(500).json({ error: `数据库写入失败: ${dbErr.message}` });
    }

    res.json({ success: true, pair: insertData, message: `🎉 ${voiceIntro}` });
  } catch (e) {
    console.error('Upload error:', e);
    res.status(500).json({ error: e.message || '服务器错误' });
  }
});

/* ===== 管理 API：列出所有配对 ===== */
app.get('/api/pairs', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('custom_pairs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===== 管理 API：删除单个配对 ===== */
app.delete('/api/pairs/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('custom_pairs')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===== 管理 API：修改配对名称 ===== */
app.put('/api/pairs/:id', express.json(), async (req, res) => {
  try {
    const updates = {};
    if (req.body.item_a_name) updates.item_a_name = req.body.item_a_name;
    if (req.body.item_b_name) updates.item_b_name = req.body.item_b_name;
    if (req.body.result_name) updates.result_name = req.body.result_name;
    updates.voice_intro = `${updates.item_a_name || ''}和${updates.item_b_name || ''}碰在一起，变成了${updates.result_name || ''}！`;
    const { error } = await supabase
      .from('custom_pairs')
      .update(updates)
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===== 管理 API：清除全部配对 ===== */
app.delete('/api/pairs', async (req, res) => {
  try {
    const { error } = await supabase
      .from('custom_pairs')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // delete all
    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ===== 启动（本地开发） / Vercel 导出 ===== */
if (process.env.VERCEL) {
  module.exports = app;
} else {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🏃 跑跑镇 3.0 游戏服务器已启动`);
    console.log(`   🎮 游戏: http://localhost:${PORT}`);
    console.log(`   📱 上传: http://localhost:${PORT}/upload.html`);
    console.log(`   📡 API:  http://localhost:${PORT}/api/upload`);
  });
}
