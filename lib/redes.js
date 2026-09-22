"use strict";

// Registry de redes: tudo que o orquestrador (todos-encartes) precisa saber
// sobre cada mercado. Cada entrada declara onde está o script, quais flags
// ele aceita receber, quais dependências externas usa e o slug usado pela API
// de ingestão do site (tem que espelhar o redesenho de enviar-todos.mjs).
// Mercado novo = entrada nova aqui; nada mais no orquestrador muda.

const REDES = [
  {
    nome: "Cometa",
    slug: "cometa",
    pasta: "cometa-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso", "dpi"],
    deps: { poppler: true, playwright: false },
  },
  {
    nome: "SaoLuiz",
    slug: "saoluiz",
    pasta: "saoluiz-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso"],
    deps: { poppler: false, playwright: true },
  },
  {
    nome: "MercadaoSaoLuiz",
    slug: "mercadao",
    pasta: "mercadao-encartes",
    script: "scripts/download-encartes.js",
    flags: ["semReuso"],
    deps: { poppler: false, playwright: false },
  },
  {
    nome: "SuperDoPovo",
    slug: "superdopovo",
    pasta: "superdopovo-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso", "dpi", "all"],
    deps: { poppler: true, playwright: true },
  },
  {
    nome: "Atacadao",
    slug: "atacadao",
    pasta: "atacadao-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso", "dpi"],
    deps: { poppler: true, playwright: false },
  },
  {
    nome: "Guara",
    slug: "guara",
    pasta: "guara-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso"],
    deps: { poppler: false, playwright: true },
  },
  {
    nome: "Assai",
    slug: "assai",
    pasta: "assai-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso"],
    deps: { poppler: false, playwright: true },
  },
  {
    nome: "Frangolandia",
    slug: "frangolandia",
    pasta: "frangolandia-encartes",
    script: "download-encartes.js",
    flags: ["semReuso"],
    deps: { poppler: false, playwright: false },
  },
  {
    nome: "Mateus",
    slug: "mateus",
    pasta: "mateus-encartes",
    script: "download-encartes.js",
    flags: ["semReuso", "dpi"],
    deps: { poppler: true, playwright: false },
  },
];

module.exports = { REDES };
