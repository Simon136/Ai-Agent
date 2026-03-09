/**
 * 模型加载器 - Node.js版本
 * 对应原Python models/加载函数
 */
const aiService = require('../services/aiService');
const database = require('../database/adaptedConnection');
const logger = require('../utils/logger');

// 加载AI模型 (对应原Python load_models)
async function loadModels() {
  try {
    logger.info('开始加载AI模型...');
    
    // 尝试从数据库加载AI模型
    let dbModels = [];
    try {
      dbModels = await database.getAllAiModels();
      logger.info(`从数据库加载了 ${dbModels.length} 个AI模型`);
    } catch (error) {
      logger.warn('从数据库加载AI模型失败，使用默认模型:', error.message);
    }
    
    // 如果数据库中没有模型，使用默认配置
    if (!dbModels || dbModels.length === 0) {
      logger.info('数据库中没有AI模型，使用默认模型配置');
      const availableModels = aiService.getAvailableModels();
      
      const models = {
        // 文本生成模型
        textModels: availableModels.filter(model => 
          !aiService.supportsImages(model)
        ),
        
        // 支持图片的模型
        imageModels: availableModels.filter(model => 
          aiService.supportsImages(model)
        ),
        
        // 所有模型
        allModels: availableModels,
        
        // 模型配置
        config: {
          maxTokens: 4000,
          temperature: 0.7,
          timeout: 120000 // 2分钟超时
        }
      };
      
      logger.info(`使用默认配置加载了 ${availableModels.length} 个模型`);
      return models;
    }
    
    // 处理从数据库加载的模型，创建前端和内部使用的两种格式
    const processedModels = [];
    const modelGroups = {};
    
    dbModels.forEach(model => {
      let customMetadata = model.custom_metadata;
      let modelVersion = model.model_version;
      
      // 安全地解析JSON字段
      if (typeof customMetadata === 'string') {
        try {
          customMetadata = JSON.parse(customMetadata);
        } catch (e) {
          logger.warn(`解析模型元数据失败 (${model.model_name}):`, e.message);
          customMetadata = {};
        }
      }
      
      if (typeof modelVersion === 'string') {
        try {
          modelVersion = JSON.parse(modelVersion);
        } catch (e) {
          logger.warn(`解析模型版本失败 (${model.model_name}):`, e.message);
          modelVersion = {};
        }
      }
      
      // 如果model_version是对象，为每个版本创建一个模型条目
      if (modelVersion && typeof modelVersion === 'object') {
        // 为前端创建分组格式
        modelGroups[model.model_name] = modelVersion;
        
        // 为内部逻辑创建详细信息
        Object.entries(modelVersion).forEach(([versionKey, apiModelName]) => {
          processedModels.push({
            model_id: `${model.model_id}_${versionKey}`,
            display_name: `${model.model_name}-${versionKey}`, // 前端显示名称
            api_model_name: apiModelName, // API调用时使用的模型名
            model_name: model.model_name, // 原始模型名称
            version_key: versionKey, // 版本标识
            model_key: model.model_key, // API密钥
            model_url: model.model_url, // API地址
            category_request: model.category_request, // 提供商
            custom_metadata: customMetadata || {},
            original_model_id: model.model_id
          });
        });
      } else {
        // 如果model_version不是对象，创建单个模型条目
        modelGroups[model.model_name] = { 'default': model.model_name.toLowerCase() };
        
        processedModels.push({
          model_id: model.model_id,
          display_name: model.model_name,
          api_model_name: model.model_name.toLowerCase(),
          model_name: model.model_name,
          version_key: 'default',
          model_key: model.model_key,
          model_url: model.model_url,
          category_request: model.category_request,
          custom_metadata: customMetadata || {},
          original_model_id: model.model_id
        });
      }
    });
    
    // 转换为前端期望的数组格式
    const frontendModels = Object.keys(modelGroups).map(modelName => {
      return {
        [modelName]: modelGroups[modelName]
      };
    });
    
    const models = {
      // 文本生成模型
      textModels: processedModels.filter(model => 
        model.category_request === 'text' || 
        model.category_request === 'Ali' || // Ali提供商的模型视为文本模型
        !model.category_request
      ).map(m => m.api_model_name),
      
      // 支持图片的模型
      imageModels: processedModels.filter(model => 
        model.category_request === 'multimodal' || 
        model.category_request === 'vision' ||
        model.category_request === 'Azure' // Azure提供商的模型视为多模态
      ).map(m => m.api_model_name),
      
      // 所有模型的API名称
      allModels: processedModels.map(m => m.api_model_name),
      
      // 详细模型信息（包含前端显示需要的信息）
      modelDetails: processedModels,
      
      // 模型配置
      config: {
        maxTokens: 4000,
        temperature: 0.7,
        timeout: 120000 // 2分钟超时
      }
    };
    
    logger.info(`AI模型加载完成，共加载 ${processedModels.length} 个模型`);
    logger.info(`文本模型: ${models.textModels.join(', ')}`);
    logger.info(`图片模型: ${models.imageModels.join(', ')}`);
    
    return models;
    
  } catch (error) {
    logger.error('AI模型加载失败:', error);
    throw error;
  }
}

// 加载OCR模型 (对应原Python ocr_models)
async function loadOcrModels() {
  try {
    logger.info('开始加载OCR模型...');
    
    // Node.js版本中，OCR功能可以通过外部服务实现
    // 或者使用如tesseract.js等库
    const ocrModels = {
      // 支持的OCR服务
      services: [
        'azure-computer-vision',
        'google-vision',
        'aws-textract'
      ],
      
      // OCR配置
      config: {
        timeout: 30000, // 30秒超时
        maxImageSize: 10 * 1024 * 1024, // 10MB
        supportedFormats: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp']
      }
    };
    
    logger.info('OCR模型加载完成');
    return ocrModels;
    
  } catch (error) {
    logger.error('OCR模型加载失败:', error);
    // OCR失败不影响主要功能
    return {};
  }
}

// 检查模型状态
function checkModelStatus() {
  const status = {
    aiService: {
      available: true,
      models: aiService.getAvailableModels(),
      clients: Object.keys(aiService.clients)
    },
    timestamp: new Date().toISOString()
  };
  
  return status;
}

// 重新加载模型
async function reloadModels() {
  try {
    logger.info('重新加载模型...');
    
    // 重新初始化AI服务
    aiService.initializeClients();
    
    // 重新加载模型配置
    const models = await loadModels();
    const ocrModels = await loadOcrModels();
    
    logger.info('模型重新加载完成');
    return { models, ocrModels };
    
  } catch (error) {
    logger.error('模型重新加载失败:', error);
    throw error;
  }
}

// 获取模型信息
function getModelInfo(modelName) {
  const info = {
    name: modelName,
    supportsImages: aiService.supportsImages(modelName),
    provider: 'unknown',
    maxTokens: 4000,
    costTier: 'standard'
  };
  
  // 确定提供商
  if (modelName.startsWith('gpt-')) {
    info.provider = modelName.includes('azure') ? 'azure-openai' : 'openai';
  } else if (modelName.startsWith('claude-')) {
    info.provider = 'anthropic';
  }
  
  // 确定成本等级
  if (modelName.includes('4') || modelName.includes('opus')) {
    info.costTier = 'premium';
  } else if (modelName.includes('3.5') || modelName.includes('haiku')) {
    info.costTier = 'budget';
  }
  
  return info;
}

// 验证模型可用性
async function validateModel(modelName) {
  try {
    const availableModels = aiService.getAvailableModels();
    
    if (!availableModels.includes(modelName)) {
      return {
        valid: false,
        error: `模型 ${modelName} 不可用`
      };
    }
    
    // 可以添加更多验证逻辑，如测试API调用
    
    return {
      valid: true,
      info: getModelInfo(modelName)
    };
    
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

module.exports = {
  loadModels,
  loadOcrModels,
  checkModelStatus,
  reloadModels,
  getModelInfo,
  validateModel
};
