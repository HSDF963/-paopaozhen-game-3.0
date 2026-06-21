// Supabase Edge Function: 上传碰撞组合（存储 + 入库）
// 抠图已在浏览器端 Canvas 完成，此函数仅处理上传
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const formData = await req.formData();
    const fileA = formData.get("itemAImage") as File;
    const fileB = formData.get("itemBImage") as File;
    const fileR = formData.get("resultImage") as File;
    const nameA = (formData.get("itemAName") as string || "").trim();
    const nameB = (formData.get("itemBName") as string || "").trim();
    const nameR = (formData.get("resultName") as string || "").trim();

    if (!fileA || !fileB || !fileR) {
      return new Response(JSON.stringify({ error: "请上传三张图片" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!nameA || !nameB || !nameR) {
      return new Response(JSON.stringify({ error: "请填写名称" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    async function uploadFile(file: File, prefix: string): Promise<string> {
      const buf = new Uint8Array(await file.arrayBuffer());
      const ts = Date.now();
      const path = `custom/${prefix}-${ts}.png`;
      const { error } = await supabase.storage.from("artworks").upload(path, buf, {
        contentType: "image/png", upsert: true,
      });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from("artworks").getPublicUrl(path);
      return data.publicUrl;
    }

    const [urlA, urlB, urlR] = await Promise.all([
      uploadFile(fileA, "a"), uploadFile(fileB, "b"), uploadFile(fileR, "r"),
    ]);

    const voice = `${nameA}和${nameB}碰在一起，变成了${nameR}！`;
    const { data, error: dbErr } = await supabase.from("custom_pairs").insert({
      item_a_name: nameA, item_a_image: urlA,
      item_b_name: nameB, item_b_image: urlB,
      result_name: nameR, result_image: urlR,
      voice_intro: voice,
    }).select().single();

    if (dbErr) {
      return new Response(JSON.stringify({ error: dbErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, pair: data }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
