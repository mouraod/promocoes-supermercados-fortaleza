"use strict";

const API = "https://roldao.com.br/wp-json/wp/v2";
const ORIGEM = "https://roldao.com.br";

function oficial(valor, caminho) {
  let url;
  try {
    url = new URL(valor);
  } catch {
    throw new Error("Roldão: URL inválida");
  }
  if (
    url.origin !== ORIGEM ||
    url.username ||
    url.password ||
    !url.pathname.startsWith(caminho)
  )
    throw new Error(`Roldão: URL fora da origem permitida: ${valor}`);
  return url.href;
}

async function listar(endpoint, buscar) {
  const registros = [];
  const ids = new Set();
  let total, paginas;
  for (let pagina = 1; pagina === 1 || pagina <= paginas; pagina++) {
    const url = `${API}/${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${pagina}`;
    let resposta;
    try {
      resposta = await buscar(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch (erro) {
      throw new Error(`Roldão: falha ao consultar ${url}: ${erro.message}`, {
        cause: erro,
      });
    }
    if (!resposta.ok)
      throw new Error(`Roldão: HTTP ${resposta.status} em ${url}`);
    const totalAtual = resposta.headers.get("x-wp-total");
    const paginasAtual = resposta.headers.get("x-wp-totalpages");
    if (!/^\d+$/.test(totalAtual ?? "") || !/^\d+$/.test(paginasAtual ?? ""))
      throw new Error(`Roldão: paginação sem totais em ${url}`);
    const n = Number(totalAtual),
      p = Number(paginasAtual);
    if (
      !Number.isSafeInteger(n) ||
      !Number.isSafeInteger(p) ||
      p !== Math.ceil(n / 100) ||
      p > 1000
    )
      throw new Error(`Roldão: paginação inválida em ${url}`);
    if (pagina === 1) {
      total = n;
      paginas = p;
    } else if (total !== n || paginas !== p)
      throw new Error("Roldão: paginação mudou durante a coleta");
    let dados;
    try {
      dados = await resposta.json();
    } catch {
      throw new Error(`Roldão: JSON inválido em ${url}`);
    }
    if (
      !Array.isArray(dados) ||
      dados.length !== Math.min(100, total - registros.length)
    )
      throw new Error(`Roldão: página truncada em ${url}`);
    for (const dado of dados) {
      if (!Number.isSafeInteger(dado?.id) || dado.id <= 0 || ids.has(dado.id))
        throw new Error(`Roldão: identidade ausente ou duplicada em ${url}`);
      ids.add(dado.id);
      registros.push(dado);
    }
  }
  return registros;
}

async function descobrirComEvidencia(
  args = {},
  { fetch: buscar = fetch } = {},
) {
  let posts;
  const encartes = [];
  const selecionados = new Set(args.ids_posts ?? []);
  if ([...selecionados].some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error("Roldão: ids de post inválidos");
  const lacunas = [];
  const catalogo = [];
  const anexosVistos = new Set();
  const urlsVistas = new Set();
  try {
    posts = await listar("ofertas-da-semana", buscar);
    for (const post of posts) {
      const link = oficial(post.link, "/ofertas-da-semana/");
      const anexos = await listar(`media?parent=${post.id}`, buscar);
      if (!anexos.length) lacunas.push(`post ${post.id}: sem anexos`);
      let pdfs = 0;
      const documentos = [];
      for (const anexo of anexos) {
        if (anexo.post !== post.id || anexosVistos.has(anexo.id))
          throw new Error(
            `Roldão: anexo ${anexo.id} com vínculo inválido ou duplicado`,
          );
        anexosVistos.add(anexo.id);
        const url = oficial(anexo.source_url, "/wp-content/uploads/");
        if (urlsVistas.has(url))
          throw new Error(`Roldão: URL de anexo duplicada: ${url}`);
        urlsVistas.add(url);
        if (anexo.mime_type !== "application/pdf") {
          if (/\.pdf$/i.test(new URL(url).pathname)) {
            documentos.push({
              id: anexo.id,
              url,
              mime_type: anexo.mime_type ?? null,
            });
            lacunas.push(
              `post ${post.id}: anexo ${anexo.id} com extensão PDF e MIME incompatível`,
            );
          }
          continue;
        }
        if (!/\.pdf$/i.test(new URL(url).pathname))
          throw new Error(`Roldão: PDF com URL inválida: ${url}`);
        pdfs++;
        documentos.push({ id: anexo.id, url });
        if (!selecionados.has(post.id)) continue;
        encartes.push({
          slug: `roldao-post-${post.id}-pdf-${anexo.id}`,
          pdf: { url, manter: true, identificar: true, redirect: "error" },
          meta: {
            titulo: post.title?.rendered ?? `Post ${post.id}`,
            campanha: `post-${post.id}`,
            origem: link,
            post_id: post.id,
            anexo_id: anexo.id,
            pdf_origem: url,
            vigencia: null,
            revisao_loja_obrigatoria: true,
            revisao_vigencia_obrigatoria: true,
            revisao_visual_obrigatoria: true,
          },
        });
      }
      catalogo.push({
        id: post.id,
        titulo: post.title?.rendered ?? null,
        origem: link,
        pdfs: documentos,
      });
      if (!pdfs) lacunas.push(`post ${post.id}: PDF não encontrado`);
      if (pdfs > 1)
        lacunas.push(`post ${post.id}: ${pdfs} PDFs; vínculo exige revisão`);
    }
    for (const id of selecionados)
      if (!posts.some((post) => post.id === id))
        lacunas.push(`post ${id}: não encontrado na fonte`);
    return {
      encartes,
      evidenciaFonte: {
        posts: posts.length,
        anexos: anexosVistos.size,
        posts_selecionados: [...selecionados],
        selecao_completa: false,
        descoberta_completa: lacunas.length === 0,
        lacunas,
        catalogo,
      },
    };
  } catch (erro) {
    erro.evidenciaFonte = {
      posts: posts?.length ?? null,
      anexos: anexosVistos.size,
      posts_selecionados: [...selecionados],
      selecao_completa: false,
      descoberta_completa: false,
      lacunas: [...lacunas, erro.message],
      catalogo,
    };
    throw erro;
  }
}

module.exports = { descobrirComEvidencia };
