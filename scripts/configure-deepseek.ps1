$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot ".env.local"

Write-Host "Paste your DeepSeek API Key. Input is hidden and is not sent to chat." -ForegroundColor Cyan
$secureKey = Read-Host "DeepSeek API Key" -AsSecureString
$plainKey = [Net.NetworkCredential]::new("", $secureKey).Password

if ([string]::IsNullOrWhiteSpace($plainKey)) {
  throw "API Key cannot be empty"
}

$lines = @(
  "AGENT_PROVIDER_MODE=openai-compatible"
  "AGENT_BASE_URL=https://api.deepseek.com"
  "AGENT_API_KEY=$plainKey"
  "AGENT_MODEL=deepseek-v4-flash"
  "AGENT_MODEL_QUALITY=deepseek-v4-pro"
  "AGENT_THINKING_MODE=operation-based"
  "AGENT_TIMEOUT_MS=60000"
  "ALLOW_UNAUTHENTICATED_AGENT=1"
  "HOST=127.0.0.1"
  "PORT=3000"
  "TRUST_PROXY=0"
  "RATE_LIMIT_MAX=30"
  "RATE_LIMIT_WINDOW_MS=60000"
)

[IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))
$plainKey = $null
$secureKey.Dispose()
Remove-Variable plainKey, secureKey -ErrorAction SilentlyContinue

Write-Host "DeepSeek configuration saved to .env.local. You can close this window." -ForegroundColor Green
