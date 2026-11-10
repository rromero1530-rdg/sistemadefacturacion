#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Instala Zoe Closet como servicio de Windows disponible para TODOS los usuarios de la PC.

.DESCRIPTION
  - El sistema arranca solo al encender la computadora (aunque nadie haya iniciado sesion).
  - Corre con la cuenta de minimo privilegio "Servicio local" (no como administrador).
  - Base de datos en C:\ProgramData\ZoeCloset (los usuarios normales de Windows NO pueden copiarla ni modificarla).
  - Respaldos automaticos a la carpeta de OneDrive indicada.
  - Crea el acceso directo "Zoe Closet" en el escritorio de todos los usuarios.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1
  powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1 -BackupDir "D:\OneDrive\Facturacion\respaldos"
  powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1 -Update      # descarga la ultima version y reinstala
  powershell -ExecutionPolicy Bypass -File scripts\instalar-windows.ps1 -Uninstall   # quita el servicio (conserva los datos)
#>
param(
  [string]$InstallDir = (Split-Path -Parent $PSScriptRoot),
  [string]$DataDir    = (Join-Path $env:ProgramData 'ZoeCloset'),
  [string]$BackupDir  = $(if ($env:OneDrive) { Join-Path $env:OneDrive 'Facturacion\respaldos' } else { '' }),
  [int]$Port = 3000,
  [switch]$Update,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$TaskName = 'ZoeCloset'
$Shortcuts = @(
  (Join-Path $env:PUBLIC 'Desktop\Zoe Closet.url'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Zoe Closet.url')
)
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Magenta }
function Fail($msg) { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }
function Stop-ZoeService {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
  # Detener tambien el proceso node que lanzo la tarea
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*server\index.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- Desinstalar
if ($Uninstall) {
  Step 'Quitando el servicio Zoe Closet'
  Stop-ZoeService
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
  $Shortcuts | ForEach-Object { Remove-Item $_ -ErrorAction SilentlyContinue }
  Write-Host "Listo. Tus datos se conservan en $DataDir y los respaldos en OneDrive." -ForegroundColor Green
  exit 0
}

# ---------------------------------------------------------------- Validaciones
Step 'Verificando requisitos'
$InstallDir = (Resolve-Path $InstallDir).Path
if ($InstallDir -like "$env:SystemDrive\Users\*") {
  Fail ("El programa esta en '$InstallDir' (dentro de un perfil de usuario/OneDrive).`n" +
        "  Los demas usuarios de Windows no tendrian acceso y OneDrive podria dejar archivos 'solo en la nube'.`n" +
        "  Clona el repositorio en C:\ZoeCloset y ejecuta de nuevo este instalador desde ahi.")
}
if (-not (Test-Path (Join-Path $InstallDir 'server\index.js'))) { Fail "No se encontro server\index.js en $InstallDir" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail "Node.js no esta instalado. Instalalo con:  winget install OpenJS.NodeJS.LTS   y abre una nueva ventana de PowerShell." }
$ver = [version]((& $node -v).TrimStart('v'))
if ($ver -lt [version]'20.12.0') { Fail "Se requiere Node.js 20.12 o superior (tienes $ver). Actualiza con: winget upgrade OpenJS.NodeJS.LTS" }
Write-Host "Node.js $ver  ($node)"

if (-not $BackupDir) { $BackupDir = Read-Host 'Carpeta de OneDrive para respaldos (ej. C:\Users\TuUsuario\OneDrive\Facturacion\respaldos)' }
Write-Host "Programa : $InstallDir"
Write-Host "Datos    : $DataDir"
Write-Host "Respaldos: $BackupDir"

# Cuentas por SID (funciona en Windows en espanol o ingles)
function Account($sid) { (New-Object System.Security.Principal.SecurityIdentifier $sid).Translate([System.Security.Principal.NTAccount]).Value }
$SvcAccount = Account 'S-1-5-19'   # NT AUTHORITY\Servicio local (LOCAL SERVICE)

# ---------------------------------------------------------------- Actualizar codigo
if ($Update) {
  Step 'Descargando la ultima version'
  Stop-ZoeService
  git -C $InstallDir pull --ff-only
  if ($LASTEXITCODE -ne 0) { Fail 'git pull fallo' }
}

# ---------------------------------------------------------------- Dependencias
Stop-ZoeService   # libera los archivos de node_modules y la base
Step 'Instalando dependencias (npm ci)'
Push-Location $InstallDir
try {
  & npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Fail 'npm ci fallo (revisa tu conexion a internet)' }
  Step 'Descargando librerias de interfaz para uso sin internet'
  & npm run vendor
  if ($LASTEXITCODE -ne 0) { Write-Warning 'No se pudieron descargar; el sistema usara internet para los estilos.' }
} finally { Pop-Location }

# ---------------------------------------------------------------- Carpetas y permisos
Step 'Creando carpetas y aplicando permisos'
foreach ($d in @("$DataDir\data", "$DataDir\logs", $BackupDir)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# Datos: solo SYSTEM, Administradores y la cuenta del servicio. Usuarios normales sin acceso.
icacls $DataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-19:(OI)(CI)M' /Q | Out-Null
# Programa: los usuarios pueden leerlo/ejecutarlo pero NO modificarlo (evita que alguien altere el codigo del servicio)
icacls $InstallDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' '*S-1-5-19:(OI)(CI)RX' /Q | Out-Null
# Respaldos en OneDrive: se agrega permiso al servicio (el dueno de la carpeta conserva el suyo)
icacls $BackupDir /grant '*S-1-5-19:(OI)(CI)M' /Q | Out-Null

# ---------------------------------------------------------------- Configuracion
Step 'Escribiendo configuracion (.env)'
$envFile = Join-Path $InstallDir '.env'
$content = @"
# Generado por instalar-windows.ps1 - $(Get-Date -Format 'yyyy-MM-dd HH:mm')
PORT=$Port
HOST=127.0.0.1
TIMEZONE=America/Tegucigalpa
DB_PATH=$DataDir\data\zoecloset.db
BACKUP_DIR=$BackupDir
BACKUP_INTERVAL_HOURS=4
BACKUP_KEEP=60
"@
[System.IO.File]::WriteAllText($envFile, $content, (New-Object System.Text.UTF8Encoding $false))

Step 'Preparando base de datos'
Push-Location $InstallDir
try { & $node server\db\migrate.js; if ($LASTEXITCODE -ne 0) { Fail 'La migracion de la base fallo' } } finally { Pop-Location }
icacls $DataDir /grant:r '*S-1-5-19:(OI)(CI)M' /T /Q | Out-Null   # incluye el archivo .db recien creado

# ---------------------------------------------------------------- Servicio (tarea programada al arranque)
Step "Registrando servicio '$TaskName' (cuenta: $SvcAccount)"
$log = Join-Path $DataDir 'logs\servidor.log'
if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) { Move-Item $log "$log.anterior" -Force }
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -WorkingDirectory $InstallDir `
  -Argument "/c `"`"$node`" server\index.js >> `"$log`" 2>&1`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$desc = 'Zoe Closet - sistema de facturacion e inventario (http://localhost)'
try {
  $principal = New-ScheduledTaskPrincipal -UserId $SvcAccount -LogonType ServiceAccount -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $desc -Force | Out-Null
} catch {
  Write-Warning "No se pudo usar la cuenta '$SvcAccount' ($($_.Exception.Message)). Se usara SYSTEM."
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description $desc -Force | Out-Null
}

Stop-ZoeService
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName $TaskName

Step 'Esperando a que el sistema responda'
$url = "http://localhost:$Port/"
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  Start-Sleep -Seconds 1
  try { $ok = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/api/health" -TimeoutSec 2).StatusCode -eq 200 } catch {}
}
if (-not $ok) { Fail "El servicio no respondio. Revisa el registro: $log" }

# ---------------------------------------------------------------- Accesos directos para todos los usuarios
Step 'Creando accesos directos (escritorio y menu Inicio de todos los usuarios)'
$icon = Join-Path $InstallDir 'public\favicon.ico'
foreach ($s in $Shortcuts) {
  New-Item -ItemType Directory -Force -Path (Split-Path $s) | Out-Null
  Set-Content -Path $s -Encoding ASCII -Value "[InternetShortcut]`r`nURL=$url`r`nIconFile=$icon`r`nIconIndex=0"
}

Write-Host "`nZoe Closet instalado correctamente." -ForegroundColor Green
Write-Host "Abre '$url' o el icono 'Zoe Closet' del escritorio desde cualquier usuario de Windows."
Write-Host 'La primera vez, crea la cuenta de Administrador en el asistente que aparece en pantalla.'
Start-Process $url
