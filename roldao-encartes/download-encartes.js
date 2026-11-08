"use strict";
const { descobrirComEvidencia } = require("../lib/roldao");
module.exports = {
  descobrirComEvidencia,
  descobrir: async (...args) => (await descobrirComEvidencia(...args)).encartes,
};
