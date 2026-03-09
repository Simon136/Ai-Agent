/**
 * 验证中间件 - Node.js版本
 * 对应原Python utils.py中的验证函数
 */
const logger = require('../utils/logger');

// 协议验证中间件 (对应原Python protocol_validation)
function protocolValidation(req, res, next) {
  // 检查请求协议
  const protocol = req.get('X-Forwarded-Proto') || req.protocol;
  
  // 在生产环境中强制使用HTTPS
  if (process.env.NODE_ENV === 'production' && protocol !== 'https') {
    logger.warn(`不安全的协议访问: ${protocol} from ${req.ip}`);
    return res.status(426).json({
      error: 'Upgrade Required',
      message: 'Please use HTTPS'
    });
  }

  // 检查Content-Type (仅对POST/PUT请求)
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    if (contentType && !contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      logger.warn(`不支持的Content-Type: ${contentType}`);
      return res.status(415).json({
        error: 'Unsupported Media Type',
        message: 'Content-Type must be application/json or multipart/form-data'
      });
    }
  }

  next();
}

// 用户代理验证 (对应原Python validate_user_agent_for_socket)
function validateUserAgent(userAgent) {
  if (!userAgent) {
    return false;
  }

  // 检查是否为常见的恶意用户代理
  const blockedAgents = [
    'curl',
    'wget',
    'python-requests',
    'bot',
    'crawler',
    'spider',
    'scraper'
  ];

  const lowerUserAgent = userAgent.toLowerCase();
  
  for (const blocked of blockedAgents) {
    if (lowerUserAgent.includes(blocked)) {
      logger.warn(`阻止的用户代理: ${userAgent}`);
      return false;
    }
  }

  return true;
}

// Socket连接验证
function validateSocketConnection(socket) {
  const userAgent = socket.handshake.headers['user-agent'];
  const origin = socket.handshake.headers.origin;
  const referer = socket.handshake.headers.referer;

  // 验证用户代理
  if (!validateUserAgent(userAgent)) {
    return false;
  }

  // 验证来源（仅在生产环境）
  if (process.env.NODE_ENV === 'production') {
    const allowedOrigins = process.env.CORS_ORIGINS ? 
      process.env.CORS_ORIGINS.split(',') : 
      ['http://localhost:8080'];

    if (origin && !allowedOrigins.includes(origin)) {
      logger.warn(`不允许的来源: ${origin}`);
      return false;
    }
  }

  return true;
}

// 请求速率限制检查
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分钟
const RATE_LIMIT_MAX_REQUESTS = 60;   // 每分钟最多60个请求

function rateLimitCheck(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  // 清理过期的记录
  for (const [ip, data] of requestCounts.entries()) {
    if (now - data.firstRequest > RATE_LIMIT_WINDOW) {
      requestCounts.delete(ip);
    }
  }
  
  // 检查当前IP的请求次数
  if (!requestCounts.has(clientIP)) {
    requestCounts.set(clientIP, {
      count: 1,
      firstRequest: now
    });
  } else {
    const data = requestCounts.get(clientIP);
    data.count++;
    
    if (data.count > RATE_LIMIT_MAX_REQUESTS) {
      logger.warn(`IP ${clientIP} 超过速率限制`);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded'
      });
    }
  }
  
  next();
}

// 输入验证辅助函数
function validateInput(data, rules) {
  const errors = [];
  
  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];
    
    // 必填字段检查
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
      continue;
    }
    
    // 如果字段为空且不是必填，跳过其他验证
    if (value === undefined || value === null || value === '') {
      continue;
    }
    
    // 类型检查
    if (rule.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (actualType !== rule.type) {
        errors.push(`${field} must be of type ${rule.type}`);
        continue;
      }
    }
    
    // 长度检查
    if (rule.minLength && value.length < rule.minLength) {
      errors.push(`${field} must be at least ${rule.minLength} characters long`);
    }
    
    if (rule.maxLength && value.length > rule.maxLength) {
      errors.push(`${field} must be no more than ${rule.maxLength} characters long`);
    }
    
    // 正则表达式检查
    if (rule.pattern && !rule.pattern.test(value)) {
      errors.push(`${field} format is invalid`);
    }
    
    // 自定义验证函数
    if (rule.validator && typeof rule.validator === 'function') {
      const result = rule.validator(value);
      if (result !== true) {
        errors.push(result || `${field} is invalid`);
      }
    }
  }
  
  return errors;
}

// 消息内容验证
function validateMessageContent(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }
  
  // 检查消息长度
  if (content.length > 10000) {
    return false;
  }
  
  // 检查是否包含恶意内容
  const maliciousPatterns = [
    /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /data:text\/html/gi
  ];
  
  for (const pattern of maliciousPatterns) {
    if (pattern.test(content)) {
      return false;
    }
  }
  
  return true;
}

// 文件验证
function validateFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }
  
  // 检查文件大小
  if (file.size > 10 * 1024 * 1024) { // 10MB
    return { valid: false, error: 'File too large' };
  }
  
  // 检查文件类型
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowedTypes.includes(file.mimetype)) {
    return { valid: false, error: 'Invalid file type' };
  }
  
  return { valid: true };
}

// IP地址验证
function isValidIP(ip) {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

// 请求日志中间件
function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    };
    
    if (res.statusCode >= 400) {
      logger.warn('HTTP Request Error', logData);
    } else {
      logger.info('HTTP Request', logData);
    }
  });
  
  next();
}

module.exports = {
  protocolValidation,
  validateUserAgent,
  validateSocketConnection,
  rateLimitCheck,
  validateInput,
  validateMessageContent,
  validateFile,
  isValidIP,
  requestLogger
};
