/** File del runner che l'installer scarica dal server (bundle di `@jeko/runner`). */
export const RUNNER_FILES = ['runner.js', 'mcp.js', 'hook.js'] as const;

const ps = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * Installer PowerShell (5.1 o successivo) del runner, con indirizzo del server e token già dentro.
 * Copia il runner in %LOCALAPPDATA%\jeko\bin, scrive la configurazione accanto ai dati del
 * runner, lo avvia nascosto e, se non si passa -NoAutoStart, lo fa ripartire a ogni accesso.
 */
export function installerScript(opts: { serverUrl: string; token: string; at: Date }): string {
  const lines = [
    `# Installer del runner di Jeko, generato il ${opts.at.toISOString()}.`,
    '# Contiene il token del runner: non condividerlo. Ogni nuovo installer invalida il precedente.',
    '# Uso:  powershell -ExecutionPolicy Bypass -File .\\jeko-runner-install.ps1 [-NoAutoStart]',
    'param([switch]$NoAutoStart)',
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    `$Server = ${ps(opts.serverUrl.replace(/\/+$/, ''))}`,
    `$Token = ${ps(opts.token)}`,
    '',
    '$node = Get-Command node -ErrorAction SilentlyContinue',
    "if (-not $node) { throw 'Node.js non trovato: installa Node 22 o successivo e riprova.' }",
    '$major = [int](& $node.Source -p \'process.versions.node.split(".")[0]\')',
    'if ($major -lt 22) { throw "Serve Node 22 o successivo (trovato $major)." }',
    '',
    "$Base = Join-Path $env:LOCALAPPDATA 'jeko'",
    "$Bin = Join-Path $Base 'bin'",
    "$Data = Join-Path $Base 'runner'",
    'New-Item -ItemType Directory -Force -Path $Bin, $Data | Out-Null',
    '',
    '# Un runner già installato si ferma: i turni di claude in corso restano vivi e il nuovo li riaggancia.',
    "$script = Join-Path $Bin 'runner.js'",
    'Get-CimInstance Win32_Process -Filter "Name = \'node.exe\'" |',
    '  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($script) } |',
    '  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }',
    '',
    '$headers = @{ Authorization = "Bearer $Token" }',
    `foreach ($f in ${RUNNER_FILES.map(ps).join(', ')}) {`,
    '  Write-Host "Scarico $f"',
    '  Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri "$Server/api/runner/files/$f" -OutFile (Join-Path $Bin $f)',
    '}',
    '',
    "$ws = ($Server -replace '^http', 'ws') + '/ws/runner'",
    '$config = @{ server = $ws; token = $Token } | ConvertTo-Json',
    "[IO.File]::WriteAllText((Join-Path $Data 'config.json'), $config)",
    '',
    '# Avvio nascosto, con il registro in runner.log.',
    "$cmd = Join-Path $Bin 'jeko-runner.cmd'",
    "$log = Join-Path $Data 'runner.log'",
    '[IO.File]::WriteAllText($cmd, "@`"$($node.Source)`" `"$script`" >> `"$log`" 2>&1`r`n")',
    "$vbs = Join-Path $Bin 'jeko-runner.vbs'",
    '$run = \'CreateObject("WScript.Shell").Run """\' + $cmd + \'""", 0, False\'',
    '[IO.File]::WriteAllText($vbs, $run + "`r`n")',
    '',
    "$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'jeko-runner.vbs'",
    'if ($NoAutoStart) {',
    '  Remove-Item -Force -ErrorAction SilentlyContinue $startup',
    '} else {',
    '  Copy-Item -Force $vbs $startup',
    "  Write-Host 'Il runner partirà a ogni accesso a Windows.'",
    '}',
    '',
    'Start-Process wscript.exe -ArgumentList "`"$vbs`""',
    "Write-Host 'Runner avviato, attendo che si colleghi...'",
    'for ($i = 0; $i -lt 30; $i++) {',
    '  Start-Sleep -Seconds 1',
    '  try {',
    '    $s = Invoke-RestMethod -UseBasicParsing -Uri "$Server/api/setup"',
    '    if ($s.runner.connected) { Write-Host "Runner collegato ($($s.runner.runnerId))."; exit 0 }',
    '  } catch {}',
    '}',
    'Write-Warning "Il runner non si è ancora collegato: guarda $log"',
    'exit 1',
  ];
  // BOM: PowerShell 5.1 legge senza BOM come ANSI e rovinerebbe le lettere accentate.
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
