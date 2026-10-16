#!/usr/bin/env node
"use strict";

const path = require("node:path");
const os = require("node:os");

const { baixarEncartes, parsearArgs, todayISO } = require("../lib/pipeline");
const { mapearEncartes } = require("../mateus-encartes/download-encartes");
const HOST = "ofertas.novoatacarejo.com";
const PROXY = `https://${HOST}/api-proxy.php`;

async function descobrir(args, { fetch: buscar = fetch, hoje = todayISO() } = {}) {
  const loja = args.loja ?? "afogados";
  if (!/^[a-z0-9-]+$/.test(loja)) throw new Error("Slug de loja Novo inválido");
  async function consultar(endpoint) {
    const resposta = await buscar(`${PROXY}?endpoint=${encodeURIComponent(endpoint)}`, {
      headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000),
    });
    if (!resposta.ok) throw new Error(`Novo: HTTP ${resposta.status}`);
    const json = await resposta.json();
    if (json.status !== "success") throw new Error("Novo: resposta inesperada");
    return json.data;
  }
  const dadosLoja = await consultar(`/lojas/${loja}`);
  if (dadosLoja?.idloja !== loja || dadosLoja.cidade !== "recife" || !dadosLoja.marca) {
    throw new Error("Novo: loja/cidade/marca ausente ou divergente");
  }
  const itens = await consultar(`/encartes/pe/recife/${loja}?marca=${encodeURIComponent(dadosLoja.marca)}`);
  if (!Array.isArray(itens)) throw new Error("Novo: lista de encartes inválida");
  return mapearEncartes(itens, hoje)
    .filter((e) => e.meta.vigencia.de <= hoje)
    .map((e) => ({
      ...e,
      pdf: { ...e.pdf, url: e.pdf.url.replace("https://ofertasmateus.com/", `https://${HOST}/`) },
      meta: { ...e.meta, loja, marca_api: dadosLoja.marca },
    }));
}

async function main() {
  const args = await parsearArgs(process.argv.slice(2), {
    aceitas: ["loja", "dpi", "sem-reuso"], padroes: { loja: "afogados", base: path.join(os.homedir(), "Downloads/Encartes/Recife") },
    ajuda: "Novo: --loja afogados --base <raiz Recife> --dpi 200 --sem-reuso",
  });
  await baixarEncartes({
    rede: "NovoAtacarejo", source: `https://${HOST}/pe/recife/${args.loja}`,
    descobrir, args, hostsPermitidos: [HOST], extra: { cidade: "recife-pe", mercado: "novo-atacarejo", loja: args.loja },
  });
}
if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
module.exports = { descobrir };
