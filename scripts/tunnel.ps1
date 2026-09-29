[CmdletBinding()]
param([string]$SshHost = $env:FUELOPS_SSH_HOST)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($SshHost) -or $SshHost -notmatch '^[A-Za-z0-9][A-Za-z0-9._@-]*$') {
    throw 'Provide -SshHost or FUELOPS_SSH_HOST with an authorized SSH alias or user@host.'
}
# Use the operator's default SSH configuration and previously verified host key.
# No machine-specific alias, credential path or SSH secrets belong in this project.
Get-Command ssh.exe -ErrorAction Stop | Out-Null
Write-Host 'FuelOps: http://127.0.0.1:18090'
Write-Host 'Official simulator docs: http://127.0.0.1:18091/docs'
Write-Host 'Keep this terminal open. Ctrl+C closes the tunnel only, not the app.'
& ssh.exe -n -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -N -L '127.0.0.1:18090:127.0.0.1:18090' -L '127.0.0.1:18091:127.0.0.1:18091' $SshHost
if ($LASTEXITCODE -ne 0) { throw 'SSH tunnel failed. Check port availability, network and configured host identity.' }