#!/usr/bin/env node

const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { reaproveitarPaginas } = require("../lib/reuso");

const STORE_URL = "https://mercadinhossaoluiz.com.br/loja/355/encartes";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 75 * 1024 * 1024;

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
    .toLowerCase();
}

async function downloadFile(url, filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 0) return false; // ja existe
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
  node download-encartes.js [opcoes]

Opcoes:
  --base          Pasta raiz. Padrao: ~/Downloads/Encartes
  --output        Substitui base+rede+data por um caminho completo
  --only-newest   Baixa apenas o encarte com maior id (util para teste)
  --sem-reuso     Nao reaproveita paginas de rodadas anteriores
  --help          Exibe esta mensagem

Saida padrao:
  <base>/SaoLuiz/DD-Mes/JPG/<slug>-pagina-NN.jpg
  <base>/SaoLuiz/DD-Mes/manifest.json

Requer: npm install playwright (na pasta da ferramenta)
`);
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dateLabel = dateFolderName(new Date());
  const destino = args.output ?? path.join(args.base, "SaoLuiz", dateLabel);

  const jpgDir = path.join(destino, "JPG");
  await fs.mkdir(jpgDir, { recursive: true });

  // Abrir navegador headless e interceptar o payload de flipbooks
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  let flipbooksPayload = null;

  page.on("response", async (res) => {
    if (res.url().includes("/flipbooks") && !flipbooksPayload) {
      try { flipbooksPayload = await res.json(); } catch { /* ignorar */ }
    }
  });

  await page.goto(STORE_URL, { waitUntil: "networkidle", timeout: 60000 });
  await browser.close();

  if (!flipbooksPayload || !Array.isArray(flipbooksPayload.flipbooks)) {
    throw new Error("Nenhum encarte encontrado. Verifique se o site esta acessivel.");
  }

  let encartes = flipbooksPayload.flipbooks;
  if (encartes.length === 0) throw new Error("Lista de encartes vazia.");

  if (args.onlyNewest) {
    encartes = [encartes.reduce((a, b) => (a.id > b.id ? a : b))];
  }

  const manifestEntries = [];
  let totalNovas = 0;
  let totalPuladas = 0;
  let totalReaproveitadas = 0;

  for (const e of encartes) {
    const slug = slugify(`${e.id}-${e.name}`);
    const urls = Array.isArray(e.images_urls) ? e.images_urls : [];

    if (urls.length === 0) {
      console.warn(`  [aviso] Encarte ${e.id} (${e.name}) sem imagens -- ignorado.`);
      continue;
    }

    if (!args.semReuso && !args.output) {
      const reuso = await reaproveitarPaginas({
        redeDir: path.join(args.base, "SaoLuiz"),
        dataAtual: dateLabel,
        slug,
        jpgDirDestino: jpgDir,
        paginasEsperadas: urls.length,
      });

      if (reuso) {
        totalReaproveitadas += reuso.paginas;
        manifestEntries.push({
          id: e.id,
          name: e.name,
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
      const filePath = path.join(jpgDir, `${slug}-pagina-${pageNum}.jpg`);
      const baixou = await downloadFile(urls[p], filePath);
      if (baixou) totalNovas += 1;
      else totalPuladas += 1;
    }

    manifestEntries.push({
      id: e.id,
      name: e.name,
      slug,
      paginas: urls.length,
      urls,
    });
  }

  const totalPaginas = totalNovas + totalPuladas + totalReaproveitadas;
  const manifest = {
    rede: "SaoLuiz",
    data: dateLabel,
    source: STORE_URL,
    downloadedAt: new Date().toISOString(),
    totalEncartes: manifestEntries.length,
    totalPaginas,
    encartes: manifestEntries,
  };

  await fs.writeFile(path.join(destino, "manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`SaoLuiz | ${dateLabel}`);
  console.log(`Encartes: ${manifestEntries.length} | Paginas: ${totalPaginas} (${totalNovas} novas, ${totalPuladas} puladas, ${totalReaproveitadas} reaproveitadas)`);
  console.log(`Destino: ${destino}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
