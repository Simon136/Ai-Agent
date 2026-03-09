/**
 * 修复数据库表结构问题
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../config/config');
const logger = require('../utils/logger');

async function fixDatabase() {
  let connection;
  
  try {
    // 创建数据库连接
    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });

    console.log('✅ 连接到数据库成功');

    // 禁用外键检查
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
    console.log('✅ 禁用外键检查');

    // 1. 修复users表
    try {
      // 检查表是否存在
      const [userTables] = await connection.execute(
        "SHOW TABLES LIKE 'users'"
      );
      
      if (userTables.length === 0) {
        // 创建users表
        await connection.execute(`
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
        console.log('✅ 创建users表');
      } else {
        // 检查并添加缺失的字段
        const [columns] = await connection.execute("DESCRIBE users");
        const columnNames = columns.map(col => col.Field);
        
        if (!columnNames.includes('updated_at')) {
          await connection.execute(
            'ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
          );
          console.log('✅ 添加users.updated_at字段');
        }
        
        if (!columnNames.includes('last_login')) {
          await connection.execute(
            'ALTER TABLE users ADD COLUMN last_login TIMESTAMP NULL'
          );
          console.log('✅ 添加users.last_login字段');
        }
      }
    } catch (error) {
      console.error('❌ 修复users表失败:', error.message);
    }

    // 2. 修复conversations表
    try {
      const [convTables] = await connection.execute(
        "SHOW TABLES LIKE 'conversations'"
      );
      
      if (convTables.length === 0) {
        await connection.execute(`
          CREATE TABLE conversations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            INDEX idx_user_id (user_id),
            INDEX idx_created_at (created_at)
          )
        `);
        console.log('✅ 创建conversations表');
      } else {
        // 检查表结构
        const [columns] = await connection.execute("DESCRIBE conversations");
        const columnNames = columns.map(col => col.Field);
        
        // 检查主键是否正确
        const [primaryKey] = await connection.execute(`
          SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'conversations' AND COLUMN_KEY = 'PRI'
        `, [config.database.database]);
        
        if (primaryKey.length > 0 && primaryKey[0].COLUMN_NAME === 'conversation_id') {
          // 需要修改主键从conversation_id到id
          console.log('⚠️ 需要修改conversations表主键结构');
          // 这里需要谨慎处理，可能需要重建表
        }
        
        if (!columnNames.includes('updated_at')) {
          await connection.execute(
            'ALTER TABLE conversations ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
          );
          console.log('✅ 添加conversations.updated_at字段');
        }
      }
    } catch (error) {
      console.error('❌ 修复conversations表失败:', error.message);
    }

    // 3. 修复messages表
    try {
      const [msgTables] = await connection.execute(
        "SHOW TABLES LIKE 'messages'"
      );
      
      if (msgTables.length === 0) {
        await connection.execute(`
          CREATE TABLE messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            conversation_id INT NOT NULL,
            question TEXT NOT NULL,
            answers JSON,
            image_url VARCHAR(500),
            message_order INT NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            INDEX idx_conversation_id (conversation_id),
            INDEX idx_message_order (message_order),
            INDEX idx_created_at (created_at)
          )
        `);
        console.log('✅ 创建messages表');
      } else {
        // 检查并修复字段
        const [columns] = await connection.execute("DESCRIBE messages");
        const columnNames = columns.map(col => col.Field);
        
        if (!columnNames.includes('created_at') && columnNames.includes('timestamp')) {
          // 重命名timestamp为created_at
          await connection.execute(
            'ALTER TABLE messages CHANGE timestamp created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
          );
          console.log('✅ 重命名messages.timestamp为created_at');
        }
        
        if (!columnNames.includes('updated_at')) {
          await connection.execute(
            'ALTER TABLE messages ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
          );
          console.log('✅ 添加messages.updated_at字段');
        }
      }
    } catch (error) {
      console.error('❌ 修复messages表失败:', error.message);
    }

    // 4. 删除并重建user_preferences表
    try {
      await connection.execute('DROP TABLE IF EXISTS user_preferences');
      console.log('✅ 删除旧的user_preferences表');
      
      await connection.execute(`
        CREATE TABLE user_preferences (
          user_id VARCHAR(255) PRIMARY KEY,
          view_type INT DEFAULT 1,
          selected_models JSON,
          conversation_id INT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
          INDEX idx_user_id (user_id),
          INDEX idx_conversation_id (conversation_id)
        )
      `);
      console.log('✅ 创建新的user_preferences表');
    } catch (error) {
      console.error('❌ 修复user_preferences表失败:', error.message);
    }

    // 启用外键检查
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
    console.log('✅ 启用外键检查');

    console.log('🎉 数据库修复完成');

  } catch (error) {
    console.error('❌ 数据库修复失败:', error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// 运行修复
fixDatabase().catch(console.error);
