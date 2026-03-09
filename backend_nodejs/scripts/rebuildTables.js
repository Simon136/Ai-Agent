/**
 * 重建数据库表以匹配新的Node.js结构
 */
require('dotenv').config();
const database = require('../database/connection');
const logger = require('../utils/logger');

async function rebuildTables() {
  try {
    await database.initialize();
    
    console.log('⚠️ 开始重建数据库表...');
    console.log('⚠️ 这将删除所有现有数据!');
    
    // 禁用外键检查
    await database.execute('SET FOREIGN_KEY_CHECKS = 0');
    
    // 删除现有表
    const tables = ['messages', 'conversations', 'users', 'user_preferences'];
    for (const table of tables) {
      try {
        await database.execute(`DROP TABLE IF EXISTS ${table}`);
        console.log(`✅ 删除表 ${table}`);
      } catch (error) {
        console.log(`⚠️ 删除表 ${table} 时出错: ${error.message}`);
      }
    }
    
    // 启用外键检查
    await database.execute('SET FOREIGN_KEY_CHECKS = 1');
    
    // 重新创建表
    console.log('🔨 开始创建新表...');
    
    // 1. 用户表
    await database.execute(`
      CREATE TABLE users (
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
    console.log('✅ 创建 users 表');
    
    // 2. 对话表
    await database.execute(`
      CREATE TABLE conversations (
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
    console.log('✅ 创建 conversations 表');
    
    // 3. 消息表
    await database.execute(`
      CREATE TABLE messages (
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
    console.log('✅ 创建 messages 表');
    
    // 4. 用户偏好表
    await database.execute(`
      CREATE TABLE user_preferences (
        user_id VARCHAR(255) PRIMARY KEY,
        view_type INT DEFAULT 1,
        selected_models JSON,
        conversation_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_conversation_id (conversation_id)
      )
    `);
    console.log('✅ 创建 user_preferences 表');
    
    console.log('🎉 数据库表重建完成');
    
  } catch (error) {
    console.error('❌ 重建数据库表失败:', error);
    throw error;
  } finally {
    await database.close();
  }
}

// 运行重建
rebuildTables().catch(console.error);
