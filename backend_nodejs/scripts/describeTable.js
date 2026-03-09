/**
 * 查看数据库表结构
 */
require('dotenv').config();
const database = require('../database/connection');

async function describeTable(tableName) {
  try {
    await database.initialize();
    console.log(`\n=== ${tableName} 表结构 ===`);
    
    const result = await database.query(`DESCRIBE ${tableName}`);
    result.forEach(column => {
      console.log(`${column.Field}: ${column.Type} ${column.Null} ${column.Key} ${column.Default || ''} ${column.Extra || ''}`);
    });
    
  } catch (error) {
    console.error(`查看 ${tableName} 表结构失败:`, error.message);
  }
}

async function main() {
  try {
    await describeTable('users');
    await describeTable('conversations');
    await describeTable('messages');
    await describeTable('user_preferences');
  } finally {
    await database.close();
  }
}

main().catch(console.error);
