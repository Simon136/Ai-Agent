/**
 * 适配现有数据库结构的数据库操作方法
 * 基于现有数据库表结构（使用自增整数ID）
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const logger = require('../utils/logger');
const { encoding_for_model } = require('tiktoken');

class AdaptedDatabase {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  async initialize() {
    try {
      // 创建连接池
      this.pool = mysql.createPool({
        host: process.env.SQLALCHEMY_DATABASE_URL || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.SQLALCHEMY_DATABASE_USER,
        password: process.env.SQLALCHEMY_DATABASE_PASSWORD,
        database: process.env.SQLALCHEMY_DATABASE_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        idleTimeout: 300000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
      });

      // 测试连接
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      
      this.isConnected = true;
      logger.info('数据库连接池初始化成功');
    } catch (error) {
      logger.error('数据库初始化失败:', error);
      throw error;
    }
  }

  async execute(query, params = []) {
    try {
      const [results] = await this.pool.execute(query, params);
      return results;
    } catch (error) {
      logger.error('数据库查询失败:', { query, params, error: error.message });
      throw error;
    }
  }

  // 用户相关操作
  async createUser(userId, username, email) {
    const result = await this.execute(
      `INSERT INTO users (user_id, username, email) 
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE 
       username = VALUES(username),
       email = VALUES(email),
       last_login = CURRENT_TIMESTAMP`,
      [userId, username, email]
    );
    return result;
  }

  async getUser(userId) {
    const [user] = await this.execute(
      'SELECT * FROM users WHERE user_id = ?',
      [userId]
    );
    return user;
  }

  // 用户相关操作 - 添加方法别名以兼容现有API
  async getUserByUserId(userId) {
    return await this.getUser(userId);
  }

  async addUser(userId, username, email) {
    return await this.createUser(userId, username, email);
  }

  async updateUserLastLogin(userId) {
    const result = await this.execute(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE user_id = ?',
      [userId]
    );
    return result;
  }

  async getConversationsByUser(userId) {
    return await this.getConversations(userId);
  }

  // 会话相关操作（适配现有结构）
  async createConversation(userId, title = 'New Chat') {
    const result = await this.execute(
      `INSERT INTO conversations (user_id, title) 
       VALUES (?, ?)`,
      [userId, title]
    );
    
    const conversationId = result.insertId;
    
    // 返回创建的会话信息
    const [conversation] = await this.execute(
      'SELECT * FROM conversations WHERE conversation_id = ?',
      [conversationId]
    );
    
    return conversation;
  }

  async getConversations(userId) {
    const conversations = await this.execute(
      `SELECT conversation_id, user_id, title, created_at, 
              COALESCE(updated_at, created_at) as updated_at 
       FROM conversations 
       WHERE user_id = ? 
       ORDER BY COALESCE(updated_at, created_at) DESC`,
      [userId]
    );
    return conversations;
  }

  async getConversation(conversationId) {
    const [conversation] = await this.execute(
      'SELECT * FROM conversations WHERE conversation_id = ?',
      [conversationId]
    );
    return conversation;
  }

  async updateConversationTitle(conversationId, title) {
    const result = await this.execute(
      'UPDATE conversations SET title = ? WHERE conversation_id = ?',
      [title, conversationId]
    );
    return result;
  }

  async deleteConversation(conversationId) {
    // 由于外键约束，删除会话时会自动删除相关消息
    const result = await this.execute(
      'DELETE FROM conversations WHERE conversation_id = ?',
      [conversationId]
    );
    return result;
  }

  // 消息相关操作（适配现有messages表结构）
  async createMessage(conversationId, content, role = 'user', imageUrl = null, messageOrder = null, functionCall = null) {
    // 如果没有指定messageOrder，获取当前会话的消息数量
    if (messageOrder === null) {
      try {
        const [countResult] = await this.execute(
          'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
          [conversationId]
        );
        messageOrder = countResult.count;
      } catch (error) {
        messageOrder = 0;
      }
    }

    // 计算tokens
    let tokens = 0;
    try {
      const enc = encoding_for_model("gpt-4");
      tokens = enc.encode(content).length;
    } catch (error) {
      logger.warn('Token计算失败:', error.message);
      tokens = Math.ceil(content.length / 4); // 简单估算：4个字符约等于1个token
    }

    // 设置默认的function_call
    if (!functionCall) {
      functionCall = { "role": role };
      if (imageUrl) {
        functionCall.has_image = true;
        if (typeof imageUrl === 'string') {
          functionCall.image_url = imageUrl;
        }
      }
    }

    try {
      // 尝试使用标准字段插入（包含所有必需字段）
      const result = await this.execute(
        `INSERT INTO messages (conversation_id, content, role, message_order, tokens, function_call) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conversationId, content, role, messageOrder, tokens, JSON.stringify(functionCall)]
      );
      
      const messageId = result.insertId;
      
      // 返回创建的消息信息
      const [message] = await this.execute(
        'SELECT * FROM messages WHERE message_id = ?',
        [messageId]
      );
      
      return message;
    } catch (error) {
      logger.warn('标准插入失败，尝试备选字段组合:', error.message);
      
      // 备选方案1: 尝试只用基本字段（包含必需的字段）
      try {
        const result = await this.execute(
          `INSERT INTO messages (conversation_id, content, message_order, tokens, role) 
           VALUES (?, ?, ?, ?, ?)`,
          [conversationId, content, messageOrder, tokens, role]
        );
        
        const messageId = result.insertId;
        const [message] = await this.execute(
          'SELECT * FROM messages WHERE message_id = ?',
          [messageId]
        );
        
        return message;
      } catch (error2) {
        logger.warn('备选方案1失败，尝试最简化插入:', error2.message);
        
        // 备选方案2: 最简化插入（包含所有必需字段）
        try {
          const result = await this.execute(
            `INSERT INTO messages (conversation_id, content, message_order, tokens, role) 
             VALUES (?, ?, ?, ?, ?)`,
            [conversationId, content, messageOrder, tokens, role]
          );
          
          const messageId = result.insertId; 
          const [message] = await this.execute(
            'SELECT * FROM messages WHERE message_id = ?',
            [messageId]
          );
          
          return message;
        } catch (error3) {
          logger.error('所有插入方式都失败:', { 
            original: error.message, 
            backup1: error2.message, 
            backup2: error3.message 
          });
          throw new Error(`消息插入失败: ${error3.message}`);
        }
      }
    }
  }

  // 创建带有模型名称的消息（主要用于assistant角色）
  async createMessageWithName(conversationId, content, role = 'assistant', name = null, imageUrl = null, messageOrder = null, associatedId = null, contextTokens = 0) {
    // 如果没有指定messageOrder，获取当前会话的消息数量
    if (messageOrder === null) {
      try {
        const [countResult] = await this.execute(
          'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
          [conversationId]
        );
        messageOrder = countResult.count;
      } catch (error) {
        messageOrder = 0;
      }
    }

    // 计算tokens
    let responseTokens = 0;
    try {
      const enc = encoding_for_model("gpt-4");
      responseTokens = enc.encode(content).length;
    } catch (error) {
      logger.warn('Token计算失败:', error.message);
      responseTokens = Math.ceil(content.length / 4); // 简单估算
    }

    // 总tokens = 上下文tokens + 回答tokens
    const totalTokens = contextTokens + responseTokens;

    // 设置function_call（对于assistant消息）
    const functionCall = {
      "role": "answers",
      "associated_id": associatedId,
      "Multiple_rounds_tokens": contextTokens
    };
    
    if (imageUrl) {
      functionCall.has_image = true;
    }

    try {
      // 尝试使用标准字段插入（包含name字段）
      const result = await this.execute(
        `INSERT INTO messages (conversation_id, content, role, name, message_order, tokens, function_call) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [conversationId, content, role, name, messageOrder, totalTokens, JSON.stringify(functionCall)]
      );
      
      const messageId = result.insertId;
      
      // 返回创建的消息信息
      const [message] = await this.execute(
        'SELECT * FROM messages WHERE message_id = ?',
        [messageId]
      );
      
      return message;
    } catch (error) {
      logger.warn('带name字段插入失败，尝试不使用name字段:', error.message);
      
      // 备选方案：不使用name字段（为了向后兼容）
      try {
        const result = await this.execute(
          `INSERT INTO messages (conversation_id, content, role, message_order, tokens, function_call) 
           VALUES (?, ?, ?, ?, ?, ?)`,
          [conversationId, content, role, messageOrder, totalTokens, JSON.stringify(functionCall)]
        );
        
        const messageId = result.insertId;
        const [message] = await this.execute(
          'SELECT * FROM messages WHERE message_id = ?',
          [messageId]
        );
        
        logger.warn(`消息创建成功但未包含模型名称: ${name}`);
        return message;
      } catch (error2) {
        logger.error('创建带名称消息的所有方式都失败:', { 
          original: error.message, 
          backup: error2.message 
        });
        throw new Error(`消息插入失败: ${error2.message}`);
      }
    }
  }

  async getMessages(conversationId) {
    // 先尝试使用标准的字段名（包含name字段用于显示模型名称）
    try {
      const messages = await this.execute(
        `SELECT message_id, conversation_id, content, role, name, message_order, created_at
         FROM messages 
         WHERE conversation_id = ? 
         ORDER BY message_order ASC`,
        [conversationId]
      );
      return messages;
    } catch (error) {
      // 如果失败，尝试其他可能的字段组合
      logger.warn('标准字段查询失败，尝试其他字段组合:', error.message);
      
      try {
        const messages = await this.execute(
          `SELECT message_id, conversation_id, content, role, message_order, created_at
           FROM messages 
           WHERE conversation_id = ? 
           ORDER BY message_order ASC`,
          [conversationId]
        );
        return messages;
      } catch (error2) {
        logger.warn('带message_order查询失败，尝试最简化查询:', error2.message);
        
        try {
          const messages = await this.execute(
            `SELECT message_id, conversation_id, content, created_at
             FROM messages 
             WHERE conversation_id = ? 
             ORDER BY COALESCE(message_order, message_id) ASC`,
            [conversationId]
          );
          return messages;
        } catch (error3) {
          // 最后尝试最基本的查询
          logger.warn('最简化查询失败，尝试基本查询:', error3.message);
          const messages = await this.execute(
            `SELECT * FROM messages WHERE conversation_id = ? ORDER BY message_id ASC`,
            [conversationId]
          );
          return messages;
        }
      }
    }
  }

  async updateMessage(messageId, content) {
    try {
      // 尝试更新content字段（这是标准字段）
      const result = await this.execute(
        'UPDATE messages SET content = ? WHERE message_id = ?',
        [content, messageId]
      );
      
      if (result.affectedRows === 0) {
        throw new Error('没有找到要更新的消息');
      }
      
      return result;
    } catch (error) {
      logger.error('更新消息失败:', {
        messageId,
        content: content.substring(0, 100) + '...', // 只记录前100个字符
        error: error.message
      });
      throw error;
    }
  }

  async clearConversationMessages(conversationId) {
    const result = await this.execute(
      'DELETE FROM messages WHERE conversation_id = ?',
      [conversationId]
    );
    return result;
  }

  // 为了兼容现有API，添加旧版本的消息方法
  async addMessage(messageId, conversationId, question, answers, imageUrl = null, messageOrder = 0) {
    // 创建用户消息
    const userMessage = await this.createMessage(conversationId, question, 'user', imageUrl, messageOrder);
    
    // 如果有回答，创建助手消息
    const assistantMessages = [];
    if (answers) {
      if (Array.isArray(answers) && answers.length > 0) {
        // 如果answers是数组，为每个回答创建一条assistant消息
        for (let i = 0; i < answers.length; i++) {
          const assistantMessage = await this.createMessage(
            conversationId, 
            answers[i], 
            'assistant', 
            null, 
            messageOrder + 1 + i
          );
          assistantMessages.push(assistantMessage);
        }
      } else if (typeof answers === 'string') {
        // 如果answers是字符串，创建一条assistant消息
        const assistantMessage = await this.createMessage(
          conversationId, 
          answers, 
          'assistant', 
          null, 
          messageOrder + 1
        );
        assistantMessages.push(assistantMessage);
      } else if (typeof answers === 'object' && answers !== null) {
        // 如果answers是对象（模型名 -> 回答的键值对），为每个模型单独创建assistant消息
        const modelNames = Object.keys(answers);
        for (let i = 0; i < modelNames.length; i++) {
          const modelName = modelNames[i];
          const content = answers[modelName];
          if (content) {
            const assistantMessage = await this.createMessageWithName(
              conversationId, 
              content, 
              'assistant', 
              modelName,
              null, 
              messageOrder + 1 + i
            );
            assistantMessages.push(assistantMessage);
          }
        }
      }
    }
    
    return { 
      userMessage, 
      assistantMessages: assistantMessages.length > 0 ? assistantMessages : null 
    };
  }

  async getMessagesByConversation(conversationId) {
    return await this.getMessages(conversationId);
  }

  async getMaxMessageOrder(conversationId) {
    const [result] = await this.execute(
      'SELECT MAX(message_order) as max_order FROM messages WHERE conversation_id = ?',
      [conversationId]
    );
    return result.max_order || 0;
  }

  async deleteMessage(messageId) {
    const result = await this.execute(
      'DELETE FROM messages WHERE message_id = ?',
      [messageId]
    );
    return result;
  }

  // 用户偏好设置相关操作（使用users表中的custom_metadata字段）
  async saveUserPreferences(userId, preferences) {
    try {
      // 首先获取用户当前的custom_metadata
      const [user] = await this.execute(
        'SELECT custom_metadata FROM users WHERE user_id = ?',
        [userId]
      );
      
      let customMetadata = {};
      if (user && user.custom_metadata) {
        try {
          customMetadata = typeof user.custom_metadata === 'string' 
            ? JSON.parse(user.custom_metadata) 
            : user.custom_metadata;
        } catch (e) {
          logger.warn('解析用户custom_metadata失败:', e.message);
          customMetadata = {};
        }
      }
      
      logger.info(`数据库配置 ${JSON.stringify(preferences)} `);
      
      // 清理旧字段，只保留统一的字段名
      const cleanedMetadata = {};
      
      // 更新偏好设置，使用统一的字段名
      if (preferences.view_type !== undefined) {
        cleanedMetadata.view_type = preferences.view_type;
      } else if (customMetadata.view_type !== undefined) {
        cleanedMetadata.view_type = customMetadata.view_type;
      } else if (customMetadata.view !== undefined) {
        cleanedMetadata.view_type = customMetadata.view; // 迁移旧字段
      } else {
        cleanedMetadata.view_type = 1; // 默认值
      }
      
      // 对于selected_models，只有在明确提供时才更新
      if (preferences.selected_models !== undefined) {
        cleanedMetadata.selected_models = preferences.selected_models;
      } else {
        // 保持现有值不变
        cleanedMetadata.selected_models = customMetadata.selected_models || customMetadata.models || [];
      }
      
      if (preferences.conversation_id !== undefined) {
        cleanedMetadata.conversation_id = preferences.conversation_id;
      } else {
        // 保持现有值不变
        cleanedMetadata.conversation_id = customMetadata.conversation_id || customMetadata.conversationId || null;
      }
      
      if (preferences.current_conversation_id !== undefined) {
        cleanedMetadata.current_conversation_id = preferences.current_conversation_id;
      } else {
        // 保持现有值不变
        cleanedMetadata.current_conversation_id = customMetadata.current_conversation_id || null;
      }
      
      logger.info(`清理后的元数据:`, cleanedMetadata);
      
      // 更新users表中的custom_metadata字段
      const result = await this.execute(
        'UPDATE users SET custom_metadata = ? WHERE user_id = ?',
        [JSON.stringify(cleanedMetadata), userId]
      );
      
      logger.info(`用户 ${userId} 偏好设置已保存:`, cleanedMetadata);
      return result;
    } catch (error) {
      logger.error('保存用户偏好设置失败:', error);
      throw error;
    }
  }

  async getUserPreferences(userId) {
    try {
      const [user] = await this.execute(
        'SELECT custom_metadata FROM users WHERE user_id = ?',
        [userId]
      );
      
      if (user && user.custom_metadata) {
        try {
          const customMetadata = typeof user.custom_metadata === 'string' 
            ? JSON.parse(user.custom_metadata) 
            : user.custom_metadata;
          
          return {
            view_type: customMetadata.view_type || customMetadata.view || 1,
            selected_models: customMetadata.selected_models || customMetadata.models || [],
            conversation_id: customMetadata.conversation_id || customMetadata.conversationId || null,
            current_conversation_id: customMetadata.current_conversation_id || null
          };
        } catch (e) {
          logger.warn('解析用户custom_metadata失败:', e.message);
        }
      }
      
      // 返回默认值
      return {
        view_type: 1,
        selected_models: [],
        conversation_id: null,
        current_conversation_id: null
      };
    } catch (error) {
      logger.error('获取用户偏好设置失败:', error);
      return {
        view_type: 1,
        selected_models: [],
        conversation_id: null,
        current_conversation_id: null
      };
    }
  }

  // AI模型相关操作
  async getAllAiModels() {
    try {
      const models = await this.execute(
        `SELECT model_id, model_name, model_version, model_key, model_url, 
                custom_metadata, category_request, created_at, updated_at, is_enabled
         FROM aimodel 
         WHERE is_enabled = TRUE OR is_enabled IS NULL
         ORDER BY created_at DESC`
      );
      return models;
    } catch (error) {
      logger.error('获取AI模型列表失败:', error);
      // 如果aimodel表不存在，返回空数组
      if (error.code === 'ER_NO_SUCH_TABLE') {
        logger.warn('aimodel表不存在，返回空模型列表');
        return [];
      }
      throw error;
    }
  }

  async getAiModelById(modelId) {
    try {
      const [model] = await this.execute(
        'SELECT * FROM aimodel WHERE model_id = ?',
        [modelId]
      );
      return model;
    } catch (error) {
      logger.error('获取AI模型详情失败:', error);
      return null;
    }
  }

  async addAiModel(modelData) {
    try {
      const { model_name, model_version, model_key, model_url, category_request, custom_metadata } = modelData;
      
      const result = await this.execute(
        `INSERT INTO aimodel (model_name, model_version, model_key, model_url, 
                              category_request, custom_metadata, created_at, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          model_name,
          JSON.stringify(model_version),
          model_key,
          model_url,
          category_request,
          JSON.stringify(custom_metadata)
        ]
      );
      
      return { model_id: result.insertId, ...modelData };
    } catch (error) {
      logger.error('添加AI模型失败:', error);
      throw error;
    }
  }

  // 获取会话的Q&A列表，组装为 [{question, answers:{模型:回答}}] 的格式
  // 参照Python backend的get_conversation_qa_list方法
  async getConversationQAList(conversationId) {
    try {
      const messages = await this.getMessages(conversationId);
      const qaList = [];
      const questionMap = {};

      for (const msg of messages) {
        if (msg.role === 'user') {
          // 用户问题
          const q = {
            question: msg.content,
            answers: {},
            message_id: msg.message_id  // 仅内部用，后面会去掉
          };
          qaList.push(q);
          questionMap[msg.message_id] = q;
        } else if (msg.role === 'assistant') {
          // 助手回答 - 需要找到对应的用户问题
          // 我们假设assistant消息紧跟在user消息后面，按message_order排序
          
          // 找到最近的user消息
          let targetQuestion = null;
          for (let i = qaList.length - 1; i >= 0; i--) {
            targetQuestion = qaList[i];
            break;
          }
          
          if (targetQuestion) {
            const modelName = msg.name || 'unknown';
            targetQuestion.answers[modelName] = msg.content;
          }
        }
      }

      // 去掉 message_id 字段，仅返回前端需要的格式
      for (const q of qaList) {
        delete q.message_id;
      }

      return qaList;
    } catch (error) {
      logger.error('获取会话Q&A列表失败:', error);
      throw error;
    }
  }

  // 获取AI上下文消息的tokens数（参照Python backend的get_ai_context_messages）
  async getContextTokens(conversationId, modelName) {
    try {
      // 获取该会话的前5条该模型的assistant消息和所有user消息
      const userMessages = await this.execute(
        `SELECT content FROM messages 
         WHERE conversation_id = ? AND role = 'user' 
         ORDER BY created_at`,
        [conversationId]
      );

      const assistantMessages = await this.execute(
        `SELECT content FROM messages 
         WHERE conversation_id = ? AND role = 'assistant' AND name = ? 
         ORDER BY created_at 
         LIMIT 5`,
        [conversationId, modelName]
      );

      // 合并所有消息内容来计算上下文tokens
      const allMessages = [...userMessages, ...assistantMessages];
      const contextText = allMessages.map(msg => msg.content).join('\n');

      // 计算tokens
      let contextTokens = 0;
      try {
        const enc = encoding_for_model("gpt-4");
        contextTokens = enc.encode(contextText).length;
      } catch (error) {
        logger.warn('上下文Token计算失败:', error.message);
        contextTokens = Math.ceil(contextText.length / 4); // 简单估算
      }

      return contextTokens;
    } catch (error) {
      logger.error('获取上下文tokens失败:', error);
      return 0;
    }
  }

  // 连接状态检查
  isConnectionAlive() {
    return this.isConnected && this.pool;
  }

  // 关闭连接
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      logger.info('数据库连接已关闭');
    }
  }

  // 获取指定对话的历史对话记录（最多3轮，用于多轮对话AI生成）
  async getConversationHistory(conversationId, modelName, maxRounds = 3) {
    try {
      // 获取所有消息，然后在应用层匹配对话对
      const allMessages = await this.execute(
        `SELECT message_id, content, message_order, role, name, created_at
         FROM messages 
         WHERE conversation_id = ? 
           AND (role = 'user' OR (role = 'assistant' AND name = ?))
         ORDER BY message_order ASC`,
        [conversationId, modelName]
      );

      const conversations = [];
      let currentUserMessage = null;
      
      // 遍历消息，构建对话对
      for (const message of allMessages) {
        if (message.role === 'user') {
          currentUserMessage = message;
        } else if (message.role === 'assistant' && currentUserMessage) {
          // 找到了一个完整的对话对
          conversations.push({
            user_message: currentUserMessage.content,
            assistant_message: message.content,
            created_at: currentUserMessage.created_at
          });
          currentUserMessage = null; // 重置，准备下一轮
        }
      }

      // 取最近的N轮对话
      const recentConversations = conversations.slice(-maxRounds);

      logger.info(`获取会话 ${conversationId} 中模型 ${modelName} 的历史对话，共 ${recentConversations.length} 轮`);
      
      return recentConversations;
    } catch (error) {
      logger.error('获取历史对话失败:', error);
      return [];
    }
  }

  // 用户自定义元数据的辅助方法
  async updateUserCustomMetadata(userId, metadataUpdates) {
    try {
      // 获取当前的custom_metadata
      const [user] = await this.execute(
        'SELECT custom_metadata FROM users WHERE user_id = ?',
        [userId]
      );
      
      let customMetadata = {};
      if (user && user.custom_metadata) {
        try {
          customMetadata = typeof user.custom_metadata === 'string' 
            ? JSON.parse(user.custom_metadata) 
            : user.custom_metadata;
        } catch (e) {
          logger.warn('解析用户custom_metadata失败:', e.message);
          customMetadata = {};
        }
      }
      
      // 合并更新
      Object.assign(customMetadata, metadataUpdates);
      
      // 更新数据库
      const result = await this.execute(
        'UPDATE users SET custom_metadata = ? WHERE user_id = ?',
        [JSON.stringify(customMetadata), userId]
      );
      
      logger.info(`用户 ${userId} 自定义元数据已更新:`, metadataUpdates);
      return result;
    } catch (error) {
      logger.error('更新用户自定义元数据失败:', error);
      throw error;
    }
  }

  async getUserCustomMetadata(userId) {
    try {
      const [user] = await this.execute(
        'SELECT custom_metadata FROM users WHERE user_id = ?',
        [userId]
      );
      
      if (user && user.custom_metadata) {
        try {
          return typeof user.custom_metadata === 'string' 
            ? JSON.parse(user.custom_metadata) 
            : user.custom_metadata;
        } catch (e) {
          logger.warn('解析用户custom_metadata失败:', e.message);
          return {};
        }
      }
      
      return {};
    } catch (error) {
      logger.error('获取用户自定义元数据失败:', error);
      return {};
    }
  }

  // 更新用户当前会话ID
  async updateUserCurrentConversation(userId, conversationId) {
    return await this.updateUserCustomMetadata(userId, {
      current_conversation_id: conversationId
    });
  }

  // 更新用户最后选择的视图和模型
  async updateUserLastSelection(userId, viewType, selectedModels, conversationId = null) {
    const updates = {
      view: viewType,
      models: selectedModels
    };
    
    if (conversationId !== null) {
      updates.conversationId = conversationId;
    }
    
    return await this.updateUserCustomMetadata(userId, updates);
  }
}

// 创建单例实例
const adaptedDatabase = new AdaptedDatabase();

module.exports = adaptedDatabase;
