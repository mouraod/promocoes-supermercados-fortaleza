#!/usr/bin/env node

const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { reaproveitarPaginas } = require("../lib/reuso");

const FOLHETOS_URL = "https://supermercadoguara.com.br/folhetos";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 75 * 1024 * 1024;
const MAX_PAGINAS_POR_ENCARTE = 50;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const MESES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// --- helpers ----------------------------------------------------------------

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
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

async function downloadFile(url, filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 0) return false;
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
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Falha ${response.status} ao baixar ${url}`);
    if (!response.body) throw new Error(`Resposta sem conteudo ao baixar ${url}`);

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
    await pipeline(Readable.fromWeb(response.body), limiter, fsSync.createWriteStream(temporaryPath, { flags: "wx" }));
    await fs.rename(temporaryPath, filePath);
    return true;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function probePageCount(capaUrl) {
  const match = capaUrl.match(/^(.+)-1(\.webp)$/);
  if (!match) return 1;

  const [, stem, ext] = match;
  let count = 1;
  for (let p = 2; p <= MAX_PAGINAS_POR_ENCARTE; p += 1) {
    const url = `${stem}-${p}${ext}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": UA, Range: "bytes=0-0" },
      });
      if (res.ok || res.status === 206) {
        count = p;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return count;
}

function pageUrl(capaUrl, page) {
  const match = capaUrl.match(/^(.+)-1(\.webp)$/);
  if (!match) return capaUrl;
  const [, stem, ext] = match;
  return `${stem}-${page}${ext}`;
}

// --- Playwright: ler cards do DOM -------------------------------------------

async function fetchEncartesDoDOM() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(FOLHETOS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector(".card-folheto img[src]", { state: "attached", timeout: 30000 });

  const encartes = await page.evaluate(() => {
    const cards = document.querySelectorAll(".card-folheto");
    return Array.from(cards).map((card) => {
      const titulo = card.querySelector(".titulo")?.textContent?.trim() || "";
      const subtitulo = card.querySelector(".subtitulo")?.textContent?.trim() || "";
      const img = card.querySelector(".imagem-capa img");
      const capaUrl = img?.src || "";
      return { titulo, subtitulo, capaUrl };
    }).filter((e) => e.capaUrl);
  });

  await browser.close();
  return encartes;
}

// --- args -------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    base: path.join(os.homedir(), "Downloads", "Encartes"),
    output: null,
    onlyNewest: false,
    semReuso: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base") args.base = argv[++i];
    else if (arg === "--output") args.output = argv[++i];
    else if (arg === "--only-newest") args.onlyNewest = true;
    else if (arg === "--sem-reuso") args.semReuso = true;
    else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`
Uso:
  node guara-encartes/download-encartes.js [opcoes]

Opcoes:
  --base          Pasta raiz. Padrao: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --only-newest   Baixa apenas o encarte mais recente (util para teste)
  --sem-reuso     Nao reaproveita paginas de rodadas anteriores
  --help          Exibe esta mensagem

Saida padrao:
  <base>/Guara/DD-Mes/JPG/<slug>-pagina-NN.webp
  <base>/Guara/DD-Mes/manifest.json

Requer: npm install playwright (na pasta da ferramenta)
`);
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dateLabel = dateFolderName(new Date());
  const destino = args.output ?? path.join(args.base, "Guara", dateLabel);

  const jpgDir = path.join(destino, "JPG");
  await fs.mkdir(jpgDir, { recursive: true });

  const encartesDoDOM = await fetchEncartesDoDOM();

  if (encartesDoDOM.length === 0) {
    throw new Error("Nenhum encarte encontrado. Verifique se o site esta acessivel.");
  }

  let encartes = encartesDoDOM;

  if (args.onlyNewest) {
    encartes = [encartes[0]];
  }

  const manifestEntries = [];
  let totalNovas = 0;
  let totalPuladas = 0;
  let totalReaproveitadas = 0;

  for (const e of encartes) {
    const slug = slugify(e.titulo || "encarte");

    const numPaginas = await probePageCount(e.capaUrl);
    const urls = [];
    for (let p = 1; p <= numPaginas; p += 1) {
      urls.push(pageUrl(e.capaUrl, p));
    }

    if (!args.semReuso && !args.output) {
      const reuso = await reaproveitarPaginas({
        redeDir: path.join(args.base, "Guara"),
        dataAtual: dateLabel,
        slug,
        jpgDirDestino: jpgDir,
        paginasEsperadas: urls.length,
      });

      if (reuso) {
        totalReaproveitadas += reuso.paginas;
        manifestEntries.push({
          titulo: e.titulo,
          subtitulo: e.subtitulo,
          slug,
          paginas: urls.length,
          urls,
          reaproveitado: true,
        });
        continue;
      }
    }

    for (let p = 0; p < urls.length; p += 1) {
      const pageNum = String(p + 1).padStart(2, "0");
      const filePath = path.join(jpgDir, `${slug}-pagina-${pageNum}.webp`);
      const baixou = await downloadFile(urls[p], filePath);
      if (baixou) totalNovas += 1;
      else totalPuladas += 1;
    }

    manifestEntries.push({
      titulo: e.titulo,
      subtitulo: e.subtitulo,
      slug,
      paginas: urls.length,
      urls,
    });
  }

  const totalPaginas = totalNovas + totalPuladas + totalReaproveitadas;
  const manifest = {
    rede: "Guara",
    data: dateLabel,
    source: FOLHETOS_URL,
    downloadedAt: new Date().toISOString(),
    totalEncartes: manifestEntries.length,
    totalPaginas,
    encartes: manifestEntries,
  };

  await fs.writeFile(path.join(destino, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`Guara | ${dateLabel}`);
  console.log(`Encartes: ${manifestEntries.length} | Paginas: ${totalPaginas} (${totalNovas} novas, ${totalPuladas} puladas, ${totalReaproveitadas} reaproveitadas)`);
  console.log(`Destino: ${destino}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
