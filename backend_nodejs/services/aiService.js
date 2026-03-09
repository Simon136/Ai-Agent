/**
 * AI服务模块 - Node.js版本
 * 对应原Python models/ai_models.py
 */
const OpenAI = require('openai');
const { AzureOpenAI } = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const config = require('../config/config');
const database = require('../database/adaptedConnection');
const logger = require('../utils/logger');

class AIService {
  constructor() {
    this.clients = {};
    this.initializeClients();
  }

  initializeClients() {
    // OpenAI客户端
    if (config.models.openai.apiKey) {
      this.clients.openai = new OpenAI({
        apiKey: config.models.openai.apiKey,
        baseURL: config.models.openai.baseURL
      });
    }

    // Anthropic客户端
    if (config.models.anthropic.apiKey) {
      this.clients.anthropic = new Anthropic({
        apiKey: config.models.anthropic.apiKey
      });
    }
    console.log('AIService initialized with clients:', Object.keys(this.clients));
    // Azure OpenAI客户端
    if (config.models.azure_openai.apiKey) {
      this.clients.azure_openai = new OpenAI({
        apiKey: config.models.azure_openai.apiKey,
        baseURL: `${config.models.azure_openai.endpoint}/openai/deployments`,
        defaultQuery: { 'api-version': config.models.azure_openai.apiVersion },
        defaultHeaders: {
          'api-key': config.models.azure_openai.apiKey
        }
      });
    }

    logger.info('AI客户端初始化完成');
  }

  // 获取模型详细信息
  async getModelInfo(apiModelName) {
    try {
      // 从数据库获取所有模型
      const models = await database.getAllAiModels();
      logger.info(`获取到 ${models.length} 个模型配置，查找模型: ${apiModelName}`);
      
      // 查找匹配的模型
      for (const model of models) {
        let modelVersion = model.model_version;
        
        // 安全地解析JSON字段
        if (typeof modelVersion === 'string') {
          try {
            modelVersion = JSON.parse(modelVersion);
          } catch (e) {
            logger.warn(`解析模型版本失败 (${model.model_name}):`, e.message);
            continue;
          }
        }
        
        // 检查是否匹配API模型名称或前端显示名称
        if (modelVersion && typeof modelVersion === 'object') {
          for (const [versionKey, mappedApiName] of Object.entries(modelVersion)) {
            // 构建前端显示名称格式（如: GPT-5-chat, GPT-4.1）
            const displayName = `${model.model_name}-${versionKey}`;
            
            // 检查是否匹配：1) 实际API名称 2) 前端显示名称
            if (mappedApiName === apiModelName || displayName === apiModelName) {
              logger.info(`找到匹配模型: ${displayName} -> ${mappedApiName}`);
              // 找到匹配的模型，返回完整信息
              return {
                model_id: model.model_id,
                model_name: model.model_name,
                api_model_name: mappedApiName,
                model_key: model.model_key,
                model_url: model.model_url,
                category_request: model.category_request,
                custom_metadata: this.parseCustomMetadata(model.custom_metadata),
                version_key: versionKey
              };
            }
          }
        }
      }
      
      // 如果没有找到，抛出错误
      throw new Error(`未找到模型配置: ${apiModelName}`);
    } catch (error) {
      logger.error(`获取模型信息失败: ${apiModelName}`, error);
      throw error;
    }
  }

  // 安全地解析自定义元数据
  parseCustomMetadata(customMetadata) {
    if (typeof customMetadata === 'string') {
      try {
        return JSON.parse(customMetadata);
      } catch (e) {
        logger.warn('解析自定义元数据失败:', e.message);
        return {};
      }
    }
    return customMetadata || {};
  }

  // 生成文本响应（支持多轮对话）
  async generateText(modelName, prompt, streamCallback = null, conversationHistory = []) {
    try {
      logger.info(`开始生成文本 - 模型: ${modelName}, 历史对话轮数: ${conversationHistory.length}`);

      // 获取模型详细信息
      const modelInfo = await this.getModelInfo(modelName);
      logger.info(`模型信息: ${JSON.stringify(modelInfo)}`);
      if (modelInfo.category_request === 'Azure') {
        // Azure OpenAI 接口
        return await this.generateAzureOpenAIText(modelInfo, prompt, streamCallback, conversationHistory);
      } else if (modelInfo.category_request === 'Ark') {
        // 火山方舟 Ark 接口（使用优化版本）
        return await this.generateArkTextOptimized(modelInfo, prompt, streamCallback, conversationHistory);
      } else {
        // 标准 OpenAI 接口（支持所有其他模型）
        return await this.generateOpenAIText(modelInfo, prompt, streamCallback, conversationHistory);
      }
    } catch (error) {
      // 记录错误时只包含有用信息，避免循环引用
      const errorInfo = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      };
      logger.error(`文本生成失败 - 模型: ${modelName}`, errorInfo);
      throw error;
    }
  }

  // 生成带图片的响应（支持多轮对话）
  async generateWithImage(modelName, prompt, imageData, streamCallback = null, conversationHistory = []) {
    try {
      logger.info(`开始生成带图片的响应 - 模型: ${modelName}, 历史对话轮数: ${conversationHistory.length}`);

      // 获取模型详细信息
      const modelInfo = await this.getModelInfo(modelName);
      
      if (modelInfo.category_request === 'Azure') {
        // Azure OpenAI 接口
        return await this.generateAzureOpenAIWithImage(modelInfo, prompt, imageData, streamCallback, conversationHistory);
      } else if (modelInfo.category_request === 'Ark') {
        // 火山方舟 Ark 接口
        return await this.generateArkWithImage(modelInfo, prompt, imageData, streamCallback, conversationHistory);
      } else {
        // 标准 OpenAI 接口
        return await this.generateOpenAIWithImage(modelInfo, prompt, imageData, streamCallback, conversationHistory);
      }
    } catch (error) {
      logger.error(`带图片生成失败 - 模型: ${modelName}`, error);
      throw error;
    }
  }

  // OpenAI文本生成（支持所有使用OpenAI接口的模型，包含多轮对话）
  async generateOpenAIText(modelInfo, prompt, streamCallback, conversationHistory = []) {
    try {
      // 使用模型配置创建客户端
      const client = new OpenAI({
        apiKey: modelInfo.model_key,
        baseURL: modelInfo.model_url
      });
      logger.info(`使用OpenAI模型: ${modelInfo.api_model_name}`);
      
      // 构建消息数组，包含历史对话
      const messages = [];
      
      // 添加历史对话（最多3轮）
      for (const historyItem of conversationHistory) {
        messages.push({ role: 'user', content: historyItem.user_message });
        messages.push({ role: 'assistant', content: historyItem.assistant_message });
      }
      
      // 添加当前用户消息
      messages.push({ role: 'user', content: prompt });
      
      logger.info(`构建消息数组，共 ${messages.length} 条消息 (包含 ${conversationHistory.length} 轮历史对话)`);

      if (streamCallback) {
        // 流式响应
        let fullResponse = '';
        const stream = await client.chat.completions.create({
          model: modelInfo.api_model_name,
          messages: messages,
          stream: true,
          max_tokens: 4000,
          temperature: 0.7 // 统一使用0.7
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            streamCallback(content, false);
          }
        }
        
        logger.info(`OpenAI流式响应完成: ${fullResponse.length} 字符`); // 只记录字符数
        streamCallback('', true); // 标记完成
        return fullResponse;
      } else {
        // 非流式响应
        const completion = await client.chat.completions.create({
          model: modelInfo.api_model_name,
          messages: messages,
          max_tokens: 4000,
          temperature: 0.7
        });

        return completion.choices[0].message.content;
      }
    } catch (error) {
      logger.error(`OpenAI接口调用失败:`, error);
      throw error;
    }
  }

  // OpenAI带图片生成（支持多轮对话）
  async generateOpenAIWithImage(modelInfo, prompt, imageData, streamCallback, conversationHistory = []) {
    try {
      // 使用模型配置创建客户端
      const client = new OpenAI({
        apiKey: modelInfo.model_key,
        baseURL: modelInfo.model_url
      });

      // 构建消息数组，包含历史对话
      const messages = [];
      
      // 添加历史对话（最多3轮，文本对话）
      for (const historyItem of conversationHistory) {
        messages.push({ role: 'user', content: historyItem.user_message });
        messages.push({ role: 'assistant', content: historyItem.assistant_message });
      }

      // 构建当前消息内容（包含文本和图片）
      const currentContent = [
        { type: 'text', text: prompt }
      ];

      if (imageData.url) {
        currentContent.push({
          type: 'image_url',
          image_url: { url: imageData.url }
        });
      } else if (imageData.base64) {
        currentContent.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${imageData.base64}` }
        });
      }

      // 添加当前用户消息（包含图片）
      messages.push({ role: 'user', content: currentContent });
      
      logger.info(`OpenAI构建带图片消息数组，共 ${messages.length} 条消息 (包含 ${conversationHistory.length} 轮历史对话)`);

      if (streamCallback) {
        // 流式响应
        let fullResponse = '';
        const stream = await client.chat.completions.create({
          model: modelInfo.api_model_name,
          messages: messages,
          stream: true,
          max_tokens: 4000,
          temperature: 0.7
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            streamCallback(content, false);
          }
        }

        streamCallback('', true);
        return fullResponse;
      } else {
        const completion = await client.chat.completions.create({
          model: modelInfo.api_model_name,
          messages: messages,
          max_tokens: 4000,
          temperature: 0.7
        });

        return completion.choices[0].message.content;
      }
    } catch (error) {
      logger.error(`OpenAI图片接口调用失败:`, error);
      throw error;
    }
  }

  // Anthropic文本生成
  async generateAnthropicText(modelName, prompt, streamCallback) {
    if (!this.clients.anthropic) {
      throw new Error('Anthropic客户端未初始化');
    }

    if (streamCallback) {
      // 流式响应
      let fullResponse = '';
      const stream = await this.clients.anthropic.messages.create({
        model: modelName,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
        stream: true
      });

      for await (const messageStreamEvent of stream) {
        if (messageStreamEvent.type === 'content_block_delta') {
          const content = messageStreamEvent.delta.text || '';
          if (content) {
            fullResponse += content;
            streamCallback(content, false);
          }
        }
      }

      streamCallback('', true);
      return fullResponse;
    } else {
      const message = await this.clients.anthropic.messages.create({
        model: modelName,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      });

      return message.content[0].text;
    }
  }

  // Azure OpenAI文本生成（支持多轮对话）
  async generateAzureOpenAIText(modelInfo, prompt, streamCallback, conversationHistory = []) {
    try {
      // 获取Azure模型的版本信息
      const customMetadata = modelInfo.custom_metadata || {};
      let apiVersion;
      
      // 从custom_metadata或model_version中获取API版本
      if (typeof customMetadata === 'object' && customMetadata[modelInfo.version_key]) {
        apiVersion = customMetadata[modelInfo.version_key];
      } else {
        // 默认版本
        apiVersion = '2024-02-01';
      }
      
      logger.info(`Azure OpenAI使用API版本: ${apiVersion}, 模型: ${modelInfo.api_model_name}`);

      // 使用Azure OpenAI的正确配置方式
      const client = new OpenAI({
        apiKey: modelInfo.model_key,
        baseURL: `${modelInfo.model_url}openai/deployments/${modelInfo.api_model_name}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: {
          'api-key': modelInfo.model_key
        }
      });

      // 构建消息数组，包含历史对话
      const messages = [];
      
      // 添加历史对话（最多3轮）
      for (const historyItem of conversationHistory) {
        messages.push({ role: 'user', content: historyItem.user_message });
        messages.push({ role: 'assistant', content: historyItem.assistant_message });
      }
      
      // 添加当前用户消息
      messages.push({ role: 'user', content: prompt });
      
      logger.info(`Azure OpenAI构建消息数组，共 ${messages.length} 条消息 (包含 ${conversationHistory.length} 轮历史对话)`);

      if (streamCallback) {
        let fullResponse = '';
        
        // 根据模型类型选择不同的请求参数，参考Python版本
        let requestParams = {
          model: modelInfo.api_model_name,
          messages: messages,
          stream: true,
          max_tokens: 4000
        };
        
        // 如果不是o3-mini模型，添加temperature参数
        if (modelInfo.api_model_name !== 'o3-mini') {
          requestParams.temperature = 0;
        }
        
        const stream = await client.chat.completions.create(requestParams);

        for await (const chunk of stream) {
          if (chunk.choices && chunk.choices.length > 0) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              streamCallback(content, false);
            }
          }
        }

        streamCallback('', true);
        return fullResponse;
      } else {
        // 非流式请求
        let requestParams = {
          model: modelInfo.api_model_name,
          messages: messages,
          max_tokens: 4000
        };
        
        // 如果不是o3-mini模型，添加temperature参数
        if (modelInfo.api_model_name !== 'o3-mini') {
          requestParams.temperature = 0;
        }
        
        const completion = await client.chat.completions.create(requestParams);

        return completion.choices[0].message.content;
      }
    } catch (error) {
      logger.error(`Azure OpenAI接口调用失败:`, error);
      throw error;
    }
  }

  // Ark文本生成（火山方舟，支持多轮对话）
  async generateArkText(modelInfo, prompt, streamCallback, conversationHistory = []) {
    try {
      logger.info(`Ark模型生成开始 - 模型: ${modelInfo.api_model_name}`);

      // 引入axios来替代内置的OpenAI客户端，因为我们需要自定义处理
      const axios = require('axios');

      // 构建消息数组，包含历史对话
      const messages = [];
      
      // 添加历史对话（最多3轮）
      for (const historyItem of conversationHistory) {
        messages.push({ role: 'user', content: historyItem.user_message });
        messages.push({ role: 'assistant', content: historyItem.assistant_message });
      }
      
      // 添加当前用户消息
      messages.push({ role: 'user', content: prompt });
      
      logger.info(`Ark构建消息数组，共 ${messages.length} 条消息 (包含 ${conversationHistory.length} 轮历史对话)`);

      // 构建请求头和数据
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelInfo.model_key}`
      };

      const requestData = {
        model: modelInfo.api_model_name,
        messages: messages,
        stream: true,
        max_tokens: 2000,
        temperature: 0.7
      };

      if (streamCallback) {
        // 流式响应处理
        let fullResponse = '';
        let inThinkBlock = false;

        const response = await axios({
          method: 'post',
          url: modelInfo.model_url,
          headers: headers,
          data: requestData,
          responseType: 'stream'
        });

        return new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            
            for (const line of lines) {
              if (line.trim() && line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                
                if (jsonStr.trim() === '[DONE]') {
                  streamCallback('', true);
                  resolve(fullResponse);
                  return;
                }
                
                try {
                  const chunkData = JSON.parse(jsonStr);
                  
                  if (chunkData.choices && chunkData.choices.length > 0) {
                    const delta = chunkData.choices[0].delta || {};
                    
                    if (delta.content) {
                      const content = delta.content;
                      fullResponse += content;
                      
                      // 处理 DeepSeek-R1 的思考标签
                      if (content.includes('<think>')) {
                        inThinkBlock = true;
                        const beforeThink = content.split('<think>')[0];
                        if (beforeThink) {
                          streamCallback(beforeThink, false);
                        }
                        continue;
                      }
                      
                      if (content.includes('</think>')) {
                        inThinkBlock = false;
                        const afterThink = content.split('</think>').pop();
                        if (afterThink) {
                          streamCallback(afterThink, false);
                        }
                        continue;
                      }
                      
                      // 正常输出内容（跳过思考部分）
                      if (!inThinkBlock) {
                        streamCallback(content, false);
                      }
                    }
                  }
                } catch (e) {
                  // 跳过无法解析的行
                  logger.warn('Ark解析响应数据失败:', e.message);
                }
              }
            }
          });

          response.data.on('end', () => {
            streamCallback('', true);
            resolve(fullResponse);
          });

          response.data.on('error', (error) => {
            logger.error('Ark流式响应错误:', error);
            reject(error);
          });
        });
      } else {
        // 非流式响应
        requestData.stream = false;
        
        const response = await axios({
          method: 'post',
          url: modelInfo.model_url,
          headers: headers,
          data: requestData
        });

        if (response.data && response.data.choices && response.data.choices.length > 0) {
          return response.data.choices[0].message.content;
        } else {
          throw new Error('Ark API响应格式异常');
        }
      }
    } catch (error) {
      logger.error(`Ark文本生成失败:`, error);
      throw error;
    }
  }

  // Ark带图片生成（火山方舟，支持多轮对话）
  async generateArkWithImage(modelInfo, prompt, imageData, streamCallback, conversationHistory = []) {
    try {
      logger.info(`Ark模型图片生成开始 - 模型: ${modelInfo.api_model_name}`);

      const axios = require('axios');

      // 构建消息数组，包含历史对话
      const messages = [];
      
      // 添加历史对话（最多3轮，文本对话）
      for (const historyItem of conversationHistory) {
        messages.push({ role: 'user', content: historyItem.user_message });
        messages.push({ role: 'assistant', content: historyItem.assistant_message });
      }

      // 构建当前消息内容（包含文本和图片）
      const currentContent = [
        { type: 'text', text: prompt }
      ];

      if (imageData.url) {
        currentContent.push({
          type: 'image_url',
          image_url: { url: imageData.url }
        });
      } else if (imageData.base64) {
        currentContent.push({
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${imageData.base64}` }
        });
      }

      // 添加当前用户消息（包含图片）
      messages.push({ role: 'user', content: currentContent });
      
      logger.info(`Ark构建带图片消息数组，共 ${messages.length} 条消息 (包含 ${conversationHistory.length} 轮历史对话)`);

      // 构建请求头和数据
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelInfo.model_key}`
      };

      const requestData = {
        model: modelInfo.api_model_name,
        messages: messages,
        stream: streamCallback ? true : false,
        max_tokens: 2000,
        temperature: 0.7
      };

      if (streamCallback) {
        // 流式响应处理
        let fullResponse = '';
        let inThinkBlock = false;

        const response = await axios({
          method: 'post',
          url: modelInfo.model_url,
          headers: headers,
          data: requestData,
          responseType: 'stream'
        });

        return new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            
            for (const line of lines) {
              if (line.trim() && line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                
                if (jsonStr.trim() === '[DONE]') {
                  streamCallback('', true);
                  resolve(fullResponse);
                  return;
                }
                
                try {
                  const chunkData = JSON.parse(jsonStr);
                  
                  if (chunkData.choices && chunkData.choices.length > 0) {
                    const delta = chunkData.choices[0].delta || {};
                    
                    if (delta.content) {
                      const content = delta.content;
                      fullResponse += content;
                      
                      // 处理 DeepSeek-R1 的思考标签
                      if (content.includes('<think>')) {
                        inThinkBlock = true;
                        const beforeThink = content.split('<think>')[0];
                        if (beforeThink) {
                          streamCallback(beforeThink, false);
                        }
                        continue;
                      }
                      
                      if (content.includes('</think>')) {
                        inThinkBlock = false;
                        const afterThink = content.split('</think>').pop();
                        if (afterThink) {
                          streamCallback(afterThink, false);
                        }
                        continue;
                      }
                      
                      // 正常输出内容（跳过思考部分）
                      if (!inThinkBlock) {
                        streamCallback(content, false);
                      }
                    }
                  }
                } catch (e) {
                  // 跳过无法解析的行
                  logger.warn('Ark解析响应数据失败:', e.message);
                }
              }
            }
          });

          response.data.on('end', () => {
            streamCallback('', true);
            resolve(fullResponse);
          });

          response.data.on('error', (error) => {
            logger.error('Ark流式响应错误:', error);
            reject(error);
          });
        });
      } else {
        // 非流式响应
        const response = await axios({
          method: 'post',
          url: modelInfo.model_url,
          headers: headers,
          data: requestData
        });

        if (response.data && response.data.choices && response.data.choices.length > 0) {
          return response.data.choices[0].message.content;
        } else {
          throw new Error('Ark API响应格式异常');
        }
      }
    } catch (error) {
      logger.error(`Ark带图片生成失败:`, error);
      throw error;
    }
  }

  // Azure OpenAI带图片生成（支持多轮对话）
  async generateAzureOpenAIWithImage(modelInfo, prompt, imageData, streamCallback, conversationHistory = []) {
    try {
      // 获取Azure模型的版本信息
      const customMetadata = modelInfo.custom_metadata || {};
      let apiVersion;
      
      // 从custom_metadata或model_version中获取API版本
      if (typeof customMetadata === 'object' && customMetadata[modelInfo.version_key]) {
        apiVersion = customMetadata[modelInfo.version_key];
      } else {
        // 默认版本
        apiVersion = '2024-02-01';
      }
      
      logger.info(`Azure OpenAI图片处理使用API版本: ${apiVersion}, 模型: ${modelInfo.api_model_name}`);

      // 使用Azure OpenAI的正确配置方式
      const client = new OpenAI({
        apiKey: modelInfo.model_key,
        baseURL: `${modelInfo.model_url}openai/deployments/${modelInfo.api_model_name}`,
        defaultQuery: { 'api-version': apiVersion },
        defaultHeaders: {
          'api-key': modelInfo.model_key
        }
      });

      // 构建消息数组，包含历史对话
      const messages = [];
      
      // 添加历史对话（最多3轮，文本对话）
      for (const historyItem of conversationHistory) {
        messages.push({ role: 'user', content: historyItem.user_message });
        messages.push({ role: 'assistant', content: historyItem.assistant_message });
      }

      // 构建当前消息内容（包含文本和图片）
      const currentContent = [
        { type: 'text', text: prompt }
      ];

      // 处理图片数据，参考Python版本的逻辑
      let imageContent;
      if (imageData.url) {
        // 直接使用图片URL（需要是公网可访问的）
        imageContent = {
          url: imageData.url
        };
        logger.info(`Azure OpenAI 使用图片URL: ${imageData.url}`);
      } else if (imageData.base64) {
        // 备用：使用base64编码
        imageContent = {
          url: `data:image/jpeg;base64,${imageData.base64}`
        };
        logger.info("Azure OpenAI 使用base64编码");
      } else {
        throw new Error("需要提供image_url或base64_image");
      }

      currentContent.push({
        type: 'image_url',
        image_url: imageContent
      });

      // 添加当前用户消息（包含图片）
      messages.push({ role: 'user', content: currentContent });
      
      logger.info(`Azure OpenAI构建带图片消息数组，共 ${messages.length} 条消息 (包含 ${conversationHistory.length} 轮历史对话)`);

      if (streamCallback) {
        let fullResponse = '';
        const stream = await client.chat.completions.create({
          model: modelInfo.api_model_name,
          messages: messages,
          max_completion_tokens: 1000, // 参考Python版本使用max_completion_tokens
          stream: true
        });

        for await (const chunk of stream) {
          if (chunk.choices && chunk.choices.length > 0) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              streamCallback(content, false);
            }
          }
        }

        streamCallback('', true);
        return fullResponse;
      } else {
        const completion = await client.chat.completions.create({
          model: modelInfo.api_model_name,
          messages: messages,
          max_completion_tokens: 1000
        });

        return completion.choices[0].message.content;
      }
    } catch (error) {
      logger.error(`Azure OpenAI图片接口调用失败:`, error);
      throw error;
    }
  }

  // 移除不需要的方法
  // ...existing code...

  // 获取可用模型列表
  getAvailableModels() {
    const models = [];
    
    // 添加配置中的模型
    if (this.clients.openai) {
      models.push('gpt-3.5-turbo', 'gpt-4', 'gpt-4-turbo');
    }
    
    if (this.clients.anthropic) {
      models.push('claude-3-sonnet', 'claude-3-haiku', 'claude-3-opus');
    }
    
    if (this.clients.azure_openai) {
      models.push('gpt-4', 'gpt-35-turbo', 'o3-mini', 'gpt-5-chat');
    }
    
    // 添加Ark模型支持
    models.push('deepseek-r1-250528', 'deepseek-v3-250324');
    
    return models;
  }

  // 检查模型是否支持图片
  supportsImages(modelName) {
    const imageModels = [
      'gpt-4-vision-preview',
      'gpt-4-turbo',
      'gpt-5-chat',
      'claude-3-opus',
      'claude-3-sonnet'
    ];
    
    return imageModels.some(imageModel => 
      modelName.toLowerCase().includes(imageModel.toLowerCase())
    );
  }

  // 判断是否为Azure模型
  isAzureModel(categoryRequest) {
    return categoryRequest === 'Azure';
  }

  // 判断是否为Ark模型
  isArkModel(categoryRequest) {
    return categoryRequest === 'Ark';
  }

  // 判断是否为特殊模型（如o3-mini）
  isSpecialModel(modelName) {
    const specialModels = ['o3-mini'];
    return specialModels.includes(modelName);
  }

  // OCR图片识别功能 (对应原Python AZURE_AIMODELS_OCR)
  async analyzeImageWithOCR(modelName, prompt, imageData) {
    try {
      logger.info(`开始OCR图片识别 - 模型: ${modelName}`);
      
      // 获取模型信息
      const modelInfo = await this.getModelInfo(modelName);
      
      // 添加调试信息
      logger.info(`模型信息调试:`, {
        model_name: modelInfo.model_name,
        api_model_name: modelInfo.api_model_name,
        category_request: modelInfo.category_request,
        model_url: modelInfo.model_url
      });
      
      // 根据模型类型调用不同的OCR方法，与现有的generateWithImage逻辑保持一致
      if (modelInfo.category_request === 'Azure') {
        // Azure OpenAI 接口
        logger.info('使用Azure OpenAI OCR方法');
        return await this.generateAzureOpenAIOCR(modelInfo, prompt, imageData);
      } else if (modelInfo.category_request === 'Ark') {
        // 火山方舟 Ark 接口
        logger.info('使用Ark OCR方法');
        return await this.generateArkOCR(modelInfo, prompt, imageData);
      } else {
        // 标准 OpenAI 接口（包括其他兼容OpenAI格式的模型）
        logger.info('使用标准OpenAI OCR方法');
        return await this.generateOpenAIOCR(modelInfo, prompt, imageData);
      }
      
    } catch (error) {
      logger.error(`OCR图片识别失败 - 模型: ${modelName}`, error);
      throw error;
    }
  }

  // OCR图片识别（流式响应版本）
  async analyzeImageWithOCRStream(modelName, prompt, imageData, streamCallback) {
    try {
      // 获取模型信息
      const modelInfo = await this.getModelInfo(modelName);
      
      // 添加调试信息
      logger.info(`模型信息调试:`, {
        model_name: modelInfo.model_name,
        api_model_name: modelInfo.api_model_name,
        category_request: modelInfo.category_request,
        model_url: modelInfo.model_url
      });
      
      // 根据模型类型调用不同的OCR方法
      if (modelInfo.category_request === 'Azure') {
        // Azure OpenAI 接口（流式）
        logger.info('使用Azure OpenAI OCR流式方法');
        return await this.generateAzureOpenAIOCRStream(modelInfo, prompt, imageData, streamCallback);
      } else if (modelInfo.category_request === 'Ark') {
        // 火山方舟 Ark 接口（流式）
        logger.info('使用Ark OCR流式方法');
        return await this.generateArkOCRStream(modelInfo, prompt, imageData, streamCallback);
      } else {
        // 标准 OpenAI 接口（流式）
        logger.info('使用标准OpenAI OCR流式方法');
        return await this.generateOpenAIOCRStream(modelInfo, prompt, imageData, streamCallback);
      }
    } catch (error) {
      logger.error(`OCR图片识别失败 - 模型: ${modelName}`, error);
      throw error;
    }
  }

  // Azure OpenAI OCR识别（对应原Python AZURE_AIMODELS_OCR.generate_response）
  async generateAzureOpenAIOCR(modelInfo, prompt, imageData) {
    return await this.generateAzureOpenAIOCRStream(modelInfo, prompt, imageData, null);
  }

  // Azure OpenAI OCR识别（流式版本）
  async generateAzureOpenAIOCRStream(modelInfo, prompt, imageData, streamCallback) {
    try {
      // 使用固定的Azure OpenAI配置，与Python代码完全一致
      const apiVersion = '2025-04-01-preview';
      
      logger.info(`Azure OpenAI OCR使用API版本: ${apiVersion}, 部署名: ${modelInfo.api_model_name}`);
      
      // 使用Azure OpenAI的专用配置方式，匹配Python代码
      const client = new AzureOpenAI({
        apiKey: modelInfo.model_key,
        apiVersion: apiVersion,
        endpoint: modelInfo.model_url
      });
      
      logger.info(`Azure OpenAI OCR配置: endpoint=${modelInfo.model_url}, deployment=${modelInfo.api_model_name}, apiVersion=${apiVersion}`);

      // 构建图片内容 - 完全按照Python版本格式
      let imageContent;
      if (imageData.url) {
        // 直接使用图片URL（需要是公网可访问的）
        imageContent = {
          url: imageData.url
        };
        logger.info(`Azure OpenAI OCR使用图片URL: ${imageData.url}`);
      } else if (imageData.base64) {
        // 使用base64编码
        imageContent = {
          url: `data:image/jpeg;base64,${imageData.base64}`
        };
        logger.info("Azure OpenAI OCR使用base64编码");
      } else {
        throw new Error("需要提供image_url或base64_image");
      }

      // 构建消息（完全按照Python版本格式）
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { 
              type: "image_url", 
              image_url: {
                url: imageContent.url
              }
            }
          ]
        }
      ];

      let fullResponse = '';
      const stream = await client.chat.completions.create({
        model: modelInfo.api_model_name, // 使用部署名称
        messages: messages,
        max_tokens: 300,  // 与Python代码一致
        stream: true
      });

      for await (const chunk of stream) {
        if (chunk.choices && chunk.choices.length > 0) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            // 如果有流式回调，实时发送内容
            if (streamCallback) {
              streamCallback(content, false);
            }
          }
        }
      }

      logger.info(`Azure OpenAI OCR识别完成，返回内容长度: ${fullResponse.length}`);
      
      // 通知流式响应完成
      if (streamCallback) {
        streamCallback('', true);
      }
      
      return fullResponse;

    } catch (error) {
      logger.error('Azure OpenAI OCR识别失败:', error);
      throw new Error(`Azure OpenAI OCR识别失败: ${error.message}`);
    }
  }

  // OpenAI OCR识别（对应原Python GPT_AIMODELS，也支持图片）
  async generateOpenAIOCR(modelInfo, prompt, imageData) {
    return await this.generateOpenAIOCRStream(modelInfo, prompt, imageData, null);
  }

  // OpenAI OCR识别（流式版本）
  async generateOpenAIOCRStream(modelInfo, prompt, imageData, streamCallback) {
    try {
      // 使用模型配置创建客户端，完全按照Python版本的方式
      const client = new OpenAI({
        apiKey: modelInfo.model_key,
        baseURL: modelInfo.model_url
      });

      // 构建图片内容 - 完全按照Python版本格式
      let imageContent;
      if (imageData.url) {
        imageContent = {
          url: imageData.url
        };
        logger.info(`OpenAI OCR使用图片URL: ${imageData.url}`);
      } else if (imageData.base64) {
        imageContent = {
          url: `data:image/jpeg;base64,${imageData.base64}`
        };
        logger.info("OpenAI OCR使用base64编码");
      } else {
        throw new Error("需要提供image_url或base64_image");
      }

      // 构建消息 - 完全按照Python版本的格式
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: imageContent }
          ]
        }
      ];

      let fullResponse = '';
      const stream = await client.chat.completions.create({
        model: modelInfo.api_model_name,
        messages: messages,
        temperature: 0,  // 添加temperature参数，与Python版本一致
        stream: true
      });

      for await (const chunk of stream) {
        if (chunk.choices && chunk.choices.length > 0) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            // 如果有流式回调，实时发送内容
            if (streamCallback) {
              streamCallback(content, false);
            }
          }
        }
      }

      logger.info(`OpenAI OCR识别完成，返回内容长度: ${fullResponse.length}`);
      
      // 通知流式响应完成
      if (streamCallback) {
        streamCallback('', true);
      }
      
      return fullResponse;

    } catch (error) {
      logger.error('OpenAI OCR识别失败:', error);
      throw new Error(`OpenAI OCR识别失败: ${error.message}`);
    }
  }

  // Ark OCR识别（火山方舟）
  async generateArkOCR(modelInfo, prompt, imageData) {
    return await this.generateArkOCRStream(modelInfo, prompt, imageData, null);
  }

  // Ark OCR识别（流式版本）
  async generateArkOCRStream(modelInfo, prompt, imageData, streamCallback) {
    try {
      logger.info(`Ark OCR识别开始 - 模型: ${modelInfo.api_model_name}`);

      const axios = require('axios');

      // 构建图片内容
      let imageContent;
      if (imageData.url) {
        imageContent = {
          url: imageData.url
        };
        logger.info(`Ark OCR使用图片URL: ${imageData.url}`);
      } else if (imageData.base64) {
        imageContent = {
          url: `data:image/jpeg;base64,${imageData.base64}`
        };
        logger.info("Ark OCR使用base64编码");
      } else {
        throw new Error("需要提供image_url或base64_image");
      }

      // 构建消息
      const messages = [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: imageContent }
          ]
        }
      ];

      // 构建请求头和数据
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelInfo.model_key}`
      };

      const requestData = {
        model: modelInfo.api_model_name,
        messages: messages,
        max_tokens: 300,
        temperature: 0,
        stream: streamCallback ? true : false
      };

      if (streamCallback) {
        // 流式响应处理
        let fullResponse = '';
        let inThinkBlock = false;

        const response = await axios({
          method: 'post',
          url: modelInfo.model_url,
          headers: headers,
          data: requestData,
          responseType: 'stream'
        });

        return new Promise((resolve, reject) => {
          response.data.on('data', (chunk) => {
            const lines = chunk.toString().split('\n');
            
            for (const line of lines) {
              if (line.trim() && line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                
                if (jsonStr.trim() === '[DONE]') {
                  streamCallback('', true);
                  resolve(fullResponse);
                  return;
                }
                
                try {
                  const chunkData = JSON.parse(jsonStr);
                  
                  if (chunkData.choices && chunkData.choices.length > 0) {
                    const delta = chunkData.choices[0].delta || {};
                    
                    if (delta.content) {
                      const content = delta.content;
                      fullResponse += content;
                      
                      // 处理 DeepSeek-R1 的思考标签
                      if (content.includes('<think>')) {
                        inThinkBlock = true;
                        const beforeThink = content.split('<think>')[0];
                        if (beforeThink) {
                          streamCallback(beforeThink, false);
                        }
                        continue;
                      }
                      
                      if (content.includes('</think>')) {
                        inThinkBlock = false;
                        const afterThink = content.split('</think>').pop();
                        if (afterThink) {
                          streamCallback(afterThink, false);
                        }
                        continue;
                      }
                      
                      // 正常输出内容（跳过思考部分）
                      if (!inThinkBlock) {
                        streamCallback(content, false);
                      }
                    }
                  }
                } catch (e) {
                  // 跳过无法解析的行
                  logger.warn('Ark OCR解析响应数据失败:', e.message);
                }
              }
            }
          });

          response.data.on('end', () => {
            logger.info(`Ark OCR识别完成，返回内容长度: ${fullResponse.length}`);
            if (streamCallback) {
              streamCallback('', true);
            }
            resolve(fullResponse);
          });

          response.data.on('error', (error) => {
            logger.error('Ark OCR流式响应错误:', error);
            reject(error);
          });
        });
      } else {
        // 非流式响应
        const response = await axios({
          method: 'post',
          url: modelInfo.model_url,
          headers: headers,
          data: requestData
        });

        logger.info(`Ark OCR识别完成，返回内容长度: ${response.data?.choices?.[0]?.message?.content?.length || 0}`);
        
        if (response.data && response.data.choices && response.data.choices.length > 0) {
          return response.data.choices[0].message.content;
        } else {
          throw new Error('Ark OCR API响应格式异常');
        }
      }
    } catch (error) {
      logger.error('Ark OCR识别失败:', error);
      throw new Error(`Ark OCR识别失败: ${error.message}`);
    }
  }

  // 深度思考模型生成（支持思考过程）- 简单测试版本
  async generateWithThinking(modelName, prompt, conversationHistory = [], streamCallback) {
    try {
      logger.info(`测试思考模式生成 - 模型: ${modelName}`);
      
      // 模拟思考过程
      if (streamCallback) {
        // 发送思考内容
        streamCallback({
          type: 'thinking',
          content: '我正在思考这个问题...\n',
          isComplete: false
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        streamCallback({
          type: 'thinking',
          content: '分析用户的问题类型...\n',
          isComplete: false
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        streamCallback({
          type: 'thinking',
          content: '准备最合适的回答...\n',
          isComplete: false
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 思考完成
        streamCallback({
          type: 'thinking_complete',
          content: '',
          isComplete: false
        });
        
        // 发送回答
        const answer = "你好！我是一个AI助手，很高兴与你交流。";
        for (let i = 0; i < answer.length; i++) {
          streamCallback({
            type: 'answer',
            content: answer[i],
            isComplete: false
          });
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // 完成
        streamCallback({
          type: 'complete',
          content: '',
          isComplete: true,
          fullAnswer: answer,
          fullReasoning: '我正在思考这个问题...\n分析用户的问题类型...\n准备最合适的回答...\n'
        });
      }

      return {
        answer: "你好！我是一个AI助手，很高兴与你交流。",
        reasoning: '我正在思考这个问题...\n分析用户的问题类型...\n准备最合适的回答...\n',
        isThinking: true
      };

    } catch (error) {
      logger.error('思考模式生成失败:', error);
      throw error;
    }
  }

  // 🔥 优化版本的 Ark文本生成方法（修复R1思考过程输出）
  async generateArkTextOptimized(modelInfo, prompt, streamCallback, conversationHistory = []) {
    try {
      logger.info(`Ark模型生成开始（优化版） - 模型: ${modelInfo.api_model_name}`);

      const axios = require('axios');
      
      // 构建消息数组，包含历史对话
      const messages = [];
      
      // 添加历史对话（最多3轮）
      for (const historyItem of conversationHistory) {
        messages.push({ role: 'user', content: historyItem.user_message });
        messages.push({ role: 'assistant', content: historyItem.assistant_message });
      }
      
      // 添加当前用户消息
      messages.push({ role: 'user', content: prompt });
      
      logger.info(`Ark构建消息数组，共 ${messages.length} 条消息 (包含 ${conversationHistory.length} 轮历史对话)`);

      // 构建请求头和数据
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelInfo.model_key}`
      };

      const requestData = {
        model: modelInfo.api_model_name,
        messages: messages,
        stream: true,
        max_tokens: 2000,
        temperature: 0.7
      };

      if (streamCallback) {
        // 流式响应处理
        let fullResponse = '';
        let inThinkBlock = false;

        const response = await axios({
          method: 'post',
          url: modelInfo.model_url,
          headers: headers,
          data: requestData,
          responseType: 'stream'
        });

        return new Promise((resolve, reject) => {
          let buffer = '';
          
          response.data.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            
            // 保留最后一个可能不完整的行
            buffer = lines.pop() || '';
            
            for (const line of lines) {
              if (line.trim() && line.startsWith('data: ')) {
                const jsonStr = line.slice(6).trim();
                
                if (jsonStr === '[DONE]') {
                  streamCallback('', true);
                  resolve(fullResponse);
                  return;
                }
                
                if (jsonStr) {
                  try {
                    const chunkData = JSON.parse(jsonStr);
                    
                    if (chunkData.choices && chunkData.choices.length > 0) {
                      const delta = chunkData.choices[0].delta || {};
                      
                      if (delta.content) {
                        const content = delta.content;
                        fullResponse += content;
                        
                        // 🔥 关键修改：检查是否为 DeepSeek-R1 模型
                        if (modelInfo.api_model_name === 'deepseek-r1-250528') {
                          // ✅ 对于 R1 模型，输出所有内容包括思考过程
                          streamCallback(content, false);
                        } else {
                          // ❌ 对于其他模型，过滤思考标签
                          if (content.includes('<think>')) {
                            inThinkBlock = true;
                            const beforeThink = content.split('<think>')[0];
                            if (beforeThink) {
                              streamCallback(beforeThink, false);
                            }
                            continue;
                          }
                          
                          if (content.includes('</think>')) {
                            inThinkBlock = false;
                            const afterThink = content.split('</think>').pop();
                            if (afterThink) {
                              streamCallback(afterThink, false);
                            }
                            continue;
                          }
                          
                          // 正常输出内容（跳过思考部分）
                          if (!inThinkBlock) {
                            streamCallback(content, false);
                          }
                        }
                      }
                    }
                  } catch (e) {
                    // 静默处理JSON解析错误，避免日志噪音
                  }
                }
              }
            }
          });

          response.data.on('end', () => {
            streamCallback('', true);
            resolve(fullResponse);
          });

          response.data.on('error', (error) => {
            logger.error('Ark流式响应错误:', error);
            reject(error);
          });
        });
      } else {
        // 非流式响应
        requestData.stream = false;
        
        const response = await axios({
          method: 'post',
          url: modelInfo.model_url,
          headers: headers,
          data: requestData
        });

        if (response.data && response.data.choices && response.data.choices.length > 0) {
          return response.data.choices[0].message.content;
        } else {
          throw new Error('Ark API响应格式异常');
        }
      }
    } catch (error) {
      // 记录错误时只包含有用信息，避免循环引用
      const errorInfo = {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: modelInfo.model_url,
        model: modelInfo.api_model_name
      };
      logger.error(`Ark文本生成失败（优化版）:`, errorInfo);
      throw error;
    }
  }
}

module.exports = new AIService();
