const database = require('./database/adaptedConnection');

async function checkDeepSeekModels() {
  try {
    const models = await database.getModels();
    models.forEach(model => {
      if (model.model_name.includes('DeepSeek')) {
        console.log('DeepSeek模型配置:');
        console.log('- 模型名:', model.model_name);
        console.log('- API模型名:', model.api_model_name);
        console.log('- 模型URL:', model.model_url);
        console.log('- 模型密钥前缀:', model.model_key ? model.model_key.substring(0, 10) + '...' : 'N/A');
        console.log('- Category:', model.category_request);
        console.log('---');
      }
    });
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkDeepSeekModels();
