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
3. O Gemini devolve uma imagem 1:1. O backend repassa em base64.
4. Com `GALERIA=1` (padrão), o **resultado** é gravado em `backend/galeria/` e alimenta o mural no fim da página.
   A **foto enviada pela pessoa continua não sendo salva** — só a imagem gerada.

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

## Mural de resultados

Cada geração é gravada em `backend/galeria/` e aparece num mosaico no fim do site.

```
backend/galeria/
├── full/<id>.jpg    1024px, o que abre ao clicar
├── thumb/<id>.jpg   420px, o que o mosaico carrega
└── meta/<id>.json   { "nome": "..." } de quem gerou
```

O nome de quem gerou fica em `galeria/meta/<id>.json`. Arquivo por imagem, não índice
único: um índice traria de volta a corrida de escrita que o resto do módulo evita. O
disco é a verdade; um Map em memória, carregado no boot, evita uma leitura de disco por
item a cada poll do mural. O nome é higienizado na gravação (sem controle, espaço
colapsado, 40 caracteres) e renderizado com `textContent`, nunca `innerHTML`.

O `id` é `<timestamp>-<aleatório>`, então a ordem cronológica sai do próprio nome do
arquivo — sem índice em JSON e sem corrida de escrita entre requisições simultâneas.

- `GET /api/galeria?limit=60` lista os mais recentes. Com `?desde=<id>` devolve só o
  que chegou depois daquele id: é o que o front usa no poll de 25 s.
- `DELETE /api/galeria/<id>` com header `x-admin-token` remove uma imagem. Só existe se
  `ADMIN_TOKEN` estiver definido. **Defina antes de abrir ao público** — é a única forma
  de atender alguém que peça para sair do mural.
- `GALERIA=0` desliga a gravação e o mural some da página.

Tamanho em disco: cada resultado ocupa ~220 KB (192 KB full + 29 KB thumb), contra
~600 KB do PNG cru do Gemini. Mil gerações ≈ 220 MB.

**Privacidade:** o mural publica o retrato gerado de todo mundo, automaticamente, sem
pedir confirmação. É uma decisão consciente do projeto. Se for abrir ao público, vale
avisar na página que o resultado aparece no mural e manter o `ADMIN_TOKEN` à mão.

**Este mural exige disco persistente.** Em Vercel serverless o sistema de arquivos é
efêmero e somente leitura fora de `/tmp`: a pasta some a cada invocação e o mural fica
sempre vazio. Para Vercel, trocar `backend/galeria.js` por Vercel Blob, S3 ou R2 — a
interface é só `salvar`/`listar`/`remover`, o resto do código não muda.

## Sorteio (`/sorteio`)

Rota de telão para a apresentação. **É a mesma `index.html`**, servida por
`app.get("/sorteio")`: o front liga a seção olhando `location.pathname`. Não existe
arquivo duplicado, então as duas rotas nunca saem de sincronia.

A página aparece idêntica à principal (inclusive o mural) e ganha no fim um botão
**Sortear**, com giro tipo roleta que desacelera até parar no escolhido, revelando a
imagem grande e o nome.

- Sorteia entre quem está no mural no momento do clique (busca a lista na hora, não usa
  o que já estava em tela).
- Não repete ninguém enquanto houver gente não sorteada; quando todos saírem, recomeça.
- Mural vazio mostra aviso em vez de quebrar.
- Limitado aos 200 mais recentes, pelo teto de `/api/galeria`.

## Fila e limites

Uma medição em produção mostrou que a API do Gemini degrada muito com chamadas
simultâneas na mesma chave — ela enfileira do lado do Google em vez de recusar:

| situação | duração da chamada |
|---|---|
| isolada | 20-22 s |
| três em paralelo | 84 s, 91 s, 28 s |

Por isso o backend limita a concorrência e enfileira o excedente. O efeito é que cada
geração continua levando ~20 s e só a espera cresce, em vez de todo mundo degradar junto
e estourar o timeout do navegador.

- `GEMINI_CONCURRENCY` (2): chamadas simultâneas ao Gemini.
- `GET /api/fila?ticket=<id>`: posição na fila. O front manda um `ticket` junto com a
  geração e consulta isto a cada 3 s para mostrar "tem N pessoas na sua frente".
- O front aborta em 180 s e o backend **cancela a chamada ao Gemini** quando o cliente
  desiste, para não gerar (e pagar) uma imagem que ninguém vai receber.

O freio de uso tem duas partes, porque uma cota por IP não serve para evento:

- `COOLDOWN_IP_S` (15): intervalo mínimo entre duas gerações do mesmo IP. Num local com
  wifi compartilhado todo mundo sai pelo mesmo IP público — uma cota por hora por IP
  trancaria o evento inteiro depois das primeiras gerações. O cooldown curto segura
  o clique repetido sem punir o grupo.
- `LIMITE_GLOBAL_HORA` (300): teto de gerações por hora no app inteiro, como guarda de
  orçamento. Conta tentativas, não sucessos.

## O limite real: reputação do IP de saída

O gargalo não é a cota do projeto no Google, é a **proteção anti-abuso por IP de origem**.
Como toda geração sai do backend, o IP que o Google vê é o de egresso da máquina — que no
Fly é compartilhado com outros clientes.

Medido em 17/09/2026: uma rajada de chamadas simultâneas fez o Google primeiro degradar
(84 e 91 s contra os 20-22 s normais) e depois **recusar conexões por ~11 minutos**.
O sintoma é `fetch failed` / timeout de conexão, não 429 — 429 seria estouro de cota,
que é outra coisa. Da mesma máquina, no mesmo momento, `api.github.com` respondia normal
e `www.google.com` dava timeout.

Consequências:

- `GEMINI_CONCURRENCY` existe para não tropeçar nesse limite. Não é ajuste de performance.
- O número seguro **não é descobrível** com egresso compartilhado: depende do tráfego de
  terceiros no mesmo IP e muda sozinho.
- **Resolvido em 17/09/2026 com IP de saída dedicado** (`fly ips allocate-egress --region gru`).
  O app ficou ~50 min sem gerar (15:56 às 16:40); assim que a rota de saída mudou para
  `209.71.74.130`, a primeira geração voltou em 20,4 s, sem nenhum retry. Confirmou que o
  problema era reputação de IP compartilhado: nada de errado com a chave, a cota ou o código.
  Com IP dedicado o teto passa a depender só do seu tráfego, e vira estável e calibrável.
- O retry com backoff cobre a falha transitória, mas **não** cobre bloqueio duro de IP.

Vigiar durante evento: `fly logs | grep -E "retry|fetch failed"`. Retry frequente = perto
do limite, vale descer a concorrência. `fetch failed` mesmo com retry = já bloqueado.

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
