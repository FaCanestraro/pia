// Gerador Piá · backend
// Recebe a foto do usuário (base64), junta com o character sheet do Piá e o prompt,
// chama o Gemini (geração de imagem) e devolve a imagem final em base64.
//
// Rodar:  cp .env.example .env  →  preencher GEMINI_API_KEY  →  npm install  →  npm start
// Node 18+ (usa fetch nativo). Sem banco, sem upload em disco: nada da foto fica salvo.

import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { salvar, listar, remover, GALERIA_DIR } from "./galeria.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- .env simples (sem dependência) ----------
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const {
  GEMINI_API_KEY = "",
  GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview",
  PORT = "3000",
  CORS_ORIGIN = "*",
  MOCK = "0",
  GALERIA = "1",        // 0 desliga a gravação e o mural
  ADMIN_TOKEN = "",     // sem token, a rota de remoção fica desativada
  GEMINI_CONCURRENCY = "2",   // chamadas simultâneas ao Gemini; acima disso, fila
  COOLDOWN_IP_S = "15",       // intervalo mínimo entre gerações do mesmo IP
  LIMITE_GLOBAL_HORA = "300", // teto de gerações/hora no app todo (guarda de orçamento)
  GEMINI_TENTATIVAS = "3",    // total de tentativas por geração (1 + 2 repetições)
  GEMINI_TIMEOUT_S = "90",    // teto por tentativa; evita conexão pendurada segurar a fila
  GEMINI_BASE_URL = "https://generativelanguage.googleapis.com", // trocável para testar
} = process.env;

const mock = MOCK === "1";
const galeriaLigada = GALERIA !== "0";
if (!GEMINI_API_KEY && !mock) {
  console.error("Falta GEMINI_API_KEY nas variáveis de ambiente (ou ligue MOCK=1 para testar sem a API).");
  if (!process.env.VERCEL) process.exit(1);
}

// ---------- assets fixos, carregados uma vez ----------
const PROMPT = fs.readFileSync(path.join(__dirname, "prompt_pia.txt"), "utf8");
const SHEET_B64 = fs.readFileSync(path.join(__dirname, "character_sheet_pia.jpg")).toString("base64");
const MOCK_B64 = fs.existsSync(path.join(__dirname, "mock_resultado.jpg"))
  ? fs.readFileSync(path.join(__dirname, "mock_resultado.jpg")).toString("base64")
  : null;

// ---------- app ----------
const app = express();
app.use(express.json({ limit: "20mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// serve o frontend da pasta ../frontend (opcional: pode hospedar o front em outro lugar)
app.use(express.static(path.join(__dirname, "..", "frontend")));

// imagens do mural (cache longo: o nome do arquivo nunca se repete)
app.use("/galeria", express.static(GALERIA_DIR, { maxAge: "30d", immutable: true }));

// Number(x) || padrao trata 0 como "não informado"; aqui 0 é um valor válido
// (desligar o cooldown, por exemplo), então a checagem é por NaN.
const num = (v, padrao) => { const n = Number(v); return Number.isFinite(n) ? n : padrao; };

// ---------- freio de uso ----------
// Num evento com wifi compartilhado todo mundo sai pelo mesmo IP público, então uma
// cota por IP trancaria o local inteiro. O freio por IP virou um cooldown curto (evita
// a pessoa apertando o botão em sequência) e o teto de gasto virou global.
const ultimoPorIp = new Map();
let carimbosGlobais = [];

function freio(ip) {
  const agora = Date.now();

  carimbosGlobais = carimbosGlobais.filter((t) => agora - t < 3600_000);
  if (carimbosGlobais.length >= num(LIMITE_GLOBAL_HORA, 300)) {
    return "O gerador atingiu o limite de uso desta hora. Tenta de novo mais tarde.";
  }

  const cooldown = num(COOLDOWN_IP_S, 15) * 1000;
  const ultimo = ultimoPorIp.get(ip);
  if (ultimo && agora - ultimo < cooldown) {
    const faltam = Math.ceil((cooldown - (agora - ultimo)) / 1000);
    return `Espera ${faltam}s para gerar de novo.`;
  }

  ultimoPorIp.set(ip, agora);
  carimbosGlobais.push(agora);
  return null;
}

// Evita que ultimoPorIp cresça sem limite ao longo de um evento longo.
setInterval(() => {
  const corte = Date.now() - 3600_000;
  for (const [ip, t] of ultimoPorIp) if (t < corte) ultimoPorIp.delete(ip);
}, 600_000).unref();

// ---------- fila do Gemini ----------
// A API fica MUITO mais lenta com várias chamadas simultâneas na mesma chave: medimos
// 20s isolada contra 84-91s com três em paralelo. Limitando a concorrência, cada geração
// mantém ~20s e as demais esperam a vez — previsível em vez de todo mundo degradar junto.
const LIMITE = Math.max(1, num(GEMINI_CONCURRENCY, 2));
let emVoo = 0;
const aguardando = [];          // [{ ticket, libera }] na ordem de chegada
const processando = new Set();  // tickets que já estão na mão do Gemini

// O cliente manda um ticket próprio para poder perguntar a SUA posição. Sem isso o
// front só saberia o tamanho da fila, que inclui ele mesmo — e mostraria "1 na frente"
// para quem é o próximo.
function pegarVaga(ticket) {
  if (emVoo < LIMITE) {
    emVoo++;
    if (ticket) processando.add(ticket);
    return Promise.resolve();
  }
  return new Promise((libera) => aguardando.push({ ticket, libera }));
}
function devolverVaga(ticket) {
  if (ticket) processando.delete(ticket);
  const proximo = aguardando.shift();
  if (proximo) {
    if (proximo.ticket) processando.add(proximo.ticket);
    proximo.libera();       // passa a vaga direto, sem zerar o contador
  } else emVoo--;
}
function posicao(ticket) {
  if (processando.has(ticket)) return { estado: "processando", naFrente: 0 };
  const i = aguardando.findIndex((a) => a.ticket === ticket);
  if (i >= 0) return { estado: "fila", naFrente: i };
  return { estado: "desconhecido", naFrente: 0 };
}

// Se o cliente some enquanto espera, tira ele da fila em vez de dar a vaga a um morto.
function desistir(ticket) {
  const i = aguardando.findIndex((a) => a.ticket === ticket);
  if (i >= 0) aguardando.splice(i, 1);
}

// ---------- rotas ----------
app.get("/api/saude", (req, res) => {
  res.json({ ok: true, modelo: GEMINI_IMAGE_MODEL, mock });
});

// O loader do front consulta isto para mostrar a posição na fila em vez de um
// "aguarde" mudo enquanto espera vaga.
app.get("/api/fila", (req, res) => {
  const base = { processando: emVoo, esperando: aguardando.length, limite: LIMITE };
  const t = req.query.ticket;
  res.json(t ? { ...base, ...posicao(String(t)) } : base);
});

app.post("/api/transformar", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  const barrado = freio(ip);
  if (barrado) return res.status(429).json({ erro: barrado });

  const { imagem, proporcao = "1:1", ticket } = req.body || {};
  const tk = typeof ticket === "string" && ticket.length <= 64 ? ticket : null;
  const parsed = parseDataUrl(imagem);
  if (!parsed) return res.status(400).json({ erro: "Envie a foto em base64 (data URL jpeg, png ou webp)." });
  if (parsed.bytes > 12 * 1024 * 1024) return res.status(413).json({ erro: "Foto muito grande (máx. 12 MB)." });

  // Se o usuário fecha a aba ou o front aborta por timeout, cancelamos a chamada ao
  // Gemini: sem isto a geração continua, é cobrada e é salva sem ninguém para receber.
  // Tem que ser no `res`, não no `req`: o `close` do req dispara assim que o corpo
  // termina de ser lido (o express.json() já consumiu), o que abortaria tudo na hora.
  // `writableFinished` distingue resposta concluída de cliente que desistiu.
  const ctrl = new AbortController();
  res.on("close", () => {
    if (res.writableFinished) return;
    ctrl.abort();
    desistir(tk);            // some da fila em vez de receber uma vaga inútil
  });

  const tFila = Date.now();
  await pegarVaga(tk);
  const esperou = (Date.now() - tFila) / 1000;

  try {
    if (ctrl.signal.aborted) {            // desistiu enquanto esperava na fila
      console.log(`[abortado na fila] apos ${esperou.toFixed(1)}s`);
      return;
    }
    const t0 = Date.now();

    if (mock) {
      // O mock passa pela fila de propósito: é assim que dá para testar a espera e o
      // indicador de posição no front sem gastar API.
      // respeita o abort igual ao fetch real, senão o mock não representa o fluxo
      await new Promise((ok, falha) => {
        const t = setTimeout(ok, num(process.env.MOCK_DELAY_MS, 2500));
        ctrl.signal.addEventListener("abort", () => {
          clearTimeout(t);
          falha(Object.assign(new Error("abortado"), { name: "AbortError" }));
        }, { once: true });
      });
      const id = await guardar(Buffer.from(MOCK_B64, "base64"));
      const fila = esperou >= 0.1 ? ` (fila ${esperou.toFixed(1)}s)` : "";
      console.log(`[ok] mock em ${((Date.now() - t0) / 1000).toFixed(1)}s${fila}`);
      return res.json({ imagem: `data:image/jpeg;base64,${MOCK_B64}`, modelo: "mock", id });
    }

    const out = await gerarComGemini(parsed, proporcao, ctrl.signal);
    const fila = esperou >= 0.1 ? ` (fila ${esperou.toFixed(1)}s)` : "";
    console.log(`[ok] ${GEMINI_IMAGE_MODEL} em ${((Date.now() - t0) / 1000).toFixed(1)}s${fila}`);
    const id = await guardar(Buffer.from(out.data, "base64"));
    res.json({ imagem: `data:${out.mimeType};base64,${out.data}`, modelo: GEMINI_IMAGE_MODEL, id });
  } catch (e) {
    if (e.name === "AbortError" || ctrl.signal.aborted) {
      console.log("[abortado pelo cliente] chamada ao Gemini cancelada");
      return;                             // conexão já morreu, não há o que responder
    }
    console.error("[erro gemini]", e.message);
    res.status(502).json({ erro: e.publicMessage || "Não consegui gerar agora. Tenta de novo." });
  } finally {
    devolverVaga(tk);
  }
});

// Em servidor comum (Railway, Render, VPS) sobe a porta.
// Em serverless (Vercel) o app é exportado e a plataforma cuida do resto.
if (!process.env.VERCEL) {
  // ---------- mural ----------
app.get("/api/galeria", async (req, res) => {
  if (!galeriaLigada) return res.json({ ligada: false, total: 0, itens: [] });
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  try {
    res.json({ ligada: true, ...(await listar({ limit, desde: req.query.desde || null })) });
  } catch (e) {
    console.error("[erro galeria]", e.message);
    res.status(500).json({ erro: "Não consegui ler o mural." });
  }
});

// Remoção manual (pedido de alguém que não quer mais aparecer, foto imprópria).
// Só existe se ADMIN_TOKEN estiver definido no .env.
app.delete("/api/galeria/:id", async (req, res) => {
  if (!ADMIN_TOKEN) return res.status(404).json({ erro: "Remoção não está habilitada." });
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return res.status(401).json({ erro: "Token inválido." });
  const ok = await remover(req.params.id);
  res.status(ok ? 200 : 404).json({ removido: ok });
});

app.listen(Number(PORT), () => {
    console.log(`Gerador Piá rodando em http://localhost:${PORT}  (modelo: ${mock ? "MOCK" : GEMINI_IMAGE_MODEL})`);
  });
}

export default app;

// ---------- helpers ----------
// A foto do usuário continua não sendo salva: só o resultado gerado vai para o mural.
// Falha de disco aqui não pode custar ao usuário a imagem que ele já esperou 25 s.
async function guardar(buffer) {
  if (!galeriaLigada) return null;
  try {
    return await salvar(buffer);
  } catch (e) {
    console.error("[erro ao salvar no mural]", e.message);
    return null;
  }
}
function parseDataUrl(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2], bytes: Math.floor((m[2].length * 3) / 4) };
}

async function gerarComGemini(foto, proporcao, signal) {
  const url = `${GEMINI_BASE_URL}/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType: "image/jpeg", data: SHEET_B64 } }, // IMAGE 1: character sheet (estilo)
          { inlineData: { mimeType: foto.mimeType, data: foto.data } }, // IMAGE 2: foto da pessoa (identidade)
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: allowedRatio(proporcao) },
    },
  };

  let r = await comRepeticao(() => chamar(url, body, signal), signal);

  // Alguns modelos/versões não aceitam imageConfig: tenta sem.
  if (r.status === 400 && /imageConfig|aspect/i.test(r.text)) {
    delete body.generationConfig.imageConfig;
    r = await comRepeticao(() => chamar(url, body, signal), signal);
  }

  if (r.status !== 200) {
    const err = new Error(`HTTP ${r.status}: ${r.text.slice(0, 500)}`);
    if (r.status === 429) err.publicMessage = "Fila cheia no gerador. Tenta de novo em alguns segundos.";
    throw err;
  }

  const json = JSON.parse(r.text);
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (img) return { mimeType: img.inlineData.mimeType || "image/png", data: img.inlineData.data };

  // Sem imagem: geralmente bloqueio de segurança ou o modelo respondeu em texto.
  const txt = parts.map((p) => p.text).filter(Boolean).join(" ");
  const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || "";
  const err = new Error(`sem imagem na resposta (${reason}) ${txt.slice(0, 300)}`);
  err.publicMessage = "Não consegui transformar essa foto. Tenta outra com o rosto bem visível e boa luz.";
  throw err;
}

async function chamar(url, body, signal) {
  // Teto por tentativa: sem isso uma conexão pendurada segura uma vaga da fila até o
  // cliente desistir — foi o que aconteceu durante o bloqueio do Google.
  const teto = AbortSignal.timeout(num(GEMINI_TIMEOUT_S, 90) * 1000);
  const juntos = signal ? AbortSignal.any([signal, teto]) : teto;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify(body),
    signal: juntos,
  });
  return { status: resp.status, text: await resp.text() };
}

// Falha de rede e 5xx costumam ser transitórias. 4xx (chave errada, foto inválida) não
// melhoram repetindo, e 429 é o Google pedindo para desacelerar — insistir piora.
function recuperavel(e, status) {
  if (status !== undefined) return status >= 500 && status < 600;
  if (e?.name === "TimeoutError") return true;   // tentativa estourou o teto próprio
  return e?.name === "TypeError" || /fetch failed|network|socket|ECONN|ETIMEDOUT|terminated/i.test(e?.message || "");
}

// Backoff exponencial com jitter. A espera é generosa de propósito: quando a falha é
// throttling por IP, repetir rápido alimenta o problema que se quer contornar.
async function comRepeticao(fn, signal) {
  const total = Math.max(1, num(GEMINI_TENTATIVAS, 3));
  let ultimo;
  for (let n = 1; n <= total; n++) {
    try {
      const r = await fn();
      if (recuperavel(null, r.status) && n < total) {
        ultimo = new Error(`HTTP ${r.status}`);
      } else {
        return r;
      }
    } catch (e) {
      // Cliente desistiu: não é falha do Gemini, não repete.
      if (signal?.aborted) throw e;
      if (!recuperavel(e) || n === total) throw e;
      ultimo = e;
    }
    const base = 2000 * 2 ** (n - 1);              // 2s, 4s, 8s...
    const espera = Math.round(base + Math.random() * base * 0.5);
    console.warn(`[retry ${n}/${total - 1}] ${String(ultimo?.message).slice(0, 70)} — repetindo em ${(espera / 1000).toFixed(1)}s`);
    await dormir(espera, signal);
  }
  throw ultimo;
}

function dormir(ms, signal) {
  return new Promise((ok, falha) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      falha(Object.assign(new Error("abortado"), { name: "AbortError" }));
    }, { once: true });
  });
}

function allowedRatio(p) {
  return ["1:1", "3:4", "4:3", "9:16", "16:9", "4:5"].includes(p) ? p : "1:1";
}
