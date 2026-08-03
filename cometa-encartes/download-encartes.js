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

const API = "https://cometasupermercados.com.br/api/encartes";
const IMG_BASE = "https://adminx.cometasupermercados.com.br";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 75 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MIN_DPI = 72;
const MAX_DPI = 400;

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function dateFolderName(date) {
  const d = String(date.getDate()).padStart(2, "0");
  return `${d}-${MESES[date.getMonth()]}`;
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

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ${response.status} em ${url}: ${body.slice(0, 200)}`);
  }
  return response.json();
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
    // não existe, continuar
  }

  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:") throw new Error(`URL de download não segura: ${url}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const temporaryPath = `${filePath}.part`;

  try {
    const response = await fetch(parsedUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Falha ${response.status} ao baixar ${url}`);
    if (!response.body) throw new Error(`Resposta sem conteúdo ao baixar ${url}`);

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Arquivo excede o limite de ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB: ${url}`);
    }
    if (type === "pdf" && !/^(application\/pdf|application\/octet-stream)(;|$)/i.test(response.headers.get("content-type") || "")) {
      throw new Error(`Resposta não é um PDF: ${url}`);
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
    if (type === "pdf" && !await isValidPdf(temporaryPath)) throw new Error(`PDF inválido: ${url}`);
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
  if (!match) throw new Error(`Não foi possível ler nº de páginas de ${pdfPath}`);
  const pages = parseInt(match[1], 10);
  if (pages > MAX_PDF_PAGES) throw new Error(`PDF excede o limite de ${MAX_PDF_PAGES} páginas: ${pdfPath}`);
  return pages;
}

async function rasterizePage(pdfPath, outBase, page, dpi) {
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
      `Dependência(s) ausente(s): ${missing.join(", ")}.\n` +
      `Instale com: brew install poppler`
    );
  }
}

// ─── args ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    base: path.join(os.homedir(), "Downloads", "Encartes"),
    output: null,
    dpi: 200,
    onlyNewest: false,
    semReuso: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i];
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
  node download-encartes.js [opções]

Opções:
  --base          Pasta raiz. Padrão: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --dpi           Resolução de rasterização. Padrão: 200 (~2205x3150 px)
  --only-newest   Baixa apenas o encarte com maior id (útil para teste)
  --sem-reuso     Não reaproveita páginas de rodadas anteriores
  --help          Exibe esta mensagem

Saída padrão:
  <base>/Cometa/DD-Mês/PDF/<slug>.pdf
  <base>/Cometa/DD-Mês/JPG/<slug>-pagina-NN.jpg

Requer poppler: brew install poppler
`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  checkDependencies();

  const args = parseArgs(process.argv.slice(2));
  const dateLabel = dateFolderName(new Date());
  const destino = args.output ?? path.join(args.base, "Cometa", dateLabel);

  const pdfDir = path.join(destino, "PDF");
  const jpgDir = path.join(destino, "JPG");
  await fs.mkdir(pdfDir, { recursive: true });
  await fs.mkdir(jpgDir, { recursive: true });

  const { data } = await fetchJson(API);
  let encartes = Array.isArray(data) ? data : [];
  if (encartes.length === 0) throw new Error("Nenhum encarte encontrado na API.");

  if (args.onlyNewest) {
    encartes = [encartes.reduce((a, b) => (a.id > b.id ? a : b))];
  }

  const manifestEntries = [];
  let totalPaginasNovas = 0;
  let totalPaginasPuladas = 0;
  let totalPaginasReaproveitadas = 0;

  for (const e of encartes) {
    const pdfRel = e.pdf?.url;
    if (!pdfRel) {
      console.warn(`  [aviso] Encarte ${e.id} (${e.name}) sem PDF — ignorado.`);
      continue;
    }

    const slug = slugify(`${e.id}-${e.name}`);
    const pdfPath = path.join(pdfDir, `${slug}.pdf`);

    if (!args.semReuso && !args.output) {
      const reuso = await reaproveitarPaginas({
        redeDir: path.join(args.base, "Cometa"),
        dataAtual: dateLabel,
        slug,
        jpgDirDestino: jpgDir,
      });

      if (reuso) {
        // PDF também é hardlinkado quando existe na origem; se não existir,
        // não vale a pena baixar da rede só pra completar a pasta.
        const pdfOrigem = path.join(reuso.origemDir, "PDF", `${slug}.pdf`);
        try {
          await fs.access(pdfOrigem);
          await linkOuCopia(pdfOrigem, pdfPath);
        } catch { /* sem PDF na origem, seguir sem ele */ }

        totalPaginasReaproveitadas += reuso.paginas;

        manifestEntries.push({
          id: e.id,
          name: e.name,
          descricao: e.description || "",
          slug,
          pdf: pdfPath,
          pdfBaixado: false,
          paginas: reuso.paginas,
          reaproveitado: true,
          validade: { de: e.createdAt || null, ate: e.updatedAt || null },
        });
        continue;
      }
    }

    // 1. baixar PDF em PDF/
    const pdfUrl = /^https?:\/\//.test(pdfRel) ? pdfRel : IMG_BASE + pdfRel;
    const pdfBaixado = await downloadFile(pdfUrl, pdfPath, "pdf");

    // 2. contar páginas
    const numPages = await pdfPageCount(pdfPath);

    // 3. rasterizar cada página em JPG/<slug>-pagina-NN.jpg
    for (let p = 1; p <= numPages; p += 1) {
      const outBase = path.join(jpgDir, `${slug}-pagina-${String(p).padStart(2, "0")}`);
      const outJpg = `${outBase}.jpg`;

      let pulada = false;
      try {
        const stat = await fs.stat(outJpg);
        if (stat.size > 0) pulada = true;
      } catch { /* não existe */ }

      if (pulada) {
        totalPaginasPuladas += 1;
      } else {
        await rasterizePage(pdfPath, outBase, p, args.dpi);
        totalPaginasNovas += 1;
      }
    }

    manifestEntries.push({
      id: e.id,
      name: e.name,
      descricao: e.description || "",
      slug,
      pdf: pdfPath,
      pdfBaixado,
      paginas: numPages,
      validade: { de: e.createdAt || null, ate: e.updatedAt || null },
    });
  }

  const totalPaginas = totalPaginasNovas + totalPaginasPuladas + totalPaginasReaproveitadas;
  const manifest = {
    rede: "Cometa",
    data: dateLabel,
    dpi: args.dpi,
    source: API,
    downloadedAt: new Date().toISOString(),
    totalEncartes: manifestEntries.length,
    totalPaginas,
    encartes: manifestEntries,
  };

  await fs.writeFile(path.join(destino, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`Cometa | ${dateLabel} @${args.dpi}dpi`);
  console.log(`Encartes: ${manifestEntries.length} | Páginas: ${totalPaginas} (${totalPaginasNovas} novas, ${totalPaginasPuladas} puladas, ${totalPaginasReaproveitadas} reaproveitadas)`);
  console.log(`Destino: ${destino}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
