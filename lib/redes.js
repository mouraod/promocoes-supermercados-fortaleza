"use strict";

// Registry de redes: tudo que o orquestrador (todos-encartes) precisa saber
// sobre cada mercado. Cada entrada declara onde está o script, quais flags
// ele aceita receber e quais dependências externas usa.
// Mercado novo = entrada nova aqui; nada mais no orquestrador muda.

const REDES = [
  {
    nome: "Cometa",
    pasta: "cometa-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso", "dpi"],
    deps: { poppler: true, playwright: false },
  },
  {
    nome: "SaoLuiz",
    pasta: "saoluiz-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso"],
    deps: { poppler: false, playwright: true },
  },
  {
    nome: "MercadaoSaoLuiz",
    pasta: "mercadao-encartes",
    script: "scripts/download-encartes.js",
    flags: ["semReuso"],
    deps: { poppler: false, playwright: false },
  },
  {
    nome: "SuperDoPovo",
    pasta: "superdopovo-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso", "dpi", "all"],
    deps: { poppler: true, playwright: true },
  },
  {
    nome: "Atacadao",
    pasta: "atacadao-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso", "dpi"],
    deps: { poppler: true, playwright: false },
  },
  {
    nome: "Guara",
    pasta: "guara-encartes",
    script: "download-encartes.js",
    flags: ["onlyNewest", "semReuso"],
    deps: { poppler: false, playwright: true },
  },
];

module.exports = { REDES };
