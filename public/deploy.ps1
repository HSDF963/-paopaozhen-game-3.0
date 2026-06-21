Write-Host "=== 跑跑镇游戏 GitHub Pages 部署 ===" -ForegroundColor Cyan
Set-Location "C:\Users\19825\Desktop\跑跑镇\deploy"

# 1. 登录 GitHub
Write-Host "`n[1/3] 登录 GitHub（浏览器将打开）..." -ForegroundColor Yellow
gh auth login --hostname github.com --web --scopes repo,workflow
if ($LASTEXITCODE -ne 0) { Write-Host "登录失败，请重试" -ForegroundColor Red; exit 1 }

# 2. 创建仓库并推送
Write-Host "`n[2/3] 创建仓库并推送代码..." -ForegroundColor Yellow
gh repo create paopaozhen-game --public --source=. --remote=origin --push
if ($LASTEXITCODE -ne 0) {
    # 如果仓库已存在，直接推送
    git remote add origin https://github.com/HSDF963/paopaozhen-game.git 2>$null
    git push -u origin master
}

# 3. 开启 GitHub Pages
Write-Host "`n[3/3] 开启 GitHub Pages..." -ForegroundColor Yellow
gh repo edit HSDF963/paopaozhen-game --enable-pages --branch master

Write-Host "`n=== 完成！===" -ForegroundColor Green
Write-Host "你的游戏链接：https://hsdf963.github.io/paopaozhen-game/" -ForegroundColor Cyan
Write-Host "（可能需要等待 1-2 分钟生效）"
