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

const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Readable, Transform } = require("stream");
const { pipeline: streamPipeline } = require("stream/promises");
const { reaproveitarPaginas, linkOuCopia } = require("./reuso");

const execFileAsync = promisify(execFile);

const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 75 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MIN_DPI = 72;
const MAX_DPI = 400;
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
async function baixarArquivo(url, filePath, { tipo = "arquivo", hostsPermitidos } = {}) {
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
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
  }
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

async function rasterizarPagina(pdfPath, outBase, page, dpi) {
  // -singlefile: gera exatamente <outBase>.jpg (sem sufixo de página)
  await execFileAsync("pdftoppm", [
    "-jpeg",
    "-r", String(dpi),
    "-f", String(page),
    "-l", String(page),
    "-singlefile",
    pdfPath,
    outBase,
  ]);
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
  const comValor = new Set(["base", "output", "dpi", "loja"]);
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
 * rasterizarPagina e checarPoppler para rodar sem rede nem poppler.
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
  } = deps;

  const encartes = await descobrir(args);
  if (!Array.isArray(encartes) || encartes.length === 0) {
    throw new Error("Nenhum encarte encontrado. Verifique se o site está acessível.");
  }
  for (const e of encartes) {
    if (!e.slug || (!e.pdf && !Array.isArray(e.paginas))) {
      throw new Error(`Encarte malformado no adapter (slug=${e.slug}): precisa de pdf ou paginas.`);
    }
  }

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

  const manifestEntries = [];
  let totalNovas = 0;
  let totalPuladas = 0;
  let totalReaproveitadas = 0;

  try {
    for (const encarte of encartes) {
      const { slug, pdf, paginas, meta = {} } = encarte;

      if (!args.semReuso && !args.output) {
        const reuso = await reaproveitarPaginas({
          redeDir: path.join(args.base, rede),
          dataAtual: dataLabel,
          slug,
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
          totalReaproveitadas += reuso.paginas;
          manifestEntries.push({ ...meta, slug, paginas: reuso.paginas, reaproveitado: true });
          continue;
        }
      }

      if (pdf) {
        const pdfPath = pdf.manter ? path.join(pdfDir, `${slug}.pdf`) : path.join(tmpDir, `${slug}.pdf`);
        try {
          const baixou = await baixar(pdf.url, pdfPath, { tipo: "pdf", hostsPermitidos });
          const numPaginas = await contarPaginas(pdfPath);

          for (let p = 1; p <= numPaginas; p += 1) {
            const outBase = path.join(jpgDir, `${slug}-pagina-${String(p).padStart(2, "0")}`);
            const outJpg = `${outBase}.jpg`;

            let pulada = false;
            try {
              const stat = await fs.stat(outJpg);
              if (stat.size > 0) pulada = true;
            } catch { /* não existe */ }

            if (pulada) {
              totalPuladas += 1;
            } else {
              await rasterizar(pdfPath, outBase, p, args.dpi);
              totalNovas += 1;
            }
          }

          const saida = { ...meta, slug, paginas: numPaginas };
          if (pdf.manter) {
            saida.pdf = `PDF/${slug}.pdf`;
            saida.pdfBaixado = baixou;
          }
          manifestEntries.push(saida);
        } finally {
          if (!pdf.manter) await fs.rm(pdfPath, { force: true });
        }
      } else {
        const itens = paginas.map((pagina, indice) => ({
          pagina,
          caminho: path.join(jpgDir, nomeArquivoPagina(encarte, indice, pagina)),
        }));

        const { novas, puladas } = await baixarPaginasEmPool(itens, concorrencia, async (item) => {
          const opcoes = { hostsPermitidos };
          if (/\.(jpe?g|png|webp)(\?|$)/i.test(item.pagina.url)) opcoes.tipo = "imagem";
          return baixar(item.pagina.url, item.caminho, opcoes);
        });

        totalNovas += novas;
        totalPuladas += puladas;
        manifestEntries.push({ ...meta, slug, paginas: paginas.length });
      }
    }
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
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
  extFromUrl,
  parsearArgs,
  rasterizarPagina,
  slugify,
  todayISO,
  vigenciaSlug,
};
