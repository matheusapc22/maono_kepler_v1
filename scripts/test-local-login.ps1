$ErrorActionPreference = "Stop"

try {
    $webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

    $body = @{
        email    = "local.superadmin@maono.test"
        password = "MaonoLocal#2026"
    } | ConvertTo-Json

    $login = Invoke-RestMethod `
        -Uri "http://127.0.0.1:8788/api/auth/login" `
        -Method POST `
        -WebSession $webSession `
        -ContentType "application/json" `
        -Body $body

    Write-Host "==== LOGIN ===="
    $login | ConvertTo-Json -Depth 10

    $session = Invoke-RestMethod `
        -Uri "http://127.0.0.1:8788/api/session" `
        -Method GET `
        -WebSession $webSession

    Write-Host ""
    Write-Host "==== SESSION ===="
    $session | ConvertTo-Json -Depth 10

    Write-Host ""
    Write-Host "LOGIN_LOCAL_TEST_OK"
    exit 0
}
catch {
    Write-Host ""
    Write-Host "LOGIN_LOCAL_TEST_FAILED"
    Write-Host $_.Exception.Message
    exit 1
}