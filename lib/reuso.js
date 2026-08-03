"use strict";

const fs = require("fs/promises");
const path = require("path");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function candidatasOrdenadas(redeDir, dataAtual) {
  let entradas;
  try {
    entradas = await fs.readdir(redeDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const pastas = entradas
    .filter((e) => e.isDirectory() && e.name !== dataAtual)
    .map((e) => e.name);

  const comStat = await Promise.all(
    pastas.map(async (nome) => {
      const stat = await fs.stat(path.join(redeDir, nome));
      return { nome, mtime: stat.mtimeMs };
    })
  );
  comStat.sort((a, b) => b.mtime - a.mtime);
  return comStat.map((p) => p.nome);
}

async function lerManifest(redeDir, pasta) {
  try {
    const raw = await fs.readFile(path.join(redeDir, pasta, "manifest.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null; // ausente ou corrompido = rodada incompleta, ignorar
  }
}

async function paginasExistentesNoDir(jpgDir, slug) {
  let entradas;
  try {
    entradas = await fs.readdir(jpgDir);
  } catch {
    return new Map();
  }

  const regex = new RegExp(`^${escapeRegex(slug)}-pagina-(\\d+)\\.\\w+$`);
  const mapa = new Map();
  for (const nome of entradas) {
    const m = nome.match(regex);
    if (m) mapa.set(parseInt(m[1], 10), nome);
  }
  return mapa;
}

async function linkOuCopia(origem, destino) {
  try {
    await fs.link(origem, destino);
  } catch (err) {
    if (err.code === "EEXIST") return;
    if (err.code === "EXDEV" || err.code === "EPERM") {
      await fs.copyFile(origem, destino);
      return;
    }
    throw err;
  }
}

/**
 * Procura as paginas de `slug` em rodadas anteriores da mesma rede (pastas
 * DD-Mes irmas de `dataAtual` dentro de `redeDir`) e as hardlinka em
 * `jpgDirDestino`. So reaproveita candidatas cujo manifest.json confirma o
 * numero exato de paginas e cujos arquivos existem de fato no disco --
 * evita herdar um encarte truncado de uma rodada anterior interrompida.
 *
 * Se `paginasEsperadas` for informado, uma candidata com numero de paginas
 * diferente e descartada sem tocar em disco -- protege contra o mesmo
 * id/slug reaparecer com conteudo diferente (encarte trocado sem mudar id).
 *
 * Retorna { paginas, origemDir, fonte } em caso de sucesso, ou null.
 */
async function reaproveitarPaginas({ redeDir, dataAtual, slug, jpgDirDestino, paginasEsperadas }) {
  const candidatas = await candidatasOrdenadas(redeDir, dataAtual);

  for (const pasta of candidatas) {
    const manifest = await lerManifest(redeDir, pasta);
    if (!manifest) continue;

    const entrada = (manifest.encartes || []).find((e) => e.slug === slug);
    if (!entrada || !entrada.paginas) continue;
    if (paginasEsperadas != null && entrada.paginas !== paginasEsperadas) continue;

    const jpgOrigemDir = path.join(redeDir, pasta, "JPG");
    const paginasExistentes = await paginasExistentesNoDir(jpgOrigemDir, slug);

    let completo = true;
    for (let p = 1; p <= entrada.paginas; p += 1) {
      const nome = paginasExistentes.get(p);
      if (!nome) { completo = false; break; }
      try {
        const stat = await fs.stat(path.join(jpgOrigemDir, nome));
        if (stat.size === 0) { completo = false; break; }
      } catch {
        completo = false;
        break;
      }
    }
    if (!completo) continue;

    for (let p = 1; p <= entrada.paginas; p += 1) {
      const nome = paginasExistentes.get(p);
      await linkOuCopia(path.join(jpgOrigemDir, nome), path.join(jpgDirDestino, nome));
    }

    return {
      paginas: entrada.paginas,
      origemDir: path.join(redeDir, pasta),
      fonte: entrada.fonte ?? null,
    };
  }

  return null;
}

module.exports = { reaproveitarPaginas, linkOuCopia };
