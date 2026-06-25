// ============================================================
//  Edge Function: admin-ops  — ações privilegiadas do painel /admin
//  Deploy:  supabase functions deploy admin-ops
//  Secrets: RESEND_API_KEY, EMAIL_FROM, SITE_URL, MELHOR_ENVIO_TOKEN,
//           CEP_ORIGEM, ME_FROM_* (remetente da etiqueta)
//  Auth: exige JWT de um usuário em escola_segura.admins.
//  Ações: resend_email | set_status | generate_label
// ============================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cors, json } from "../_shared/cors.ts";

const SB_URL=Deno.env.get("SUPABASE_URL")!, SB_SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SB_ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_KEY=Deno.env.get("RESEND_API_KEY")??"", EMAIL_FROM=Deno.env.get("EMAIL_FROM")??"Escola Segura <pedidos@seudominio.com.br>", SITE_URL=Deno.env.get("SITE_URL")??"https://seudominio.com.br";
const ME_TOKEN=Deno.env.get("MELHOR_ENVIO_TOKEN")??"", ME_BASE=Deno.env.get("MELHOR_ENVIO_BASE")??"https://www.melhorenvio.com.br/api/v2/me";
const admin=createClient(SB_URL,SB_SERVICE,{db:{schema:"escola_segura"}});

const wrap=(i:string)=>`<div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:auto;color:#0a0e1a"><div style="background:#0a0e1a;color:#fff;padding:20px;border-radius:12px 12px 0 0"><b style="color:#1e90ff">ESCOLA SEGURA</b></div><div style="border:1px solid #eee;border-top:0;padding:24px;border-radius:0 0 12px 12px">${i}</div></div>`;
const TPL:Record<string,(o:any)=>{subject:string;html:string}>={
  payment_approved:(o)=>({subject:`Pagamento aprovado — Pedido #${o.number}`,html:wrap(`<h2>Pagamento aprovado ✅</h2><p>Olá, ${o.name}! Recebemos o pagamento do pedido <b>#${o.number}</b>.</p>`)}),
  label_created:(o)=>({subject:`Pedido #${o.number} — etiqueta gerada`,html:wrap(`<h2>Pedido em preparo 📦</h2><p>Olá, ${o.name}! Etiqueta do pedido <b>#${o.number}</b> gerada.</p>${o.tracking_code?`<p>Transportadora: <b>${o.carrier??"-"}</b><br>Rastreio: <b>${o.tracking_code}</b></p>`:""}`)}),
  shipped:(o)=>({subject:`Pedido #${o.number} a caminho 🚚`,html:wrap(`<h2>Seu pedido saiu para entrega</h2><p>Olá, ${o.name}! O pedido <b>#${o.number}</b> está em transporte.</p>${o.tracking_code?`<p>Rastreio: <b>${o.tracking_code}</b></p>`:""}<p><a href="${SITE_URL}/#acompanhar">Acompanhar</a></p>`)}),
  delivered:(o)=>({subject:`Pedido #${o.number} entregue 🎉`,html:wrap(`<h2>Pedido entregue!</h2><p>Olá, ${o.name}! O pedido <b>#${o.number}</b> foi entregue. Boa leitura!</p>`)}),
};
const STATUS_TPL:Record<string,string>={paid:"payment_approved",labeled:"label_created",shipped:"shipped",delivered:"delivered"};

async function loadOrder(id:string){ const {data}=await admin.from("orders").select("id,number,total_cents,status,address,shipping_carrier,tracking_code,customers(name,email,phone,cpf)").eq("id",id).single(); if(!data)return null; return {id:data.id,number:data.number,total_cents:data.total_cents,status:data.status,address:data.address,carrier:data.shipping_carrier,tracking_code:data.tracking_code,name:(data as any).customers?.name,email:(data as any).customers?.email,phone:(data as any).customers?.phone,cpf:(data as any).customers?.cpf}; }
async function sendEmail(order:any,template:string){ const t=TPL[template]; if(!t)throw new Error("template inválido"); const {subject,html}=t(order); let pid:string|undefined,st="sent",err:string|undefined; try{const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${RESEND_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:EMAIL_FROM,to:order.email,subject,html})});const d=await r.json();if(!r.ok){st="failed";err=JSON.stringify(d);}else pid=d.id;}catch(e){st="failed";err=String(e);} await admin.from("email_logs").insert({order_id:order.id,to_email:order.email,template,subject,provider_id:pid,status:st,error:err}); if(st==="failed")throw new Error(err); return pid; }
function serviceId(c:string){c=(c||"").toLowerCase();if(c.includes("sedex"))return 2;if(c.includes("pac"))return 1;if(c.includes("jadlog"))return 3;return parseInt(Deno.env.get("ME_DEFAULT_SERVICE")??"1");}
async function meCall(p:string,b:unknown){const r=await fetch(`${ME_BASE}${p}`,{method:"POST",headers:{Authorization:`Bearer ${ME_TOKEN}`,"Content-Type":"application/json",Accept:"application/json","User-Agent":"EscolaSegura ("+(Deno.env.get("ME_FROM_EMAIL")??"contato@seudominio.com.br")+")"},body:JSON.stringify(b)});return r.json();}
async function gerarEtiqueta(order:any){const env=(k:string)=>Deno.env.get(k)??"";const a=order.address||{};const cart=await meCall("/cart",{service:serviceId(order.carrier),from:{name:env("ME_FROM_NAME"),phone:env("ME_FROM_PHONE"),email:env("ME_FROM_EMAIL"),document:env("ME_FROM_DOC"),address:env("ME_FROM_ADDRESS"),number:env("ME_FROM_NUMBER"),complement:env("ME_FROM_COMPLEMENT"),district:env("ME_FROM_DISTRICT"),city:env("ME_FROM_CITY"),state_abbr:env("ME_FROM_STATE"),postal_code:env("CEP_ORIGEM"),country_id:"BR"},to:{name:order.name,phone:order.phone,email:order.email,document:order.cpf,address:a.street,number:a.number,complement:a.complement,district:a.district,city:a.city,state_abbr:a.state,postal_code:a.cep,country_id:"BR"},products:[{name:"Livro Escola Segura",quantity:1,unitary_value:(order.total_cents/100)}],volumes:[{height:2,width:16,length:23,weight:0.5}],options:{insurance_value:(order.total_cents/100),receipt:false,own_hand:false,non_commercial:true}});const id=cart.id;if(!id)throw new Error("cart falhou: "+JSON.stringify(cart));await meCall("/shipment/checkout",{orders:[id]});await meCall("/shipment/generate",{orders:[id]});const tr=await meCall("/shipment/tracking",{orders:[id]});return {meId:id,tracking:tr?.[id]?.tracking??null};}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader=req.headers.get("Authorization")??"";
    const userClient=createClient(SB_URL,SB_ANON,{global:{headers:{Authorization:authHeader}}});
    const { data:{ user } }=await userClient.auth.getUser();
    if(!user) return json({error:"unauthorized"},401);
    const { data:isAdmin }=await admin.from("admins").select("user_id").eq("user_id",user.id).maybeSingle();
    if(!isAdmin) return json({error:"forbidden"},403);
    const { action, order_id, template, status }=await req.json();
    const order=await loadOrder(order_id);
    if(!order) return json({error:"pedido não encontrado"},404);
    if(action==="resend_email"){ const id=await sendEmail(order,template); return json({ok:true,provider_id:id}); }
    if(action==="set_status"){ await admin.from("orders").update({status}).eq("id",order_id); const tpl=STATUS_TPL[status]; if(tpl){try{await sendEmail({...order,status},tpl);}catch(_){}} return json({ok:true}); }
    if(action==="generate_label"){ try{ const {meId,tracking}=await gerarEtiqueta(order); await admin.from("orders").update({status:tracking?"labeled":order.status,tracking_code:tracking,melhor_envio_id:meId}).eq("id",order_id); if(tracking){await admin.from("tracking").insert({order_id,carrier:order.carrier,tracking_code:tracking,status:"labeled",last_update:new Date().toISOString()});try{await sendEmail({...order,tracking_code:tracking},"label_created");}catch(_){}} return json({ok:true,tracking_code:tracking,melhor_envio_id:meId}); }catch(e){ return json({error:"Falha ao gerar etiqueta: "+String(e)},500); } }
    return json({error:"ação inválida"},400);
  } catch (e) { return json({ error: String(e) }, 500); }
});
