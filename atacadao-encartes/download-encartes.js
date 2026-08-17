#!/usr/bin/env node

const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { reaproveitarPaginas, linkOuCopia } = require("../lib/reuso");

const execFileAsync = promisify(execFile);

const LOJA_BASE = "https://www.atacadao.com.br/loja";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 75 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MIN_DPI = 72;
const MAX_DPI = 400;

const LOJAS_FORTALEZA = [
  "fortaleza-barra-do-ceara",
  "fortaleza-br-116",
  "fortaleza-aeroporto",
  "fortaleza-fatima",
  "fortaleza-maraponga-24hrs",
  "fortaleza-vila-peri",
  "fortaleza-osorio",
];

const MESES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function dateFolderName(date) {
  const d = String(date.getDate()).padStart(2, "0");
  return `${d}-${MESES[date.getMonth()]}`;
}

function todayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function ddmm(isoDate) {
  const [, m, d] = isoDate.split("-");
  return `${d}-${m}`;
}

function vigenciaSlug(start, end) {
  // start/end sao ISO full ("2026-08-01T00:00:00Z"), extrai so a data
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

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 _.-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ /g, "-")
    .toLowerCase();
}

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

async function downloadFile(url, filePath, type = "file") {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 0 && (type !== "pdf" || await isValidPdf(filePath))) return false;
    await fs.rm(filePath, { force: true });
  } catch {
    // nao existe, continuar
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") throw new Error(`URL de download nao segura: ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const temporaryPath = `${filePath}.part`;

  try {
    const response = await fetch(parsedUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Falha ${response.status} ao baixar ${url}`);
    if (!response.body) throw new Error(`Resposta sem conteudo ao baixar ${url}`);

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Arquivo excede o limite de ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB: ${url}`);
    }
    if (type === "pdf" && !/^(application\/pdf|application\/octet-stream)(;|$)/i.test(response.headers.get("content-type") || "")) {
      throw new Error(`Resposta nao e um PDF: ${url}`);
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
    await pipeline(Readable.fromWeb(response.body), limiter, fsSync.createWriteStream(temporaryPath, { flags: "wx" }));
    if (type === "pdf" && !await isValidPdf(temporaryPath)) throw new Error(`PDF invalido: ${url}`);
    await fs.rename(temporaryPath, filePath);
    return true;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function pdfPageCount(pdfPath) {
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath]);
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error(`Nao foi possivel ler nº de paginas de ${pdfPath}`);
  const pages = parseInt(match[1], 10);
  if (pages > MAX_PDF_PAGES) throw new Error(`PDF excede o limite de ${MAX_PDF_PAGES} paginas: ${pdfPath}`);
  return pages;
}

async function rasterizePage(pdfPath, outBase, page, dpi) {
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

function checkDependencies() {
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
      `Dependencia(s) ausente(s): ${missing.join(", ")}.\n` +
      `Instale com: brew install poppler`
    );
  }
}

// ─── fetch flyers do __NEXT_DATA__ ────────────────────────────────────────────

async function fetchFlyers(slug) {
  const url = `${LOJA_BASE}/${slug}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ${response.status} em ${url}: ${body.slice(0, 200)}`);
  }

  const html = await response.text();

  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    throw new Error(`__NEXT_DATA__ nao encontrado no HTML de ${url}`);
  }

  const nextData = JSON.parse(nextDataMatch[1]);
  const storeInfo = nextData?.props?.pageProps?.storeInfo;
  if (!storeInfo || !Array.isArray(storeInfo.flyers)) {
    throw new Error(`Estrutura de flyers nao encontrada no __NEXT_DATA__ de ${url}`);
  }

  const hoje = todayISO();
  const flyers = storeInfo.flyers.filter((f) => {
    if (f.exclude === true) return false;
    if (!f.validity?.initial || !f.validity?.final) return false;
    const finalDate = f.validity.final.slice(0, 10);
    return finalDate >= hoje;
  });

  return { flyers, storeName: storeInfo.loja || slug };
}

// ─── args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    loja: "fortaleza-aeroporto",
    base: path.join(os.homedir(), "Downloads", "Encartes"),
    output: null,
    dpi: 200,
    onlyNewest: false,
    semReuso: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--loja") args.loja = argv[++i];
    else if (arg === "--base") args.base = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--dpi") args.dpi = parseInt(argv[++i], 10);
    else if (arg === "--only-newest") args.onlyNewest = true;
    else if (arg === "--sem-reuso") args.semReuso = true;
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }

  if (!Number.isInteger(args.dpi) || args.dpi < MIN_DPI || args.dpi > MAX_DPI) {
    throw new Error(`--dpi deve ser um inteiro entre ${MIN_DPI} e ${MAX_DPI}`);
  }
  return args;
}

function printHelp() {
  console.log(`
Uso:
  node download-encartes.js [opcoes]

Opoes:
  --loja          Slug da loja. Padrao: fortaleza-aeroporto
  --base          Pasta raiz. Padrao: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --dpi           Resolucao de rasterizacao. Padrao: 200 (~2205x3150 px)
  --only-newest   Baixa apenas o encarte mais recente (util para teste)
  --sem-reuso     Nao reaproveita paginas de rodadas anteriores
  --help          Exibe esta mensagem

Lojas Fortaleza disponiveis:
  ${LOJAS_FORTALEZA.join("\n  ")}

Saida padrao:
  <base>/Atacadao/DD-Mes/PDF/<slug>.pdf
  <base>/Atacadao/DD-Mes/JPG/<slug>-pagina-NN.jpg

Requer poppler: brew install poppler
`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  checkDependencies();

  const args = parseArgs(process.argv.slice(2));
  const dateLabel = dateFolderName(new Date());
  const destino = args.output ?? path.join(args.base, "Atacadao", dateLabel);

  const pdfDir = path.join(destino, "PDF");
  const jpgDir = path.join(destino, "JPG");
  await fs.mkdir(pdfDir, { recursive: true });
  await fs.mkdir(jpgDir, { recursive: true });

  const { flyers, storeName } = await fetchFlyers(args.loja);
  if (flyers.length === 0) throw new Error(`Nenhum encarte vigente encontrado para a loja ${args.loja}.`);

  let encartes = flyers;
  if (args.onlyNewest) {
    encartes = [flyers.reduce((a, b) => (a.validity.final > b.validity.final ? a : b))];
  }

  const manifestEntries = [];
  let totalPaginasNovas = 0;
  let totalPaginasPuladas = 0;
  let totalPaginasReaproveitadas = 0;

  for (const f of encartes) {
    const name = f.name || "encarte";
    const slug = `${slugify(name)}-${vigenciaSlug(f.validity.initial, f.validity.final)}`;
    const pdfUrl = f.urlFinalDocument;
    const pdfPath = path.join(pdfDir, `${slug}.pdf`);

    // Tenta reaproveitar paginas de rodadas anteriores
    if (!args.semReuso && !args.output) {
      const reuso = await reaproveitarPaginas({
        redeDir: path.join(args.base, "Atacadao"),
        dataAtual: dateLabel,
        slug,
        jpgDirDestino: jpgDir,
      });

      if (reuso) {
        // PDF tambem e hardlinkado quando existe na origem
        const pdfOrigem = path.join(reuso.origemDir, "PDF", `${slug}.pdf`);
        try {
          await fs.access(pdfOrigem);
          await linkOuCopia(pdfOrigem, pdfPath);
        } catch { /* sem PDF na origem, seguir sem ele */ }

        totalPaginasReaproveitadas += reuso.paginas;

        manifestEntries.push({
          name,
          slug,
          vigencia: {
            de: f.validity.initial.slice(0, 10),
            ate: f.validity.final.slice(0, 10),
          },
          pdf: `PDF/${slug}.pdf`,
          pdfBaixado: false,
          paginas: reuso.paginas,
          reaproveitado: true,
        });
        continue;
      }
    }

    // Baixar PDF
    const pdfBaixado = await downloadFile(pdfUrl, pdfPath, "pdf");

    // Contar paginas
    const numPages = await pdfPageCount(pdfPath);

    // Rasterizar cada pagina
    for (let p = 1; p <= numPages; p += 1) {
      const outBase = path.join(jpgDir, `${slug}-pagina-${String(p).padStart(2, "0")}`);
      const outJpg = `${outBase}.jpg`;

      let pulada = false;
      try {
        const stat = await fs.stat(outJpg);
        if (stat.size > 0) pulada = true;
      } catch { /* nao existe */ }

      if (pulada) {
        totalPaginasPuladas += 1;
      } else {
        await rasterizePage(pdfPath, outBase, p, args.dpi);
        totalPaginasNovas += 1;
      }
    }

    manifestEntries.push({
      name,
      slug,
      vigencia: {
        de: f.validity.initial.slice(0, 10),
        ate: f.validity.final.slice(0, 10),
      },
      pdf: `PDF/${slug}.pdf`,
      pdfBaixado,
      paginas: numPages,
      reaproveitado: false,
    });
  }

  const totalPaginas = totalPaginasNovas + totalPaginasPuladas + totalPaginasReaproveitadas;
  const manifest = {
    rede: "Atacadao",
    loja: args.loja,
    data: dateLabel,
    dpi: args.dpi,
    source: `${LOJA_BASE}/${args.loja}`,
    downloadedAt: new Date().toISOString(),
    totalEncartes: manifestEntries.length,
    totalPaginas,
    encartes: manifestEntries,
  };

  await fs.writeFile(path.join(destino, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`Atacadao | ${storeName} | ${dateLabel} @${args.dpi}dpi`);
  console.log(`Encartes: ${manifestEntries.length} | Paginas: ${totalPaginas} (${totalPaginasNovas} novas, ${totalPaginasPuladas} puladas, ${totalPaginasReaproveitadas} reaproveitadas)`);
  console.log(`Destino: ${destino}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
