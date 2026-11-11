# Zoe Closet — Sistema de facturación, inventario y punto de venta

Sistema **100 % local** (Windows, sin suscripciones) para la tienda de ropa, accesorios y calzado **Zoe Closet**.
Preparado para la normativa de facturación de la **SAR (Honduras)** y diseñado para migrar a la nube
(PostgreSQL + servidor web) cuando se necesite.

## Instalación en la PC de la tienda (una sola vez)

El sistema se instala como **servicio de Windows**: arranca solo al encender la computadora y queda
disponible para **cualquier usuario de Windows** que inicie sesión en la PC (cada persona entra con su propio
usuario y contraseña de Zoe Closet).

Abre **PowerShell como administrador** (clic derecho en Inicio → *Terminal (Administrador)*) y ejecuta:

1. Instalar Node.js y Git (si no los tienes); luego **cierra y vuelve a abrir** PowerShell como administrador:
   ```powershell
   winget install OpenJS.NodeJS.LTS Git.Git
   ```
2. Descargar el sistema en `C:\ZoeCloset`:
   ```powershell
   git clone -b claude/vibrant-albattani-j6hz9a https://github.com/rromero1530-rdg/sistemadefacturacion.git C:\ZoeCloset
   ```
3. Ejecutar el instalador (usa tu carpeta de OneDrive para los respaldos):
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\ZoeCloset\scripts\instalar-windows.ps1
   ```
   Para otra carpeta de respaldos agrega `-BackupDir "C:\Users\TuUsuario\OneDrive\Facturacion\respaldos"`.
4. Se abre el navegador con el **asistente inicial**: crea la cuenta de **Administrador**.
5. En **Usuarios** crea una cuenta para cada persona (cajero o administrador).

Aparece el ícono **Zoe Closet** en el escritorio y el menú Inicio de todos los usuarios.

| Acción | Comando (PowerShell como administrador) |
|---|---|
| Actualizar a la última versión | `powershell -ExecutionPolicy Bypass -File C:\ZoeCloset\scripts\instalar-windows.ps1 -Update` |
| Quitar el servicio (conserva datos) | `powershell -ExecutionPolicy Bypass -File C:\ZoeCloset\scripts\instalar-windows.ps1 -Uninstall` |
| Ver registro del servidor | `notepad C:\ProgramData\ZoeCloset\logs\servidor.log` |

### ¿Dónde se guarda cada cosa?

| Qué | Dónde | Por qué |
|---|---|---|
| Programa | `C:\ZoeCloset` | Todos los usuarios de Windows pueden ejecutarlo; solo un administrador puede modificarlo. |
| Base de datos viva | `C:\ProgramData\ZoeCloset\data\zoecloset.db` | Accesible por el servicio aunque nadie haya iniciado sesión. Los usuarios normales de Windows **no** pueden copiarla ni alterarla. |
| **Respaldos** | `%OneDrive%\Facturacion\respaldos` | Copias completas y consistentes que OneDrive sube a la nube. |

> ⚠️ **¿Por qué no está todo dentro de OneDrive?**
> 1. La carpeta `C:\Users\<tu usuario>\OneDrive` pertenece a tu perfil: **otros usuarios de Windows no tienen acceso**.
> 2. OneDrive puede dejar archivos "solo en la nube" y el servicio no podría arrancar antes de que inicies sesión.
> 3. OneDrive sincroniza el archivo mientras SQLite escribe en él y puede **corromper la base**.
>
> Por eso la base vive en `ProgramData` y en OneDrive se guardan los **respaldos** (al iniciar, cada 4 horas y en cada
> cierre de caja; se conservan los últimos 60). Tu información queda en `OneDrive\Facturacion` y en la nube.

**Restaurar un respaldo:** quita el servicio (`-Uninstall`), copia el respaldo deseado sobre
`C:\ProgramData\ZoeCloset\data\zoecloset.db`, borra los archivos `zoecloset.db-wal` y `zoecloset.db-shm` si existen,
y ejecuta el instalador de nuevo.

## Seguridad

- **Login propio** con usuario y contraseña; roles **Administrador** (todo) y **Cajero** (vender, caja, faltantes, clientes).
- Contraseñas guardadas con **scrypt** + sal aleatoria (nunca en texto plano). Política: mínimo 10 caracteres, letras y
  números, no puede contener el usuario ni ser común.
- Usuarios nuevos reciben una **contraseña temporal** y deben cambiarla en su primer ingreso.
- **Bloqueo de cuenta** por 15 min tras 5 intentos fallidos + límite de intentos por equipo. El mensaje de error no
  revela si el usuario existe.
- Sesiones del lado del servidor: cookie `HttpOnly` + `SameSite=Strict`; en la base solo se guarda el *hash* del
  token. Expira tras **30 min sin uso** (configurable) y a las **12 h** como máximo. Cambiar la contraseña,
  desactivar un usuario o cambiar su rol cierra sus sesiones.
- Protección **CSRF**, cabeceras de seguridad (CSP estricta sin scripts en línea, anti-clickjacking, `nosniff`).
- El **primer administrador** solo puede crearse desde la propia PC y una sola vez.
- Siempre debe existir al menos un administrador activo.
- **Bitácora de seguridad** (inicios de sesión, fallos, bloqueos, cambios de usuarios, caja y configuración) en *Usuarios*.
- El servidor solo escucha en `127.0.0.1` (no es accesible desde la red). El servicio corre con la cuenta de
  **mínimo privilegio** *Servicio local*, no como administrador.

> Si en el futuro se usa desde otra PC o tablet de la red, hay que activar HTTPS antes de cambiar `HOST`.

## Ambiente de prueba (para practicar sin ensuciar los datos reales)

Doble clic en **`scripts\prueba-windows.bat`** (o `npm run prueba:demo` y luego `npm run prueba`). Abre
`http://localhost:3001` con una franja amarilla **AMBIENTE DE PRUEBA** y datos de demostración
(`admin / Demo-Admin-2026`, `cajera / Demo-Caja-2026`). Para apagarlo, cierra la ventana negra.

- Base y respaldos propios en `%LOCALAPPDATA%\ZoeCloset-prueba` (ignora `DB_PATH` y `BACKUP_DIR` del `.env`).
- Puerto 3001 y cookie de sesión distinta: puede estar abierto junto al sistema real (puerto 3000) sin cerrarle la sesión.
- Empezar de cero: `npm run prueba:borrar` (con el ambiente apagado) y abrirlo de nuevo.

## Desarrollo (en cualquier PC)

```bash
npm install
```
```bash
npm run vendor
```
```bash
npm run seed:demo -- --with-users
```
```bash
npm run dev
```
Usuarios de prueba (solo desarrollo): `admin / Demo-Admin-2026` y `cajera / Demo-Caja-2026`. Pruebas: `npm test`.

## Estructura

```
├── database/
│   ├── migrations/001_esquema_inicial.sql   # esquema relacional completo
│   └── data/                                # pos.db (ignorado por git)
├── public/                                  # frontend (HTML + Tailwind + Lucide)
│   ├── login.html  cambiar-clave.html       # Acceso
│   ├── index.html                           # Punto de venta
│   ├── productos.html                       # Alta de productos con cálculo de precio
│   ├── usuarios.html                        # Usuarios y bitácora (solo admin)
│   ├── js/  img/                            # scripts (sin código en línea) y logo
│   └── vendor/                              # librerías descargadas (npm run vendor)
├── server/
│   ├── index.js / app.js / config.js        # arranque, Express, configuración
│   ├── db/            connection, migrate, backup, seed-demo
│   ├── repositories/  ÚNICO lugar con SQL (capa de datos)
│   ├── services/      reglas de negocio (precios, promociones, ventas, caja, fiscal, alertas, reportes)
│   ├── routes/        endpoints HTTP /api/*
│   ├── middleware/    seguridad: sesión, roles, CSRF, cabeceras, límite de intentos
│   └── lib/           dinero, fechas, errores
├── scripts/           instalar-windows.ps1, vendor.js, iniciar-windows.bat
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
| 1 | Inventario en tabla (filtros, totales al costo y a precio, Excel), entradas con proveedor y flete, ajustes por conteo | ✅ |
| 1b | Código de estilo automático por categoría (`JEAN-0001`); flete/aduana en lempiras o % | ✅ |
| 2 | POS con lector de código de barras, vista en tarjetas o lista, "solo con existencia", atajos (F2, F4, F9) | ✅ |
| 2c | Descuento manual por artículo o a toda la venta, con motivo; el cajero tiene tope (`max_cashier_discount_pct`) | ✅ |
| 2d | Factura a nombre de: RTN (14) o DNI (13) + nombre; si es nuevo se registra como cliente al cobrar | ✅ |
| 2e | Aviso emergente al agotarse un producto; ventas del día y **reimpresión** marcada "REIMPRESIÓN" | ✅ |
| 2b | Botón **Faltante / Demanda insatisfecha** (F2), con teléfono para avisar al cliente | ✅ |
| 3 | Costo bruto → gastos de importación → margen (producto > categoría > global) → ISV → redondeo | ✅ |
| 4 | Apertura, gastos/retiros, arqueo y cierre con sobrante/faltante | ✅ |
| 5 | Clientes (RTN/DNI, crédito, historial, abonos FIFO) y proveedores (datos y entradas de mercancía) | ✅ |
| 6 | Reportes: indicadores, ventas por día/semana/mes y por hora, formas de pago, vendedores, más vendidos, rentabilidad por categoría, descuentos, faltantes | ✅ |
| 7 | Fiscal SAR: C.A.I., rangos, numeración `000-001-01-00000001`, fecha límite, alertas | ✅ estructura |
| 8 | Contabilidad básica: ingresos sin ISV, costo de ventas, gastos, utilidad neta | ✅ (en Reportes) |
| 9 | Alertas: crédito vencido, stock mínimo, sin vender por niveles (`slow_moving_tiers`, por defecto 15, 30 y 60 días) | ✅ |
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
| GET/POST | `/api/auth/status` · `login` · `logout` · `setup` · `change-password` | Acceso |
| GET/POST/PATCH | `/api/users` · `/api/users/:id/reset-password` · `/api/audit` | Usuarios y bitácora (admin) |

Todas las rutas (excepto `/api/auth/*` y `/api/health`) requieren sesión; las peticiones que modifican datos
requieren la cabecera `X-Requested-With: ZoeCloset`.

## Próximos pasos sugeridos

1. Pantallas de promociones y configuración (datos del negocio, C.A.I., topes de descuento, niveles de alerta).
2. Bitácora de anulaciones de ventas con autorización de administrador.
3. Anulación de ventas y devoluciones/cambios de talla (muy comunes en ropa).
4. Impresión de etiquetas con código de barras y ticket térmico de 80 mm.
5. Envío de comprobantes por WhatsApp.
