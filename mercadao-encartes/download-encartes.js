#!/usr/bin/env node

const fs = require("fs/promises");
const fsSync = require("fs");
const os = require("os");
const path = require("path");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

const FONTES = [
  { nome: "home", url: "https://www.mercadaosaoluiz.com.br/" },
  { nome: "ofertas", url: "https://www.mercadaosaoluiz.com.br/ofertas" },
];
const HOST_WIX = "static.wixstatic.com";
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 75 * 1024 * 1024;
const CONCORRENCIA_DOWNLOADS = 4;
const AREA_MINIMA_ENCARTE = 2_000_000;
const PROPORCAO_MINIMA = 1.30;
const PROPORCAO_MAXIMA = 1.55;
const MESES = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function nomePastaData(data) {
  return `${String(data.getDate()).padStart(2, "0")}-${MESES[data.getMonth()]}`;
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodificarHtml(texto) {
  return texto
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u003A", ":")
    .replaceAll("\\u0026", "&");
}

function atributo(tag, nome) {
  const padrao = new RegExp(`\\b${escaparRegex(nome)}=(?:"([^"]*)"|'([^']*)')`, "i");
  const achado = tag.match(padrao);
  return achado ? decodificarHtml(achado[1] ?? achado[2] ?? "") : "";
}

function slugificar(texto) {
  return texto
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

function candidatosSrcSet(srcSet) {
  return srcSet
    .split(/,\s*(?=https?:\/\/)/)
    .map((item) => item.trim().split(/\s+/)[0])
    .filter((item) => item.startsWith("https://"));
}

function analisarUrlWix(url) {
  const achado = url.match(
    /^https:\/\/static\.wixstatic\.com\/media\/([^/]+)\/v1\/fill\/w_(\d+),h_(\d+)[^\s"'<>]*$/i
  );
  if (!achado) return null;

  const [, mediaId, larguraTexto, alturaTexto] = achado;
  const extensao = mediaId.match(/\.(jpe?g|png)$/i)?.[1].toLowerCase();
  if (!extensao) return null;

  const largura = Number(larguraTexto);
  const altura = Number(alturaTexto);
  const proporcao = altura / largura;
  const area = largura * altura;
  if (
    !Number.isFinite(proporcao) ||
    area < AREA_MINIMA_ENCARTE ||
    proporcao < PROPORCAO_MINIMA ||
    proporcao > PROPORCAO_MAXIMA
  ) return null;

  const caminho = new URL(url).pathname;
  const nomeOriginal = decodeURIComponent(caminho.slice(caminho.lastIndexOf("/") + 1));
  return {
    mediaId,
    largura,
    altura,
    area,
    extensao: extensao === "jpeg" ? "jpg" : extensao,
    nomeOriginal,
    urlOriginal: `https://${HOST_WIX}/media/${mediaId}`,
  };
}

function metadadosPagina(alt, nomeOriginal, mediaId) {
  const nome = (alt || nomeOriginal || mediaId).replace(/\.[^.]+$/, "").trim();
  const paginaPadrao = { nome, pagina: 1 };

  const paginaWix = nome.match(/^(.*?)[_-]page[-_](\d+)$/i);
  if (paginaWix) {
    return { nome: paginaWix[1], pagina: Number(paginaWix[2]) };
  }

  const imagemWix = nome.match(/^(.*?)-imagens?-(\d+)$/i);
  if (imagemWix) {
    return { nome: imagemWix[1], pagina: Number(imagemWix[2]) + 1 };
  }

  return paginaPadrao;
}

function extrairEncartes(html, fonte) {
  const porMidia = new Map();
  const tags = decodificarHtml(html).match(/<img\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const srcSet = atributo(tag, "srcSet");
    const alt = atributo(tag, "alt");
    for (const url of candidatosSrcSet(srcSet)) {
      const candidato = analisarUrlWix(url);
      if (!candidato) continue;
      const anterior = porMidia.get(candidato.mediaId);
      if (!anterior || candidato.area > anterior.area) {
        porMidia.set(candidato.mediaId, { ...candidato, alt, fontes: [fonte] });
      }
    }
  }
  return [...porMidia.values()];
}

function descobrirEncartes(respostas) {
  const porMidia = new Map();
  for (const { fonte, html } of respostas) {
    for (const candidato of extrairEncartes(html, fonte)) {
      const anterior = porMidia.get(candidato.mediaId);
      if (!anterior) {
        porMidia.set(candidato.mediaId, candidato);
      } else {
        anterior.fontes = [...new Set([...anterior.fontes, ...candidato.fontes])];
        if (candidato.area > anterior.area) {
          anterior.largura = candidato.largura;
          anterior.altura = candidato.altura;
          anterior.area = candidato.area;
          anterior.nomeOriginal = candidato.nomeOriginal;
          anterior.alt = candidato.alt;
        }
      }
    }
  }

  const grupos = new Map();
  for (const item of porMidia.values()) {
    const dados = metadadosPagina(item.alt, item.nomeOriginal, item.mediaId);
    const slug = slugificar(dados.nome);
    const chave = slug;
    if (!grupos.has(chave)) grupos.set(chave, { nome: dados.nome, slug, paginas: [] });
    grupos.get(chave).paginas.push({ ...item, numero: dados.pagina });
  }

  const encartes = [...grupos.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const encarte of encartes) {
    encarte.paginas.sort((a, b) => a.numero - b.numero || a.mediaId.localeCompare(b.mediaId));
  }
  return encartes;
}

function atribuirArquivos(encartes) {
  const ocupados = new Set();
  for (const encarte of encartes) {
    for (const pagina of encarte.paginas) {
      const base = `${encarte.slug}-pagina-${String(pagina.numero).padStart(2, "0")}`;
      let nome = `${base}.${pagina.extensao}`;
      if (ocupados.has(nome)) {
        const hash = pagina.mediaId.match(/_([a-f0-9]{8,})~mv2\./i)?.[1].slice(0, 8) ?? "midia";
        nome = `${base}-${hash}.${pagina.extensao}`;
      }
      ocupados.add(nome);
      pagina.arquivo = nome;
    }
  }
  return encartes;
}

async function buscarHtml(fonte) {
  const controlador = new AbortController();
  const tempo = setTimeout(() => controlador.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const resposta = await fetch(fonte.url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
      signal: controlador.signal,
    });
    if (!resposta.ok) throw new Error(`${fonte.nome}: falha ${resposta.status} ao abrir ${fonte.url}`);
    const tipo = resposta.headers.get("content-type") ?? "";
    if (!tipo.includes("text/html")) throw new Error(`${fonte.nome}: resposta não é HTML (${tipo || "sem tipo"})`);
    return { fonte: fonte.nome, html: await resposta.text() };
  } finally {
    clearTimeout(tempo);
  }
}

async function arquivoNaoVazio(caminho) {
  try {
    return (await fs.stat(caminho)).size > 0;
  } catch {
    return false;
  }
}

async function baixarImagem(url, destino) {
  if (await arquivoNaoVazio(destino)) return false;

  const destinoTemporario = `${destino}.part`;
  const urlValidada = new URL(url);
  if (urlValidada.protocol !== "https:" || urlValidada.hostname !== HOST_WIX) {
    throw new Error(`URL de download não permitida: ${url}`);
  }

  const controlador = new AbortController();
  const tempo = setTimeout(() => controlador.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const resposta = await fetch(urlValidada, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controlador.signal,
    });
    if (!resposta.ok) throw new Error(`Falha ${resposta.status} ao baixar ${url}`);
    if (!resposta.body) throw new Error(`Resposta sem conteúdo ao baixar ${url}`);
    if (!/^image\/(jpeg|png)(;|$)/i.test(resposta.headers.get("content-type") ?? "")) {
      throw new Error(`Resposta não é JPEG ou PNG: ${url}`);
    }

    const tamanho = Number(resposta.headers.get("content-length"));
    if (Number.isFinite(tamanho) && tamanho > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Imagem excede o limite de 75 MB: ${url}`);
    }

    let bytesBaixados = 0;
    const limite = new Transform({
      transform(parte, _codificacao, callback) {
        bytesBaixados += parte.length;
        if (bytesBaixados > MAX_DOWNLOAD_BYTES) {
          controlador.abort();
          callback(new Error(`Imagem excede o limite de 75 MB: ${url}`));
          return;
        }
        callback(null, parte);
      },
    });

    await fs.rm(destinoTemporario, { force: true });
    await pipeline(Readable.fromWeb(resposta.body), limite, fsSync.createWriteStream(destinoTemporario, { flags: "wx" }));
    await fs.rename(destinoTemporario, destino);
    return true;
  } catch (erro) {
    await fs.rm(destinoTemporario, { force: true });
    throw erro;
  } finally {
    clearTimeout(tempo);
  }
}

async function baixarPaginas(encartes, pastaJpg, baixar = baixarImagem) {
  const paginas = encartes.flatMap((encarte) => encarte.paginas);
  let proxima = 0;
  let novas = 0;
  let puladas = 0;
  let erro = null;

  async function worker() {
    while (!erro) {
      const pagina = paginas[proxima++];
      if (!pagina) return;
      try {
        const baixou = await baixar(pagina.urlOriginal, path.join(pastaJpg, pagina.arquivo));
        if (baixou) novas += 1;
        else puladas += 1;
      } catch (causa) {
        erro = causa;
      }
    }
  }

  const workers = Math.min(CONCORRENCIA_DOWNLOADS, paginas.length);
  await Promise.all(Array.from({ length: workers }, worker));
  if (erro) throw erro;
  return { novas, puladas };
}

function parsearArgumentos(argv) {
  const args = {
    base: path.join(os.homedir(), "Downloads", "Encartes"),
    output: null,
    dryRun: false,
  };
  for (let indice = 0; indice < argv.length; indice += 1) {
    const arg = argv[indice];
    if (arg === "--base") args.base = argv[++indice];
    else if (arg === "--output") args.output = argv[++indice];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(`Uso:\n  node download-encartes.js [opções]\n\nOpções:\n  --base     Pasta raiz. Padrão: ~/Downloads/Encartes\n  --output   Substitui base+rede+data por um caminho completo\n  --dry-run  Descobre os encartes sem baixar arquivos\n  --help     Exibe esta mensagem\n\nSaída padrão:\n  <base>/MercadaoSaoLuiz/DD-Mês/JPG/<encarte>-pagina-NN.jpg\n  <base>/MercadaoSaoLuiz/DD-Mês/manifest.json`);
      process.exit(0);
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
    if ((arg === "--base" || arg === "--output") && !args[arg.slice(2)]) {
      throw new Error(`${arg} exige um caminho`);
    }
  }
  return args;
}

function resumo(encartes) {
  return encartes.flatMap((encarte) => encarte.paginas.map((pagina) =>
    `${encarte.slug} | página ${pagina.numero} | ${pagina.fontes.join(", ")} | ${pagina.urlOriginal}`
  ));
}

async function executar(argv = process.argv.slice(2)) {
  const args = parsearArgumentos(argv);
  const respostas = await Promise.all(FONTES.map(buscarHtml));
  const porFonte = new Map(respostas.map((resposta) => [resposta.fonte, extrairEncartes(resposta.html, resposta.fonte).length]));
  for (const fonte of FONTES) {
    if ((porFonte.get(fonte.nome) ?? 0) === 0) console.warn(`[aviso] Nenhum encarte encontrado em ${fonte.nome}.`);
  }

  const encartes = atribuirArquivos(descobrirEncartes(respostas));
  const totalPaginas = encartes.reduce((total, encarte) => total + encarte.paginas.length, 0);
  if (totalPaginas === 0) {
    throw new Error("Nenhuma imagem de encarte encontrada. O HTML do Wix pode ter mudado.");
  }

  if (args.dryRun) {
    console.log(`Mercadão São Luiz | ${encartes.length} encarte(s) | ${totalPaginas} página(s)`);
    for (const linha of resumo(encartes)) console.log(linha);
    return { encartes, totalPaginas, seco: true };
  }

  const data = nomePastaData(new Date());
  const destino = args.output ?? path.join(args.base, "MercadaoSaoLuiz", data);
  const pastaJpg = path.join(destino, "JPG");
  await fs.mkdir(pastaJpg, { recursive: true });

  const { novas, puladas } = await baixarPaginas(encartes, pastaJpg);

  const manifest = {
    mercado: "mercadao_sao_luiz",
    rede: "Mercadão São Luiz",
    data,
    fontes: FONTES,
    baixadoEm: new Date().toISOString(),
    totalEncartes: encartes.length,
    totalPaginas,
    encartes: encartes.map((encarte) => ({
      nome: encarte.nome,
      slug: encarte.slug,
      paginas: encarte.paginas.map((pagina) => ({
        numero: pagina.numero,
        arquivo: path.join("JPG", pagina.arquivo),
        mediaId: pagina.mediaId,
        urlOriginal: pagina.urlOriginal,
        fontes: pagina.fontes,
      })),
    })),
  };
  await fs.writeFile(path.join(destino, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Mercadão São Luiz | ${data}`);
  console.log(`Encartes: ${encartes.length} | Páginas: ${totalPaginas} (${novas} novas, ${puladas} puladas)`);
  console.log(`Destino: ${destino}`);
  return { encartes, totalPaginas, destino, novas, puladas };
}

if (require.main === module) {
  executar().catch((erro) => {
    console.error(erro.message);
    process.exit(1);
  });
}

module.exports = {
  analisarUrlWix,
  atribuirArquivos,
  baixarPaginas,
  descobrirEncartes,
  executar,
  extrairEncartes,
  metadadosPagina,
  parsearArgumentos,
};
