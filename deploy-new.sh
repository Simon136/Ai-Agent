#!/bin/bash

# 聊天AI新版本部署脚本
# 使用方法: chmod +x deploy-new.sh && ./deploy-new.sh

echo "🚀 开始部署聊天AI新版本..."

# 项目路径配置（修正为正确路径）
PROJECT_ROOT="/home/chat_ai/chat_ai_new"
FRONTEND_PATH="$PROJECT_ROOT/frontend"
BACKEND_PATH="$PROJECT_ROOT/backend_nodejs"
SITE_URL="${SITE_URL:-http://localhost:8082}"

# 检查是否在正确目录
if [ ! -d "$PROJECT_ROOT" ]; then
    echo "❌ 项目目录不存在: $PROJECT_ROOT"
    echo "请确认项目路径正确"
    exit 1
fi

echo "📁 项目路径: $PROJECT_ROOT"

# 1. 进入前端目录并构建
echo "🔨 构建前端..."
cd "$FRONTEND_PATH" || exit 1

# 检查关键文件是否存在
if [ ! -f "package.json" ]; then
    echo "❌ 前端 package.json 不存在，请确认路径正确"
    exit 1
fi

# 1.1 检查 vue.config.js 配置
echo "🔧 检查 vue.config.js 配置..."
if [ -f "vue.config.js" ]; then
    echo "✅ vue.config.js 存在"
    
    # 检查是否包含正确的 publicPath 配置
    if grep -q "publicPath.*'/'" "vue.config.js"; then
        echo "✅ vue.config.js 包含正确的 publicPath: '/' 配置"
        echo "📄 vue.config.js 相关配置:"
        grep -A 1 -B 1 "publicPath" "vue.config.js"
    else
        echo "❌ vue.config.js 缺少正确的 publicPath 配置"
        echo "📄 当前 vue.config.js 内容:"
        cat "vue.config.js"
        exit 1
    fi
else
    echo "❌ vue.config.js 不存在"
    exit 1
fi

# 安装前端依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装前端依赖..."
    npm install
fi

# 清理旧的构建文件
echo "🧹 清理旧的构建文件..."
rm -rf dist

# 构建前端
echo "🏗️ 打包前端..."
NODE_ENV=production npm run build

if [ $? -ne 0 ]; then
    echo "❌ 前端构建失败"
    exit 1
fi

echo "✅ 前端构建完成"

# 1.5 检查构建结果
echo "📁 检查前端构建结果..."
if [ -f "$FRONTEND_PATH/dist/index.html" ]; then
    echo "✅ 前端构建文件存在"
    
    # 显示文件大小
    INDEX_SIZE=$(stat -c%s "$FRONTEND_PATH/dist/index.html")
    echo "📄 index.html 大小: $INDEX_SIZE bytes"
    
    # 检查资源路径
    echo "🔍 检查前端资源路径..."
    echo "✅ 前端构建成功"
    echo "📄 index.html内容:"
    cat "$FRONTEND_PATH/dist/index.html"
    echo ""
    
    # 验证具体的资源文件路径
    echo "🔍 验证资源文件路径:"
    if grep -o '/[^"]*\.\(js\|css\)' "$FRONTEND_PATH/dist/index.html"; then
        echo "✅ 找到资源文件"
    else
        echo "❌ 未找到资源文件"
    fi
        echo "📄 当前index.html内容:"
        cat "$FRONTEND_PATH/dist/index.html"
        echo ""
        echo "❌ 构建配置有问题，请检查 vue.config.js 配置"
        exit 1
    fi
    
    # 显示构建文件信息
    echo "📄 构建文件数量: $(find "$FRONTEND_PATH/dist" -type f | wc -l) 个文件"
    echo "📁 构建目录结构:"
    ls -la "$FRONTEND_PATH/dist/" | head -10
    
    # 验证关键资源文件是否存在
    echo "🔍 验证关键资源文件:"
    JS_FILES=$(find "$FRONTEND_PATH/dist/js" -name "*.js" 2>/dev/null | wc -l)
    CSS_FILES=$(find "$FRONTEND_PATH/dist/css" -name "*.css" 2>/dev/null | wc -l)
    echo "   JavaScript文件: $JS_FILES 个"
    echo "   CSS文件: $CSS_FILES 个"
    
    if [ $JS_FILES -gt 0 ] && [ $CSS_FILES -gt 0 ]; then
        echo "✅ 关键资源文件完整"
    else
        echo "⚠️ 关键资源文件可能缺失"
        ls -la "$FRONTEND_PATH/dist/" 2>/dev/null || echo "无法列出目录内容"
    fi
else
    echo "❌ 前端构建文件不存在"
    exit 1
fi

# 2. 进入后端目录
echo "🔧 准备后端..."
cd "$BACKEND_PATH" || exit 1

# 检查关键文件是否存在
if [ ! -f "app.js" ]; then
    echo "❌ 后端 app.js 不存在，请确认路径正确"
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo "❌ 后端 package.json 不存在，请确认路径正确"
    exit 1
fi

# 安装后端依赖
if [ ! -d "node_modules" ]; then
    echo "📦 安装后端依赖..."
    npm install
fi

# 创建日志目录
mkdir -p logs

# 3. 停止旧版本(如果存在)
echo "⏹️ 停止旧版本..."
pm2 stop chat-ai-backend-new 2>/dev/null || echo "没有找到运行中的新版本"
pm2 delete chat-ai-backend-new 2>/dev/null || echo "没有找到已注册的新版本进程"

# 等待进程完全停止
sleep 2

# 4. 启动新版本
echo "🚀 启动新版本后端..."
if [ -f "ecosystem.config.js" ]; then
    pm2 start ecosystem.config.js --env production
else
    echo "⚠️ ecosystem.config.js 不存在，使用直接启动方式"
    pm2 start app.js --name chat-ai-backend-new --env production
fi

if [ $? -ne 0 ]; then
    echo "❌ 后端启动失败"
    pm2 logs chat-ai-backend-new --lines 10
    exit 1
fi

# 等待服务启动
sleep 3

# 5. 保存PM2配置
pm2 save

echo "✅ 后端启动完成"

# 6. 检查服务状态
echo "📊 检查服务状态..."
pm2 status chat-ai-backend-new

# 7. 验证部署
echo ""
echo "🔍 部署验证："
echo "前端文件: $([ -f "$FRONTEND_PATH/dist/index.html" ] && echo '✅ 存在' || echo '❌ 不存在')"
echo "后端端口: $(netstat -tlnp | grep :5001 >/dev/null && echo '✅ 5001监听中' || echo '❌ 5001未监听')"
echo "PM2状态: $(pm2 describe chat-ai-backend-new >/dev/null 2>&1 && echo '✅ 运行中' || echo '❌ 未运行')"

# 8. 检查nginx配置
echo ""
echo "🔧 检查nginx配置..."

# 检查根路径的nginx配置
NGINX_ROOT_PATH=$(sudo nginx -T 2>/dev/null | grep -A 2 "location / {" | grep "root" | awk '{print $2}' | sed 's/;//')
if [ "$NGINX_ROOT_PATH" = "$FRONTEND_PATH/dist/" ]; then
    echo "✅ nginx 根路径配置正确: $NGINX_ROOT_PATH"
else
    echo "ℹ️ nginx 根路径配置:"
    echo "   nginx配置: $NGINX_ROOT_PATH"
    echo "   实际路径: $FRONTEND_PATH/dist/"
fi

# 测试nginx配置并重载
if sudo nginx -t >/dev/null 2>&1; then
    echo "✅ nginx配置语法正确"
    sudo nginx -s reload
    echo "✅ nginx配置已重载"
else
    echo "❌ nginx配置语法错误:"
    sudo nginx -t
fi

# 9. 实际访问测试
echo ""
echo "🔍 实际访问测试..."

# 测试主页访问
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SITE_URL/" 2>/dev/null || echo "000")
echo "主页访问状态码: $HTTP_STATUS"

if [ "$HTTP_STATUS" = "200" ]; then
    echo "✅ 主页可以访问"
    
    # 获取实际返回的内容
    ACTUAL_CONTENT=$(curl -s "$SITE_URL/")
    ACTUAL_SIZE=${#ACTUAL_CONTENT}
    echo "返回内容大小: $ACTUAL_SIZE bytes"
    
    echo "✅ 网站部署成功！"
else
    echo "⚠️ 主页访问异常 (状态码: $HTTP_STATUS)"
fi

# 10. 显示日志路径
echo ""
echo "📝 日志文件位置:"
echo "   错误日志: $BACKEND_PATH/logs/pm2_error.log"
echo "   输出日志: $BACKEND_PATH/logs/pm2_out.log"
echo "   nginx访问日志: /var/log/nginx/chat_ai_access.log"
echo "   nginx错误日志: /var/log/nginx/chat_ai_error.log"

# 11. 显示访问信息
echo ""
echo "🎉 部署完成!"
echo "📍 访问地址:"
echo "   网站: $SITE_URL"
echo ""
echo "🔍 查看实时日志: pm2 logs chat-ai-backend-new"
echo "🔄 重启服务: pm2 restart chat-ai-backend-new"
echo "⏹️ 停止服务: pm2 stop chat-ai-backend-new"
echo ""
echo "🛠️ 故障排除："
echo "   清除浏览器缓存: Ctrl+Shift+R 或 F12->Network->Disable cache"
echo "   监控nginx日志: sudo tail -f /var/log/nginx/chat_ai_access.log"
echo "   检查nginx配置: sudo nginx -T | grep -A 10 'location /'"
echo "   重载nginx: sudo nginx -s reload"
echo ""
echo "📁 项目目录结构:"
echo "   前端代码: $FRONTEND_PATH"
echo "   后端代码: $BACKEND_PATH"
echo "   构建文件: $FRONTEND_PATH/dist"