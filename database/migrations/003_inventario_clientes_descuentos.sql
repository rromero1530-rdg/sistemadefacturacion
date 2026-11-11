-- =====================================================================
-- 003 - Flete en lempiras, códigos por categoría, descuentos manuales,
--       factura con RTN/DNI, reimpresiones y alertas de lento movimiento por niveles
-- =====================================================================

-- Flete/aduana fijo por unidad en CENTAVOS (además del % que ya existía)
ALTER TABLE products ADD COLUMN extra_cost INTEGER NOT NULL DEFAULT 0;

-- Código de estilo por categoría: prefijo + consecutivo (JEAN-0001, JEAN-0002...)
ALTER TABLE categories ADD COLUMN code_prefix TEXT;
ALTER TABLE categories ADD COLUMN code_seq INTEGER NOT NULL DEFAULT 0;

-- Descuento manual (aparte de las promociones automáticas)
ALTER TABLE sale_items ADD COLUMN manual_discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN manual_discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN manual_discount_reason TEXT;

-- Identificación del cliente en el documento y control de reimpresiones
ALTER TABLE sales ADD COLUMN customer_dni TEXT;
ALTER TABLE sales ADD COLUMN reprint_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_customers_rtn ON customers(rtn);
CREATE INDEX idx_customers_dni ON customers(dni);
CREATE INDEX idx_purchases_supplier ON purchases(supplier_id);

-- Lento movimiento por niveles (días sin vender): 15, 30 y 60
INSERT OR IGNORE INTO settings (key, value) VALUES ('slow_moving_tiers', '15,30,60');
-- Descuento manual máximo que puede dar un cajero (el administrador no tiene límite)
INSERT OR IGNORE INTO settings (key, value) VALUES ('max_cashier_discount_pct', '10');
