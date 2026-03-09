/**
 * 主应用文件 - Node.js版本
 * 基于原Python Flask架构重构
 */
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const config = require('./config/config');
const database = require('./database/adaptedConnection'); // 使用适配的数据库连接
const apiRoutes = require('./routes/api');
const socketHandlers = require('./socket/handlers');
const { protocolValidation } = require('./middleware/validation');
const { loadModels, loadOcrModels } = require('./models/loader');
const logger = require('./utils/logger');

class ChatApp {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, config.socketio);
    
    this.models = null;
    this.ocrModels = null;
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      logger.info('开始初始化应用...');
      
      // 配置中间件
      this.setupMiddleware();
      
      // 初始化数据库
      await this.initDatabase();
      
      // 加载AI模型
      await this.loadAIModels();
      
      // 设置路由
      this.setupRoutes();
      
      // 设置WebSocket处理器
      await this.setupSocketHandlers();
      
      // 设置错误处理
      this.setupErrorHandling();
      
      logger.info('应用初始化完成');
    } catch (error) {
      logger.error('应用初始化失败:', error);
      process.exit(1);
    }
  }

  setupMiddleware() {
    // 安全中间件
    this.app.use(helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }));
    
    // 压缩响应
    this.app.use(compression());
    
    // 速率限制
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15分钟
      max: 100, // 限制每个IP 15分钟内最多100个请求
      message: {
        error: 'Too many requests from this IP, please try again later.'
      }
    });
    this.app.use('/api/', limiter);
    
    // CORS配置 - 支持多个前端端口
    const allowedOrigins = [
      config.server.frontendUrl,
      'http://localhost:8080',
      'http://localhost:8082', 
      'http://localhost:3000',
      'http://localhost:3001',
      'http://127.0.0.1:8080',
      'http://127.0.0.1:8082'
    ];
    
    this.app.use(cors({
      origin: function (origin, callback) {
        // 允许没有origin的请求(如Postman)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          logger.warn(`CORS阻止了来自 ${origin} 的请求`);
          callback(null, true); // 在开发环境中暂时允许所有来源
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
    }));
    
    // 请求解析
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    
    // 协议验证中间件
    this.app.use(protocolValidation);
    
    // 请求日志
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path} - ${req.ip}`);
      next();
    });
  }

  async initDatabase() {
    try {
      await database.initialize();
      logger.info('数据库连接成功');
    } catch (error) {
      logger.error('数据库连接失败:', error);
      throw error;
    }
  }

  async loadAIModels() {
    try {
      logger.info('正在加载AI模型...');
      this.models = await loadModels();
      this.ocrModels = await loadOcrModels();
      logger.info('AI模型加载完成');
    } catch (error) {
      logger.error('AI模型加载失败:', error);
      // 不阻止应用启动，但记录错误
      this.models = {};
      this.ocrModels = {};
    }
  }

  setupRoutes() {
    // 健康检查
    this.app.get('/health', (req, res) => {
      try {
        res.json({
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          models: this.models ? Object.keys(this.models).length : 0,
          database: database.isConnectionAlive() ? 'connected' : 'disconnected',
          memory: {
            rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
            heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB'
          },
          version: process.version
        });
      } catch (error) {
        logger.error('健康检查失败:', error);
        res.status(500).json({
          status: 'error',
          message: error.message,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // API路由
    this.app.use('/api', apiRoutes);
    
    // 404处理
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'API endpoint not found',
        path: req.originalUrl,
        method: req.method
      });
    });
  }

  async setupSocketHandlers() {
    await socketHandlers.register(this.io, this.models, this.ocrModels);
  }

  setupErrorHandling() {
    // 全局错误处理
    this.app.use((err, req, res, next) => {
      logger.error('全局错误:', err);
      
      if (res.headersSent) {
        return next(err);
      }
      
      res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
          ? 'Internal Server Error' 
          : err.message,
        timestamp: new Date().toISOString()
      });
    });
    
    // 未捕获的异常
    process.on('uncaughtException', (error) => {
      logger.error('未捕获的异常:', error);
      this.gracefulShutdown();
    });
    
    // 未处理的Promise拒绝
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('未处理的Promise拒绝:', reason);
      this.gracefulShutdown();
    });
  }

  start() {
    const port = config.server.port;
    const host = config.server.host;
    
    // 检查端口是否可用
    this.server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`端口 ${port} 已被占用，尝试使用其他端口...`);
        
        // 尝试使用下一个可用端口
        const altPort = port + 1;
        logger.info(`尝试使用端口 ${altPort}...`);
        
        this.server.listen(altPort, host, () => {
          logger.info(`🚀 服务器运行在 http://${host}:${altPort}`);
          logger.info(`📊 WebSocket服务已启动`);
          logger.info(`🔗 前端地址: ${config.server.frontendUrl}`);
          logger.info(`🌍 环境: ${config.server.environment}`);
          logger.warn(`⚠️ 注意：服务器运行在端口 ${altPort} 而不是默认端口 ${port}`);
        });
      } else {
        logger.error('服务器启动失败:', error);
        process.exit(1);
      }
    });
    
    this.server.listen(port, host, () => {
      logger.info(`🚀 服务器运行在 http://${host}:${port}`);
      logger.info(`📊 WebSocket服务已启动`);
      logger.info(`🔗 前端地址: ${config.server.frontendUrl}`);
      logger.info(`🌍 环境: ${config.server.environment}`);
    });
    
    // 优雅关闭处理
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
  }

  async gracefulShutdown() {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    logger.info('正在关闭服务器...');
    
    // 设置关闭超时
    const shutdownTimeout = setTimeout(() => {
      logger.error('强制关闭服务器');
      process.exit(1);
    }, 10000);
    
    try {
      // 停止接受新连接
      this.server.close(() => {
        logger.info('HTTP服务器已关闭');
      });
      
      // 关闭WebSocket连接
      this.io.close(() => {
        logger.info('WebSocket服务器已关闭');
      });
      
      // 关闭数据库连接
      await database.close();
      
      clearTimeout(shutdownTimeout);
      logger.info('服务器已安全关闭');
      process.exit(0);
    } catch (error) {
      logger.error('关闭服务器时出错:', error);
      process.exit(1);
    }
  }
}

// 创建并启动应用
const app = new ChatApp();

// 如果直接运行此文件，启动应用
if (require.main === module) {
  app.initialize().then(() => {
    app.start();
  }).catch((error) => {
    logger.error('启动应用失败:', error);
    process.exit(1);
  });
}

module.exports = app;
