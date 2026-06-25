# Escola Segura — Arquitetura de Produção

## Estrutura
```
LandingPage/
├─ index.html                      # frontend (3D, GSAP, 5 produtos, frete, área do cliente)
├─ autor.jpg                       # (você adiciona) retrato do autor
├─ book.glb                        # (opcional) modelo 3D; sem ele, usa fallback procedural
├─ og-cover.jpg                    # (você adiciona) imagem de compartilhamento (SEO/OG)
└─ supabase/
   ├─ migrations/001_escola_segura_init.sql
   └─ functions/
      ├─ _shared/cors.ts
      ├─ frete/index.ts            # cotação real Melhor Envio + grava shipping_quotes
      ├─ order/index.ts            # cria customer + order (físico/kits)
      └─ track/index.ts           # área do cliente (CPF + email)
```

## 1. Supabase  (projeto "Livro" — ref upgawiqxgfvxfjlolqvk)
Aplique o SQL no SQL Editor
(https://supabase.com/dashboard/project/upgawiqxgfvxfjlolqvk/sql/new) ou via CLI:
```bash
supabase link --project-ref upgawiqxgfvxfjlolqvk
supabase db push                       # aplica 001_escola_segura_init.sql (schema escola_segura)
supabase functions deploy frete
supabase functions deploy order
supabase functions deploy track
supabase secrets set MELHOR_ENVIO_TOKEN=xxxxx CEP_ORIGEM=30110000
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY já existem no ambiente das functions
```
Tabelas criadas: `products, customers, orders, shipping_quotes, tracking` (com RLS).

## 2. Melhor Envio
- Token em https://melhorenvio.com.br (App → Tokens). Use sandbox para testar (`MELHOR_ENVIO_BASE`).
- Ajuste peso/dimensões do pacote em `functions/frete/index.ts` (`PACOTE`).
- Geração de etiqueta (pós-pagamento): cart → checkout → generate → print (ver comentários no SQL).

## 3. Frontend
No `<script>` de config do `index.html`:
- Links de checkout: `KIRVANO_PDF_URL`, `CHECKOUT_FISICO_URL`, `CHECKOUT_COMBO_URL`, `CHECKOUT_KIT2_URL`, `CHECKOUT_KIT3_URL`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`
- Vire `USE_BACKEND = true` quando as functions estiverem no ar (troca o mock pelo frete/track reais)

## 4. Modelo 3D
- Sem `book.glb`: livro procedural (capa que abre no clique) — já funciona.
- Com `book.glb`: salve na pasta; carrega automático, com giro, parallax, zoom no scroll, partículas e reflexos (PMREM).

## 5. Performance / Lighthouse > 95
- **Tailwind**: o CDN é só para dev. Para produção, compile com Tailwind CLI/PostCSS e sirva CSS minificado (o CDN derruba a nota).
- Three.js inicializa só quando o hero entra na viewport (IntersectionObserver).
- Imagens com `loading="lazy"` / `decoding="async"`. Sem jQuery.
- Animações via `transform`/`requestAnimationFrame` (60fps) e respeitam `prefers-reduced-motion`.

## 6. Deploy (Vercel)
Garanta que `autor.jpg`, `book.glb`, `og-cover.jpg` sejam versionados/incluídos no deploy.
⚠️ A pasta está no OneDrive — marque "Sempre manter neste dispositivo" para os arquivos não desidratarem.
```

## Fluxo do pedido físico
Landing → checkout próprio (CEP+endereço) → `order` (Supabase) → pagamento → status `paid`
→ você gera etiqueta no Melhor Envio → grava `tracking` → cliente acompanha em /#cliente
```
