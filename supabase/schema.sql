-- 跑跑镇 3.0 - 自定义碰撞配对表
-- 在 Supabase SQL Editor 中执行: https://supabase.com/dashboard/project/fevrpteyclbqrixoidie/sql/new

CREATE TABLE IF NOT EXISTS custom_pairs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_a_name TEXT NOT NULL,
  item_a_image TEXT NOT NULL,
  item_b_name TEXT NOT NULL,
  item_b_image TEXT NOT NULL,
  result_name TEXT NOT NULL,
  result_image TEXT NOT NULL,
  voice_intro TEXT,
  created_at TIMESTAMP DEFAULT now()
);
ALTER TABLE custom_pairs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY allow_public_select ON custom_pairs FOR SELECT USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY allow_public_insert ON custom_pairs FOR INSERT WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE custom_pairs;
