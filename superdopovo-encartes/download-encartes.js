#!/usr/bin/env node

const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { chromium } = require("playwright");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { reaproveitarPaginas } = require("../lib/reuso");

const execFileAsync = promisify(execFile);

const BOOKLETS_URL = "https://loja.superdopovo.com.br/booklets";
const API_PATH = "/api/v1/booklets"; // shop id 24 vai embutido na URL, ex: /api/v1/booklets/24
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 75 * 1024 * 1024;
const MAX_PDF_PAGES = 100;
const MIN_DPI = 72;
const MAX_DPI = 400;

const MESES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// --- helpers ------------------------------------------------------------------

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
  const startMonth = start.slice(0, 7);
  const endMonth = end.slice(0, 7);
  const startDay = start.slice(8, 10);
  if (startMonth === endMonth) {
    return `${startDay}-a-${ddmm(end)}`;
  }
  return `${ddmm(start)}-a-${ddmm(end)}`;
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

function extFromUrl(url) {
  const clean = url.split("?")[0];
  const match = clean.match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "jpg";
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
  if (!match) throw new Error(`Nao foi possivel ler nº de paginas de ${pdfPath}`);
  const pages = parseInt(match[1], 10);
  if (pages > MAX_PDF_PAGES) throw new Error(`PDF excede o limite de ${MAX_PDF_PAGES} páginas: ${pdfPath}`);
  return pages;
}

async function rasterizePage(pdfPath, outBase, page, dpi) {
  // -singlefile: gera exatamente <outBase>.jpg (sem sufixo de pagina)
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

async function fetchBookletsPayload() {
  // networkidle nunca é atingido nesse site (pixels de analytics ficam
  // disparando indefinidamente), então esperamos especificamente pela
  // resposta da API em vez de esperar a rede ficar quieta.
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const responsePromise = page.waitForResponse(
    (res) => res.url().includes(API_PATH),
    { timeout: 30000 }
  );

  await page.goto(BOOKLETS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  let payload = null;
  try {
    const res = await responsePromise;
    payload = await res.json();
  } finally {
    await browser.close();
  }

  return payload;
}

// --- args -----------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    base: path.join(os.homedir(), "Downloads", "Encartes"),
    output: null,
    dpi: 200,
    onlyNewest: false,
    all: false,
    semReuso: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--dpi") args.dpi = parseInt(argv[++i], 10);
    else if (arg === "--only-newest") args.onlyNewest = true;
    else if (arg === "--all") args.all = true;
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
  node Ferramentas/superdopovo-encartes/download-encartes.js [opcoes]

Opcoes:
  --base          Pasta raiz. Padrao: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --dpi           Resolucao de rasterizacao do PDF. Padrao: 200 (~2205x3150 px)
  --only-newest   Baixa apenas o encarte com maior id (util para teste)
  --all           Inclui encartes ja vencidos (padrao: so vigentes + futuros)
  --sem-reuso     Nao reaproveita paginas de rodadas anteriores
  --help          Exibe esta mensagem

Saida padrao:
  <base>/SuperDoPovo/DD-Mes/JPG/<id>-<vigencia>-pagina-NN.jpg
  <base>/SuperDoPovo/DD-Mes/manifest.json

Requer: poppler (brew install poppler) e npm install (playwright) na pasta da ferramenta
`);
}

// --- main -------------------------------------------------------------------

async function main() {
  checkDependencies();

  const args = parseArgs(process.argv.slice(2));
  const dateLabel = dateFolderName(new Date());
  const destino = args.output ?? path.join(args.base, "SuperDoPovo", dateLabel);

  const jpgDir = path.join(destino, "JPG");
  await fs.mkdir(jpgDir, { recursive: true });

  const payload = await fetchBookletsPayload();

  if (!Array.isArray(payload)) {
    throw new Error("Nenhum encarte encontrado. Verifique se o site esta acessivel.");
  }

  let encartes = payload;
  if (encartes.length === 0) throw new Error("Lista de encartes vazia.");

  if (!args.all) {
    const hoje = todayISO();
    encartes = encartes.filter((e) => e.end >= hoje);
  }

  if (args.onlyNewest) {
    encartes = [encartes.reduce((a, b) => (a.id > b.id ? a : b))];
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sdp-encartes-"));

  const manifestEntries = [];
  let totalNovas = 0;
  let totalPuladas = 0;
  let totalReaproveitadas = 0;

  for (const e of encartes) {
    const slug = `${e.id}-${vigenciaSlug(e.start, e.end)}`;

    if (!args.semReuso && !args.output) {
      const reuso = await reaproveitarPaginas({
        redeDir: path.join(args.base, "SuperDoPovo"),
        dataAtual: dateLabel,
        slug,
        jpgDirDestino: jpgDir,
      });

      if (reuso) {
        totalReaproveitadas += reuso.paginas;
        manifestEntries.push({
          id: e.id,
          name: e.name,
          slug,
          vigencia: { de: e.start, ate: e.end },
          paginas: reuso.paginas,
          fonte: reuso.fonte ?? "reaproveitado",
          reaproveitado: true,
        });
        continue;
      }
    }

    let numPaginas = 0;
    let fonte = null;

    if (e.pdf) {
      fonte = "pdf";
      const pdfPath = path.join(tmpDir, `${slug}.pdf`);
      try {
        await downloadFile(e.pdf, pdfPath, "pdf");
        numPaginas = await pdfPageCount(pdfPath);

        for (let p = 1; p <= numPaginas; p += 1) {
          const outBase = path.join(jpgDir, `${slug}-pagina-${String(p).padStart(2, "0")}`);
          const outJpg = `${outBase}.jpg`;

          let pulada = false;
          try {
            const stat = await fs.stat(outJpg);
            if (stat.size > 0) pulada = true;
          } catch { /* nao existe */ }

          if (pulada) {
            totalPuladas += 1;
          } else {
            await rasterizePage(pdfPath, outBase, p, args.dpi);
            totalNovas += 1;
          }
        }
      } finally {
        await fs.rm(pdfPath, { force: true });
      }
    } else {
      const sheets = Array.isArray(e.sheets) && e.sheets.length > 0
        ? e.sheets.map((s) => s.link)
        : (Array.isArray(e.links) ? e.links : []);

      if (sheets.length === 0) {
        console.warn(`  [aviso] Encarte ${e.id} (${e.name}) sem PDF e sem paginas -- ignorado.`);
        continue;
      }

      fonte = "sheets";
      numPaginas = sheets.length;

      for (let p = 0; p < sheets.length; p += 1) {
        const ext = extFromUrl(sheets[p]);
        const pageNum = String(p + 1).padStart(2, "0");
        const filePath = path.join(jpgDir, `${slug}-pagina-${pageNum}.${ext}`);
        const baixou = await downloadFile(sheets[p], filePath);
        if (baixou) totalNovas += 1;
        else totalPuladas += 1;
      }
    }

    manifestEntries.push({
      id: e.id,
      name: e.name,
      slug,
      vigencia: { de: e.start, ate: e.end },
      paginas: numPaginas,
      fonte,
    });
  }

  await fs.rm(tmpDir, { recursive: true, force: true });

  const totalPaginas = totalNovas + totalPuladas + totalReaproveitadas;
  const manifest = {
    rede: "SuperDoPovo",
    data: dateLabel,
    dpi: args.dpi,
    source: BOOKLETS_URL,
    downloadedAt: new Date().toISOString(),
    totalEncartes: manifestEntries.length,
    totalPaginas,
    encartes: manifestEntries,
  };

  await fs.writeFile(path.join(destino, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`SuperDoPovo | ${dateLabel} @${args.dpi}dpi`);
  console.log(`Encartes: ${manifestEntries.length} | Paginas: ${totalPaginas} (${totalNovas} novas, ${totalPuladas} puladas, ${totalReaproveitadas} reaproveitadas)`);
  console.log(`Destino: ${destino}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
