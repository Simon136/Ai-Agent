/**
 * 根据实际数据库结构生成正确的适配代码
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const config = require('../config/config');
const fs = require('fs');
const path = require('path');

async function generateAdaptedCode() {
  let connection;
  
  try {
    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database
    });

    console.log('✅ 连接到数据库成功，正在分析表结构...');

    // 分析conversations表
    const [conversationsColumns] = await connection.execute('DESCRIBE conversations');
    const convStructure = {};
    conversationsColumns.forEach(col => {
      convStructure[col.Field] = col;
    });

    // 分析messages表
    const [messagesColumns] = await connection.execute('DESCRIBE messages');
    const msgStructure = {};
    messagesColumns.forEach(col => {
      msgStructure[col.Field] = col;
    });

    console.log('📋 conversations表字段:', Object.keys(convStructure));
    console.log('📋 messages表字段:', Object.keys(msgStructure));

    // 生成conversations相关方法
    let conversationMethods = '';
    
    // 确定主键字段
    const convPrimaryKey = convStructure.id ? 'id' : 
                          convStructure.conversation_id ? 'conversation_id' : 'id';
    
    // 确定时间字段
    const convTimeField = convStructure.updated_at ? 'updated_at' : 
                         convStructure.created_at ? 'created_at' : 'created_at';

    conversationMethods = `
  // 会话相关操作（基于实际表结构）
  async createConversation(userId, title = 'New Chat') {
    const result = await this.execute(
      \`INSERT INTO conversations (user_id, title) 
       VALUES (?, ?)\`,
      [userId, title]
    );
    
    const conversationId = result.insertId;
    
    // 返回创建的会话信息
    const [conversation] = await this.execute(
      'SELECT * FROM conversations WHERE ${convPrimaryKey} = ?',
      [conversationId]
    );
    
    return conversation;
  }

  async getConversations(userId) {
    const conversations = await this.execute(
      \`SELECT ${convPrimaryKey} as conversation_id, ${convPrimaryKey}, user_id, title, ${convTimeField} as updated_at
       FROM conversations 
       WHERE user_id = ? 
       ORDER BY ${convTimeField} DESC\`,
      [userId]
    );
    return conversations;
  }

  async getConversation(conversationId) {
    const [conversation] = await this.execute(
      'SELECT * FROM conversations WHERE ${convPrimaryKey} = ?',
      [conversationId]
    );
    return conversation;
  }

  async updateConversationTitle(conversationId, title) {
    const result = await this.execute(
      'UPDATE conversations SET title = ? WHERE ${convPrimaryKey} = ?',
      [title, conversationId]
    );
    return result;
  }

  async deleteConversation(conversationId) {
    const result = await this.execute(
      'DELETE FROM conversations WHERE ${convPrimaryKey} = ?',
      [conversationId]
    );
    return result;
  }`;

    // 生成messages相关方法
    const msgPrimaryKey = msgStructure.id ? 'id' : 
                         msgStructure.message_id ? 'message_id' : 'message_id';
    
    const msgTimeField = msgStructure.created_at ? 'created_at' : 
                        msgStructure.timestamp ? 'timestamp' : 'timestamp';

    const messagesMethods = `
  // 消息相关操作（基于实际表结构）
  async createMessage(conversationId, question, answers = null, imageUrl = null, messageOrder = null) {
    if (messageOrder === null) {
      const [countResult] = await this.execute(
        'SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?',
        [conversationId]
      );
      messageOrder = countResult.count;
    }

    const result = await this.execute(
      \`INSERT INTO messages (conversation_id, question, answers, image_url, message_order) 
       VALUES (?, ?, ?, ?, ?)\`,
      [conversationId, question, answers ? JSON.stringify(answers) : null, imageUrl, messageOrder]
    );
    
    const messageId = result.insertId;
    
    const [message] = await this.execute(
      'SELECT * FROM messages WHERE ${msgPrimaryKey} = ?',
      [messageId]
    );
    
    return message;
  }

  async getMessages(conversationId) {
    const messages = await this.execute(
      \`SELECT ${msgPrimaryKey} as message_id, conversation_id, question, answers, image_url, message_order, ${msgTimeField} as created_at
       FROM messages 
       WHERE conversation_id = ? 
       ORDER BY message_order ASC\`,
      [conversationId]
    );
    
    return messages;
  }

  async updateMessage(messageId, answers) {
    const result = await this.execute(
      'UPDATE messages SET answers = ? WHERE ${msgPrimaryKey} = ?',
      [JSON.stringify(answers), messageId]
    );
    return result;
  }

  async deleteMessage(messageId) {
    const result = await this.execute(
      'DELETE FROM messages WHERE ${msgPrimaryKey} = ?',
      [messageId]
    );
    return result;
  }`;

    console.log('✅ 分析完成，生成的适配方法已保存到 generated_methods.js');
    
    // 保存生成的方法到文件
    const generatedCode = `// 根据实际数据库结构生成的适配方法
// conversations表主键: ${convPrimaryKey}
// messages表主键: ${msgPrimaryKey}
// conversations时间字段: ${convTimeField}
// messages时间字段: ${msgTimeField}

${conversationMethods}

${messagesMethods}`;

    fs.writeFileSync(path.join(__dirname, 'generated_methods.js'), generatedCode);

  } catch (error) {
    console.error('❌ 分析失败:', error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

generateAdaptedCode().catch(console.error);
