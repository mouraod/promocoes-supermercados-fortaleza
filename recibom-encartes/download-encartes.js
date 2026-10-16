#!/usr/bin/env node
"use strict";

const path = require("node:path");
const os = require("node:os");

const { createHash } = require("node:crypto");
const { baixarEncartes, parsearArgs } = require("../lib/pipeline");
const SOURCE = "https://recibom.com.br/tabloide/";
const HOST = "cdn.bitrix24.com.br";

function atributo(tag, nome) {
  return tag.match(new RegExp(`\\b${nome}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2];
}

function parsearTabloide(html) {
  const paginas = [...html.matchAll(/<img\b[^>]*>/gi)]
    .map(([tag]) => tag)
    .filter((tag) => (atributo(tag, "class") ?? "").split(/\s+/).includes("landing-block-node-img"))
    .map((tag) => {
      const variante = atributo(tag, "srcset")?.split(",").map((s) => s.trim()).find((s) => /\s2x$/.test(s));
      if (!variante) throw new Error("Recibom: imagem sem srcset 2x");
      const url = variante.replace(/\s+2x$/, "").replace(/&amp;/g, "&");
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.hostname !== HOST || parsed.username || parsed.password) {
        throw new Error("Recibom: host de imagem não permitido");
      }
      return { url };
    });
  if (!paginas.length) return [];
  const campanha = createHash("sha256").update(JSON.stringify(paginas.map((p) => p.url).sort())).digest("hex");
  return [{
    slug: `tabloide-recibom-${campanha}`, paginas,
    meta: { titulo: "Tabloide Recibom", campanha, vigencia: null, validade_evidencia: null },
  }];
}

async function descobrir(_args, { fetch: buscar = fetch } = {}) {
  const resposta = await buscar(SOURCE, { signal: AbortSignal.timeout(30000) });
  if (!resposta.ok) throw new Error(`Recibom: HTTP ${resposta.status}`);
  return parsearTabloide(await resposta.text());
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), {
    aceitas: ["sem-reuso"], padroes: { base: path.join(os.homedir(), "Downloads/Encartes/Recife") }, ajuda: "Recibom: --base <raiz Recife> --sem-reuso; validade exige leitura visual do rodapé",
  });
  await baixarEncartes({
    rede: "Recibom", source: SOURCE, descobrir, args, hostsPermitidos: [HOST],
    extra: { cidade: "recife-pe", mercado: "recibom", loja: "torre" },
  });
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { descobrir, parsearTabloide };
