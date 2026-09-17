# Gerador Piá · pacote para o programador

Página web onde a pessoa tira uma selfie ou escolhe uma foto da galeria e recebe a própria versão no traço do Piá (o menino 3D do Poupatempo Paraná), vestindo a camiseta preta com as logos PRODUÇÃO BOLD, PIX2 e tif.

O visual está pronto. O que falta é hospedar e colocar a chave do Gemini.

## O que tem na pasta

```
gerador-pia/
├── api/
│   └── index.js              entrypoint serverless (só usado na Vercel)
├── frontend/
│   ├── index.html            página completa (HTML + CSS + JS num arquivo só)
│   └── assets/               hero, character sheet e logos
├── backend/
│   ├── server.js             API em Node/Express que fala com o Gemini
│   ├── prompt_pia.txt        o prompt de estilo (pode ajustar sem mexer no código)
│   ├── character_sheet_pia.jpg  referência visual enviada junto em toda geração
│   ├── mock_resultado.jpg    resposta fixa do modo MOCK (testar o front sem gastar API)
│   ├── package.json
│   └── .env.example          variáveis de ambiente
├── referencias/              hero em 2752x1536, character sheet original, rosto oficial do Piá
├── package.json             start na raiz (`npm start` → backend/server.js)
├── vercel.json              config de deploy na Vercel
├── railway.json             config de deploy na Railway
└── README.md
```

## Como funciona

1. O front reduz a foto no navegador (máx. 1280 px, JPEG) e manda em base64 para `POST /api/transformar`.
2. O backend monta uma chamada ao Gemini com **três partes**, nesta ordem:
   - o texto de `prompt_pia.txt`
   - `character_sheet_pia.jpg` (IMAGE 1 = referência de estilo e da camiseta)
   - a foto da pessoa (IMAGE 2 = referência de identidade)
3. O Gemini devolve uma imagem 1:1. O backend repassa em base64. Nada fica salvo em disco nem em banco.

## Subir localmente

```bash
cp .env.example .env
# editar .env e colocar a GEMINI_API_KEY
npm install
npm start
```

Abre em `http://localhost:3000`. O `server.js` já serve a pasta `frontend/` como estático, então um único processo resolve.

Para testar o front sem gastar API: `npm run mock` (ou `MOCK=1` no `.env`). Ele espera 2,5 s e devolve `mock_resultado.jpg`.

## Chave e modelo do Gemini

- Chave: Google AI Studio, https://aistudio.google.com/apikey. Colocar em `GEMINI_API_KEY`.
- `GEMINI_IMAGE_MODEL`:
  - `gemini-2.5-flash-image` (padrão): rápido e barato, bom para volume.
  - `gemini-3-pro-image-preview`: fidelidade de rosto e de texto na camiseta bem melhor. Recomendo testar os dois com 5 selfies diferentes e escolher.
  - Confira o nome exato dos modelos na documentação atual, os nomes de preview mudam: https://ai.google.dev/gemini-api/docs/image-generation
- A chamada usa a REST `v1beta/models/{modelo}:generateContent` com `responseModalities: ["IMAGE"]` e `imageConfig.aspectRatio`. Se o modelo escolhido rejeitar `imageConfig`, o código tenta de novo sem ele.
- Se preferir o SDK oficial `@google/genai`, a montagem é a mesma: `parts = [texto, sheet, foto]`.

## Hospedagem

O repositório já vem configurado para as duas plataformas. **A Railway é a recomendada**: a geração leva de 8 a 30 s e um servidor sempre ligado lida melhor com isso do que uma função serverless.

### Railway (recomendado)

1. New Project → Deploy from GitHub repo → escolher este repositório.
2. Em **Variables**, adicionar:
   - `GEMINI_API_KEY` (obrigatória)
   - `GEMINI_IMAGE_MODEL` (opcional, padrão `gemini-3-pro-image-preview`)
   - `RATE_LIMIT_PER_HOUR` (opcional, padrão 20)
   - Não definir `PORT`: a Railway injeta sozinha.
3. Settings → Networking → Generate Domain. Pronto, o domínio já sai em HTTPS.

O `railway.json` manda rodar `npm start`, que sobe o Express servindo a API e o frontend no mesmo processo.

### Vercel

1. Import Project → escolher o repositório (framework: Other, sem build command).
2. Em **Settings → Environment Variables**, adicionar `GEMINI_API_KEY` e, se quiser, `GEMINI_IMAGE_MODEL`.
3. Deploy.

O `vercel.json` publica `frontend/` como estático na CDN e manda `/api/*` para a função em `api/index.js`, com `maxDuration` de 60 s.

Atenção: 60 s é o teto da Vercel. Se o `gemini-3-pro-image-preview` passar disso em fotos pesadas, a requisição é cortada — nesse caso use `gemini-2.5-flash-image` ou vá de Railway.

### Qualquer outro lugar (Render, Fly.io, Cloud Run, VPS com PM2)

Precisa apenas de Node 18+ e `npm start`.

### Vale para todas

- HTTPS é obrigatório: a câmera (`getUserMedia`) só abre em origem segura.
- Se o front for hospedado separado do backend, edite no `index.html` a constante `API_URL` ou defina `window.PIA_API_URL` antes do script, e ajuste `CORS_ORIGIN` para o domínio do front.
- Se tiver proxy/CDN na frente (Cloudflare, Nginx), suba o timeout de resposta para 90 s.
- `RATE_LIMIT_PER_HOUR` é um freio simples por IP em memória. Com mais de uma instância, troque por Redis ou pelo rate limit da plataforma.
- A chave do Gemini fica só no backend, sempre como variável de ambiente. Nunca no código, nunca no front.

## Frontend

- Um arquivo, sem build, sem framework. Fontes do Google Fonts (Space Grotesk + Inter).
- Câmera frontal com preview espelhado; captura e envio não são espelhados.
- No celular, o botão "Galeria" abre o seletor nativo (que também oferece a câmera).
- Resultado: comparação antes/depois, botão Baixar (PNG) e Compartilhar (Web Share API com arquivo, quando o navegador suporta).
- Cores e textos estão em variáveis CSS e no HTML, fáceis de trocar.

## Ajustes de prompt

O `prompt_pia.txt` está dividido em blocos: estilo, identidade, camiseta, enquadramento. Para mudar o cenário (por exemplo, fundo branco de estúdio em vez do bastidor), altere só o bloco FRAMING AND BACKGROUND. Não tire o bloco OUTFIT: é ele que garante as três logos na camiseta.

## Custo estimado

Consultar a tabela atual em https://ai.google.dev/gemini-api/docs/pricing. Cada geração conta as duas imagens de entrada mais a de saída. Colocar um limite de gasto no projeto do Google Cloud antes de abrir ao público.
