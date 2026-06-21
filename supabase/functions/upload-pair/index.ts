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

    let debugLog = "";

    async function removeBg(file: File, label: string): Promise<Uint8Array> {
      const buf = new Uint8Array(await file.arrayBuffer());

      // 方法1: Hugging Face RMBG-1.4
      if (hfToken) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await fetch("https://router.huggingface.co/hf-inference/models/briaai/RMBG-1.4", {
              method: "POST",
              headers: { Authorization: "Bearer " + hfToken, "Content-Type": "image/png" },
              body: buf,
            });
            if (r.ok) {
              const arr = await r.arrayBuffer();
              if (arr.byteLength > 1000) {
                debugLog += label + ":HF✓ ";
                return new Uint8Array(arr);
              }
              debugLog += label + ":HF-small ";
            } else if (r.status === 503) {
              const j = await r.json().catch(() => ({}));
              debugLog += label + ":HF-loading ";
              await new Promise(ok => setTimeout(ok, Math.min((j.estimated_time || 10) * 1000, 12000)));
              continue;
            } else {
              debugLog += label + ":HF" + r.status + " ";
            }
          } catch (e) { debugLog += label + ":HF-err:" + (e.message || "").substring(0, 20) + " "; }
          break;
        }
      }

      // 方法2: remove.bg
      if (rbKey) {
        try {
          const rbForm = new FormData();
          rbForm.append("image_file", new Blob([buf]), file.name);
          rbForm.append("size", "auto");
          const r = await fetch("https://api.remove.bg/v1.0/removebg", {
            method: "POST", headers: { "X-Api-Key": rbKey }, body: rbForm,
          });
          if (r.ok) { debugLog += label + ":RB✓ "; return new Uint8Array(await r.arrayBuffer()); }
          debugLog += label + ":RB" + r.status + " ";
        } catch (e) { debugLog += label + ":RB-err "; }
      }

      debugLog += label + ":raw ";
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

    const [bufA, bufB, bufR] = await Promise.all([removeBg(fileA, "A"), removeBg(fileB, "B"), removeBg(fileR, "R")]);
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

    return new Response(JSON.stringify({ success: true, pair: data, debug: debugLog }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
