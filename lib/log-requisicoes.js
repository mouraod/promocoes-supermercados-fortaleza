"use strict";

// Log local de requisições da coleta: uma linha JSON por requisição em
// `downloads.jsonl`, ao lado do manifest.json da rodada.
//   {ts, rede, etapa, url, status, bytes, ms, tentativa, erro}
// `etapa` é descoberta | sonda | pagina | pdf.
//
// O arquivo tem URL e fica SÓ no disco local. O canal de eventos
// (lib/eventos.js) continua sanitizado e nunca recebe nada daqui.
//
// A pasta da rodada é configurada pelo pipeline antes da descoberta. Se alguém
// registrar antes disso (adaptador usado fora do pipeline), as linhas ficam em
// memória e saem quando a pasta for conhecida.

const fs = require("fs");
const path = require("path");

const NOME_ARQUIVO = "downloads.jsonl";
const ETAPAS = new Set(["descoberta", "sonda", "pagina", "pdf"]);

const estado = { rede: null, destino: null, pendentes: [] };

function caminhoDoLog(destino) {
  return path.join(destino, NOME_ARQUIVO);
}

function gravar(destino, linhas) {
  if (linhas.length === 0) return;
  try {
    fs.mkdirSync(destino, { recursive: true });
    fs.appendFileSync(caminhoDoLog(destino), linhas.map((l) => `${JSON.stringify(l)}\n`).join(""));
  } catch {
    // O log nunca derruba a coleta.
  }
}

// Define a rede e a pasta da rodada e descarrega o que estava em memória.
function configurar({ rede, destino }) {
  estado.rede = rede ?? null;
  estado.destino = destino ?? null;
  if (estado.destino && estado.pendentes.length > 0) {
    const pendentes = estado.pendentes;
    estado.pendentes = [];
    gravar(estado.destino, pendentes.map((l) => ({ ...l, rede: l.rede ?? estado.rede })));
  }
}

function registrar({ etapa, url, status = null, bytes = null, ms = null, tentativa = 1, erro = null }) {
  if (!ETAPAS.has(etapa)) throw new Error(`etapa de log desconhecida: ${etapa}`);
  const linha = {
    ts: new Date().toISOString(),
    rede: estado.rede,
    etapa,
    url: String(url ?? ""),
    status: status ?? null,
    bytes: bytes ?? null,
    ms: ms === null || ms === undefined ? null : Math.round(ms),
    tentativa,
    erro: erro === null || erro === undefined ? null : String(erro),
  };
  if (estado.destino) gravar(estado.destino, [linha]);
  else estado.pendentes.push(linha);
  return linha;
}

// Lê o log de uma pasta de rodada (usado nos testes e no resumo).
function lerLog(destino) {
  try {
    return fs.readFileSync(caminhoDoLog(destino), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

// Só para testes: zera o estado do módulo.
function reiniciar() {
  estado.rede = null;
  estado.destino = null;
  estado.pendentes = [];
}

module.exports = { NOME_ARQUIVO, caminhoDoLog, configurar, lerLog, registrar, reiniciar };
