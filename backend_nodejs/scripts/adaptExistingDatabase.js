/**
 * 适配现有数据库结构脚本
 * 修改代码以匹配现有的数据库表结构
 */
const mysql = require('mysql2/promise');
const config = require('../config/config');
const logger = require('../utils/logger');

async function adaptToExistingDatabase() {
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
    
    logger.info('正在分析现有数据库结构...');
    
    // 分析现有表结构
    const [conversationsSchema] = await connection.execute(`
      DESCRIBE conversations
    `);
    
    const [messagesSchema] = await connection.execute(`
      DESCRIBE messages
    `);
    
    const [usersSchema] = await connection.execute(`
      DESCRIBE users
    `);
    
    logger.info('现有表结构分析完成:');
    logger.info('conversations表结构:', JSON.stringify(conversationsSchema, null, 2));
    logger.info('messages表结构:', JSON.stringify(messagesSchema, null, 2));
    logger.info('users表结构:', JSON.stringify(usersSchema, null, 2));
    
    // 生成适配后的数据库操作方法
    await generateAdaptedMethods(conversationsSchema, messagesSchema, usersSchema);
    
    logger.info('数据库结构适配完成');
    
  } catch (error) {
    logger.error('适配数据库结构失败:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

async function generateAdaptedMethods(conversationsSchema, messagesSchema, usersSchema) {
  // 分析字段类型
  const conversationIdField = conversationsSchema.find(field => 
    field.Field === 'conversation_id' || field.Field === 'id'
  );
  
  const messageIdField = messagesSchema.find(field => 
    field.Field === 'message_id' || field.Field === 'id'
  );
  
  logger.info('检测到的字段类型:');
  logger.info('conversation_id类型:', conversationIdField);
  logger.info('message_id类型:', messageIdField);
  
  // 根据字段类型决定ID生成策略
  if (conversationIdField && conversationIdField.Type.includes('int')) {
    logger.info('conversations表使用自增整数ID，将使用数据库自动生成ID');
  }
  
  if (messageIdField && messageIdField.Type.includes('int')) {
    logger.info('messages表使用自增整数ID，将使用数据库自动生成ID');
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  adaptToExistingDatabase()
    .then(() => {
      logger.info('✅ 数据库适配完成');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('❌ 数据库适配失败:', error);
      process.exit(1);
    });
}

module.exports = { adaptToExistingDatabase };
