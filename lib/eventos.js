"use strict";

// Canal interno de eventos de progresso entre processos. Cada evento é uma
// linha no stderr: `@@mmb-evento {json compacto}`. Só é emitido quando o
// processo pai pede (MMB_EVENTOS=1), para não poluir a saída de quem roda
// uma skill isolada no terminal. Stdout nunca recebe eventos.
//
// O payload é montado por lista de campos permitidos: nunca leva URL,
// cabeçalho ou texto bruto de erro.

const PREFIXO = "@@mmb-evento ";

const EVENTOS = new Set([
  "download_iniciado",
  "download_ok",
  "download_falhou",
  "conversao_iniciada",
  "conversao_ok",
  "conversao_falhou",
]);

function eventosLigados(env = process.env) {
  return env.MMB_EVENTOS === "1";
}

// Mensagem curta e sem nada que identifique origem ou credencial.
function sanitizarErro(texto) {
  return String(texto ?? "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]")
    .replace(/\bbearer\s+\S+/gi, "bearer [omitido]")
    .replace(/\b(authorization|token|api[_-]?key|cookie|senha|password)\b\s*[:=]\s*(bearer\s+)?\S+/gi, "$1 [omitido]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 200);
}

function montarEvento(bruto) {
  if (!bruto || typeof bruto !== "object" || !EVENTOS.has(bruto.evento)) return null;
  const evento = { rede: String(bruto.rede ?? ""), evento: bruto.evento };
  for (const campo of ["ms", "espera_ms"]) {
    if (bruto[campo] === undefined) continue;
    const valor = Number(bruto[campo]);
    if (Number.isFinite(valor) && valor >= 0) evento[campo] = Math.round(valor);
  }
  if (bruto.erro !== undefined && bruto.erro !== null) evento.erro = sanitizarErro(bruto.erro);
  return evento;
}

function formatarEvento(bruto) {
  const evento = montarEvento(bruto);
  return evento ? `${PREFIXO}${JSON.stringify(evento)}` : null;
}

function emitirEvento(bruto, { env = process.env, stderr = process.stderr } = {}) {
  if (!eventosLigados(env)) return;
  const linha = formatarEvento(bruto);
  if (linha) stderr.write(`${linha}\n`);
}

// Devolve o evento já sanitizado se a linha for do canal; null caso contrário.
function lerEvento(linha) {
  const texto = String(linha ?? "").replace(/\r$/, "");
  if (!texto.startsWith(PREFIXO)) return null;
  try {
    return montarEvento(JSON.parse(texto.slice(PREFIXO.length)));
  } catch {
    return null;
  }
}

// Lê um fluxo de texto linha a linha conforme chega. Linhas do canal vão para
// `aoEvento`; o resto (inclusive linha incompleta no fim) vai para `aoTexto`
// com a quebra de linha original, para o acumulado continuar igual ao de hoje.
function lerLinhas(fluxo, { aoEvento, aoTexto }) {
  let pendente = "";
  fluxo.setEncoding("utf8");
  fluxo.on("data", (chunk) => {
    pendente += chunk;
    let quebra = pendente.indexOf("\n");
    while (quebra >= 0) {
      const linha = pendente.slice(0, quebra);
      pendente = pendente.slice(quebra + 1);
      if (linha.startsWith(PREFIXO)) {
        const evento = lerEvento(linha);
        if (evento) aoEvento(evento);
      } else {
        aoTexto(`${linha}\n`);
      }
      quebra = pendente.indexOf("\n");
    }
  });
  fluxo.on("end", () => {
    if (!pendente) return;
    if (pendente.startsWith(PREFIXO)) {
      const evento = lerEvento(pendente);
      if (evento) aoEvento(evento);
    } else {
      aoTexto(pendente);
    }
    pendente = "";
  });
}

module.exports = {
  PREFIXO,
  emitirEvento,
  eventosLigados,
  formatarEvento,
  lerEvento,
  lerLinhas,
  sanitizarErro,
};
