param(
  [string]$RepoName = "koukyo-public-trainer",
  [string]$Description = "Koukyo public studies test prep app",
  [switch]$Private
)

$ErrorActionPreference = "Stop"

$token = $env:GITHUB_TOKEN
if (-not $token) {
  $token = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "User")
}
if (-not $token) {
  $token = [Environment]::GetEnvironmentVariable("GITHUB_TOKEN", "Machine")
}
if (-not $token) {
  throw "GITHUB_TOKEN is missing."
}

$headers = @{
  Authorization = "Bearer $token"
  Accept = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent" = "koukyo-public-deploy"
}

function Invoke-GitHub {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [switch]$AllowNotFound
  )

  $uri = "https://api.github.com$Path"
  try {
    if ($null -eq $Body) {
      return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
    }

    $json = $Body | ConvertTo-Json -Depth 30
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $json -ContentType "application/json; charset=utf-8"
  } catch {
    $response = $_.Exception.Response
    if ($AllowNotFound -and $response -and ([int]$response.StatusCode -in @(404, 409))) {
      return $null
    }
    throw
  }
}

function New-Blob {
  param(
    [string]$Owner,
    [string]$Repo,
    [string]$Path
  )

  $fullPath = Join-Path $PSScriptRoot $Path
  $bytes = [System.IO.File]::ReadAllBytes($fullPath)
  $content = [Convert]::ToBase64String($bytes)
  $blob = Invoke-GitHub -Method "POST" -Path "/repos/$Owner/$Repo/git/blobs" -Body @{
    content = $content
    encoding = "base64"
  }

  return @{
    path = $Path.Replace("\", "/")
    mode = "100644"
    type = "blob"
    sha = $blob.sha
  }
}

$user = Invoke-GitHub -Method "GET" -Path "/user"
$owner = $user.login

$repo = Invoke-GitHub -Method "GET" -Path "/repos/$owner/$RepoName" -AllowNotFound
if (-not $repo) {
  Write-Host "Creating repository $owner/$RepoName ..."
  $repo = Invoke-GitHub -Method "POST" -Path "/user/repos" -Body @{
    name = $RepoName
    description = $Description
    private = [bool]$Private
    has_issues = $false
    has_projects = $false
    has_wiki = $false
  }
} else {
  Write-Host "Using existing repository $owner/$RepoName ..."
}

$rootWithSlash = $PSScriptRoot.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar
$paths = Get-ChildItem -LiteralPath $PSScriptRoot -File -Recurse |
  Where-Object { $_.FullName -notmatch "\\.git\\" } |
  ForEach-Object { $_.FullName.Substring($rootWithSlash.Length) } |
  Sort-Object

$ref = Invoke-GitHub -Method "GET" -Path "/repos/$owner/$RepoName/git/ref/heads/main" -AllowNotFound
if (-not $ref) {
  Write-Host "Bootstrapping empty repository ..."
  $bootstrapContent = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes("`n"))
  Invoke-GitHub -Method "PUT" -Path "/repos/$owner/$RepoName/contents/.nojekyll" -Body @{
    message = "Initialize repository"
    content = $bootstrapContent
    branch = "main"
  } | Out-Null
  for ($attempt = 1; $attempt -le 6 -and -not $ref; $attempt++) {
    Start-Sleep -Seconds 2
    $ref = Invoke-GitHub -Method "GET" -Path "/repos/$owner/$RepoName/git/ref/heads/main" -AllowNotFound
  }
}

$baseTree = $null
$parents = @()
if ($ref) {
  $baseCommit = Invoke-GitHub -Method "GET" -Path "/repos/$owner/$RepoName/git/commits/$($ref.object.sha)" -AllowNotFound
  if ($baseCommit) {
    $baseTree = $baseCommit.tree.sha
    $parents = @($ref.object.sha)
  } else {
    $ref = $null
  }
}

Write-Host "Uploading files ..."
$treeItems = foreach ($path in $paths) {
  New-Blob -Owner $owner -Repo $RepoName -Path $path
}

$treeBody = @{ tree = @($treeItems) }
if ($baseTree) {
  $treeBody.base_tree = $baseTree
}
$tree = Invoke-GitHub -Method "POST" -Path "/repos/$owner/$RepoName/git/trees" -Body $treeBody

$commit = Invoke-GitHub -Method "POST" -Path "/repos/$owner/$RepoName/git/commits" -Body @{
  message = "Publish koukyo public app"
  tree = $tree.sha
  parents = $parents
}

if ($ref) {
  Invoke-GitHub -Method "PATCH" -Path "/repos/$owner/$RepoName/git/refs/heads/main" -Body @{
    sha = $commit.sha
    force = $false
  } | Out-Null
} else {
  Invoke-GitHub -Method "POST" -Path "/repos/$owner/$RepoName/git/refs" -Body @{
    ref = "refs/heads/main"
    sha = $commit.sha
  } | Out-Null
}

$pages = Invoke-GitHub -Method "GET" -Path "/repos/$owner/$RepoName/pages" -AllowNotFound
if ($pages) {
  Write-Host "Updating GitHub Pages settings ..."
  Invoke-GitHub -Method "PUT" -Path "/repos/$owner/$RepoName/pages" -Body @{
    source = @{
      branch = "main"
      path = "/"
    }
  } | Out-Null
} else {
  Write-Host "Enabling GitHub Pages ..."
  Invoke-GitHub -Method "POST" -Path "/repos/$owner/$RepoName/pages" -Body @{
    source = @{
      branch = "main"
      path = "/"
    }
  } | Out-Null
}

$repoUrl = "https://github.com/$owner/$RepoName"
$pagesUrl = "https://$owner.github.io/$RepoName/"

Write-Host ""
Write-Host "Repository: $repoUrl"
Write-Host "GitHub Pages: $pagesUrl"
Write-Host "GitHub Pages may take a few minutes to update."
