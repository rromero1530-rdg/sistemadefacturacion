'use strict';
const { getDb } = require('../db/connection');

/** Construye todos los repositorios sobre una conexión. */
function repos(db = getDb()) {
  return {
    db,
    settings: require('./settings')(db),
    catalog: require('./catalog')(db),
    sales: require('./sales')(db),
    fiscal: require('./fiscal')(db),
    cash: require('./cash')(db),
    partners: require('./partners')(db),
    demand: require('./demand')(db),
    reports: require('./reports')(db),
    users: require('./users')(db),
  };
}

module.exports = { repos };
