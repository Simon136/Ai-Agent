/**
 * API路由处理器 - Node.js版本
 * 对应原Python api_routes.py
 */
const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult, param } = require('express-validator');
const multer = require('multer');
const database = require('../database/adaptedConnection'); // 使用适配的数据库连接
const s3Utils = require('../services/s3Utils');
const logger = require('../utils/logger');
const config = require('../config/config');

const router = express.Router();

// 配置multer用于文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize
  },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.toLowerCase().split('.').pop();
    if (config.upload.allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${ext}`), false);
    }
  }
});

// 验证中间件
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

// 用户注册/登录 (对应原Python registration函数)
router.post('/registration',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('user_name').notEmpty().withMessage('User name is required'),
    body('email').isEmail().withMessage('Valid email is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, user_name, email } = req.body;
      
      // 检查用户是否存在
      const existingUser = await database.getUserByUserId(user_id);
      
      if (existingUser) {
        // 更新最后登录时间
        await database.updateUserLastLogin(user_id);
        logger.info(`用户 ${user_id} 登录成功`);
        return res.json({ 
          status: 'ok', 
          user: user_id,
          message: 'User login successful'
        });
      }
      
      // 创建新用户
      const newUser = await database.addUser(user_id, user_name, email);
      logger.info(`新用户 ${user_id} 注册成功`);
      
      res.json({
        status: 'success in creation',
        user: {
          user_id: newUser.user_id,
          username: newUser.username,
          email: newUser.email
        }
      });
    } catch (error) {
      logger.error('用户注册/登录失败:', error);
      res.status(500).json({
        error: 'Registration/login failed',
        message: error.message
      });
    }
  }
);

// 获取用户对话列表 (对应原Python get_conversations函数)
router.post('/conversations',
  [
    body('user_id').notEmpty().withMessage('User ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id } = req.body;
      
      const conversations = await database.getConversationsByUser(user_id);
      logger.info(`获取用户 ${user_id} 的对话列表，共 ${conversations.length} 个对话`);
      
      res.json({
        data: {
          conversations: conversations.map(conv => ({
            id: conv.conversation_id,
            title: conv.title,
            created_at: conv.created_at,
            updated_at: conv.updated_at
          }))
        }
      });
    } catch (error) {
      logger.error('获取对话列表失败:', error);
      res.status(500).json({
        error: 'Failed to get conversations',
        message: error.message
      });
    }
  }
);

// 获取对话历史记录 (对应原Python get_conversation_history函数)
router.post('/conversation_history',
  [
    body('conversation_id').notEmpty().withMessage('Conversation ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { conversation_id } = req.body;
      
      const messages = await database.getMessagesByConversation(conversation_id);
      logger.info(`获取对话 ${conversation_id} 的历史记录，共 ${messages.length} 条消息`);
      
      res.json({
        messages: messages.map(msg => ({
          id: msg.message_id,
          question: msg.question,
          answers: msg.answers,
          image_url: msg.image_url,
          order: msg.message_order,
          created_at: msg.created_at
        }))
      });
    } catch (error) {
      logger.error('获取对话历史失败:', error);
      res.status(500).json({
        error: 'Failed to get conversation history',
        message: error.message
      });
    }
  }
);

// 创建新对话 (对应原Python create_conversation函数)
router.post('/create_conversation',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('title').optional().isString().withMessage('Title must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, title = 'New Conversation' } = req.body;
      
      // 确保用户存在 - 如果不存在则自动创建
      const existingUser = await database.getUserByUserId(user_id);
      if (!existingUser) {
        logger.info(`用户 ${user_id} 不存在，自动创建用户`);
        try {
          // 自动创建用户，使用 user_id 作为默认用户名和邮箱
          await database.addUser(user_id, `User_${user_id.substring(0, 8)}`, `${user_id}@auto.generated`);
        } catch (userCreateError) {
          // 如果创建用户失败（可能是并发问题），检查用户是否已存在
          const recheckUser = await database.getUserByUserId(user_id);
          if (!recheckUser) {
            throw new Error(`Failed to create user: ${userCreateError.message}`);
          }
        }
      }
      
      const conversation = await database.createConversation(user_id, title);
      logger.info(`用户 ${user_id} 创建新对话 ${conversation.conversation_id}`);
      
      res.json({
        status: 'success',
        conversation: {
          id: conversation.conversation_id,
          title: conversation.title,
          user_id: conversation.user_id
        }
      });
    } catch (error) {
      logger.error('创建对话失败:', error);
      res.status(500).json({
        error: 'Failed to create conversation',
        message: error.message
      });
    }
  }
);

// 为前端兼容性添加路由别名
router.post('/conversation', 
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('title').optional().isString().withMessage('Title must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, title = 'New Conversation' } = req.body;
      
      // 确保用户存在 - 如果不存在则自动创建
      const existingUser = await database.getUserByUserId(user_id);
      if (!existingUser) {
        logger.info(`用户 ${user_id} 不存在，自动创建用户`);
        try {
          // 自动创建用户，使用 user_id 作为默认用户名和邮箱
          await database.addUser(user_id, `User_${user_id.substring(0, 8)}`, `${user_id}@auto.generated`);
        } catch (userCreateError) {
          // 如果创建用户失败（可能是并发问题），检查用户是否已存在
          const recheckUser = await database.getUserByUserId(user_id);
          if (!recheckUser) {
            throw new Error(`Failed to create user: ${userCreateError.message}`);
          }
        }
      }
      
      // 使用适配的数据库连接方法（自动生成ID）
      const conversation = await database.createConversation(user_id, title);
      logger.info(`用户 ${user_id} 创建新对话 ${conversation.conversation_id}`);
      
      res.json({
        status: 'success',
        conversation: {
          id: conversation.conversation_id,
          title: conversation.title,
          user_id: conversation.user_id,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at
        }
      });
    } catch (error) {
      logger.error('创建对话失败:', error);
      res.status(500).json({
        error: 'Failed to create conversation',
        message: error.message
      });
    }
  }
);

// 更新对话标题 (对应原Python update_conversation函数)
router.post('/update_conversation',
  [
    body('conversation_id').notEmpty().withMessage('Conversation ID is required'),
    body('title').notEmpty().withMessage('Title is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { conversation_id, title } = req.body;
      
      await database.updateConversationTitle(conversation_id, title);
      logger.info(`更新对话 ${conversation_id} 标题为: ${title}`);
      
      res.json({
        status: 'success',
        message: 'Conversation title updated'
      });
    } catch (error) {
      logger.error('更新对话标题失败:', error);
      res.status(500).json({
        error: 'Failed to update conversation title',
        message: error.message
      });
    }
  }
);

// 更新对话标题 - PUT方法
router.put('/conversation/:id',
  [
    param('id').notEmpty().withMessage('Conversation ID is required'),
    body('title').notEmpty().withMessage('Title is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const conversation_id = req.params.id;
      const { title } = req.body;
      
      await database.updateConversationTitle(conversation_id, title);
      logger.info(`对话 ${conversation_id} 标题更新为: ${title}`);
      
      res.json({
        status: 'success',
        message: 'Conversation title updated successfully'
      });
    } catch (error) {
      logger.error('更新对话标题失败:', error);
      res.status(500).json({
        error: 'Failed to update conversation title',
        message: error.message
      });
    }
  }
);

// 删除对话 (对应原Python delete_conversation函数)
router.post('/delete_conversation',
  [
    body('conversation_id').isNumeric().withMessage('Conversation ID must be a number')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { conversation_id } = req.body;
      
      // 确保 conversation_id 是数字类型
      const conversationId = parseInt(conversation_id);
      
      if (isNaN(conversationId)) {
        return res.status(400).json({
          status: 'error',
          message: 'Invalid conversation ID'
        });
      }
      
      await database.deleteConversation(conversationId);
      logger.info(`删除对话 ${conversationId}`);
      
      res.json({
        status: 'success',
        message: 'Conversation deleted'
      });
    } catch (error) {
      logger.error('删除对话失败:', error);
      res.status(500).json({
        error: 'Failed to delete conversation',
        message: error.message
      });
    }
  }
);

// 清除会话 (清空对话历史)
router.post('/clearsession/:id',
  [
    param('id').notEmpty().withMessage('Conversation ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const conversation_id = req.params.id;
      
      // 删除对话中的所有消息
      await database.clearConversationMessages(conversation_id);
      logger.info(`清除对话 ${conversation_id} 的所有消息`);
      
      res.json({
        status: 'success',
        message: 'Conversation cleared successfully'
      });
    } catch (error) {
      logger.error('清除对话失败:', error);
      res.status(500).json({
        error: 'Failed to clear conversation',
        message: error.message
      });
    }
  }
);

// 文件上传到S3 (对应原Python upload_image函数)
router.post('/upload_image',
  upload.single('image'),
  [
    body('user_id').optional().isString().withMessage('User ID must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'No file uploaded'
        });
      }

      // 检查是否提供了user_id，如果有则使用用户专属路径
      const { user_id } = req.body;
      let fileKey;
      
      if (user_id) {
        // 使用用户专属路径
        fileKey = s3Utils.generateS3Key(user_id, req.file.originalname);
      } else {
        // 使用传统路径保持兼容性
        fileKey = s3Utils.generateS3KeyLegacy(req.file.originalname);
      }
      
      const s3Url = await s3Utils.uploadToS3(req.file.buffer, fileKey, req.file.mimetype);
      
      logger.info(`文件上传成功: ${fileKey} ${user_id ? `(用户: ${user_id})` : '(通用)'}`);
      
      res.json({
        status: 'success',
        s3_url: s3Url,
        file_key: fileKey
      });
    } catch (error) {
      logger.error('文件上传失败:', error);
      res.status(500).json({
        error: 'File upload failed',
        message: error.message
      });
    }
  }
);

// 删除S3文件 (对应原Python delete_image函数)
router.post('/delete_image',
  [
    body('file_key').notEmpty().withMessage('File key is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { file_key } = req.body;
      
      await s3Utils.deleteS3Object(file_key);
      logger.info(`删除S3文件: ${file_key}`);
      
      res.json({
        status: 'success',
        message: 'File deleted'
      });
    } catch (error) {
      logger.error('删除文件失败:', error);
      res.status(500).json({
        error: 'File deletion failed',
        message: error.message
      });
    }
  }
);

// 上传图片到S3 - 别名路由
router.post('/upload_image_s3', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided'
      });
    }

    const { user_id } = req.body;
    if (!user_id) {
      return res.status(400).json({
        error: 'User ID is required'
      });
    }

    const uploadResult = await s3Utils.uploadImage(req.file, user_id);
    logger.info(`用户 ${user_id} 上传图片到S3: ${uploadResult.url}`);

    res.json({
      status: 'success',
      image_url: uploadResult.url,
      image_key: uploadResult.key
    });
  } catch (error) {
    logger.error('上传图片到S3失败:', error);
    res.status(500).json({
      error: 'Failed to upload image to S3',
      message: error.message
    });
  }
});

// 获取/更新用户偏好 (对应原Python相关函数，使用users表的custom_metadata字段)
router.post('/user_preferences',
  [
    body('user_id').notEmpty().withMessage('User ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id } = req.body;
      
      const preferences = await database.getUserPreferences(user_id);
      
      res.json({
        preferences: preferences || {
          view_type: 1,
          selected_models: [],
          conversation_id: null,
          current_conversation_id: null
        }
      });
    } catch (error) {
      logger.error('获取用户偏好失败:', error);
      res.status(500).json({
        error: 'Failed to get user preferences',
        message: error.message
      });
    }
  }
);

router.post('/update_user_preferences',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('view_type').optional().isInt({ min: 1, max: 3 }).withMessage('View type must be 1, 2, or 3'),
    body('selected_models').optional().isArray().withMessage('Selected models must be an array'),
    body('conversation_id').optional().isNumeric().withMessage('Conversation ID must be numeric'),
    body('current_conversation_id').optional().isNumeric().withMessage('Current conversation ID must be numeric')
  ],
  handleValidationErrors,

  // logger.info(req.body, '更新用户偏好请求'),

  async (req, res) => {
    try {
      // 添加详细的请求日志
      logger.info('📥 收到 /update_user_preferences 请求');
      logger.info('📋 原始请求体:', JSON.stringify(req.body, null, 2));
      logger.info('📋 请求体类型:', typeof req.body);
      
      const { user_id, view_type, selected_models, conversation_id, current_conversation_id } = req.body;
      
      // 详细分析每个字段
      logger.info('🔍 解析后的字段:');
      logger.info(`  - user_id: ${user_id} (${typeof user_id})`);
      logger.info(`  - view_type: ${view_type} (${typeof view_type})`);
      logger.info(`  - selected_models: ${JSON.stringify(selected_models)} (${typeof selected_models})`);
      logger.info(`  - selected_models 是否为数组: ${Array.isArray(selected_models)}`);
      logger.info(`  - selected_models 长度: ${selected_models ? selected_models.length : 'N/A'}`);
      logger.info(`  - conversation_id: ${conversation_id} (${typeof conversation_id})`);
      logger.info(`  - current_conversation_id: ${current_conversation_id} (${typeof current_conversation_id})`);
      
      // 构建偏好设置对象（只包含提供的字段）
      const preferences = {};
      if (view_type !== undefined) {
        preferences.view_type = view_type;
        logger.info(`✅ 添加 view_type: ${view_type}`);
      }
      if (selected_models !== undefined) {
        preferences.selected_models = selected_models;
        logger.info(`✅ 添加 selected_models: ${JSON.stringify(selected_models)}`);
      }
      if (conversation_id !== undefined) {
        preferences.conversation_id = conversation_id;
        logger.info(`✅ 添加 conversation_id: ${conversation_id}`);
      }
      if (current_conversation_id !== undefined) {
        preferences.current_conversation_id = current_conversation_id;
        logger.info(`✅ 添加 current_conversation_id: ${current_conversation_id}`);
      }
      
      logger.info('🔧 构建的偏好设置对象:', JSON.stringify(preferences, null, 2));
      
      // 调用数据库保存前的日志
      logger.info('💾 即将调用 database.saveUserPreferences...');
      await database.saveUserPreferences(user_id, preferences);
      logger.info(`✅ 用户 ${user_id} 的偏好设置保存成功`);
      
      res.json({
        status: 'success',
        message: 'User preferences updated'
      });
    } catch (error) {
      logger.error('❌ 更新用户偏好失败:', error);
      logger.error('❌ 错误堆栈:', error.stack);
      res.status(500).json({
        error: 'Failed to update user preferences',
        message: error.message
      });
    }
  }
);

// Azure验证路由 (对应原Python verify_azure_token函数)
router.post('/verify_azure_token',
  [
    body('access_token').notEmpty().withMessage('Access token is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // 这里应该实现Azure令牌验证逻辑
      // 暂时返回成功状态，实际项目中需要实现真正的验证
      const { access_token } = req.body;
      
      // TODO: 实现Azure令牌验证
      logger.info('Azure令牌验证请求');
      
      res.json({
        status: 'ok',
        message: 'Token verified'
      });
    } catch (error) {
      logger.error('Azure令牌验证失败:', error);
      res.status(500).json({
        error: 'Token verification failed',
        message: error.message
      });
    }
  }
);

// Azure token验证 (对应原Python azure_verify函数)
router.post('/azure_verify', 
  [
    body('access_token').notEmpty().withMessage('Access token is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { access_token } = req.body;

      // 基本的token验证
      // 在生产环境中，你应该使用 msal 或 jwt 库验证 access_token 的有效性
      // 包括验证签名、aud、iss等
      if (!access_token || access_token.trim() === '') {
        return res.status(401).json({
          status: 'fail',
          message: 'Invalid access token'
        });
      }

      // 可选：调用Microsoft Graph API验证token
      try {
        const response = await axios.get('https://graph.microsoft.com/v1.0/me', {
          headers: {
            'Authorization': `Bearer ${access_token}`
          }
        });

        if (response.status === 200) {
          const userInfo = response.data;
          logger.info('Azure验证成功', { 
            userId: userInfo.id,
            email: userInfo.userPrincipalName 
          });
          
          res.json({ 
            status: 'ok',
            user: {
              id: userInfo.id,
              email: userInfo.userPrincipalName,
              displayName: userInfo.displayName
            }
          });
        } else {
          logger.warn('Azure token验证失败', { status: response.status });
          res.status(401).json({
            status: 'fail',
            message: 'Token validation failed'
          });
        }
      } catch (graphError) {
        logger.error('调用Microsoft Graph API失败:', graphError.message);
        // 如果Graph API调用失败，仍然可以基于token存在性返回成功
        // 这样保持与原Python版本的兼容性
        logger.warn('回退到简单token验证');
        res.json({ status: 'ok' });
      }
      
    } catch (error) {
      logger.error('Azure验证处理失败:', error);
      res.status(500).json({
        error: 'Azure verification failed',
        message: error.message
      });
    }
  }
);

// Azure配置获取 (对应原Python Azure配置接口)
router.get('/azure_config', (req, res) => {
  try {
    const azureConfig = {
      clientId: config.azure.clientId,
      authority: config.azure.authority,
      redirectUri: config.azure.redirectUri
    };

    // 检查必要的Azure配置是否存在
    if (!azureConfig.clientId) {
      return res.status(400).json({
        error: 'Azure配置不完整',
        message: 'AZURE_CLIENT_ID 环境变量未设置'
      });
    }

    logger.info('返回Azure配置', { 
      clientId: azureConfig.clientId,
      authority: azureConfig.authority
    });

    res.json(azureConfig);
  } catch (error) {
    logger.error('获取Azure配置失败:', error);
    res.status(500).json({
      error: 'Failed to get Azure config',
      message: error.message
    });
  }
});

// 健康检查路由
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: database.isConnectionAlive() ? 'connected' : 'disconnected'
  });
});

// 获取对话详情 (对应原Python conversation/<cid> GET)
router.get('/conversation/:cid', 
  [
    param('cid').notEmpty().withMessage('Conversation ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const conversationId = req.params.cid;
      
      logger.info('获取对话详情', { conversationId });
      
      // 获取对话信息
      const conversation = await database.getConversation(conversationId);
      
      if (!conversation) {
        return res.status(404).json({
          error: 'Conversation not found',
          conversation_id: conversationId
        });
      }
      
      // 获取对话消息 - 使用新的Q&A格式（类似Python backend）
      const qaList = await database.getConversationQAList(conversationId);
      
      res.json({
        data: {
          conversation: conversation,
          qa_list: qaList,
          // 为了向后兼容，也保留原始的messages
          messages: await database.getMessages(conversationId)
        }
      });
      
    } catch (error) {
      logger.error('获取对话详情失败:', error);
      res.status(500).json({
        error: 'Failed to get conversation',
        message: error.message
      });
    }
  }
);

// 获取会话的Q&A列表 (对应Python backend的get_conversation_qa_list)
router.get('/conversation/:cid/qa_list', 
  [
    param('cid').notEmpty().withMessage('Conversation ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const conversationId = req.params.cid;
      
      logger.info('获取对话Q&A列表', { conversationId });
      
      // 获取对话信息
      const conversation = await database.getConversation(conversationId);
      
      if (!conversation) {
        return res.status(404).json({
          error: 'Conversation not found',
          conversation_id: conversationId
        });
      }
      
      // 获取Q&A格式的对话数据
      const qaList = await database.getConversationQAList(conversationId);
      
      res.json({
        conversation_id: conversationId,
        qa_list: qaList
      });
      
    } catch (error) {
      logger.error('获取Q&A列表失败:', error);
      res.status(500).json({
        error: 'Failed to get QA list',
        message: error.message
      });
    }
  }
);

// 保存用户选择的对话 (对应原Python get_select_conversations)
router.post('/get_select_conversations',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('conversations').notEmpty().withMessage('Conversations is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, conversations } = req.body;
      
      logger.info('保存用户选择的对话', { user_id, conversations });
      
      // 更新或插入用户偏好设置
      await database.pool.execute(`
        INSERT INTO user_preferences (user_id, conversation_id)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE 
        conversation_id = VALUES(conversation_id)
      `, [user_id, conversations]);
      
      res.json({
        status: 'success',
        message: 'User conversation selection saved'
      });
      
    } catch (error) {
      logger.error('保存用户对话选择失败:', error);
      res.status(500).json({
        error: 'Failed to save user conversation selection',
        message: error.message
      });
    }
  }
);

// 获取用户自定义元数据 (对应原Python get_custom_metadata，使用users表的custom_metadata字段)
router.post('/get_custom_metadata',
  [
    body('user_id').notEmpty().withMessage('User ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id } = req.body;
      
      logger.info('📥 收到获取用户自定义元数据请求', { user_id });
      
      // 使用新的getUserPreferences方法
      const preferences = await database.getUserPreferences(user_id);
      
      logger.info('🔍 从数据库获取的原始偏好数据:', JSON.stringify(preferences, null, 2));
      logger.info('🔍 偏好数据类型:', typeof preferences);
      
      if (preferences) {
        logger.info('📋 偏好数据字段分析:');
        logger.info(`  - view_type: ${preferences.view_type} (${typeof preferences.view_type})`);
        logger.info(`  - selected_models: ${JSON.stringify(preferences.selected_models)} (${typeof preferences.selected_models})`);
        logger.info(`  - selected_models 是否为数组: ${Array.isArray(preferences.selected_models)}`);
        logger.info(`  - selected_models 长度: ${preferences.selected_models ? preferences.selected_models.length : 'N/A'}`);
        logger.info(`  - conversation_id: ${preferences.conversation_id} (${typeof preferences.conversation_id})`);
        logger.info(`  - current_conversation_id: ${preferences.current_conversation_id} (${typeof preferences.current_conversation_id})`);
      }
      
      const responseData = {
        view_type: preferences?.view_type,
        selected_models: preferences?.selected_models || [],
        conversation_id: preferences?.conversation_id,
        current_conversation_id: preferences?.current_conversation_id
      };
      
      logger.info('📤 即将返回的响应数据:', JSON.stringify(responseData, null, 2));
      
      res.json({
        data: responseData
      });
      
    } catch (error) {
      logger.error('❌ 获取用户自定义元数据失败:', error);
      logger.error('❌ 错误堆栈:', error.stack);
      res.status(500).json({
        error: 'Failed to get user custom metadata',
        message: error.message
      });
    }
  }
);

// 获取AI模型列表 (对应原Python models)
router.get('/models', async (req, res) => {
  try {
    // 从数据库获取AI模型列表
    const dbModels = await database.getAllAiModels();
    
    // 如果数据库中没有模型，返回默认模型列表
    if (!dbModels || dbModels.length === 0) {
      logger.warn('数据库中没有AI模型，返回默认模型列表');
      const defaultModels = [
        {
          'GPT': {
            '3.5': 'gpt-3.5-turbo',
            '4': 'gpt-4',
            '4-vision': 'gpt-4-vision-preview'
          }
        }
      ];
      
      return res.json(defaultModels);
    }
    
    // 处理数据库中的模型数据，按模型名称分组
    const modelGroups = {};
    
    dbModels.forEach(model => {
      let modelVersion = model.model_version;
      let customMetadata = model.custom_metadata;
      
      // 安全地解析JSON字段
      if (typeof modelVersion === 'string') {
        try {
          modelVersion = JSON.parse(modelVersion);
        } catch (e) {
          logger.warn(`解析model_version JSON失败 (model_id: ${model.model_id}):`, e.message);
          modelVersion = {};
        }
      }
      
      if (typeof customMetadata === 'string') {
        try {
          customMetadata = JSON.parse(customMetadata);
        } catch (e) {
          logger.warn(`解析custom_metadata JSON失败 (model_id: ${model.model_id}):`, e.message);
          customMetadata = {};
        }
      }
      
      // 创建模型组
      if (modelVersion && typeof modelVersion === 'object') {
        modelGroups[model.model_name] = modelVersion;
      } else {
        // 如果没有版本信息，创建默认版本
        modelGroups[model.model_name] = {
          'default': model.model_name.toLowerCase()
        };
      }
    });
    
    // 转换为前端期望的数组格式
    const processedModels = Object.keys(modelGroups).map(modelName => {
      return {
        [modelName]: modelGroups[modelName]
      };
    });
    
    logger.info('返回AI模型列表', { count: processedModels.length });
    
    res.json(processedModels);
    
  } catch (error) {
    logger.error('获取模型列表失败:', error);
    
    // 发生错误时返回默认模型列表
    const fallbackModels = [
      {
        'GPT': {
          '3.5': 'gpt-3.5-turbo',
          '4': 'gpt-4'
        }
      }
    ];
    
    res.json(fallbackModels);
  }
});

// 保存用户选择的视图和模型 (对应原Python get_select，使用users表的custom_metadata字段)
router.post('/get_select',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('custom_metadata').isObject().withMessage('Custom metadata must be an object')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      // 添加详细的请求日志
      logger.info('📥 收到 /get_select 请求');
      logger.info('📋 原始请求体:', JSON.stringify(req.body, null, 2));
      
      const { user_id, custom_metadata } = req.body;
      
      logger.info('🔍 解析 custom_metadata:');
      logger.info(`  - custom_metadata: ${JSON.stringify(custom_metadata, null, 2)}`);
      logger.info(`  - view_type: ${custom_metadata.view_type} (${typeof custom_metadata.view_type})`);
      logger.info(`  - view: ${custom_metadata.view} (${typeof custom_metadata.view})`);
      logger.info(`  - selected_models: ${JSON.stringify(custom_metadata.selected_models)} (${typeof custom_metadata.selected_models})`);
      logger.info(`  - models: ${JSON.stringify(custom_metadata.models)} (${typeof custom_metadata.models})`);
      
      // 构建偏好设置对象 - 只包含明确提供的字段
      const preferences = {};
      
      // 只有当字段明确提供时才添加到preferences中
      if (custom_metadata.view_type !== undefined || custom_metadata.view !== undefined) {
        preferences.view_type = custom_metadata.view_type || custom_metadata.view;
        logger.info(`✅ 添加 view_type: ${preferences.view_type}`);
      }
      
      if (custom_metadata.selected_models !== undefined || custom_metadata.models !== undefined) {
        preferences.selected_models = custom_metadata.selected_models || custom_metadata.models;
        logger.info(`✅ 添加 selected_models: ${JSON.stringify(preferences.selected_models)}`);
      }
      
      logger.info('🔧 转换后的 preferences:', JSON.stringify(preferences, null, 2));
      
      // 如果有会话相关的信息，也保存
      if (custom_metadata.conversation_id !== undefined) {
        preferences.conversation_id = custom_metadata.conversation_id;
        logger.info(`✅ 添加 conversation_id: ${custom_metadata.conversation_id}`);
      }
      if (custom_metadata.current_conversation_id !== undefined) {
        preferences.current_conversation_id = custom_metadata.current_conversation_id;
        logger.info(`✅ 添加 current_conversation_id: ${custom_metadata.current_conversation_id}`);
      }
      
      logger.info('💾 即将保存偏好设置:', JSON.stringify(preferences, null, 2));
      
      // 使用新的saveUserPreferences方法
      await database.saveUserPreferences(user_id, preferences);
      
      logger.info(`✅ /get_select - 用户 ${user_id} 偏好设置保存成功`);
      
      res.json({
        status: 'success',
        message: 'User selections saved'
      });
      
    } catch (error) {
      logger.error('❌ /get_select - 保存用户选择失败:', error);
      logger.error('❌ 错误堆栈:', error.stack);
      res.status(500).json({
        error: 'Failed to save user selections',
        message: error.message
      });
    }
  }
);

// 添加AI模型 (管理员功能)
router.post('/admin/models',
  [
    body('model_name').notEmpty().withMessage('Model name is required'),
    body('model_key').notEmpty().withMessage('Model key is required'),
    body('model_url').notEmpty().withMessage('Model URL is required'),
    body('category_request').optional().isString().withMessage('Category must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { model_name, model_version, model_key, model_url, category_request, custom_metadata } = req.body;
      
      const modelData = {
        model_name,
        model_version: model_version || { version: '1.0' },
        model_key,
        model_url,
        category_request: category_request || 'text',
        custom_metadata: custom_metadata || {}
      };
      
      const newModel = await database.addAiModel(modelData);
      logger.info(`添加新AI模型: ${model_name}`);
      
      res.json({
        status: 'success',
        model: newModel
      });
    } catch (error) {
      logger.error('添加AI模型失败:', error);
      res.status(500).json({
        error: 'Failed to add AI model',
        message: error.message
      });
    }
  }
);

// 获取单个AI模型详情
router.get('/admin/models/:id',
  [
    param('id').isInt().withMessage('Model ID must be an integer')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const modelId = req.params.id;
      const model = await database.getAiModelById(modelId);
      
      if (!model) {
        return res.status(404).json({
          error: 'AI model not found'
        });
      }
      
      res.json({
        model: model
      });
    } catch (error) {
      logger.error('获取AI模型详情失败:', error);
      res.status(500).json({
        error: 'Failed to get AI model',
        message: error.message
      });
    }
  }
);

// 更新AI模型 (管理员功能)
router.put('/admin/models/:id',
  [
    param('id').isInt().withMessage('Model ID must be an integer'),
    body('model_name').optional().notEmpty().withMessage('Model name must not be empty'),
    body('model_key').optional().notEmpty().withMessage('Model key must not be empty'),
    body('model_url').optional().notEmpty().withMessage('Model URL must not be empty'),
    body('category_request').optional().isString().withMessage('Category must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const modelId = req.params.id;
      const { model_name, model_key, model_url, category_request, custom_metadata } = req.body;
      
      const updatedModelData = {
        model_name,
        model_key,
        model_url,
        category_request,
        custom_metadata
      };
      
      // 更新AI模型信息
      await database.updateAiModel(modelId, updatedModelData);
      logger.info(`更新AI模型 ${modelId}`);
      
      res.json({
        status: 'success',
        message: 'AI model updated'
      });
    } catch (error) {
      logger.error('更新AI模型失败:', error);
      res.status(500).json({
        error: 'Failed to update AI model',
        message: error.message
      });
    }
  }
);

// 删除AI模型 (管理员功能)
router.delete('/admin/models/:id',
  [
    param('id').isInt().withMessage('Model ID must be an integer')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const modelId = req.params.id;
      
      // 删除AI模型
      await database.deleteAiModel(modelId);
      logger.info(`删除AI模型 ${modelId}`);
      
      res.json({
        status: 'success',
        message: 'AI model deleted'
      });
    } catch (error) {
      logger.error('删除AI模型失败:', error);
      res.status(500).json({
        error: 'Failed to delete AI model',
        message: error.message
      });
    }
  }
);

// 获取用户自定义元数据
router.post('/user_custom_metadata',
  [
    body('user_id').notEmpty().withMessage('User ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id } = req.body;
      
      const customMetadata = await database.getUserCustomMetadata(user_id);
      
      res.json({
        custom_metadata: customMetadata
      });
    } catch (error) {
      logger.error('获取用户自定义元数据失败:', error);
      res.status(500).json({
        error: 'Failed to get user custom metadata',
        message: error.message
      });
    }
  }
);

// 更新用户自定义元数据
router.post('/update_user_custom_metadata',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('metadata').isObject().withMessage('Metadata must be an object')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, metadata } = req.body;
      
      await database.updateUserCustomMetadata(user_id, metadata);
      logger.info(`更新用户 ${user_id} 的自定义元数据:`, metadata);
      
      res.json({
        status: 'success',
        message: 'User custom metadata updated'
      });
    } catch (error) {
      logger.error('更新用户自定义元数据失败:', error);
      res.status(500).json({
        error: 'Failed to update user custom metadata',
        message: error.message
      });
    }
  }
);

// 更新用户当前会话ID
router.post('/update_current_conversation',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('conversation_id').isNumeric().withMessage('Conversation ID must be numeric')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, conversation_id } = req.body;
      
      await database.updateUserCurrentConversation(user_id, conversation_id);
      logger.info(`更新用户 ${user_id} 的当前会话ID: ${conversation_id}`);
      
      res.json({
        status: 'success',
        message: 'Current conversation updated'
      });
    } catch (error) {
      logger.error('更新用户当前会话ID失败:', error);
      res.status(500).json({
        error: 'Failed to update current conversation',
        message: error.message
      });
    }
  }
);

// 更新用户最后选择（视图、模型、会话）
router.post('/update_user_last_selection',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('view_type').isInt({ min: 1, max: 3 }).withMessage('View type must be 1, 2, or 3'),
    body('selected_models').isArray().withMessage('Selected models must be an array'),
    body('conversation_id').optional().isNumeric().withMessage('Conversation ID must be numeric')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, view_type, selected_models, conversation_id } = req.body;
      
      await database.updateUserLastSelection(user_id, view_type, selected_models, conversation_id);
      logger.info(`更新用户 ${user_id} 的最后选择:`, { view_type, selected_models, conversation_id });
      
      res.json({
        status: 'success',
        message: 'User last selection updated'
      });
    } catch (error) {
      logger.error('更新用户最后选择失败:', error);
      res.status(500).json({
        error: 'Failed to update user last selection',
        message: error.message
      });
    }
  }
);

// 调试API：获取模型详细信息
router.post('/debug_model_info',
  [
    body('model_name').notEmpty().withMessage('Model name is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { model_name } = req.body;
      
      const aiService = require('../services/aiService');
      const modelInfo = await aiService.getModelInfo(model_name);
      
      res.json({
        status: 'success',
        model_info: modelInfo
      });
    } catch (error) {
      logger.error('获取模型信息失败:', error);
      res.status(500).json({
        error: 'Failed to get model info',
        message: error.message
      });
    }
  }
);

// 图片OCR识别接口 (对应原Python的图片识别功能)
router.post('/analyze_image',
  [
    body('model_name').notEmpty().withMessage('Model name is required'),
    body('prompt').notEmpty().withMessage('Prompt is required'),
    body('image_url').optional().isURL().withMessage('Invalid image URL'),
    body('image_base64').optional().isString().withMessage('Image base64 must be a string')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { model_name, prompt, image_url, image_base64, enable_thinking } = req.body;
      
      logger.info(`收到analyze_image请求 - 模型: ${model_name}, enable_thinking: ${enable_thinking}, 有image_url: ${!!image_url}, 有image_base64: ${!!image_base64}`);
      
      // 检查是否启用思考模式（临时测试）
      if (enable_thinking === true && !image_url && !image_base64) {
        // 思考模式测试（不需要图片）
        logger.info(`启用思考模式测试 - 模型: ${model_name}`);
        
        // 设置SSE响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');
        
        // 流式回调函数
        const streamCallback = (data) => {
          try {
            const sseData = `data: ${JSON.stringify(data)}\n\n`;
            res.write(sseData);
          } catch (error) {
            logger.error('发送SSE数据失败:', error);
          }
        };

        // 调用思考模式生成
        const aiService = require('../services/aiService');
        try {
          await aiService.generateWithThinking(model_name, prompt, [], streamCallback);
          res.end();
        } catch (thinkingError) {
          logger.error('思考模式调用失败:', thinkingError);
          const errorData = {
            type: 'error',
            content: `思考模式调用失败: ${thinkingError.message}`,
            isComplete: true
          };
          res.write(`data: ${JSON.stringify(errorData)}\n\n`);
          res.end();
        }
        return; // 重要：确保思考模式处理后不继续执行OCR代码
      }
      
      // 验证至少提供一种图片数据（非思考模式时）
      if (!image_url && !image_base64) {
        return res.status(400).json({
          error: 'Either image_url or image_base64 is required'
        });
      }

      // 构建图片数据对象
      const imageData = {};
      if (image_url) {
        imageData.url = image_url;
      }
      if (image_base64) {
        imageData.base64 = image_base64;
      }

      logger.info(`开始图片OCR识别 - 模型: ${model_name}, 提示词长度: ${prompt.length}`);

      // 设置流式响应头
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      // 调用AI服务进行OCR识别（流式响应）
      const aiService = require('../services/aiService');
      const result = await aiService.analyzeImageWithOCRStream(model_name, prompt, imageData, (chunk, isComplete) => {
        if (!isComplete) {
          res.write(chunk);
        } else {
          res.end();
        }
      });
      
      logger.info(`图片OCR识别完成 - 模型: ${model_name}`);
    } catch (error) {
      logger.error('图片OCR识别失败:', error);
      res.status(500).json({
        error: 'Image analysis failed',
        message: error.message
      });
    }
  }
);

// 独立的思考模式测试路由
router.post('/test_thinking_mode',
  [
    body('prompt').notEmpty().withMessage('Prompt is required'),
    body('model_name').notEmpty().withMessage('Model name is required'),
    body('user_id').notEmpty().withMessage('User ID is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { model_name, prompt, user_id } = req.body;
      
      logger.info(`启动独立思考模式测试 - 模型: ${model_name}, 用户: ${user_id}`);
      
      // 设置SSE响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      // 流式回调函数
      const streamCallback = (data) => {
        try {
          const sseData = `data: ${JSON.stringify(data)}\n\n`;
          res.write(sseData);
        } catch (error) {
          logger.error('发送SSE数据失败:', error);
        }
      };

      // 调用思考模式生成
      const aiService = require('../services/aiService');
      await aiService.generateWithThinking(model_name, prompt, [], streamCallback);
      res.end();
      
    } catch (error) {
      logger.error('独立思考模式测试失败:', error);
      const errorData = {
        type: 'error',
        content: `思考模式失败: ${error.message}`,
        isComplete: true
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
    }
  }
);

// 上传图片并进行OCR识别 (对应原Python的完整上传+识别流程)
router.post('/upload_and_analyze_image',
  upload.single('image'),
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('model_name').notEmpty().withMessage('Model name is required'),
    body('prompt').notEmpty().withMessage('Prompt is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, model_name, prompt } = req.body;
      
      if (!req.file) {
        return res.status(400).json({
          error: 'No image file uploaded'
        });
      }

      // 生成S3键名（按用户分组）
      const fileKey = s3Utils.generateS3Key(user_id, req.file.originalname);
      
      // 上传图片到S3
      const s3Url = await s3Utils.uploadToS3(req.file.buffer, fileKey, req.file.mimetype);
      logger.info(`用户 ${user_id} 上传图片成功: ${fileKey}`);

      // 准备图片数据
      const imageData = {
        url: s3Url,
        base64: req.file.buffer.toString('base64')
      };

      // 进行OCR识别
      const aiService = require('../services/aiService');
      const analysisResult = await aiService.analyzeImageWithOCR(model_name, prompt, imageData);
      
      logger.info(`图片上传并识别完成 - 用户: ${user_id}, 模型: ${model_name}`);
      
      res.json({
        status: 'success',
        upload_info: {
          s3_url: s3Url,
          file_key: fileKey
        },
        analysis_result: analysisResult,
        model_used: model_name
      });
    } catch (error) {
      logger.error('图片上传并识别失败:', error);
      res.status(500).json({
        error: 'Upload and analysis failed',
        message: error.message
      });
    }
  }
);

// 删除用户上传的图片 (对应原Python delete_image，带用户权限验证)
router.post('/delete_user_image',
  [
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('image_url').notEmpty().withMessage('Image URL is required')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { user_id, image_url } = req.body;
      
      // 调用S3Utils的用户权限验证删除方法
      const deleteResult = await s3Utils.deleteS3ObjectWithUserValidation(image_url, user_id);
      
      if (deleteResult.success) {
        logger.info(`用户 ${user_id} 成功删除图片: ${image_url}`);
        res.json({
          status: 'success',
          message: deleteResult.message
        });
      } else {
        logger.warn(`用户 ${user_id} 删除图片失败: ${deleteResult.message}`);
        res.status(403).json({
          error: deleteResult.message
        });
      }
    } catch (error) {
      logger.error('删除用户图片失败:', error);
      res.status(500).json({
        error: 'Failed to delete user image',
        message: error.message
      });
    }
  }
);

// 测试路由
router.get('/test_thinking', (req, res) => {
  res.json({ status: 'Thinking API route is working' });
});

// 思考模式AI对话接口
router.post('/chat_with_thinking',
  [
    body('prompt').notEmpty().withMessage('Prompt is required'),
    body('model_name').notEmpty().withMessage('Model name is required'),
    body('user_id').notEmpty().withMessage('User ID is required'),
    body('conversation_history').optional().isArray().withMessage('Conversation history must be an array')
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { prompt, model_name, user_id, conversation_history = [] } = req.body;
      
      logger.info(`用户 ${user_id} 开始思考模式对话 - 模型: ${model_name}`);

      // 设置SSE响应头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // 流式回调函数
      const streamCallback = (data) => {
        try {
          const sseData = `data: ${JSON.stringify(data)}\n\n`;
          res.write(sseData);
        } catch (error) {
          logger.error('发送SSE数据失败:', error);
        }
      };

      // 调用AI服务进行思考模式生成
      const aiService = require('../services/aiService');
      const result = await aiService.generateWithThinking(
        model_name, 
        prompt, 
        conversation_history, 
        streamCallback
      );
      
      logger.info(`思考模式对话完成 - 用户: ${user_id}, 模型: ${model_name}`);
      res.end();

    } catch (error) {
      logger.error('思考模式对话失败:', error);
      
      // 发送错误信息
      const errorData = {
        type: 'error',
        content: error.message,
        isComplete: true
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
      res.end();
    }
  }
);

module.exports = router;
