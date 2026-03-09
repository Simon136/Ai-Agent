/**
 * 数据库修复脚本
 * 专门用于修复外键约束和表结构问题
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../config/config');

class DatabaseRepair {
  constructor() {
    this.connection = null;
  }

  async connect() {
    try {
      this.connection = await mysql.createConnection({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: config.database.database,
        charset: config.database.charset
      });
      console.log('✅ 数据库连接成功');
    } catch (error) {
      console.error('❌ 数据库连接失败:', error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.connection) {
      await this.connection.end();
      console.log('✅ 数据库连接已关闭');
    }
  }

  async checkTableExists(tableName) {
    try {
      const [rows] = await this.connection.execute(
        `SELECT COUNT(*) as count FROM information_schema.tables 
         WHERE table_schema = ? AND table_name = ?`,
        [config.database.database, tableName]
      );
      return rows[0].count > 0;
    } catch (error) {
      console.error(`❌ 检查表 ${tableName} 是否存在时出错:`, error.message);
      return false;
    }
  }

  async repairUsersTable() {
    try {
      console.log('🔧 修复 users 表...');
      
      const exists = await this.checkTableExists('users');
      if (!exists) {
        await this.connection.execute(`
          CREATE TABLE users (
            user_id VARCHAR(255) PRIMARY KEY,
            username VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255) UNIQUE,
            password_hash VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_username (username),
            INDEX idx_email (email)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ users 表创建完成');
      } else {
        console.log('✅ users 表已存在');
      }
    } catch (error) {
      console.error('❌ 修复 users 表失败:', error.message);
      throw error;
    }
  }

  async repairConversationsTable() {
    try {
      console.log('🔧 修复 conversations 表...');
      
      const exists = await this.checkTableExists('conversations');
      if (!exists) {
        await this.connection.execute(`
          CREATE TABLE conversations (
            conversation_id VARCHAR(255) PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            title VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id),
            INDEX idx_created_at (created_at),
            CONSTRAINT fk_conversations_user_id 
              FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ conversations 表创建完成');
      } else {
        console.log('✅ conversations 表已存在');
      }
    } catch (error) {
      console.error('❌ 修复 conversations 表失败:', error.message);
      throw error;
    }
  }

  async repairMessagesTable() {
    try {
      console.log('🔧 修复 messages 表...');
      
      const exists = await this.checkTableExists('messages');
      if (!exists) {
        await this.connection.execute(`
          CREATE TABLE messages (
            message_id VARCHAR(255) PRIMARY KEY,
            conversation_id VARCHAR(255) NOT NULL,
            sender ENUM('user', 'assistant') NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            model_used VARCHAR(255),
            tokens_used INT DEFAULT 0,
            INDEX idx_conversation_id (conversation_id),
            INDEX idx_timestamp (timestamp),
            CONSTRAINT fk_messages_conversation_id 
              FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ messages 表创建完成');
      } else {
        console.log('✅ messages 表已存在');
      }
    } catch (error) {
      console.error('❌ 修复 messages 表失败:', error.message);
      throw error;
    }
  }

  async repairUserPreferencesTable() {
    try {
      console.log('🔧 修复 user_preferences 表...');
      
      // 先删除现有的表（如果存在问题的话）
      try {
        await this.connection.execute('DROP TABLE IF EXISTS user_preferences');
        console.log('✅ 已删除现有的 user_preferences 表');
      } catch (error) {
        console.log('⚠️ 删除现有表时出现问题，继续处理...');
      }

      // 尝试创建带外键约束的表
      try {
        await this.connection.execute(`
          CREATE TABLE user_preferences (
            user_id VARCHAR(255) PRIMARY KEY,
            view_type INT DEFAULT 1,
            selected_models JSON,
            conversation_id VARCHAR(255) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_user_id (user_id),
            INDEX idx_conversation_id (conversation_id),
            CONSTRAINT fk_user_preferences_user_id 
              FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            CONSTRAINT fk_user_preferences_conversation_id 
              FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE SET NULL
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ user_preferences 表创建完成（带外键约束）');
        
      } catch (fkError) {
        console.log('⚠️ 创建带外键约束的表失败，尝试降级方案...');
        console.log('   错误信息:', fkError.message);
        
        // 降级方案：创建不带外键约束的表
        try {
          await this.connection.execute(`
            CREATE TABLE user_preferences (
              user_id VARCHAR(255) PRIMARY KEY,
              view_type INT DEFAULT 1,
              selected_models JSON,
              conversation_id VARCHAR(255) NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              INDEX idx_user_id (user_id),
              INDEX idx_conversation_id (conversation_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          `);
          console.log('✅ user_preferences 表创建完成（无外键约束）');
          console.log('⚠️ 注意：数据完整性需要应用层保证');
          
        } catch (fallbackError) {
          console.error('❌ 降级方案也失败了:', fallbackError.message);
          throw fallbackError;
        }
      }
    } catch (error) {
      console.error('❌ 修复 user_preferences 表失败:', error.message);
      throw error;
    }
  }

  async repairDatabase() {
    try {
      console.log('🔧 开始数据库修复...');
      
      await this.connect();
      await this.repairUsersTable();
      await this.repairConversationsTable();
      await this.repairMessagesTable();
      await this.repairUserPreferencesTable();
      
      console.log('✅ 数据库修复完成');
    } catch (error) {
      console.error('❌ 数据库修复失败:', error.message);
      throw error;
    } finally {
      await this.disconnect();
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  const repair = new DatabaseRepair();
  repair.repairDatabase()
    .then(() => {
      console.log('🎉 数据库修复成功');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 数据库修复失败:', error);
      process.exit(1);
    });
}

module.exports = DatabaseRepair;
