// Gerador Piá · galeria
// Guarda cada resultado em disco e lista os mais recentes para o mural do site.
//
// Layout em disco:
//   galeria/full/<id>.jpg   imagem cheia (1024px, o que abre no lightbox)
//   galeria/thumb/<id>.jpg  miniatura (420px, o que o mosaico carrega)
//
// O id é `<timestamp>-<aleatório>`, então a ordem cronológica sai do próprio nome
// do arquivo: nada de índice em JSON, nada de corrida de escrita entre requisições.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Em container o disco da raiz é efêmero: aponte GALERIA_DIR para um volume
// persistente (no Fly, o mount de fly.toml). Sem isso o mural some a cada deploy.
export const GALERIA_DIR = process.env.GALERIA_DIR || path.join(__dirname, "galeria");
const FULL_DIR = path.join(GALERIA_DIR, "full");
const THUMB_DIR = path.join(GALERIA_DIR, "thumb");

const LADO_FULL = 1024;
const LADO_THUMB = 420;
const ID_RE = /^[0-9]{13}-[a-z0-9]{6}$/; // trava o id: só o que a gente mesmo gerou

for (const dir of [FULL_DIR, THUMB_DIR]) fs.mkdirSync(dir, { recursive: true });

function novoId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8).padStart(6, "0")}`;
}

// Grava a imagem gerada e devolve o id. Converte para JPEG: o mural não precisa de
// PNG sem perda e o tamanho cai de ~600 KB para ~120 KB por resultado.
export async function salvar(buffer) {
  const id = novoId();
  const base = sharp(buffer).rotate();
  await Promise.all([
    base.clone().resize(LADO_FULL, LADO_FULL, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 }).toFile(path.join(FULL_DIR, `${id}.jpg`)),
    base.clone().resize(LADO_THUMB, LADO_THUMB, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 }).toFile(path.join(THUMB_DIR, `${id}.jpg`)),
  ]);
  return id;
}

// Mais recentes primeiro. `desde` permite ao front pedir só o que chegou depois do
// último id que ele já tem, em vez de baixar a lista inteira a cada poll.
export async function listar({ limit = 60, desde = null } = {}) {
  let nomes;
  try {
    nomes = await fsp.readdir(THUMB_DIR);
  } catch {
    return { total: 0, itens: [] };
  }
  const ids = nomes
    .filter((n) => n.endsWith(".jpg"))
    .map((n) => n.slice(0, -4))
    .filter((id) => ID_RE.test(id))
    .sort()
    .reverse();

  const corte = desde && ID_RE.test(desde) ? ids.indexOf(desde) : -1;
  const janela = (corte > 0 ? ids.slice(0, corte) : corte === 0 ? [] : ids).slice(0, limit);

  return {
    total: ids.length,
    itens: janela.map((id) => ({
      id,
      thumb: `/galeria/thumb/${id}.jpg`,
      full: `/galeria/full/${id}.jpg`,
      ts: Number(id.split("-")[0]),
    })),
  };
}

// Válvula de remoção: usada pela rota protegida por ADMIN_TOKEN.
export async function remover(id) {
  if (!ID_RE.test(id)) return false;
  const alvos = [path.join(FULL_DIR, `${id}.jpg`), path.join(THUMB_DIR, `${id}.jpg`)];
  let apagou = false;
  for (const a of alvos) {
    try { await fsp.unlink(a); apagou = true; } catch { /* já não existia */ }
  }
  return apagou;
}
