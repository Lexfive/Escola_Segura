// ============================================================
//  Edge Function: frete  — cotação REAL via Melhor Envio
//  Deploy:  supabase functions deploy frete
//  Secrets: supabase secrets set MELHOR_ENVIO_TOKEN=... CEP_ORIGEM=30110000
//  Chamada: POST /functions/v1/frete  { cep: "30110000", order_id?: uuid }
//  Retorno: [{ carrier, price, days }]  (PAC, SEDEX, Jadlog...) ordenado por preço
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, json } from "../_shared/cors.ts";

const TOKEN      = Deno.env.get("MELHOR_ENVIO_TOKEN")!;
const CEP_ORIGEM = Deno.env.get("CEP_ORIGEM") ?? "30110000";
const ME_BASE    = Deno.env.get("MELHOR_ENVIO_BASE") ?? "https://www.melhorenvio.com.br/api/v2/me";
const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Dimensões/peso do livro físico — AJUSTE para o produto real
const PACOTE = { weight: 0.5, width: 16, height: 2, length: 23, insurance_value: 59.9 };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { cep, order_id } = await req.json();
    const clean = String(cep ?? "").replace(/\D/g, "");
    if (clean.length !== 8) return json({ error: "CEP inválido" }, 400);

    const resp = await fetch(`${ME_BASE}/shipment/calculate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "EscolaSegura (contato@seudominio.com.br)",
      },
      body: JSON.stringify({ from: { postal_code: CEP_ORIGEM }, to: { postal_code: clean }, package: PACOTE }),
    });
    const data = await resp.json();

    const options = (Array.isArray(data) ? data : [])
      .filter((s: any) => !s.error && s.price)
      .map((s: any) => ({
        carrier: `${s.company?.name ?? ""} ${s.name}`.trim(),
        price: Number(s.price),
        days: Number(s.delivery_time),
      }))
      .sort((a, b) => a.price - b.price);

    // grava as cotações (auditoria / vínculo futuro com o pedido)
    try {
      const db = createClient(SB_URL, SB_SERVICE, { db: { schema: "escola_segura" } });
      await db.from("shipping_quotes").insert(
        options.map((o) => ({
          order_id: order_id ?? null, cep: clean,
          carrier: o.carrier, price_cents: Math.round(o.price * 100), days: o.days, raw: data,
        })),
      );
    } catch (_) { /* não bloqueia a cotação se o log falhar */ }

    return json(options);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
