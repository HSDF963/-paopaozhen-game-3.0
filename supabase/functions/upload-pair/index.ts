// Supabase Edge Function: 上传碰撞组合（抠图 + 存储 + 入库）
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    const hfToken = Deno.env.get("HF_TOKEN") || "";
    const rbKey = Deno.env.get("REMOVE_BG_API_KEY") || "";

    async function removeBg(file: File): Promise<Uint8Array> {
      const buf = new Uint8Array(await file.arrayBuffer());

      // 方法1: Hugging Face RMBG-1.4（免费，效果接近 remove.bg）
      if (hfToken) {
        try {
          const r = await fetch("https://api-inference.huggingface.co/models/briaai/RMBG-1.4", {
            method: "POST",
            headers: { Authorization: "Bearer " + hfToken },
            body: buf,
          });
          if (r.ok) {
            const arr = await r.arrayBuffer();
            if (arr.byteLength > 1000) return new Uint8Array(arr);
          }
          console.warn("HF failed, trying remove.bg...");
        } catch (e) { console.warn("HF error:", e); }
      }

      // 方法2: remove.bg（备用）
      if (rbKey) {
        try {
          const rbForm = new FormData();
          rbForm.append("image_file", new Blob([buf]), file.name);
          rbForm.append("size", "auto");
          const r = await fetch("https://api.remove.bg/v1.0/removebg", {
            method: "POST", headers: { "X-Api-Key": rbKey }, body: rbForm,
          });
          if (r.ok) return new Uint8Array(await r.arrayBuffer());
        } catch (e) { console.warn("remove.bg error:", e); }
      }

      // 方法3: 返回原图
      return buf;
    }

    async function uploadToStorage(data: Uint8Array, prefix: string): Promise<string> {
      const ts = Date.now();
      const path = `custom/${prefix}-${ts}.png`;
      const { error } = await supabase.storage.from("artworks").upload(path, data, { contentType: "image/png", upsert: true });
      if (error) throw new Error(error.message);
      const { data: urlData } = supabase.storage.from("artworks").getPublicUrl(path);
      return urlData.publicUrl;
    }

    const [bufA, bufB, bufR] = await Promise.all([removeBg(fileA), removeBg(fileB), removeBg(fileR)]);
    const [urlA, urlB, urlR] = await Promise.all([uploadToStorage(bufA, "a"), uploadToStorage(bufB, "b"), uploadToStorage(bufR, "r")]);

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

    return new Response(JSON.stringify({ success: true, pair: data }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
