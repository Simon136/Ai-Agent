@echo off
echo 构建聊天AI新版本生产环境...

echo.
echo 1. 构建前端...
cd frontend
call npm run build
if %errorlevel% neq 0 (
    echo 前端构建失败!
    pause
    exit /b 1
)

echo.
echo 2. 检查后端依赖...
cd ..\backend_nodejs
if not exist node_modules (
    echo 安装后端依赖...
    call npm install
)

echo.
echo 3. 构建完成!
echo 前端文件: frontend\dist\
echo 后端服务: backend_nodejs\
echo.
echo 部署说明:
echo 1. 将整个项目上传到服务器 /home/chat_ai/APM-master/APM-master/
echo 2. 运行部署脚本: ./deploy-new.sh
echo.
pause
