// ============================================================
//  Edge Function: webhook-abacatepay
//  AbacatePay (pago) -> marca pago -> e-mail "pagamento aprovado"
//   -> Melhor Envio (cart->checkout->generate->tracking) -> e-mail "etiqueta gerada"
//  Deploy: supabase functions deploy webhook-abacatepay --no-verify-jwt
//  Secrets: ABACATEPAY_WEBHOOK_SECRET, MELHOR_ENVIO_TOKEN, CEP_ORIGEM,
//           RESEND_API_KEY, EMAIL_FROM, SITE_URL,
//           ME_FROM_NAME, ME_FROM_DOC, ME_FROM_PHONE, ME_FROM_EMAIL,
//           ME_FROM_ADDRESS, ME_FROM_NUMBER, ME_FROM_COMPLEMENT,
//           ME_FROM_DISTRICT, ME_FROM_CITY, ME_FROM_STATE
//  URL do webhook: .../functions/v1/webhook-abacatepay?secret=SEU_SEGREDO
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, json } from "../_shared/cors.ts";

const SB_URL=Deno.env.get("SUPABASE_URL")!, SB_SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WH_SECRET=Deno.env.get("ABACATEPAY_WEBHOOK_SECRET")??"";
const ME_TOKEN=Deno.env.get("MELHOR_ENVIO_TOKEN")!, ME_BASE=Deno.env.get("MELHOR_ENVIO_BASE")??"https://www.melhorenvio.com.br/api/v2/me";
const RESEND_KEY=Deno.env.get("RESEND_API_KEY")??"", EMAIL_FROM=Deno.env.get("EMAIL_FROM")??"Escola Segura <pedidos@seudominio.com.br>", SITE_URL=Deno.env.get("SITE_URL")??"https://seudominio.com.br";
const db=createClient(SB_URL,SB_SERVICE,{db:{schema:"escola_segura"}});

const wrap=(i:string)=>`<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;color:#0a0e1a"><div style="background:#0a0e1a;color:#fff;padding:20px;border-radius:12px 12px 0 0"><b style="color:#1e90ff">ESCOLA SEGURA</b></div><div style="border:1px solid #eee;border-top:0;padding:24px;border-radius:0 0 12px 12px">${i}</div></div>`;
async function sendEmail(order:any, template:string){
  if(!RESEND_KEY) return;
  const T:Record<string,{s:string;h:string}>={
    payment_approved:{s:`Pagamento aprovado — Pedido #${order.number}`,h:wrap(`<h2>Pagamento aprovado ✅</h2><p>Olá, ${order.name}! Recebemos o pagamento do pedido <b>#${order.number}</b>. Já estamos preparando o envio.</p>`)},
    label_created:{s:`Pedido #${order.number} — etiqueta gerada`,h:wrap(`<h2>Pedido em preparo 📦</h2><p>Olá, ${order.name}! Etiqueta do pedido <b>#${order.number}</b> gerada.</p>${order.tracking_code?`<p>Transportadora: <b>${order.carrier??"-"}</b><br>Rastreio: <b>${order.tracking_code}</b></p>`:""}<p><a href="${SITE_URL}/#acompanhar">Acompanhar pedido</a></p>`)},
  };
  const t=T[template]; if(!t) return;
  let pid:string|undefined, st="sent", err:string|undefined;
  try{ const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:EMAIL_FROM,to:order.email,subject:t.s,html:t.h})}); const d=await r.json(); if(!r.ok){st="failed";err=JSON.stringify(d);}else pid=d.id; }catch(e){st="failed";err=String(e);}
  await db.from("email_logs").insert({order_id:order.id,to_email:order.email,template,subject:t.s,provider_id:pid,status:st,error:err});
}
function serviceId(carrier:string){ const c=(carrier||"").toLowerCase(); if(c.includes("sedex"))return 2; if(c.includes("pac"))return 1; if(c.includes("jadlog"))return 3; return parseInt(Deno.env.get("ME_DEFAULT_SERVICE")??"1"); }
async function meCall(path:string, body:unknown){ const r=await fetch(`${ME_BASE}${path}`,{method:"POST",headers:{Authorization:`Bearer ${ME_TOKEN}`,"Content-Type":"application/json",Accept:"application/json","User-Agent":"EscolaSegura ("+(Deno.env.get("ME_FROM_EMAIL")??"contato@seudominio.com.br")+")"},body:JSON.stringify(body)}); return r.json(); }
async function gerarEtiqueta(order:any){
  const env=(k:string)=>Deno.env.get(k)??""; const a=order.address||{};
  const cart=await meCall("/cart",{service:serviceId(order.carrier),
    from:{name:env("ME_FROM_NAME"),phone:env("ME_FROM_PHONE"),email:env("ME_FROM_EMAIL"),document:env("ME_FROM_DOC"),address:env("ME_FROM_ADDRESS"),number:env("ME_FROM_NUMBER"),complement:env("ME_FROM_COMPLEMENT"),district:env("ME_FROM_DISTRICT"),city:env("ME_FROM_CITY"),state_abbr:env("ME_FROM_STATE"),postal_code:env("CEP_ORIGEM"),country_id:"BR"},
    to:{name:order.name,phone:order.phone,email:order.email,document:order.cpf,address:a.street,number:a.number,complement:a.complement,district:a.district,city:a.city,state_abbr:a.state,postal_code:a.cep,country_id:"BR"},
    products:[{name:"Livro Escola Segura",quantity:1,unitary_value:(order.total_cents/100)}],
    volumes:[{height:2,width:16,length:23,weight:0.5}],
    options:{insurance_value:(order.total_cents/100),receipt:false,own_hand:false,non_commercial:true}});
  const id=cart.id; if(!id) throw new Error("cart falhou: "+JSON.stringify(cart));
  await meCall("/shipment/checkout",{orders:[id]});
  await meCall("/shipment/generate",{orders:[id]});
  const tr=await meCall("/shipment/tracking",{orders:[id]});
  return { meId:id, tracking: tr?.[id]?.tracking ?? null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url=new URL(req.url);
    if (WH_SECRET && url.searchParams.get("secret")!==WH_SECRET) return json({error:"unauthorized"},401);
    const evt=await req.json();
    const paid = evt?.event==="billing.paid" || evt?.data?.status==="PAID";
    const orderId=evt?.data?.metadata?.order_id;
    if(!paid||!orderId) return json({ok:true,ignored:true});
    const { data:row } = await db.from("orders").select("id,number,total_cents,address,shipping_carrier,status,customers(name,email,phone,cpf)").eq("id",orderId).single();
    if(!row) return json({error:"order não encontrado"},404);
    const order:any={ id:row.id, number:row.number, total_cents:row.total_cents, address:row.address, carrier:row.shipping_carrier, name:(row as any).customers?.name, email:(row as any).customers?.email, phone:(row as any).customers?.phone, cpf:(row as any).customers?.cpf };
    await db.from("orders").update({status:"paid"}).eq("id",orderId);
    await sendEmail(order,"payment_approved");
    try{
      const { meId, tracking } = await gerarEtiqueta(order);
      await db.from("orders").update({status:tracking?"labeled":"paid",tracking_code:tracking,melhor_envio_id:meId}).eq("id",orderId);
      if(tracking){ await db.from("tracking").insert({order_id:orderId,carrier:order.carrier,tracking_code:tracking,status:"labeled",last_update:new Date().toISOString()}); await sendEmail({...order,tracking_code:tracking},"label_created"); }
    }catch(e){ console.error("etiqueta:",String(e)); } // mantém 'paid' p/ retentar via admin
    return json({ok:true});
  } catch (e) { return json({ error: String(e) }, 500); }
});
