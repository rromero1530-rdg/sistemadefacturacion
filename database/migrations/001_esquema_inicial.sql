-- =====================================================================
-- Zoe Closet - Esquema inicial
-- Convenciones:
--   * Montos de dinero en CENTAVOS (INTEGER) para evitar errores de redondeo.
--     L 1,250.50  ->  125050
--   * Porcentajes en REAL (15.0 = 15 %).
--   * Fechas TEXT 'YYYY-MM-DD HH:MM:SS' en hora local de Honduras.
--   * SQL estándar en lo posible para migrar a PostgreSQL sin dolor.
-- =====================================================================

-- ---------- Configuración ----------
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE users (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  username   TEXT NOT NULL UNIQUE,
  pin_hash   TEXT,
  role       TEXT NOT NULL DEFAULT 'cajero' CHECK (role IN ('admin','cajero')),
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- Impuestos (ISV Honduras) ----------
CREATE TABLE tax_rates (
  id    INTEGER PRIMARY KEY,
  code  TEXT NOT NULL UNIQUE,         -- ISV15, ISV18, EXE
  name  TEXT NOT NULL,
  rate  REAL NOT NULL CHECK (rate >= 0)
);

-- ---------- Catálogo ----------
CREATE TABLE categories (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  parent_id     INTEGER REFERENCES categories(id),
  margin_pct    REAL,                  -- NULL = usa margen global
  tax_rate_id   INTEGER REFERENCES tax_rates(id),
  min_stock     INTEGER NOT NULL DEFAULT 2,
  slow_days     INTEGER,               -- NULL = usa días globales de lento movimiento
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE products (
  id           INTEGER PRIMARY KEY,
  code         TEXT UNIQUE,            -- código interno / estilo
  name         TEXT NOT NULL,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  brand        TEXT,
  description  TEXT,
  cost         INTEGER NOT NULL DEFAULT 0,  -- costo bruto de referencia (centavos)
  extra_cost_pct REAL NOT NULL DEFAULT 0,   -- flete/aduana/importación (%)
  margin_pct   REAL,                   -- NULL = hereda de categoría/global
  tax_rate_id  INTEGER REFERENCES tax_rates(id), -- NULL = hereda de categoría
  price        INTEGER NOT NULL DEFAULT 0,  -- precio final con ISV (centavos)
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_name ON products(name);

-- Cada combinación talla/color es una variante con su propio stock y código de barras.
CREATE TABLE product_variants (
  id           INTEGER PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku          TEXT NOT NULL UNIQUE,
  barcode      TEXT UNIQUE,
  size         TEXT,                   -- talla: XS, S, M, 36, 37, Única...
  color        TEXT,
  cost         INTEGER NOT NULL DEFAULT 0,  -- costo unitario puesto en tienda (promedio)
  price        INTEGER NOT NULL DEFAULT 0,  -- precio final con ISV
  stock        INTEGER NOT NULL DEFAULT 0,
  min_stock    INTEGER,                -- NULL = usa el de la categoría
  last_sold_at TEXT,
  last_received_at TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_variants_product ON product_variants(product_id);

CREATE TABLE inventory_movements (
  id          INTEGER PRIMARY KEY,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  type        TEXT NOT NULL CHECK (type IN ('initial','purchase','sale','return','adjustment','void')),
  qty         INTEGER NOT NULL,        -- positivo entra, negativo sale
  unit_cost   INTEGER NOT NULL DEFAULT 0,
  ref_table   TEXT,
  ref_id      INTEGER,
  note        TEXT,
  user_id     INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_movements_variant ON inventory_movements(variant_id, created_at);

-- ---------- Proveedores y compras ----------
CREATE TABLE suppliers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  rtn          TEXT,
  contact_name TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  country      TEXT DEFAULT 'Honduras',
  notes        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE purchases (
  id              INTEGER PRIMARY KEY,
  supplier_id     INTEGER REFERENCES suppliers(id),
  document_number TEXT,                -- factura del proveedor
  purchase_date   TEXT NOT NULL,
  extra_cost      INTEGER NOT NULL DEFAULT 0, -- flete/aduana prorrateado
  total_cost      INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  user_id         INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE purchase_items (
  id          INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  variant_id  INTEGER NOT NULL REFERENCES product_variants(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_cost   INTEGER NOT NULL
);

-- ---------- Clientes y crédito ----------
CREATE TABLE customers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  rtn          TEXT,                   -- RTN para factura con datos fiscales
  dni          TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  birthday     TEXT,
  credit_limit INTEGER NOT NULL DEFAULT 0,
  credit_days  INTEGER NOT NULL DEFAULT 30,
  notes        TEXT,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_customers_name ON customers(name);

-- ---------- Fiscal SAR (Honduras) ----------
-- Rangos autorizados (C.A.I.). Número: EEE-PPP-TT-NNNNNNNN
CREATE TABLE fiscal_cai (
  id             INTEGER PRIMARY KEY,
  cai            TEXT NOT NULL,
  establishment  TEXT NOT NULL DEFAULT '000',
  emission_point TEXT NOT NULL DEFAULT '001',
  doc_type       TEXT NOT NULL DEFAULT '01',   -- 01 = Factura
  range_start    INTEGER NOT NULL,
  range_end      INTEGER NOT NULL,
  next_number    INTEGER NOT NULL,
  deadline       TEXT NOT NULL,                -- fecha límite de emisión
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (range_end >= range_start),
  CHECK (next_number BETWEEN range_start AND range_end + 1)
);

-- ---------- Caja ----------
CREATE TABLE cash_sessions (
  id             INTEGER PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at      TEXT NOT NULL,
  opened_by      INTEGER REFERENCES users(id),
  opening_amount INTEGER NOT NULL DEFAULT 0,
  closed_at      TEXT,
  closed_by      INTEGER REFERENCES users(id),
  expected_cash  INTEGER,
  counted_cash   INTEGER,
  difference     INTEGER,                      -- + sobrante / - faltante
  notes          TEXT
);
-- Solo una caja abierta a la vez
CREATE UNIQUE INDEX idx_one_open_session ON cash_sessions(status) WHERE status = 'open';

-- ---------- Promociones y combos ----------
CREATE TABLE promotions (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('combo','item_pct')),
  discount_pct REAL NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
  starts_at    TEXT,
  ends_at      TEXT,
  priority     INTEGER NOT NULL DEFAULT 0,  -- mayor = se evalúa primero
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- combo: todas las reglas deben cumplirse (p.ej. 1 bolso + 1 accesorio)
-- item_pct: cualquier artículo que cumpla una regla recibe el descuento
CREATE TABLE promotion_rules (
  id           INTEGER PRIMARY KEY,
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  category_id  INTEGER REFERENCES categories(id),
  product_id   INTEGER REFERENCES products(id),
  qty          INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  CHECK (category_id IS NOT NULL OR product_id IS NOT NULL)
);

-- ---------- Ventas ----------
CREATE TABLE sales (
  id               INTEGER PRIMARY KEY,
  doc_kind         TEXT NOT NULL CHECK (doc_kind IN ('factura','comprobante')),
  doc_number       TEXT NOT NULL UNIQUE,
  cai_id           INTEGER REFERENCES fiscal_cai(id),
  cai              TEXT,
  cai_deadline     TEXT,
  cai_range_text   TEXT,
  customer_id      INTEGER REFERENCES customers(id),
  customer_name    TEXT NOT NULL DEFAULT 'Consumidor Final',
  customer_rtn     TEXT,
  cash_session_id  INTEGER NOT NULL REFERENCES cash_sessions(id),
  user_id          INTEGER REFERENCES users(id),
  gross_amount     INTEGER NOT NULL,   -- suma precios con ISV antes de descuentos
  discount_amount  INTEGER NOT NULL DEFAULT 0,
  exempt_amount    INTEGER NOT NULL DEFAULT 0,
  taxable15_amount INTEGER NOT NULL DEFAULT 0,  -- importe gravado 15 % (sin ISV)
  taxable18_amount INTEGER NOT NULL DEFAULT 0,  -- importe gravado 18 % (sin ISV)
  tax15_amount     INTEGER NOT NULL DEFAULT 0,
  tax18_amount     INTEGER NOT NULL DEFAULT 0,
  total            INTEGER NOT NULL,
  cost_total       INTEGER NOT NULL DEFAULT 0,  -- costo de ventas
  -- Campos requeridos por el Reglamento de Facturación para compras exentas/exoneradas
  exempt_order_number   TEXT,
  exoneration_record    TEXT,
  sag_registration      TEXT,
  status           TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','voided')),
  void_reason      TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sales_customer ON sales(customer_id);
CREATE INDEX idx_sales_session ON sales(cash_session_id);

CREATE TABLE sale_items (
  id            INTEGER PRIMARY KEY,
  sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id    INTEGER NOT NULL REFERENCES product_variants(id),
  description   TEXT NOT NULL,         -- copia congelada del nombre
  qty           INTEGER NOT NULL CHECK (qty > 0),
  unit_price    INTEGER NOT NULL,      -- con ISV
  unit_cost     INTEGER NOT NULL,
  discount      INTEGER NOT NULL DEFAULT 0,
  tax_rate      REAL NOT NULL,
  line_total    INTEGER NOT NULL,      -- qty*unit_price - discount
  promotion_id  INTEGER REFERENCES promotions(id)
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_variant ON sale_items(variant_id);

CREATE TABLE sale_payments (
  id        INTEGER PRIMARY KEY,
  sale_id   INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method    TEXT NOT NULL CHECK (method IN ('cash','card','transfer','credit')),
  amount    INTEGER NOT NULL CHECK (amount > 0),  -- monto aplicado a la venta
  tendered  INTEGER,                   -- efectivo recibido (para calcular cambio)
  reference TEXT                       -- voucher / # transferencia
);

-- Cuentas por cobrar (ventas al crédito)
CREATE TABLE receivables (
  id              INTEGER PRIMARY KEY,
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  sale_id         INTEGER REFERENCES sales(id),
  original_amount INTEGER NOT NULL,
  balance         INTEGER NOT NULL,
  due_date        TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','cancelled')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_receivables_customer ON receivables(customer_id, status);

CREATE TABLE receivable_payments (
  id              INTEGER PRIMARY KEY,
  receivable_id   INTEGER NOT NULL REFERENCES receivables(id),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  method          TEXT NOT NULL CHECK (method IN ('cash','card','transfer')),
  cash_session_id INTEGER REFERENCES cash_sessions(id),
  reference       TEXT,
  created_at      TEXT NOT NULL
);

-- ---------- Gastos y movimientos de caja ----------
CREATE TABLE expenses (
  id              INTEGER PRIMARY KEY,
  expense_date    TEXT NOT NULL,
  category        TEXT NOT NULL,       -- alquiler, luz, publicidad, menores...
  description     TEXT,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  payment_method  TEXT NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash','card','transfer')),
  supplier_id     INTEGER REFERENCES suppliers(id),
  cash_session_id INTEGER REFERENCES cash_sessions(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_expenses_date ON expenses(expense_date);

CREATE TABLE cash_movements (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES cash_sessions(id),
  type        TEXT NOT NULL CHECK (type IN ('expense','withdrawal','deposit')),
  amount      INTEGER NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  expense_id  INTEGER REFERENCES expenses(id),
  created_at  TEXT NOT NULL
);

-- ---------- Demanda insatisfecha ----------
CREATE TABLE unmet_demand (
  id             INTEGER PRIMARY KEY,
  description    TEXT NOT NULL,
  reason         TEXT NOT NULL DEFAULT 'sin_stock'
                 CHECK (reason IN ('sin_stock','no_manejamos','talla','color','precio','otro')),
  category_id    INTEGER REFERENCES categories(id),
  variant_id     INTEGER REFERENCES product_variants(id),
  size           TEXT,
  color          TEXT,
  qty            INTEGER NOT NULL DEFAULT 1,
  customer_name  TEXT,
  customer_phone TEXT,                 -- para avisarle cuando llegue
  status         TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','pedido','atendido','descartado')),
  notes          TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_unmet_created ON unmet_demand(created_at);

-- ---------- Vistas ----------
CREATE VIEW v_variants AS
SELECT v.id, v.product_id, v.sku, v.barcode, v.size, v.color, v.cost, v.price, v.stock,
       COALESCE(v.min_stock, c.min_stock) AS min_stock,
       v.last_sold_at, v.last_received_at, v.created_at, v.active,
       p.name AS product_name, p.brand, p.code AS product_code,
       p.category_id, c.name AS category_name,
       COALESCE(tp.rate, tc.rate, 15.0) AS tax_rate
FROM product_variants v
JOIN products p   ON p.id = v.product_id
JOIN categories c ON c.id = p.category_id
LEFT JOIN tax_rates tp ON tp.id = p.tax_rate_id
LEFT JOIN tax_rates tc ON tc.id = c.tax_rate_id;

CREATE VIEW v_customer_balance AS
SELECT c.id AS customer_id, c.name, c.credit_limit,
       COALESCE(SUM(CASE WHEN r.status = 'open' THEN r.balance END), 0) AS balance
FROM customers c
LEFT JOIN receivables r ON r.customer_id = c.id
GROUP BY c.id;

-- ---------- Datos base ----------
INSERT INTO tax_rates (code, name, rate) VALUES
  ('ISV15', 'ISV 15 %', 15.0),
  ('ISV18', 'ISV 18 %', 18.0),
  ('EXE',   'Exento',    0.0);

INSERT INTO settings (key, value) VALUES
  ('business_name',      'Pixel Hardstore'),
  ('business_rtn',       ''),
  ('business_address',   ''),
  ('business_phone',     ''),
  ('business_email',     ''),
  ('fiscal_mode',        'informal'),   -- informal | formal
  ('pricing_mode',       'markup'),     -- markup: costo*(1+m) | margin: costo/(1-m)
  ('default_margin_pct', '60'),
  ('price_rounding',     '500'),        -- redondear hacia arriba a L 5.00 (centavos). 0 = sin redondeo
  ('slow_moving_days',   '75'),
  ('allow_negative_stock','0'),
  ('internal_seq',       '0');

INSERT INTO users (name, username, role) VALUES ('Administrador', 'admin', 'admin');
