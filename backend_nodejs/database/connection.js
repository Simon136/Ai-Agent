/**
 * 数据库连接管理器 - Node.js版本
 * 对应原Python sql_database/sql_models.py
 */
const mysql = require('mysql2/promise');
const config = require('../config/config');
const logger = require('../utils/logger');

class Database {
  constructor() {
    this.pool = null;
    this.connected = false;
  }

  async initialize() {
    try {
      // 创建连接池 - 仅使用MySQL2支持的配置选项
      this.pool = mysql.createPool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
        charset: config.database.charset,
        connectionLimit: config.database.connectionLimit,
        waitForConnections: config.database.waitForConnections,
        queueLimit: config.database.queueLimit,
        supportBigNumbers: config.database.supportBigNumbers,
        bigNumberStrings: config.database.bigNumberStrings,
        multipleStatements: config.database.multipleStatements,
        ssl: config.database.ssl
      });

      // 测试连接
      const connection = await this.pool.getConnection();
      logger.info('数据库连接池创建成功');
      connection.release();
      this.connected = true;

      // 创建必要的表
      await this.createTables();

      // 打印数据库配置
      config.printDbConfig();
      
    } catch (error) {
      logger.error('数据库初始化失败:', error);
      throw error;
    }
  }

  async createTables() {
    try {
      // 按照依赖顺序创建表，确保外键约束正确
      
      // 1. 用户表 (对应原Python User模型)
      await this.execute(`
        CREATE TABLE IF NOT EXISTS users (
          user_id VARCHAR(255) PRIMARY KEY,
          username VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          last_login TIMESTAMP NULL,
          INDEX idx_email (email),
          INDEX idx_created_at (created_at)
        )
      `);
      
      // 2. 对话表 (对应原Python Conversation模型)
      await this.execute(`
        CREATE TABLE IF NOT EXISTS conversations (
          conversation_id VARCHAR(255) PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
          INDEX idx_user_id (user_id),
          INDEX idx_created_at (created_at)
        )
      `);
      
      // 3. 消息表 (对应原Python Message模型)
      await this.execute(`
        CREATE TABLE IF NOT EXISTS messages (
          message_id VARCHAR(255) PRIMARY KEY,
          conversation_id VARCHAR(255) NOT NULL,
          question TEXT NOT NULL,
          answers JSON,
          image_url VARCHAR(500),
          message_order INT NOT NULL DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
          INDEX idx_conversation_id (conversation_id),
          INDEX idx_message_order (message_order),
          INDEX idx_created_at (created_at)
        )
      `);

      // 4. 用户偏好表 - 使用正确的字段类型和约束处理
      await this.createUserPreferencesTable();
      
      logger.info('数据库表创建/检查完成');
      
    } catch (error) {
      logger.error('创建数据库表失败:', error);
      throw error;
    }
  }

  async createUserPreferencesTable() {
    try {
      // 尝试创建用户偏好表，确保字段类型与外键引用表完全一致
      await this.execute(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          user_id VARCHAR(255) PRIMARY KEY,
          view_type INT DEFAULT 1,
          selected_models JSON,
          conversation_id VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_user_preferences_user_id 
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
          CONSTRAINT fk_user_preferences_conversation_id 
            FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE SET NULL,
          INDEX idx_conversation_id (conversation_id)
        )
      `);
      logger.info('用户偏好表创建成功');
      
    } catch (error) {
      logger.error('创建用户偏好表失败:', error);
      
      // 错误处理：如果是外键约束错误，尝试修复
      if (error.code === 'ER_FK_INCOMPATIBLE_COLUMNS' || 
          error.code === 'ER_CANT_CREATE_TABLE' ||
          error.message.includes('foreign key constraint')) {
        
        logger.warn('检测到外键约束问题，尝试自动修复...');
        await this.repairUserPreferencesTable();
        
      } else {
        throw error;
      }
    }
  }

  async repairUserPreferencesTable() {
    try {
      // 检查表是否存在
      const [tables] = await this.pool.query(`
        SELECT TABLE_NAME 
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'user_preferences'
      `, [config.database.database]);

      if (tables.length > 0) {
        logger.info('删除现有的user_preferences表...');
        
        // 先删除外键约束（如果存在）
        try {
          await this.execute(`
            ALTER TABLE user_preferences 
            DROP FOREIGN KEY fk_user_preferences_user_id
          `);
        } catch (e) { /* 忽略约束不存在的错误 */ }
        
        try {
          await this.execute(`
            ALTER TABLE user_preferences 
            DROP FOREIGN KEY fk_user_preferences_conversation_id
          `);
        } catch (e) { /* 忽略约束不存在的错误 */ }
        
        // 删除表
        await this.execute('DROP TABLE user_preferences');
      }

      // 重新创建表
      await this.execute(`
        CREATE TABLE user_preferences (
          user_id VARCHAR(255) PRIMARY KEY,
          view_type INT DEFAULT 1,
          selected_models JSON,
          conversation_id VARCHAR(255) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          CONSTRAINT fk_user_preferences_user_id 
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
          CONSTRAINT fk_user_preferences_conversation_id 
            FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE SET NULL,
          INDEX idx_conversation_id (conversation_id)
        )
      `);
      
      logger.info('用户偏好表修复成功');
      
    } catch (repairError) {
      logger.error('修复用户偏好表失败:', repairError);
      
      // 最后的降级方案：创建不带外键约束的表
      logger.warn('使用降级方案：创建不带外键约束的用户偏好表');
      
      try {
        await this.execute('DROP TABLE IF EXISTS user_preferences');
        await this.execute(`
          CREATE TABLE user_preferences (
            user_id VARCHAR(255) PRIMARY KEY,
            view_type INT DEFAULT 1,
            selected_models JSON,
            conversation_id VARCHAR(255) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id),
            INDEX idx_conversation_id (conversation_id)
          )
        `);
        logger.warn('已创建不带外键约束的用户偏好表，请手动检查数据完整性');
        
      } catch (fallbackError) {
        logger.error('降级方案也失败了:', fallbackError);
        throw fallbackError;
      }
    }
  }

  async execute(sql, params = []) {
    try {
      const [results] = await this.pool.execute(sql, params);
      return results;
    } catch (error) {
      logger.error('数据库执行错误:', { sql, params, error: error.message });
      throw error;
    }
  }

  async query(sql, params = []) {
    try {
      const [rows] = await this.pool.query(sql, params);
      return rows;
    } catch (error) {
      logger.error('数据库查询错误:', { sql, params, error: error.message });
      throw error;
    }
  }

  async transaction(callback) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  // 用户相关操作 (对应原Python sql_models函数)
  async getUserByUserId(userId) {
    const sql = 'SELECT * FROM users WHERE user_id = ?';
    const [rows] = await this.pool.execute(sql, [userId]);
    return rows[0] || null;
  }

  async addUser(userId, username, email) {
    const sql = 'INSERT INTO users (user_id, username, email) VALUES (?, ?, ?)';
    await this.execute(sql, [userId, username, email]);
    return await this.getUserByUserId(userId);
  }

  async updateUserLastLogin(userId) {
    const sql = 'UPDATE users SET last_login = NOW() WHERE user_id = ?';
    await this.execute(sql, [userId]);
  }

  // 对话相关操作
  async getConversationsByUser(userId) {
    const sql = `
      SELECT conversation_id, title, created_at, updated_at 
      FROM conversations 
      WHERE user_id = ? 
      ORDER BY updated_at DESC
    `;
    return await this.query(sql, [userId]);
  }

  async createConversation(conversationId, userId, title = 'New Conversation') {
    const sql = 'INSERT INTO conversations (conversation_id, user_id, title) VALUES (?, ?, ?)';
    await this.execute(sql, [conversationId, userId, title]);
    return { conversation_id: conversationId, user_id: userId, title };
  }

  async updateConversationTitle(conversationId, title) {
    const sql = 'UPDATE conversations SET title = ?, updated_at = NOW() WHERE conversation_id = ?';
    await this.execute(sql, [title, conversationId]);
  }

  async deleteConversation(conversationId) {
    const sql = 'DELETE FROM conversations WHERE conversation_id = ?';
    await this.execute(sql, [conversationId]);
  }

  // 消息相关操作
  async getMessagesByConversation(conversationId) {
    const sql = `
      SELECT message_id, question, answers, image_url, message_order, created_at 
      FROM messages 
      WHERE conversation_id = ? 
      ORDER BY message_order ASC, created_at ASC
    `;
    const messages = await this.query(sql, [conversationId]);
    
    // 解析JSON字段
    return messages.map(msg => ({
      ...msg,
      answers: typeof msg.answers === 'string' ? JSON.parse(msg.answers) : msg.answers
    }));
  }

  async addMessage(messageId, conversationId, question, answers, imageUrl = null, messageOrder = 0) {
    const sql = `
      INSERT INTO messages (message_id, conversation_id, question, answers, image_url, message_order) 
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const answersJson = JSON.stringify(answers);
    await this.execute(sql, [messageId, conversationId, question, answersJson, imageUrl, messageOrder]);

    // 更新对话的更新时间
    await this.execute(
      'UPDATE conversations SET updated_at = NOW() WHERE conversation_id = ?',
      [conversationId]
    );

    return {
      message_id: messageId,
      conversation_id: conversationId,
      question,
      answers,
      image_url: imageUrl,
      message_order: messageOrder
    };
  }

  async getMaxMessageOrder(conversationId) {
    const sql = 'SELECT COALESCE(MAX(message_order), 0) as max_order FROM messages WHERE conversation_id = ?';
    const [rows] = await this.pool.execute(sql, [conversationId]);
    return rows[0]?.max_order || 0;
  }

  async deleteMessage(messageId) {
    const sql = 'DELETE FROM messages WHERE message_id = ?';
    await this.execute(sql, [messageId]);
  }

  // 用户偏好相关操作
  async getUserPreferences(userId) {
    const sql = 'SELECT * FROM user_preferences WHERE user_id = ?';
    const [rows] = await this.pool.execute(sql, [userId]);
    const prefs = rows[0];
    
    if (prefs && prefs.selected_models) {
      prefs.selected_models = typeof prefs.selected_models === 'string' 
        ? JSON.parse(prefs.selected_models) 
        : prefs.selected_models;
    }
    
    return prefs || null;
  }

  async updateUserPreferences(userId, viewType, selectedModels, conversationId = null) {
    const modelsJson = JSON.stringify(selectedModels);
    const sql = `
      INSERT INTO user_preferences (user_id, view_type, selected_models, conversation_id) 
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        view_type = VALUES(view_type),
        selected_models = VALUES(selected_models),
        conversation_id = VALUES(conversation_id),
        updated_at = NOW()
    `;
    await this.execute(sql, [userId, viewType, modelsJson, conversationId]);
  }

  isConnected() {
    return this.connected;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.connected = false;
      logger.info('数据库连接池已关闭');
    }
  }
}

module.exports = new Database();
