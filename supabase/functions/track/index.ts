// ============================================================
//  Edge Function: track  — Acompanhar pedido (sem login)
//  Deploy:  supabase functions deploy track
//  Chamada: POST /functions/v1/track  { email, order_number }
//  Retorno: { order: { number, status, carrier, tracking_code, total, created_at } | null }
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, json } from "../_shared/cors.ts";

const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { email, order_number } = await req.json();
    const num = parseInt(String(order_number ?? "").replace(/\D/g, ""), 10);
    if (!email || !num) return json({ error: "Informe e-mail e número do pedido" }, 400);

    const db = createClient(SB_URL, SB_SERVICE, { db: { schema: "escola_segura" } });

    // confere o dono pelo e-mail (evita enumeração de pedidos)
    const { data: cust } = await db.from("customers").select("id").eq("email", email).maybeSingle();
    if (!cust) return json({ order: null });

    const { data: o } = await db.from("orders")
      .select("number,status,shipping_carrier,tracking_code,total_cents,created_at")
      .eq("number", num).eq("customer_id", cust.id).maybeSingle();
    if (!o) return json({ order: null });

    return json({ order: {
      number: o.number, status: o.status, carrier: o.shipping_carrier,
      tracking_code: o.tracking_code, total: o.total_cents / 100, created_at: o.created_at,
    }});
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
