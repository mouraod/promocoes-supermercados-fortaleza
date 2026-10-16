"use strict";

// Pipeline compartilhado de download de encartes. Cada rede (Cometa, São
// Luiz, ...) contribui só com um adapter de descoberta (`descobrir`) que
// fala com o site dela e devolve dados; este módulo cuida de todo o resto:
// layout de pastas, download com limite de tamanho, rasterização de PDF,
// reaproveitamento de rodadas anteriores, manifest e resumo.
//
// Contrato do `descobrir(args)`:
//   [
//     {
//       slug: "id-nome-do-encarte",            // já em kebab-case
//       pdf: { url, manter? },                  // OU paginas: [...]
//       paginas: [{ url, ext?, arquivo? }],     // quando não há PDF
//       meta: { ...campos que vão verbatim para o manifest },
//     },
//   ]
// `pdf.manter` true guarda o PDF em PDF/ (Cometa, Atacadão); sem ele o PDF
// vai para um tmpdir e é apagado após rasterizar (Super do Povo).

const { createHash } = require("node:crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { Readable, Transform } = require("stream");
const { pipeline: streamPipeline } = require("stream/promises");
const { reaproveitarPaginas, linkOuCopia } = require("./reuso");
const { emitirEvento } = require("./eventos");
const { converterPaginasPdf, criarSemaforo } = require("./conversao");

const execFileAsync = promisify(execFile);

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 75 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MIN_DPI = 72;
const MAX_DPI = 400;
// Downloads simultâneos dentro de uma rede (PDFs; um encarte de imagens ocupa
// uma vaga). MMB_DOWNLOAD_PDF_PARALELO é seam interno, só para testes ou para
// reduzir sob pressão: aceita inteiro positivo e nunca passa deste limite.
const DOWNLOADS_PDF_PARALELOS = 4;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// ─── helpers de domínio ───────────────────────────────────────────────────────

function dateFolderName(date) {
  const d = String(date.getDate()).padStart(2, "0");
  return `${d}-${MESES[date.getMonth()]}`;
}

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[ _.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "encarte";
}

function todayISO(date = new Date()) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

function ddmm(isoDate) {
  const [, m, d] = isoDate.split("-");
  return `${d}-${m}`;
}

// "01-08 a 07-08" quando o mês não muda; "29-07 a 04-08" quando muda.
function vigenciaSlug(start, end) {
  const inicio = start.slice(0, 10);
  const fim = end.slice(0, 10);
  const startMonth = inicio.slice(0, 7);
  const endMonth = fim.slice(0, 7);
  const startDay = inicio.slice(8, 10);
  if (startMonth === endMonth) {
    return `${startDay}-a-${ddmm(fim)}`;
  }
  return `${ddmm(inicio)}-a-${ddmm(fim)}`;
}

function extFromUrl(url) {
  const clean = url.split("?")[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "jpg";
}

// ─── download ─────────────────────────────────────────────────────────────────

async function isValidPdf(filePath) {
  const handle = await fs.open(filePath, "r");
  try {
    const header = Buffer.alloc(5);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.toString("ascii") === "%PDF-";
  } finally {
    await handle.close();
  }
}

// tipo "pdf" valida content-type e magic number; "imagem" valida image/jpeg|png;
// hostsPermitidos trava de onde o download pode vir (confiança por rede).
// `signal` (opcional) interrompe o download em andamento: o `.part` é apagado
// e o nome final nunca recebe arquivo parcial.
async function baixarArquivo(url, filePath, { tipo = "arquivo", hostsPermitidos, signal } = {}) {
  if (signal?.aborted) throw erroInterrompido(signal);
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 0 && (tipo !== "pdf" || await isValidPdf(filePath))) return false;
    await fs.rm(filePath, { force: true });
  } catch {
    // não existe, continuar
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") throw new Error(`URL de download não segura: ${url}`);
  if (hostsPermitidos && !hostsPermitidos.includes(parsedUrl.hostname)) {
    throw new Error(`URL de download não permitida: ${url}`);
  }

  if (signal?.aborted) throw erroInterrompido(signal);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const aoInterromper = () => controller.abort(erroInterrompido(signal));
  signal?.addEventListener("abort", aoInterromper, { once: true });
  const temporaryPath = `${filePath}.part`;

  try {
    const response = await fetch(parsedUrl, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Falha ${response.status} ao baixar ${url}`);
    if (!response.body) throw new Error(`Resposta sem conteúdo ao baixar ${url}`);

    if (tipo === "pdf" && !/^(application\/pdf|application\/octet-stream)(;|$)/i.test(response.headers.get("content-type") || "")) {
      throw new Error(`Resposta não é um PDF: ${url}`);
    }
    if (tipo === "imagem") {
      // CDN de imagem às vezes não manda content-type; só rejeita quando o
      // servidor afirma com clareza que não é imagem (ex: página de erro HTML)
      const contentType = response.headers.get("content-type");
      if (contentType && !/^image\//i.test(contentType)) {
        throw new Error(`Resposta não é uma imagem (${contentType}): ${url}`);
      }
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Arquivo excede o limite de ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB: ${url}`);
    }

    let downloadedBytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > MAX_DOWNLOAD_BYTES) {
          controller.abort();
          callback(new Error(`Arquivo excede o limite de ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB: ${url}`));
          return;
        }
        callback(null, chunk);
      },
    });

    await fs.rm(temporaryPath, { force: true });
    await streamPipeline(Readable.fromWeb(response.body), limiter, fsSync.createWriteStream(temporaryPath, { flags: "wx" }));
    if (tipo === "pdf" && !await isValidPdf(temporaryPath)) throw new Error(`PDF inválido: ${url}`);
    await fs.rename(temporaryPath, filePath);
    return true;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", aoInterromper);
  }
}

function erroInterrompido(signal) {
  return signal?.reason instanceof Error ? signal.reason : new Error("download interrompido");
}

function downloadsPdfParalelos(env = process.env) {
  const bruto = env.MMB_DOWNLOAD_PDF_PARALELO;
  if (bruto === undefined || bruto === "") return DOWNLOADS_PDF_PARALELOS;
  if (!/^[1-9][0-9]*$/.test(String(bruto))) {
    throw new Error("MMB_DOWNLOAD_PDF_PARALELO deve ser um inteiro positivo");
  }
  return Math.min(DOWNLOADS_PDF_PARALELOS, Number(bruto));
}

// ─── PDF / poppler ────────────────────────────────────────────────────────────

async function contarPaginasPdf(pdfPath) {
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath]);
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error(`Não foi possível ler nº de páginas de ${pdfPath}`);
  const pages = parseInt(match[1], 10);
  if (pages > MAX_PDF_PAGES) throw new Error(`PDF excede o limite de ${MAX_PDF_PAGES} páginas: ${pdfPath}`);
  return pages;
}

// Uma página por pdftoppm, com os mesmos parâmetros de sempre. Usa spawn e
// só resolve no "close": com `signal` abortado o pdftoppm recebe SIGTERM (e
// SIGKILL após 2 s), e a promessa só termina depois que ele saiu de fato,
// para ninguém apagar o preparo com um pdftoppm ainda escrevendo.
function rasterizarPagina(pdfPath, outBase, page, dpi, { signal } = {}) {
  // -singlefile: gera exatamente <outBase>.jpg (sem sufixo de página)
  const argumentos = [
    "-jpeg",
    "-r", String(dpi),
    "-f", String(page),
    "-l", String(page),
    "-singlefile",
    pdfPath,
    outBase,
  ];
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("conversão interrompida"));
      return;
    }
    const proc = spawn("pdftoppm", argumentos, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let erroSpawn = null;
    let forcar = null;
    let encerrado = false;
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => { if (stderr.length < 2000) stderr += chunk; });
    const aoAbortar = () => {
      proc.kill("SIGTERM");
      forcar = setTimeout(() => { if (!encerrado) proc.kill("SIGKILL"); }, 2000);
      forcar.unref();
    };
    signal?.addEventListener("abort", aoAbortar, { once: true });
    const terminar = (erro) => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(forcar);
      signal?.removeEventListener("abort", aoAbortar);
      if (erro) reject(erro);
      else resolve();
    };
    proc.on("error", (erro) => {
      erroSpawn = erro;
      // Nem chegou a iniciar: não haverá processo a esperar.
      if (proc.pid === undefined) terminar(erro);
    });
    proc.on("close", (codigo, sinal) => {
      if (erroSpawn) return terminar(erroSpawn);
      if (signal?.aborted) {
        return terminar(signal.reason instanceof Error ? signal.reason : new Error("conversão interrompida"));
      }
      if (codigo === 0) return terminar(null);
      terminar(new Error(`Command failed: pdftoppm ${argumentos.join(" ")} (${codigo ?? sinal})\n${stderr.trim()}`));
    });
  });
}

function checarPoppler() {
  const missing = [];
  for (const bin of ["pdfinfo", "pdftoppm"]) {
    try {
      require("child_process").execFileSync("which", [bin], { stdio: "ignore" });
    } catch {
      missing.push(bin);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Dependência(s) ausente(s): ${missing.join(", ")}.\n` +
      `Instale com: brew install poppler`
    );
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

// Flags padrão: --base, --output, --help. Cada rede lista em `aceitas` as
// extras que o script dela conhece; `padroes` injeta defaults (ex: --loja).
async function parsearArgs(argv, { aceitas = [], padroes = {}, ajuda } = {}) {
  const args = {
    base: path.join(os.homedir(), "Downloads", "Encartes"),
    output: null,
    onlyNewest: false,
    semReuso: false,
    all: false,
    dryRun: false,
    ...padroes,
  };
  if (aceitas.includes("dpi")) args.dpi = args.dpi ?? 200;

  const aceitasSet = new Set(aceitas);
  const comValor = new Set(["base", "output", "dpi", "loja", "url"]);
  const semValor = { "only-newest": "onlyNewest", "sem-reuso": "semReuso", all: "all", "dry-run": "dryRun" };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const nome = arg.replace(/^--/, "");
    if (arg === "--help" || arg === "-h") {
      if (ajuda) console.log(typeof ajuda === "function" ? ajuda() : ajuda);
      process.exit(0);
    } else if (nome === "base" || nome === "output") {
      args[nome] = argv[++i];
    } else if (comValor.has(nome) && aceitasSet.has(nome)) {
      args[nome] = nome === "dpi" ? parseInt(argv[++i], 10) : argv[++i];
    } else if (semValor[nome]) {
      if (!aceitasSet.has(nome)) throw new Error(`Argumento desconhecido: ${arg}`);
      args[semValor[nome]] = true;
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }

  if (aceitas.includes("dpi") && (!Number.isInteger(args.dpi) || args.dpi < MIN_DPI || args.dpi > MAX_DPI)) {
    throw new Error(`--dpi deve ser um inteiro entre ${MIN_DPI} e ${MAX_DPI}`);
  }
  return args;
}

// ─── o pipeline ───────────────────────────────────────────────────────────────

function nomeArquivoPagina(encarte, indice, pagina) {
  if (pagina.arquivo) return pagina.arquivo;
  const numero = String(indice + 1).padStart(2, "0");
  const ext = pagina.ext ?? extFromUrl(pagina.url);
  return `${encarte.slug}-pagina-${numero}.${ext}`;
}

async function baixarPaginasEmPool(paginas, concorrencia, baixar) {
  let proxima = 0;
  let novas = 0;
  let puladas = 0;
  let erro = null;

  async function worker() {
    while (!erro) {
      const pagina = paginas[proxima++];
      if (!pagina) return;
      try {
        const baixou = await baixar(pagina);
        if (baixou) novas += 1;
        else puladas += 1;
      } catch (causa) {
        erro = causa;
      }
    }
  }

  const workers = Math.max(1, Math.min(concorrencia, paginas.length));
  await Promise.all(Array.from({ length: workers }, worker));
  if (erro) throw erro;
  return { novas, puladas };
}

/**
 * Baixa os encartes de uma rede usando o adapter `descobrir`. Escreve em
 * <base>/<rede>/DD-Mês/ (ou args.output), grava manifest.json e imprime o
 * resumo. Retorna { destino, manifest }.
 *
 * deps é seam interno para testes: injete baixarArquivo, contarPaginasPdf,
 * rasterizarPagina e checarPoppler para rodar sem rede nem poppler, e
 * adquirirVagaConversao para trocar o orçamento global de conversões.
 */
async function baixarEncartes({
  rede,
  source,
  descobrir,
  args,
  extra = {},
  hostsPermitidos,
  concorrencia = 1,
  agora = new Date(),
  deps = {},
}) {
  const {
    baixarArquivo: baixar = baixarArquivo,
    contarPaginasPdf: contarPaginas = contarPaginasPdf,
    rasterizarPagina: rasterizar = rasterizarPagina,
    checarPoppler: checarDeps = checarPoppler,
    adquirirVagaConversao: adquirirVaga,
  } = deps;

  // Valida o seam antes de qualquer trabalho.
  const limiteDownloads = downloadsPdfParalelos();

  let encartes = await descobrir(args);
  if (!Array.isArray(encartes) || encartes.length === 0) {
    throw new Error("Nenhum encarte encontrado. Verifique se o site está acessível.");
  }
  for (const e of encartes) {
    if (!e.slug || (!e.pdf && !Array.isArray(e.paginas))) {
      throw new Error(`Encarte malformado no adapter (slug=${e.slug}): precisa de pdf ou paginas.`);
    }
  }

  // Fortaleza conserva a identidade legada; outras praças exigem origem explícita.
  const escopado = extra.cidade && extra.cidade !== "fortaleza-ce";
  if (escopado) {
    if (!extra.loja || !source) throw new Error("Captura por cidade exige loja e fonte");
    const hoje = todayISO(agora);
    encartes = encartes.filter((e) => !e.meta?.vigencia ||
      (e.meta.vigencia.de <= hoje && e.meta.vigencia.ate >= hoje)).map((e) => {
      const campanha = String(e.meta?.campanha ?? e.meta?.id ?? e.meta?.id_encarte ?? e.pdf?.url ?? "");
      if (!campanha) throw new Error("Captura por cidade exige identidade de campanha");
      const identidade = { cidade: extra.cidade, loja: extra.loja, fonte: source, campanha };
      const hash = createHash("sha256").update(JSON.stringify(identidade)).digest("hex");
      return { ...e, slug: `${e.slug}-${hash}`, meta: { ...e.meta, identidade } };
    });
  }
  if (encartes.length === 0) throw new Error("Nenhum encarte vigente encontrado.");

  const dataLabel = dateFolderName(agora);
  const destino = args.output ?? path.join(args.base, rede, dataLabel);
  const jpgDir = path.join(destino, "JPG");
  const pdfDir = path.join(destino, "PDF");
  const mantemPdf = encartes.some((e) => e.pdf?.manter);
  const rasteriza = encartes.some((e) => e.pdf);

  await fs.mkdir(jpgDir, { recursive: true });
  if (mantemPdf) await fs.mkdir(pdfDir, { recursive: true });
  if (rasteriza) checarDeps();

  const tmpDir = rasteriza && !mantemPdf ? await fs.mkdtemp(path.join(os.tmpdir(), "encartes-")) : null;

  // Medição de conversão (tempo de parede): cada PDF é convertido num lote
  // com páginas em paralelo, e lotes de PDFs diferentes podem se sobrepor
  // (cada PDF converte assim que termina de baixar). Conta-se a união dos
  // intervalos: o relógio só corre enquanto há pelo menos um lote ativo, sem
  // somar lotes ou pdftoppm simultâneos. Só emite eventos se houve conversão.
  const conversao = { iniciada: false, ms: 0, ativas: 0, inicioTrecho: 0 };
  async function converterMedido(opcoes) {
    if (!conversao.iniciada) {
      conversao.iniciada = true;
      emitirEvento({ rede, evento: "conversao_iniciada" });
    }
    if (conversao.ativas === 0) conversao.inicioTrecho = performance.now();
    conversao.ativas += 1;
    try {
      return await converterPaginasPdf({ ...opcoes, rasterizar, adquirirVaga });
    } finally {
      conversao.ativas -= 1;
      if (conversao.ativas === 0) conversao.ms += performance.now() - conversao.inicioTrecho;
    }
  }
  let concluiu = false;

  // Downloads de PDF em paralelo (até `limiteDownloads`) dentro da rede. Cada
  // encarte vira uma tarefa com resultado guardado pelo seu índice, então o
  // manifest sai na ordem de descoberta, igual ao sequencial. Um encarte de
  // imagens ocupa uma vaga e roda em linha, como antes.
  //
  // Colisão de slug (ex.: dois encartes do Mateus com o mesmo slug): decidida
  // antes de lançar qualquer download. A ocorrência N de um slug só começa
  // depois que a N-1 terminou, então ninguém escreve no mesmo caminho ao mesmo
  // tempo e o resultado é o do sequencial: a primeira baixa e converte; a
  // seguinte acha o PDF e as páginas prontos e é pulada. (Isso perde as
  // ofertas do segundo encarte, como hoje; não é corrigido aqui.)
  //
  // Falha: a primeira falha interrompe os downloads em andamento e impede
  // novos; conversões já iniciadas terminam (publicam tudo ou nada). O
  // manifest não é gravado e a falha original sobe, como no sequencial.
  const vagasDownload = criarSemaforo(limiteDownloads);
  const controle = new AbortController();
  let primeiroErro = null;
  const falhar = (erro) => {
    if (primeiroErro) return;
    primeiroErro = erro;
    controle.abort(erro);
  };
  const interrompido = () => {
    if (controle.signal.aborted) throw primeiroErro ?? new Error("download interrompido");
  };

  const colisoes = new Map(); // índice -> índice da ocorrência anterior do mesmo slug
  const anteriorPorSlug = new Map();
  for (const [indice, encarte] of encartes.entries()) {
    const anterior = anteriorPorSlug.get(encarte.slug);
    if (anterior !== undefined) colisoes.set(indice, anterior);
    anteriorPorSlug.set(encarte.slug, indice);
  }

  const resultados = new Array(encartes.length);

  async function processarEncarte(encarte, indice) {
    const { slug, pdf, paginas, meta = {} } = encarte;

    if (!args.semReuso && !args.output && (!escopado || meta.vigencia)) {
      const reuso = await reaproveitarPaginas({
        redeDir: path.join(args.base, rede),
        dataAtual: dataLabel,
        slug,
        identidade: meta.identidade,
        jpgDirDestino: jpgDir,
        paginasEsperadas: Array.isArray(paginas) ? paginas.length : undefined,
      });

      if (reuso) {
        if (pdf?.manter) {
          const pdfOrigem = path.join(reuso.origemDir, "PDF", `${slug}.pdf`);
          try {
            await fs.access(pdfOrigem);
            await linkOuCopia(pdfOrigem, path.join(pdfDir, `${slug}.pdf`));
          } catch { /* sem PDF na origem, seguir sem ele */ }
        }
        resultados[indice] = {
          entrada: { ...meta, slug, paginas: reuso.paginas, reaproveitado: true },
          novas: 0,
          puladas: 0,
          reaproveitadas: reuso.paginas,
        };
        return;
      }
    }

    interrompido();
    if (pdf) {
      const pdfPath = pdf.manter ? path.join(pdfDir, `${slug}.pdf`) : path.join(tmpDir, `${slug}.pdf`);
      try {
        let baixou;
        const liberar = await vagasDownload.adquirir(controle.signal);
        try {
          interrompido();
          baixou = await baixar(pdf.url, pdfPath, { tipo: "pdf", hostsPermitidos, signal: controle.signal });
        } finally {
          liberar();
        }
        interrompido();
        const numPaginas = await contarPaginas(pdfPath);

        let puladas = 0;
        const aConverter = [];
        for (let p = 1; p <= numPaginas; p += 1) {
          const nome = `${slug}-pagina-${String(p).padStart(2, "0")}`;

          let pulada = false;
          try {
            const stat = await fs.stat(path.join(jpgDir, `${nome}.jpg`));
            if (stat.size > 0) pulada = true;
          } catch { /* não existe */ }

          if (pulada) puladas += 1;
          else aConverter.push({ numero: p, nome });
        }

        // Começa assim que ESTE PDF baixou, sem esperar os demais; páginas em
        // paralelo no orçamento global; publica tudo ou nada.
        if (aConverter.length > 0) {
          interrompido();
          await converterMedido({ pdfPath, jpgDir, preparoDir: destino, paginas: aConverter, dpi: args.dpi });
        }

        const saida = { ...meta, slug, paginas: numPaginas };
        if (pdf.manter) {
          saida.pdf = `PDF/${slug}.pdf`;
          saida.pdfBaixado = baixou;
        }
        resultados[indice] = { entrada: saida, novas: aConverter.length, puladas, reaproveitadas: 0 };
      } finally {
        if (!pdf.manter) await fs.rm(pdfPath, { force: true });
      }
    } else {
      const itens = paginas.map((pagina, i) => ({
        pagina,
        caminho: path.join(jpgDir, nomeArquivoPagina(encarte, i, pagina)),
      }));

      const liberar = await vagasDownload.adquirir(controle.signal);
      let contagem;
      try {
        interrompido();
        contagem = await baixarPaginasEmPool(itens, concorrencia, async (item) => {
          const opcoes = { hostsPermitidos, signal: controle.signal };
          if (/\.(jpe?g|png|webp)(\?|$)/i.test(item.pagina.url)) opcoes.tipo = "imagem";
          return baixar(item.pagina.url, item.caminho, opcoes);
        });
      } finally {
        liberar();
      }

      resultados[indice] = {
        entrada: { ...meta, slug, paginas: paginas.length },
        novas: contagem.novas,
        puladas: contagem.puladas,
        reaproveitadas: 0,
      };
    }
  }

  const tarefas = new Array(encartes.length);
  try {
    for (const [indice, encarte] of encartes.entries()) {
      if (controle.signal.aborted) break;
      const anterior = colisoes.has(indice) ? tarefas[colisoes.get(indice)] : null;
      tarefas[indice] = (async () => {
        if (anterior) await anterior; // tarefas nunca rejeitam (falhar captura)
        interrompido();
        await processarEncarte(encarte, indice);
      })().catch(falhar);
      // Reuso e imagens seguem em linha, como antes; só PDFs ficam em voo.
      if (!encarte.pdf) await tarefas[indice];
    }
    // Espera todas, inclusive as interrompidas, antes de apagar tmpDir.
    await Promise.all(tarefas.filter(Boolean));
    if (primeiroErro) throw primeiroErro;
    concluiu = true;
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    if (conversao.iniciada) {
      emitirEvento({ rede, evento: concluiu ? "conversao_ok" : "conversao_falhou", ms: conversao.ms });
    }
  }

  const manifestEntries = resultados.map((r) => r.entrada);
  let totalNovas = 0;
  let totalPuladas = 0;
  let totalReaproveitadas = 0;
  for (const r of resultados) {
    totalNovas += r.novas;
    totalPuladas += r.puladas;
    totalReaproveitadas += r.reaproveitadas;
  }

  const totalPaginas = totalNovas + totalPuladas + totalReaproveitadas;
  const manifest = {
    ...extra,
    rede,
    data: dataLabel,
    ...(rasteriza ? { dpi: args.dpi } : {}),
    ...(source !== undefined ? { source } : {}),
    downloadedAt: agora.toISOString(),
    totalEncartes: manifestEntries.length,
    totalPaginas,
    encartes: manifestEntries,
  };

  await fs.writeFile(path.join(destino, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`${rede} | ${dataLabel}${rasteriza ? ` @${args.dpi}dpi` : ""}`);
  console.log(`Encartes: ${manifestEntries.length} | Páginas: ${totalPaginas} (${totalNovas} novas, ${totalPuladas} puladas, ${totalReaproveitadas} reaproveitadas)`);
  console.log(`Destino: ${destino}`);

  return { destino, manifest };
}

module.exports = {
  baixarArquivo,
  baixarEncartes,
  baixarPaginasEmPool,
  checarPoppler,
  contarPaginasPdf,
  dateFolderName,
  downloadsPdfParalelos,
  extFromUrl,
  parsearArgs,
  rasterizarPagina,
  slugify,
  todayISO,
  vigenciaSlug,
};
