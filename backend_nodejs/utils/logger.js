/**
 * 日志工具 - Node.js版本
 */
const winston = require('winston');
const path = require('path');
const config = require('../config/config');

// 创建logs目录
const fs = require('fs');
if (!fs.existsSync(config.logging.directory)) {
  fs.mkdirSync(config.logging.directory, { recursive: true });
}

// 自定义日志格式
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      try {
        // 安全的JSON.stringify，处理循环引用
        log += ` ${JSON.stringify(meta, (key, value) => {
          if (typeof value === 'object' && value !== null) {
            // 跳过可能包含循环引用的对象
            if (value.constructor && (
              value.constructor.name === 'ClientRequest' ||
              value.constructor.name === 'TLSSocket' ||
              value.constructor.name === 'Socket' ||
              key === 'request' ||
              key === 'response' ||
              key === 'config'
            )) {
              return '[Circular Reference Removed]';
            }
          }
          return value;
        })}`;
      } catch (err) {
        log += ` [JSON stringify error: ${err.message}]`;
      }
    }
    
    return log;
  })
);

// 创建Winston logger实例
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  defaultMeta: { service: 'chat-ai-backend' },
  transports: [
    // 错误日志文件
    new winston.transports.File({
      filename: path.join(config.logging.directory, 'error.log'),
      level: 'error',
      maxsize: 20 * 1024 * 1024, // 20MB
      maxFiles: 5,
      tailable: true
    }),
    
    // 组合日志文件
    new winston.transports.File({
      filename: path.join(config.logging.directory, 'combined.log'),
      maxsize: 20 * 1024 * 1024, // 20MB
      maxFiles: 10,
      tailable: true
    })
  ]
});

// 开发环境添加控制台输出
if (config.server.environment !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let log = `${timestamp} [${level}]: ${message}`;
        
        if (Object.keys(meta).length > 0) {
          try {
            // 安全的JSON.stringify，处理循环引用
            log += ` ${JSON.stringify(meta, (key, value) => {
              if (typeof value === 'object' && value !== null) {
                // 跳过可能包含循环引用的对象
                if (value.constructor && (
                  value.constructor.name === 'ClientRequest' ||
                  value.constructor.name === 'TLSSocket' ||
                  value.constructor.name === 'Socket' ||
                  key === 'request' ||
                  key === 'response' ||
                  key === 'config' ||
                  key === 'stack'
                )) {
                  return '[Circular Reference Removed]';
                }
              }
              return value;
            }, null, 2)}`;
          } catch (err) {
            log += ` [JSON stringify error: ${err.message}]`;
          }
        }
        
        return log;
      })
    )
  }));
}

// 处理未捕获的异常
logger.exceptions.handle(
  new winston.transports.File({
    filename: path.join(config.logging.directory, 'exceptions.log')
  })
);

// 处理未处理的Promise拒绝
logger.rejections.handle(
  new winston.transports.File({
    filename: path.join(config.logging.directory, 'rejections.log')
  })
);

module.exports = logger;
