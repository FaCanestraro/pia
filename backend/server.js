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
  RATE_LIMIT_PER_HOUR = "20",
  MOCK = "0",
} = process.env;

const mock = MOCK === "1";
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

// ---------- rate limit em memória (por IP, por hora) ----------
const hits = new Map();
function rateLimited(ip) {
  const limit = Number(RATE_LIMIT_PER_HOUR) || 20;
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  if (arr.length >= limit) return true;
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

// ---------- rotas ----------
app.get("/api/saude", (req, res) => {
  res.json({ ok: true, modelo: GEMINI_IMAGE_MODEL, mock });
});

app.post("/api/transformar", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress;
  if (rateLimited(ip)) {
    return res.status(429).json({ erro: "Muitas gerações seguidas. Tenta de novo daqui a pouco." });
  }

  const { imagem, proporcao = "1:1" } = req.body || {};
  const parsed = parseDataUrl(imagem);
  if (!parsed) return res.status(400).json({ erro: "Envie a foto em base64 (data URL jpeg, png ou webp)." });
  if (parsed.bytes > 12 * 1024 * 1024) return res.status(413).json({ erro: "Foto muito grande (máx. 12 MB)." });

  if (mock) {
    await new Promise((r) => setTimeout(r, 2500));
    return res.json({ imagem: `data:image/jpeg;base64,${MOCK_B64}`, modelo: "mock" });
  }

  try {
    const t0 = Date.now();
    const out = await gerarComGemini(parsed, proporcao);
    console.log(`[ok] ${GEMINI_IMAGE_MODEL} em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    res.json({ imagem: `data:${out.mimeType};base64,${out.data}`, modelo: GEMINI_IMAGE_MODEL });
  } catch (e) {
    console.error("[erro gemini]", e.message);
    res.status(502).json({ erro: e.publicMessage || "Não consegui gerar agora. Tenta de novo." });
  }
});

// Em servidor comum (Railway, Render, VPS) sobe a porta.
// Em serverless (Vercel) o app é exportado e a plataforma cuida do resto.
if (!process.env.VERCEL) {
  app.listen(Number(PORT), () => {
    console.log(`Gerador Piá rodando em http://localhost:${PORT}  (modelo: ${mock ? "MOCK" : GEMINI_IMAGE_MODEL})`);
  });
}

export default app;

// ---------- helpers ----------
function parseDataUrl(s) {
  if (typeof s !== "string") return null;
  const m = s.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  return { mimeType: m[1], data: m[2], bytes: Math.floor((m[2].length * 3) / 4) };
}

async function gerarComGemini(foto, proporcao) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`;

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

  let r = await chamar(url, body);

  // Alguns modelos/versões não aceitam imageConfig: tenta sem.
  if (r.status === 400 && /imageConfig|aspect/i.test(r.text)) {
    delete body.generationConfig.imageConfig;
    r = await chamar(url, body);
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

async function chamar(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
    body: JSON.stringify(body),
  });
  return { status: resp.status, text: await resp.text() };
}

function allowedRatio(p) {
  return ["1:1", "3:4", "4:3", "9:16", "16:9", "4:5"].includes(p) ? p : "1:1";
}
