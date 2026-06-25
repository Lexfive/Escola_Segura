// ============================================================
//  Edge Function: order  — cria cliente + pedido e gera cobrança AbacatePay
//  Deploy:  supabase functions deploy order
//  Secrets: supabase secrets set ABACATEPAY_TOKEN=... SITE_URL=https://seudominio.com.br
//  Chamada: POST /functions/v1/order
//    { product_slug:"fisico"|"combo", shipping:{carrier,price,days},
//      customer:{name,email,phone,cpf}, address:{cep,street,number,complement,district,city,state} }
//  Retorno: { order_id, number, total, payment_url }
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, json } from "../_shared/cors.ts";

const SB_URL     = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ABACATE    = Deno.env.get("ABACATEPAY_TOKEN")!;
const SITE_URL   = Deno.env.get("SITE_URL") ?? "https://seudominio.com.br";
const ABACATE_BASE = "https://api.abacatepay.com/v1";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { product_slug, shipping, customer, address } = await req.json();
    if (!product_slug || !customer?.email || !customer?.name) return json({ error: "Dados incompletos" }, 400);

    const db = createClient(SB_URL, SB_SERVICE, { db: { schema: "escola_segura" } });

    // preço vem do banco (nunca confie no cliente)
    const { data: product, error: pErr } = await db.from("products")
      .select("id,name,price_cents,requires_shipping").eq("slug", product_slug).single();
    if (pErr || !product) return json({ error: "Produto inválido" }, 400);

    const shippingCents = product.requires_shipping ? Math.round((shipping?.price ?? 0) * 100) : 0;
    const total = product.price_cents + shippingCents;

    // upsert do cliente (chave: email)
    const { data: cust, error: cErr } = await db.from("customers")
      .upsert({ name: customer.name, email: customer.email, phone: customer.phone, cpf: customer.cpf || null },
              { onConflict: "email" })
      .select("id").single();
    if (cErr) return json({ error: "Falha ao salvar cliente", detail: cErr.message }, 500);

    // cria pedido (status pending)
    const { data: order, error: oErr } = await db.from("orders").insert({
      customer_id: cust.id, product_id: product.id,
      product_cents: product.price_cents, shipping_cents: shippingCents, total_cents: total,
      shipping_carrier: shipping?.carrier ?? null, shipping_days: shipping?.days ?? null,
      status: "pending", address,
    }).select("id,number").single();
    if (oErr) return json({ error: "Falha ao criar pedido", detail: oErr.message }, 500);

    // cria cobrança no AbacatePay
    const pay = await fetch(`${ABACATE_BASE}/billing/create`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ABACATE}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        frequency: "ONE_TIME",
        methods: ["PIX"],
        products: [{ externalId: product.id, name: product.name, quantity: 1, price: total }],
        returnUrl: `${SITE_URL}/#acompanhar`,
        completionUrl: `${SITE_URL}/obrigado?pedido=${order.number}`,
        customer: { name: customer.name, email: customer.email,
          cellphone: customer.phone, taxId: customer.cpf },
        metadata: { order_id: order.id, order_number: order.number },
      }),
    });
    const payData = await pay.json();
    const url = payData?.data?.url ?? payData?.url;

    if (url) {
      await db.from("orders").update({ payment_ref: payData?.data?.id ?? payData?.id }).eq("id", order.id);
    }
    return json({ order_id: order.id, number: order.number, total: total / 100, payment_url: url });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
