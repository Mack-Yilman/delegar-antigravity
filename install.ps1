# Instalador de la skill delegar-antigravity (https://github.com/Mack-Yilman/delegar-antigravity).
# Instala solo la skill (SKILL.md, LICENSE.txt, scripts/ y references/), nunca el resto del repositorio.
#
#   Con menu:  irm https://raw.githubusercontent.com/Mack-Yilman/delegar-antigravity/main/install.ps1 | iex
#   Sin menu:  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Mack-Yilman/delegar-antigravity/main/install.ps1))) -Destino claude-code
#
# Destinos: claude-code, gemini-cli, descargas, todos.
# El archivo es solo ASCII a proposito: los textos con tilde usan \uXXXX (funcion T), asi funciona
# igual en Windows PowerShell 5.1 y PowerShell 7 sin depender de la codificacion. Nunca pases una
# ruta por T: Regex.Unescape fallaria con "\U" de C:\Users.
# Sin [ValidateSet]: con "irm | iex" el param se evalua como variable vacia y la validacion rompe el script.
param([string]$Destino)

# Todo corre en un ambito hijo para no dejar variables ni preferencias en la sesion de quien usa "irm | iex".
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    $nombre = 'delegar-antigravity'
    $repo = 'Mack-Yilman/delegar-antigravity'
    $zipUrl = "https://github.com/$repo/releases/latest/download/$nombre.zip"
    $rawUrl = "https://raw.githubusercontent.com/$repo/main/skills/$nombre"
    $archivos = 'SKILL.md', 'LICENSE.txt', 'scripts/agy.mjs', 'references/modelos.md', 'references/agy-cli.md'

    function T([string]$texto) { [regex]::Unescape($texto) }

    function Ruta([string[]]$partes) {
        $ruta = $HOME
        foreach ($parte in $partes) { $ruta = Join-Path $ruta $parte }
        $ruta
    }

    function Get-Descargas {
        if ($env:OS -eq 'Windows_NT') {
            try {
                $ruta = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
                if ($ruta) { return $ruta }
            } catch { }
        }
        Ruta 'Downloads'
    }

    # Descarga la skill en una carpeta temporal: primero la ultima Release; si no la hay, la rama main.
    function Get-Skill {
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ("$nombre-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmp | Out-Null
        $zip = Join-Path $tmp "$nombre.zip"
        try {
            Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
            Expand-Archive -Path $zip -DestinationPath $tmp -Force
        } catch {
            $carpeta = Join-Path $tmp $nombre
            foreach ($archivo in $archivos) {
                $destino = Join-Path $carpeta $archivo
                New-Item -ItemType Directory -Path (Split-Path $destino) -Force | Out-Null
                Invoke-WebRequest -Uri "$rawUrl/$archivo" -OutFile $destino -UseBasicParsing
            }
            Compress-Archive -Path $carpeta -DestinationPath $zip -Force
        }
        $carpeta = Join-Path $tmp $nombre
        if (-not (Test-Path (Join-Path $carpeta 'SKILL.md'))) { throw (T 'No se encontr\u00f3 SKILL.md en la descarga.') }
        [pscustomobject]@{ Temporal = $tmp; Carpeta = $carpeta; Zip = $zip }
    }

    function Write-Hecho([string]$plataforma, [string]$ruta) {
        Write-Host ('  [OK] ' + $plataforma + ' -> ' + $ruta) -ForegroundColor Green
    }

    # Copia la skill en una carpeta de skills. Reemplaza una instalacion anterior, salvo que sea un clon de git.
    function Copy-Skill($skill, [string]$base, [string]$plataforma) {
        $destino = Join-Path $base $nombre
        if (Test-Path (Join-Path $destino '.git')) {
            Write-Warning ((T 'Omitido ') + $plataforma + ': ' + $destino + (T ' es un clon de git; actual\u00edzalo con git pull.'))
            return
        }
        if (Test-Path $destino) { Remove-Item -Path $destino -Recurse -Force }
        New-Item -ItemType Directory -Path $base -Force | Out-Null
        Copy-Item -Path $skill.Carpeta -Destination $destino -Recurse
        Write-Hecho $plataforma $destino
    }

    function Install-Destino($skill, [string]$opcion) {
        switch ($opcion) {
            'claude-code' {
                Copy-Skill $skill (Ruta '.claude', 'skills') 'Claude Code'
                Write-Host (T '       Abre una sesi\u00f3n nueva y pide, por ejemplo: delega esto a Antigravity.')
            }
            'gemini-cli' {
                Copy-Skill $skill (Ruta '.gemini', 'skills') 'Gemini CLI'
                Write-Host (T '       En Gemini CLI, /skills reload la carga sin reiniciar.')
            }
            'descargas' {
                # Solo se sobrescribe este .zip, nunca se borra nada. La carpeta puede no existir (perfil nuevo).
                $descargas = Get-Descargas
                New-Item -ItemType Directory -Path $descargas -Force | Out-Null
                $zip = Join-Path $descargas "$nombre.zip"
                Copy-Item -Path $skill.Zip -Destination $zip -Force
                Write-Hecho 'Descargas' $zip
                Write-Host (T '       Descompr\u00edmelo en la carpeta de skills de tu agente.')
            }
        }
    }

    $opciones = [ordered]@{
        '1' = 'claude-code'
        '2' = 'gemini-cli'
        '3' = 'descargas'
        '4' = 'todos'
    }

    Write-Host ''
    Write-Host 'Delegar a Antigravity: instalador' -ForegroundColor Cyan
    Write-Host (T '  Necesita Node 22 o superior y Antigravity CLI (agy) con la sesi\u00f3n iniciada.')
    Write-Host ''

    if ($Destino -and -not ($opciones.Values -contains $Destino)) {
        throw ((T 'Destino no v\u00e1lido: ') + $Destino + '. Usa: ' + ($opciones.Values -join ', '))
    }
    if (-not $Destino) {
        Write-Host (T '\u00bfD\u00f3nde quieres instalar la skill?')
        Write-Host '  1) Claude Code'
        Write-Host '  2) Gemini CLI'
        Write-Host (T '  3) Descargas (.zip para otro agente con terminal)')
        Write-Host '  4) Todos'
        $eleccion = "$(Read-Host (T 'Escribe un n\u00famero'))".Trim()
        if (-not $opciones.Contains($eleccion)) { throw ((T 'Opci\u00f3n no v\u00e1lida: ') + $eleccion) }
        $Destino = $opciones[$eleccion]
    }

    $skill = Get-Skill
    try {
        if ($Destino -eq 'todos') {
            foreach ($opcion in 'claude-code', 'gemini-cli', 'descargas') { Install-Destino $skill $opcion }
        } else {
            Install-Destino $skill $Destino
        }
        Write-Host ''
        Write-Host (T 'Listo. Licencia CC BY-NC-ND 4.0 \u00a9 2026 Mack Chirinos: uso libre, sin fines comerciales ni versiones modificadas.')
    } finally {
        Remove-Item -Path $skill.Temporal -Recurse -Force -ErrorAction SilentlyContinue
    }
}
