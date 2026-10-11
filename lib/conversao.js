"use strict";

// Conversão de páginas de PDF em paralelo (F4), com orçamento global.
//
// Orçamento: no máximo max(1, núcleos - 1) pdftoppm ao mesmo tempo, somando
// todas as redes e todos os PDFs. Cada rede roda num processo filho do
// baixar-todos.js, então um semáforo só em memória daria esse limite por
// processo. Por isso há dois modos, com a mesma interface:
//   - filho do baixar-todos (MMB_CONVERSAO_IPC=1 e canal IPC aberto): cada
//     vaga é pedida ao pai pelo canal IPC; o pai mantém o único contador
//     (criarCorretorConversao) e devolve as vagas de um filho que morre.
//   - skill rodada isolada: semáforo em memória do próprio processo.
// MMB_CONVERSOES_MAX é seam interno (testes, ou reduzir sob pressão de
// memória/CPU): só reduz o orçamento, nunca aumenta.
//
// Publicação: as páginas são geradas numa pasta de preparo irmã de JPG/ e só
// vão para JPG/ (rename, mesmo sistema de arquivos) depois que TODAS
// concluírem. Se uma falhar, as demais são interrompidas, nenhuma é publicada
// e o preparo é apagado: JPG/ nunca recebe página parcial que a próxima
// rodada tomaria por completa.

const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const MSG_PEDIR = "mmb-conversao-pedir";
const MSG_VAGA = "mmb-conversao-vaga";
const MSG_LIBERAR = "mmb-conversao-liberar";

function nucleosDisponiveis() {
  return typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
}

function orcamentoConversoes(env = process.env) {
  const padrao = Math.max(1, nucleosDisponiveis() - 1);
  const texto = String(env.MMB_CONVERSOES_MAX ?? "");
  if (/^[1-9][0-9]*$/.test(texto)) return Math.min(padrao, Number(texto));
  return padrao;
}

// ─── semáforo em memória ──────────────────────────────────────────────────────

function erroAbortado(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error("conversão interrompida");
}

function criarSemaforo(limite) {
  let ativos = 0;
  const fila = [];

  function conceder() {
    while (ativos < limite && fila.length > 0) {
      const pedido = fila.shift();
      ativos += 1;
      pedido.resolver();
    }
  }

  function adquirir(signal) {
    if (signal?.aborted) return Promise.reject(erroAbortado(signal));
    return new Promise((resolve, reject) => {
      let liberada = false;
      const liberar = () => {
        if (liberada) return;
        liberada = true;
        ativos -= 1;
        conceder();
      };
      const pedido = {
        resolver: () => {
          signal?.removeEventListener("abort", aoAbortar);
          resolve(liberar);
        },
      };
      function aoAbortar() {
        const i = fila.indexOf(pedido);
        if (i >= 0) fila.splice(i, 1);
        reject(erroAbortado(signal));
      }
      signal?.addEventListener("abort", aoAbortar, { once: true });
      fila.push(pedido);
      conceder();
    });
  }

  return {
    adquirir,
    get ativos() { return ativos; },
    get limite() { return limite; },
  };
}

// ─── vaga via pai (IPC) ───────────────────────────────────────────────────────

let semaforoLocal = null;
let sequencia = 0;
const pedidosRemotos = new Map();

function modoIpc(env = process.env) {
  return env.MMB_CONVERSAO_IPC === "1" && typeof process.send === "function" && process.connected === true;
}

function aoMensagemDoPai(mensagem) {
  if (!mensagem || mensagem.mmb !== MSG_VAGA) return;
  const pedido = pedidosRemotos.get(mensagem.id);
  if (!pedido) return;
  pedidosRemotos.delete(mensagem.id);
  pararDeOuvirSeOcioso();
  if (pedido.cancelado) {
    // Pedido abortado enquanto esperava: devolve a vaga na hora.
    enviarAoPai({ mmb: MSG_LIBERAR });
    return;
  }
  pedido.resolver();
}

function aoDesconectarDoPai() {
  for (const [id, pedido] of pedidosRemotos) {
    pedidosRemotos.delete(id);
    if (!pedido.cancelado) pedido.rejeitar(new Error("orquestrador desconectou durante a conversão"));
  }
  pararDeOuvirSeOcioso();
}

// O listener de "message" mantém o processo vivo; só fica ligado enquanto há
// pedido pendente, para a rede terminar sozinha como antes.
function ouvirPai() {
  if (pedidosRemotos.size > 0) return;
  process.on("message", aoMensagemDoPai);
  process.on("disconnect", aoDesconectarDoPai);
}

function pararDeOuvirSeOcioso() {
  if (pedidosRemotos.size > 0) return;
  process.removeListener("message", aoMensagemDoPai);
  process.removeListener("disconnect", aoDesconectarDoPai);
}

function enviarAoPai(mensagem, aoErro = () => {}) {
  try {
    process.send(mensagem, (erro) => { if (erro) aoErro(erro); });
  } catch (erro) {
    aoErro(erro);
  }
}

function adquirirRemoto(signal) {
  if (signal?.aborted) return Promise.reject(erroAbortado(signal));
  return new Promise((resolve, reject) => {
    sequencia += 1;
    const id = sequencia;
    let liberada = false;
    const liberar = () => {
      if (liberada) return;
      liberada = true;
      enviarAoPai({ mmb: MSG_LIBERAR });
    };
    const pedido = {
      cancelado: false,
      resolver: () => {
        signal?.removeEventListener("abort", aoAbortar);
        resolve(liberar);
      },
      rejeitar: (erro) => {
        signal?.removeEventListener("abort", aoAbortar);
        reject(erro);
      },
    };
    function aoAbortar() {
      // Continua registrado até a vaga chegar, para devolvê-la ao pai.
      pedido.cancelado = true;
      reject(erroAbortado(signal));
    }
    signal?.addEventListener("abort", aoAbortar, { once: true });
    ouvirPai();
    pedidosRemotos.set(id, pedido);
    enviarAoPai({ mmb: MSG_PEDIR, id }, (erro) => {
      if (!pedidosRemotos.has(id)) return;
      pedidosRemotos.delete(id);
      pararDeOuvirSeOcioso();
      if (!pedido.cancelado) pedido.rejeitar(erro);
    });
  });
}

// Vaga do orçamento global. Devolve a função que libera a vaga.
function adquirirVagaConversao(signal) {
  if (modoIpc()) return adquirirRemoto(signal);
  if (!semaforoLocal) semaforoLocal = criarSemaforo(orcamentoConversoes());
  return semaforoLocal.adquirir(signal);
}

// ─── lado do pai (baixar-todos.js) ────────────────────────────────────────────

// Contador único do orçamento para todos os filhos. Vagas de um filho que sai
// (normal, erro ou morto) voltam ao orçamento; pedidos dele na fila somem.
function criarCorretorConversao(limite) {
  let ativos = 0;
  let fila = [];
  const porFilho = new Map();

  function conceder() {
    while (ativos < limite && fila.length > 0) {
      const { filho, id } = fila.shift();
      if (!filho.connected) continue;
      ativos += 1;
      porFilho.set(filho, (porFilho.get(filho) ?? 0) + 1);
      // Se o envio falhar, o filho está saindo; o "exit" devolve a vaga.
      try { filho.send({ mmb: MSG_VAGA, id }, () => {}); } catch { /* idem */ }
    }
  }

  function anexar(filho) {
    filho.on("message", (mensagem) => {
      if (!mensagem || typeof mensagem !== "object") return;
      if (mensagem.mmb === MSG_PEDIR && Number.isSafeInteger(mensagem.id)) {
        fila.push({ filho, id: mensagem.id });
        conceder();
      } else if (mensagem.mmb === MSG_LIBERAR) {
        const detidas = porFilho.get(filho) ?? 0;
        if (detidas > 0) {
          porFilho.set(filho, detidas - 1);
          ativos -= 1;
        }
        conceder();
      }
    });
    filho.on("exit", () => {
      ativos -= porFilho.get(filho) ?? 0;
      porFilho.delete(filho);
      fila = fila.filter((pedido) => pedido.filho !== filho);
      conceder();
    });
  }

  return {
    anexar,
    get ativos() { return ativos; },
    get limite() { return limite; },
  };
}

// ─── conversão de um PDF ──────────────────────────────────────────────────────

/**
 * Converte as páginas pedidas de um PDF em paralelo, dentro do orçamento
 * global, e publica em `jpgDir` só depois de todas concluírem.
 *
 * paginas: [{ numero, nome }], onde `nome` é a base sem extensão
 * (ex.: "slug-pagina-03"); a saída final é `<jpgDir>/<nome>.jpg`, igual à
 * conversão sequencial. `preparoDir` precisa estar no mesmo sistema de
 * arquivos de `jpgDir` (o pipeline usa a pasta da rodada).
 */
async function converterPaginasPdf({
  pdfPath,
  jpgDir,
  preparoDir,
  paginas,
  dpi,
  rasterizar,
  adquirirVaga = adquirirVagaConversao,
}) {
  if (paginas.length === 0) return;
  const preparo = await fs.mkdtemp(path.join(preparoDir, ".convertendo-"));
  const controle = new AbortController();
  let primeiroErro = null;

  try {
    await Promise.all(paginas.map(async ({ numero, nome }) => {
      let liberar = null;
      try {
        liberar = await adquirirVaga(controle.signal);
        if (controle.signal.aborted) return;
        await rasterizar(pdfPath, path.join(preparo, nome), numero, dpi, { signal: controle.signal });
        const stat = await fs.stat(path.join(preparo, `${nome}.jpg`));
        if (stat.size === 0) throw new Error(`pdftoppm gerou página vazia (${numero})`);
      } catch (erro) {
        if (!primeiroErro) {
          primeiroErro = erro;
          controle.abort(erro);
        }
      } finally {
        if (liberar) liberar();
      }
    }));
    // Todas as tarefas já terminaram (inclusive os pdftoppm interrompidos).
    if (primeiroErro) throw primeiroErro;
    for (const { nome } of paginas) {
      await fs.rename(path.join(preparo, `${nome}.jpg`), path.join(jpgDir, `${nome}.jpg`));
    }
  } finally {
    await fs.rm(preparo, { recursive: true, force: true });
  }
}

module.exports = {
  adquirirVagaConversao,
  converterPaginasPdf,
  criarCorretorConversao,
  criarSemaforo,
  orcamentoConversoes,
};
