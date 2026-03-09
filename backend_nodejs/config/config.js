/**
 * 应用配置文件 - Node.js版本
 * 对应原Python config.py
 */
require('dotenv').config();
const path = require('path');

const config = {
  // 服务器配置
  server: {
    port: process.env.PORT || 5001,
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    // Public repo default; set FRONTEND_URL in deployment environment
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8082'
  },

  // 数据库配置 (对应原Python SQLALCHEMY配置)
  database: {
    host: process.env.SQLALCHEMY_DATABASE_URL || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.SQLALCHEMY_DATABASE_USER || 'root',
    password: process.env.SQLALCHEMY_DATABASE_PASSWORD || '',
    database: process.env.SQLALCHEMY_DATABASE_NAME || 'chat_ai',
    connectionLimit: 10,
    charset: 'utf8mb4',
    waitForConnections: true,
    queueLimit: 0,
    supportBigNumbers: true,
    bigNumberStrings: true,
    // MySQL2连接池专用配置  
    createDatabaseTable: true,
    multipleStatements: false,
    ssl: false
  },

  // JWT配置
  jwt: {
    secret: process.env.FLASK_KEY || 'your-secret-key',
    expiresIn: '24h'
  },

  // AWS S3配置 (对应原Python AWS配置)
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET_NAME
  },

  // Azure配置 (对应原Python Azure配置)
  azure: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: process.env.AZURE_AUTHORITY,
    redirectUri: process.env.AZURE_REDIRECT_URI
  },

  // AI模型配置
  models: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL,
      organization: process.env.OPENAI_ORGANIZATION
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY
    },
    google: {
      apiKey: process.env.GOOGLE_API_KEY
    },
    azure_openai: {
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview'
    }
  },

  // 文件上传配置 (对应原Python上传配置)
  upload: {
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedExtensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'svg'], // 扩展支持更多图片格式
    uploadDir: path.join(__dirname, '../uploads'),
    tempDir: path.join(__dirname, '../temp')
  },

  // SocketIO配置 (对应原Python SOCKETIO_CONFIG)
  socketio: {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:8080",
      methods: ["GET", "POST"],
      credentials: true
    },
    pingTimeout: 120000, // 120秒
    pingInterval: 15000,  // 15秒
    maxHttpBufferSize: 10000000, // 10MB
    transports: ['websocket', 'polling'],
    allowEIO3: true
  },

  // 速率限制配置
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15分钟
    max: 100, // 限制每个IP 15分钟内最多100个请求
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'combined',
    directory: path.join(__dirname, '../logs'),
    filename: 'app-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d'
  },

  // 安全配置
  security: {
    bcryptRounds: 12,
    sessionSecret: process.env.SESSION_SECRET || 'your-session-secret',
    corsOrigins: process.env.CORS_ORIGINS ? 
      process.env.CORS_ORIGINS.split(',') : 
      ['http://localhost:8080']
  }
};

// 开发环境特殊配置
if (config.server.environment === 'development') {
  config.logging.level = 'debug';
}

// 生产环境特殊配置
if (config.server.environment === 'production') {
  config.logging.level = 'info';
  config.socketio.cors.origin = config.security.corsOrigins;
}

// 配置验证和打印函数 (对应原Python print_db_config)
config.printDbConfig = function() {
  console.log('数据库配置:');
  console.log(`  用户: ${config.database.user}`);
  console.log(`  密码: ${config.database.password ? '****' : '未设置'}`);
  console.log(`  主机: ${config.database.host}:${config.database.port}`);
  console.log(`  数据库: ${config.database.database}`);
};

// 配置验证
config.validate = function() {
  const required = [
    'database.user',
    'database.host',
    'database.database'
  ];
  
  const missing = [];
  
  required.forEach(key => {
    const keys = key.split('.');
    let current = config;
    
    for (const k of keys) {
      current = current[k];
      if (current === undefined) {
        missing.push(key);
        break;
      }
    }
  });
  
  if (missing.length > 0) {
    throw new Error(`缺少必需的配置项: ${missing.join(', ')}`);
  }
  
  return true;
};

module.exports = config;
