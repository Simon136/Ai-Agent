/**
 * 临时修复脚本 - 适配现有数据库结构
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../config/config');

async function adaptToExistingStructure() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });

    console.log('✅ 连接到数据库成功');

    // 检查conversations表的实际结构
    console.log('正在检查conversations表结构...');
    const [conversationsColumns] = await connection.execute('DESCRIBE conversations');
    
    const hasId = conversationsColumns.some(col => col.Field === 'id');
    const hasConversationId = conversationsColumns.some(col => col.Field === 'conversation_id');
    const hasUpdatedAt = conversationsColumns.some(col => col.Field === 'updated_at');
    
    console.log(`conversations表字段信息:`);
    console.log(`- 有id字段: ${hasId}`);
    console.log(`- 有conversation_id字段: ${hasConversationId}`);
    console.log(`- 有updated_at字段: ${hasUpdatedAt}`);

    // 检查messages表的实际结构
    console.log('\n正在检查messages表结构...');
    const [messagesColumns] = await connection.execute('DESCRIBE messages');
    
    const msgHasId = messagesColumns.some(col => col.Field === 'id');
    const msgHasMessageId = messagesColumns.some(col => col.Field === 'message_id');
    const msgHasTimestamp = messagesColumns.some(col => col.Field === 'timestamp');
    const msgHasCreatedAt = messagesColumns.some(col => col.Field === 'created_at');
    
    console.log(`messages表字段信息:`);
    console.log(`- 有id字段: ${msgHasId}`);
    console.log(`- 有message_id字段: ${msgHasMessageId}`);
    console.log(`- 有timestamp字段: ${msgHasTimestamp}`);
    console.log(`- 有created_at字段: ${msgHasCreatedAt}`);

    // 如果需要，添加缺失的字段
    if (hasConversationId && !hasUpdatedAt) {
      console.log('添加conversations表的updated_at字段...');
      await connection.execute(`
        ALTER TABLE conversations 
        ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      `);
      console.log('✅ 添加updated_at字段成功');
    }

    // 检查users表
    console.log('\n正在检查users表结构...');
    try {
      const [usersColumns] = await connection.execute('DESCRIBE users');
      const userHasUpdatedAt = usersColumns.some(col => col.Field === 'updated_at');
      
      if (!userHasUpdatedAt) {
        console.log('添加users表的updated_at字段...');
        await connection.execute(`
          ALTER TABLE users 
          ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        `);
        console.log('✅ 添加users.updated_at字段成功');
      }
    } catch (error) {
      console.log('users表检查失败:', error.message);
    }

    // 创建user_preferences表（如果不存在）
    console.log('\n检查user_preferences表...');
    try {
      await connection.execute('DESCRIBE user_preferences');
      console.log('user_preferences表已存在');
    } catch (error) {
      console.log('创建user_preferences表...');
      await connection.execute(`
        CREATE TABLE user_preferences (
          user_id VARCHAR(255) PRIMARY KEY,
          view_type INT DEFAULT 1,
          selected_models JSON,
          conversation_id ${hasConversationId ? 'VARCHAR(255)' : 'INT'} NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
        )
      `);
      console.log('✅ 创建user_preferences表成功');
    }

    console.log('\n🎉 数据库结构适配完成！');

  } catch (error) {
    console.error('❌ 适配失败:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

adaptToExistingStructure().catch(console.error);
