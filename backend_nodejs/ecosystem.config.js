// PM2生产环境配置
module.exports = {
  apps: [{
    name: 'chat-ai-backend-new',
    script: './app.js',
    instances: 'max', // 使用所有CPU核心
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      PORT: 5001
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 5001,
      FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:8082'
    },
    error_file: './logs/pm2_error.log',
    out_file: './logs/pm2_out.log',
    log_file: './logs/pm2_combined.log',
    time: true,
    max_memory_restart: '1G',
    node_args: '--max-old-space-size=1024',
    
    // 监控和重启配置
    watch: false, // 生产环境不建议开启文件监控
    ignore_watch: ['node_modules', 'logs', 'uploads'],
    max_restarts: 10,
    min_uptime: '10s',
    
    // 优雅重启
    kill_timeout: 5000,
    listen_timeout: 10000,
    
    // 健康检查
    health_check_grace_period: 3000
  }]
};
