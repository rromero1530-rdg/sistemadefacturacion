# Pixel POS — Sistema de facturación, inventario y punto de venta

Sistema **100 % local** (Windows, sin suscripciones) para tienda de ropa, accesorios y calzado de dama.
Preparado para la normativa de facturación de la **SAR (Honduras)** y diseñado para migrar a la nube
(PostgreSQL + servidor web) cuando se necesite.

## Inicio rápido (Windows)

1. Instala **Node.js 22 LTS** desde <https://nodejs.org>.
2. Clona el repositorio y entra a la carpeta:
   ```bash
   git clone https://github.com/rromero1530-rdg/sistemadefacturacion.git
   ```
   ```bash
   cd sistemadefacturacion
   ```
3. Instala dependencias y descarga las librerías de interfaz para trabajar **sin internet**:
   ```bash
   npm install
   ```
   ```bash
   npm run vendor
   ```
4. Copia `.env.example` como `.env` y ajusta `BACKUP_DIR` (ver sección OneDrive).
5. (Opcional) Carga datos de ejemplo:
   ```bash
   npm run seed:demo
   ```
6. Inicia el sistema y abre <http://localhost:3000>:
   ```bash
   npm start
   ```
   También puedes hacer doble clic en `scripts\iniciar-windows.bat`.

## Base de datos y OneDrive (importante)

> ⚠️ **No pongas el archivo `.db` vivo dentro de OneDrive.** OneDrive sincroniza el archivo mientras SQLite
> lo está escribiendo (y no entiende los archivos `-wal`/`-shm`), lo que puede **corromper la base** o generar
> copias en conflicto.

La configuración recomendada (la que trae el sistema):

| Qué | Dónde | Variable |
|---|---|---|
| Base de datos viva | Disco local: `database/data/pos.db` | `DB_PATH` |
| Respaldos automáticos | Carpeta de OneDrive | `BACKUP_DIR` |

Los respaldos se generan con la API oficial de backup de SQLite (copia consistente aunque el sistema esté en uso):

- al iniciar el servidor,
- cada `BACKUP_INTERVAL_HOURS` horas (4 por defecto),
- **al cerrar caja**,
- manualmente con `npm run backup` o `POST /api/backup`.

Se conservan los últimos `BACKUP_KEEP` archivos. Si `BACKUP_DIR` queda vacío se usa automáticamente
`%OneDriveCommercial%` (Microsoft 365 empresarial) o `%OneDrive%` + `\PixelPOS\respaldos`.

**Restaurar:** detén el sistema, copia el respaldo deseado sobre `database/data/pos.db` y vuelve a iniciar.

## Estructura

```
├── database/
│   ├── migrations/001_esquema_inicial.sql   # esquema relacional completo
│   └── data/                                # pos.db (ignorado por git)
├── public/                                  # frontend (HTML + Tailwind + Lucide)
│   ├── index.html  js/pos.js                # Punto de venta
│   ├── productos.html                       # Alta de productos con cálculo de precio
│   └── vendor/                              # librerías descargadas (npm run vendor)
├── server/
│   ├── index.js / app.js / config.js        # arranque, Express, configuración
│   ├── db/            connection, migrate, backup, seed-demo
│   ├── repositories/  ÚNICO lugar con SQL (capa de datos)
│   ├── services/      reglas de negocio (precios, promociones, ventas, caja, fiscal, alertas, reportes)
│   ├── routes/        endpoints HTTP /api/*
│   └── lib/           dinero, fechas, errores
├── scripts/           vendor.js, iniciar-windows.bat
└── tests/             pruebas (npm test)
```

**Capas:** `routes` (HTTP) → `services` (negocio, sin SQL) → `repositories` (SQL) → SQLite.
Para migrar a PostgreSQL solo se reescriben `repositories/` y `db/connection.js`; los servicios y el frontend no cambian.

## Convenciones

- **Dinero en centavos enteros** en base de datos y API (`L 1,250.50` = `125050`). Evita errores de redondeo.
- **Precios al público con ISV incluido**; el sistema separa base imponible e ISV al facturar.
- Fechas en hora local de Honduras (`TIMEZONE=America/Tegucigalpa`).

## Módulos

| # | Módulo | Estado |
|---|---|---|
| 1 | Inventario por producto / talla / color / categoría, ingreso de mercancía con costo promedio | ✅ API + alta de productos |
| 2 | POS con lector de código de barras, búsqueda, atajos (F2, F4, F9) | ✅ |
| 2b | Botón **Faltante / Demanda insatisfecha** (F2), con teléfono para avisar al cliente | ✅ |
| 3 | Costo bruto → gastos de importación → margen (producto > categoría > global) → ISV → redondeo | ✅ |
| 4 | Apertura, gastos/retiros, arqueo y cierre con sobrante/faltante | ✅ |
| 5 | Clientes (RTN, límite y días de crédito, historial, abonos FIFO) y proveedores | ✅ API |
| 6 | Reportes: ventas día/semana/mes, más vendidos, rentabilidad por categoría | ✅ API |
| 7 | Fiscal SAR: C.A.I., rangos, numeración `000-001-01-00000001`, fecha límite, alertas | ✅ estructura |
| 8 | Contabilidad básica: ingresos sin ISV, costo de ventas, gastos, utilidad neta | ✅ API |
| 9 | Alertas: crédito vencido, stock mínimo, lento movimiento | ✅ |
| 10 | Promociones: combos (bolso + accesorio −15 %) y descuentos por categoría/producto | ✅ motor (alta por API/SQL) |

### Cálculo de precio

```
costo puesto  = costo bruto × (1 + flete/aduana %)
precio base   = costo × (1 + margen)        ← pricing_mode = markup (por defecto)
              = costo ÷ (1 − margen)        ← pricing_mode = margin (margen real sobre venta)
precio final  = precio base × (1 + ISV) → redondeado hacia arriba a L 5 (price_rounding)
```

### Modo fiscal (SAR)

- **`fiscal_mode = informal`** (por defecto): emite *Comprobantes internos* `CI-00000001`, sin validez fiscal,
  y muestra un aviso permanente en el POS.
- **`fiscal_mode = formal`**: requiere un C.A.I. vigente (`POST /api/fiscal/cai`). Numera según el rango autorizado,
  bloquea la emisión si el C.A.I. venció o se agotó el rango, y alerta 30 días antes y al quedar < 10 % del rango.
  El comprobante impreso incluye RTN, C.A.I., rango, fecha límite y leyendas.

> Verifica los requisitos exactos del documento con tu contador y el Reglamento del Régimen de Facturación vigente
> de la SAR antes de activar el modo formal (formato de impresión, leyendas, imprenta autorizada o facturación electrónica).

## API principal

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/products?q=&category_id=` | Buscar variantes |
| GET | `/api/products/code/:barcode` | Lectura por código de barras |
| POST | `/api/products` | Crear producto + variantes (precio automático) |
| POST | `/api/pricing/preview` | Simular precio desde costo bruto |
| POST | `/api/inventory/receive` | Ingreso de mercancía |
| POST | `/api/sales/quote` · `/api/sales` | Cotizar carrito · registrar venta |
| GET/POST | `/api/cash/current` · `open` · `movements` · `close` | Caja |
| POST | `/api/unmet-demand` | Registrar faltante |
| GET/POST | `/api/customers` · `/api/customers/:id/payments` | Clientes y abonos |
| GET | `/api/alerts` | Alertas inteligentes |
| GET | `/api/reports/sales?group=day\|week\|month` · `top-products` · `profit-by-category` · `income-statement` · `unmet-demand` | Reportes |
| GET/PUT | `/api/settings` | Configuración |
| GET/POST | `/api/fiscal/status` · `/api/fiscal/cai` | Estado fiscal y C.A.I. |

## Desarrollo

```bash
npm run dev
```
```bash
npm test
```

## Próximos pasos sugeridos

1. Pantallas de reportes, clientes, proveedores, promociones y configuración (la API ya existe).
2. Usuarios con PIN y permisos (tabla `users` ya creada) + bitácora de anulaciones.
3. Anulación de ventas y devoluciones/cambios de talla (muy comunes en ropa).
4. Impresión de etiquetas con código de barras y ticket térmico de 80 mm.
5. Envío de comprobantes por WhatsApp.
