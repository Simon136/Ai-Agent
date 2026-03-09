/**
 * WebSocket事件处理器 - Node.js版本
 * 对应原Python socket_handlers.py
 */
const { v4: uuidv4 } = require('uuid');
const database = require('../database/adaptedConnection');
const s3Utils = require('../services/s3Utils');
const aiService = require('../services/aiService');
const logger = require('../utils/logger');
const { validateUserAgent } = require('../middleware/validation');

class SocketHandlers {
  constructor() {
    this.connectedUsers = new Map();
    this.modelMapping = new Map(); // 存储模型名称映射
    this.conversationStates = new Map(); // 存储对话状态，跟踪哪些对话正在生成回复
    this.abortControllers = new Map(); // 存储取消控制器，用于中断AI请求
  }

  async register(io, models, ocrModels) {
    this.io = io;
    this.models = models;
    this.ocrModels = ocrModels;

    // 初始化模型映射
    await this.initializeModelMapping();

    io.on('connection', (socket) => {
      this.handleConnection(socket);
    });
  }

  handleConnection(socket) {
    logger.info(`新的WebSocket连接: ${socket.id}`);

    // 验证用户代理
    if (!validateUserAgent(socket.handshake.headers['user-agent'])) {
      logger.warn(`拒绝连接 - 无效的用户代理: ${socket.id}`);
      socket.disconnect();
      return;
    }

    // 加入房间
    socket.join(socket.id);
    this.connectedUsers.set(socket.id, {
      connectedAt: new Date(),
      lastActivity: new Date()
    });

    // 注册事件处理器
    this.registerEventHandlers(socket);

    // 连接断开处理
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  registerEventHandlers(socket) {
    // 处理带图片的消息 (对应原Python handle_message_with_image)
    socket.on('send_message_with_image', (data) => {
      this.handleMessageWithImage(socket, data);
    });

    // 处理普通消息 (对应原Python handle_message)
    socket.on('send_message', (data) => {
      this.handleMessage(socket, data);
    });

    // 处理OCR图片识别请求 (新增功能)
    socket.on('analyze_image_ocr', (data) => {
      this.handleImageOCRAnalysis(socket, data);
    });

    // 处理停止生成请求
    socket.on('stop_generation', (data) => {
      this.handleStopGeneration(socket, data);
    });

    // 处理思考模式消息 (新增功能)
    socket.on('send_message_with_thinking', (data) => {
      this.handleMessageWithThinking(socket, data);
    });

    // 心跳检测
    socket.on('ping', () => {
      this.updateLastActivity(socket.id);
      socket.emit('pong');
    });
  }

  async handleMessageWithImage(socket, data) {
    try {
      const {
        models: modelList,
        prompt,
        image,
        image_url,
        conversation_id: cid
      } = data;

      // 验证必需参数
      if (!modelList || !prompt || !cid) {
        socket.emit('error', {
          message: 'Model name, prompt, and conversation_id are required.'
        });
        return;
      }

      // 检查对话是否正在生成回复
      if (this.conversationStates.has(cid)) {
        socket.emit('error', {
          message: '当前对话正在生成回复，请等待完成后再发送新消息'
        });
        return;
      }

      // 标记对话开始生成
      this.conversationStates.set(cid, {
        isGenerating: true,
        models: [...modelList],
        startTime: Date.now()
      });

      // 为这个对话创建取消控制器
      const abortController = new AbortController();
      this.abortControllers.set(cid, abortController);

      logger.info(`处理带图片的消息 - 对话: ${cid}, 模型: ${modelList.join(', ')}`);

      // 通知前端开始生成
      socket.emit('generation_started', {
        conversation_id: cid,
        models: modelList
      });

      // 处理图片数据
      let imageData = null;
      if (image_url) {
        logger.info(`使用图片URL: ${image_url}`);
        imageData = { url: image_url };
        
        // 尝试下载图片作为备用
        try {
          const base64Data = await s3Utils.downloadImageFromS3ToBase64(image_url);
          if (base64Data) {
            imageData.base64 = base64Data;
          }
        } catch (error) {
          logger.warn('图片下载失败，将直接使用URL:', error.message);
        }
      } else if (image) {
        const [header, encoded] = image.includes(',') ? image.split(',', 1) : ['', image];
        imageData = { base64: encoded };
      } else {
        socket.emit('error', { message: '缺少图片数据' });
        return;
      }

      // 获取当前对话的最大消息顺序
      const maxMessageOrder = await database.getMaxMessageOrder(cid);
      const newMessageOrder = maxMessageOrder + 1;

      // 先保存用户消息（参照Python backend的做法）
      // 设置正确的function_call格式：{"role": "user"}
      const userFunctionCall = { "role": "user" };
      if (image_url) {
        userFunctionCall.has_image = true;
        userFunctionCall.image_url = image_url;
      }
      
      const userMessage = await database.createMessage(
        cid, 
        prompt, 
        'user', 
        image_url, 
        newMessageOrder,
        userFunctionCall
      );
      const associatedId = userMessage.message_id;

      // 创建消息记录
      const messageId = uuidv4();
      const answers = {};

      // 并发处理多个模型
      const modelPromises = modelList.map(async (displayModelName, index) => {
        try {
          // 映射显示名称到API模型名称
          const apiModelName = this.mapModelName(displayModelName);
          
          socket.emit('model_start', { model: displayModelName });
          
          // 在生成AI回复前，先计算上下文tokens和获取历史对话
          const contextTokens = await database.getContextTokens(cid, displayModelName);
          const conversationHistory = await database.getConversationHistory(cid, displayModelName, 3);
          
          const response = await aiService.generateWithImage(
            apiModelName, // 使用API模型名称
            prompt,
            imageData,
            (chunk, isComplete) => {
              socket.emit('ai_response', {
                model: displayModelName, // 返回显示名称
                text: chunk,
                complete: isComplete
              });
            },
            conversationHistory // 传递历史对话
          );

          answers[displayModelName] = response; // 使用显示名称存储答案
          
          // 为每个模型单独保存assistant消息（参照Python backend的做法）
          // 使用新的createMessageWithName方法，包含tokens和function_call
          await database.createMessageWithName(
            cid,
            response,
            'assistant',
            displayModelName, // 保存模型名称
            null,
            newMessageOrder + 1 + index,
            associatedId, // 关联的用户消息ID
            contextTokens // 上下文tokens
          );
          
          socket.emit('model_complete', { model: displayModelName });
          
        } catch (error) {
          logger.error(`模型 ${displayModelName} 处理失败:`, error);
          answers[displayModelName] = `错误: ${error.message}`;
          
          // 即使出错也保存错误消息
          try {
            const contextTokens = await database.getContextTokens(cid, displayModelName);
            await database.createMessageWithName(
              cid,
              `错误: ${error.message}`,
              'assistant',
              displayModelName,
              null,
              newMessageOrder + 1 + index,
              associatedId,
              contextTokens
            );
          } catch (saveError) {
            logger.error('保存错误消息失败:', saveError);
          }
          
          socket.emit('model_error', {
            model: displayModelName,
            error: error.message
          });
        }
      });

      // 等待所有模型完成
      await Promise.all(modelPromises);

      // 清除对话生成状态
      this.conversationStates.delete(cid);
      this.abortControllers.delete(cid);

      // 发送完成信号（不再需要调用旧的addMessage方法）
      socket.emit('message_complete', {
        message_id: messageId,
        user_message_id: associatedId,
        answers: answers
      });

      // 通知前端生成完成
      socket.emit('generation_finished', {
        conversation_id: cid
      });

      this.updateLastActivity(socket.id);

    } catch (error) {
      logger.error('处理带图片消息失败:', error);
      
      // 发生错误时也要清除对话状态
      this.conversationStates.delete(cid);
      this.abortControllers.delete(cid);
      
      socket.emit('error', {
        message: '处理消息失败',
        details: error.message
      });

      // 通知前端生成完成（即使是错误）
      socket.emit('generation_finished', {
        conversation_id: cid
      });
    }
  }

  async handleMessage(socket, data) {
    try {
      const {
        models: modelList,
        prompt,
        conversation_id: cid
      } = data;

      // 验证必需参数
      if (!modelList || !prompt || !cid) {
        socket.emit('error', {
          message: 'Model name, prompt, and conversation_id are required.'
        });
        return;
      }

      // 检查对话是否正在生成回复
      if (this.conversationStates.has(cid)) {
        socket.emit('error', {
          message: '当前对话正在生成回复，请等待完成后再发送新消息'
        });
        return;
      }

      // 标记对话开始生成
      this.conversationStates.set(cid, {
        isGenerating: true,
        models: [...modelList],
        startTime: Date.now()
      });

      // 为这个对话创建取消控制器
      const abortController = new AbortController();
      this.abortControllers.set(cid, abortController);

      logger.info(`处理普通消息 - 对话: ${cid}, 模型: ${modelList.join(', ')}`);

      // 通知前端开始生成
      socket.emit('generation_started', {
        conversation_id: cid,
        models: modelList
      });

      // 获取当前对话的最大消息顺序
      const maxMessageOrder = await database.getMaxMessageOrder(cid);
      const newMessageOrder = maxMessageOrder + 1;

      // 先保存用户消息（参照Python backend的做法）
      // 设置正确的function_call格式：{"role": "user"}
      const userFunctionCall = { "role": "user" };
      
      const userMessage = await database.createMessage(
        cid, 
        prompt, 
        'user', 
        null, 
        newMessageOrder,
        userFunctionCall
      );
      const associatedId = userMessage.message_id;

      // 创建消息记录
      const messageId = uuidv4();
      const answers = {};

      // 并发处理多个模型
      const modelPromises = modelList.map(async (displayModelName, index) => {
        try {
          // 映射显示名称到API模型名称
          const apiModelName = this.mapModelName(displayModelName);
          
          socket.emit('model_start', { model: displayModelName });
          
          // 在生成AI回复前，先计算上下文tokens和获取历史对话
          const contextTokens = await database.getContextTokens(cid, displayModelName);
          const conversationHistory = await database.getConversationHistory(cid, displayModelName, 3);
          
          const response = await aiService.generateText(
            apiModelName, // 使用API模型名称
            prompt,
            (chunk, isComplete) => {
              socket.emit('ai_response', {
                model: displayModelName, // 返回显示名称
                text: chunk,
                complete: isComplete
              });
            },
            conversationHistory // 传递历史对话
          );

          answers[displayModelName] = response; // 使用显示名称存储答案
          
          // 为每个模型单独保存assistant消息（参照Python backend的做法）
          // 使用新的createMessageWithName方法，包含tokens和function_call
          await database.createMessageWithName(
            cid,
            response,
            'assistant',
            displayModelName, // 保存模型名称
            null,
            newMessageOrder + 1 + index,
            associatedId, // 关联的用户消息ID
            contextTokens // 上下文tokens
          );
          
          socket.emit('model_complete', { model: displayModelName });
          
        } catch (error) {
          logger.error(`模型 ${displayModelName} 处理失败:`, error);
          answers[displayModelName] = `错误: ${error.message}`;
          
          // 即使出错也保存错误消息
          try {
            const contextTokens = await database.getContextTokens(cid, displayModelName);
            await database.createMessageWithName(
              cid,
              `错误: ${error.message}`,
              'assistant',
              displayModelName,
              null,
              newMessageOrder + 1 + index,
              associatedId,
              contextTokens
            );
          } catch (saveError) {
            logger.error('保存错误消息失败:', saveError);
          }
          
          socket.emit('model_error', {
            model: displayModelName,
            error: error.message
          });
        }
      });

      // 等待所有模型完成
      await Promise.all(modelPromises);

      // 清除对话生成状态
      this.conversationStates.delete(cid);
      this.abortControllers.delete(cid);

      // 发送完成信号（不再需要调用旧的addMessage方法）
      socket.emit('message_complete', {
        message_id: messageId,
        user_message_id: associatedId,
        answers: answers
      });

      // 通知前端生成完成
      socket.emit('generation_finished', {
        conversation_id: cid
      });

      this.updateLastActivity(socket.id);

    } catch (error) {
      logger.error('处理消息失败:', error);
      
      // 发生错误时也要清除对话状态
      this.conversationStates.delete(cid);
      this.abortControllers.delete(cid);
      
      socket.emit('error', {
        message: '处理消息失败',
        details: error.message
      });

      // 通知前端生成完成（即使是错误）
      socket.emit('generation_finished', {
        conversation_id: cid
      });
    }
  }

  handleStopGeneration(socket, data) {
    const { conversation_id } = data;
    logger.info(`停止生成请求 - 对话: ${conversation_id}`);
    
    // 获取并触发取消控制器
    if (this.abortControllers.has(conversation_id)) {
      const abortController = this.abortControllers.get(conversation_id);
      abortController.abort();
      logger.info(`已触发取消信号: ${conversation_id}`);
    }
    
    // 清除对话生成状态
    if (this.conversationStates.has(conversation_id)) {
      this.conversationStates.delete(conversation_id);
      logger.info(`已清除对话状态: ${conversation_id}`);
    }
    
    // 清除取消控制器
    if (this.abortControllers.has(conversation_id)) {
      this.abortControllers.delete(conversation_id);
      logger.info(`已清除取消控制器: ${conversation_id}`);
    }
    
    // 通知前端生成已停止
    socket.emit('generation_stopped', { 
      conversation_id,
      message: '生成已停止'
    });
    
    // 通知前端生成完成
    socket.emit('generation_finished', {
      conversation_id
    });
  }

  handleDisconnection(socket) {
    logger.info(`WebSocket连接断开: ${socket.id}`);
    this.connectedUsers.delete(socket.id);
  }

  updateLastActivity(socketId) {
    const user = this.connectedUsers.get(socketId);
    if (user) {
      user.lastActivity = new Date();
    }
  }

  // 获取连接统计
  getConnectionStats() {
    return {
      totalConnections: this.connectedUsers.size,
      connections: Array.from(this.connectedUsers.entries()).map(([id, info]) => ({
        id,
        connectedAt: info.connectedAt,
        lastActivity: info.lastActivity
      }))
    };
  }

  // 广播消息给所有连接的用户
  broadcast(event, data) {
    this.io.emit(event, data);
  }

  // 发送消息给特定用户
  sendToUser(socketId, event, data) {
    this.io.to(socketId).emit(event, data);
  }

  // 初始化模型映射
  async initializeModelMapping() {
    try {
      const models = await database.getAllAiModels();
      
      models.forEach(model => {
        let modelVersion = model.model_version;
        
        // 安全地解析JSON字段
        if (typeof modelVersion === 'string') {
          try {
            modelVersion = JSON.parse(modelVersion);
          } catch (e) {
            logger.warn(`解析模型版本失败 (${model.model_name}):`, e.message);
            modelVersion = {};
          }
        }
        
        // 创建映射：显示名称 -> API模型名称
        if (modelVersion && typeof modelVersion === 'object') {
          Object.entries(modelVersion).forEach(([versionKey, apiModelName]) => {
            const displayName = `${model.model_name}-${versionKey}`;
            this.modelMapping.set(displayName, apiModelName);
            logger.info(`模型映射: ${displayName} -> ${apiModelName}`);
          });
        }
      });
      
      logger.info(`初始化了 ${this.modelMapping.size} 个模型映射`);
    } catch (error) {
      logger.error('初始化模型映射失败:', error);
    }
  }

  // 将显示名称转换为API模型名称
  mapModelName(displayName) {
    const apiModelName = this.modelMapping.get(displayName);
    if (!apiModelName) {
      logger.warn(`未找到模型映射: ${displayName}`);
      return displayName; // 如果找不到映射，返回原始名称
    }
    return apiModelName;
  }

  // 处理OCR图片识别请求 (新增功能)
  async handleImageOCRAnalysis(socket, data) {
    try {
      const {
        model_name,
        prompt,
        image_url,
        image_base64,
        user_id,
        request_id = uuidv4()
      } = data;

      // 验证必需参数
      if (!model_name || !prompt) {
        socket.emit('ocr_error', {
          request_id,
          message: 'Model name and prompt are required.'
        });
        return;
      }

      // 验证图片数据
      if (!image_url && !image_base64) {
        socket.emit('ocr_error', {
          request_id,
          message: 'Either image_url or image_base64 is required.'
        });
        return;
      }

      logger.info(`处理OCR图片识别请求 - 用户: ${user_id}, 模型: ${model_name}, 请求ID: ${request_id}`);

      // 通知前端开始处理
      socket.emit('ocr_started', {
        request_id,
        model_name
      });

      // 构建图片数据对象
      const imageData = {};
      if (image_url) {
        imageData.url = image_url;
        
        // 如果是S3 URL，尝试下载作为base64备用
        if (image_url.includes('s3')) {
          try {
            const base64Data = await s3Utils.downloadImageFromS3ToBase64(image_url);
            if (base64Data) {
              imageData.base64 = base64Data;
            }
          } catch (error) {
            logger.warn('S3图片下载失败，将直接使用URL:', error.message);
          }
        }
      }
      if (image_base64) {
        imageData.base64 = image_base64;
      }

      // 映射模型名称
      const apiModelName = this.mapModelName(model_name);

      // 调用AI服务进行OCR识别
      const result = await aiService.analyzeImageWithOCR(apiModelName, prompt, imageData);
      
      logger.info(`OCR图片识别完成 - 请求ID: ${request_id}, 结果长度: ${result.length}`);
      
      // 发送识别结果
      socket.emit('ocr_result', {
        request_id,
        model_name,
        result,
        success: true
      });

    } catch (error) {
      logger.error('OCR图片识别失败:', error);
      socket.emit('ocr_error', {
        request_id: data.request_id || uuidv4(),
        message: error.message,
        success: false
      });
    }
  }

  // 处理思考模式消息 (新增功能)
  async handleMessageWithThinking(socket, data) {
    try {
      const {
        models: modelList,
        prompt,
        conversation_id: cid,
        conversation_history = []
      } = data;

      // 验证必需参数
      if (!modelList || !prompt || !cid) {
        socket.emit('error', {
          message: 'Model name, prompt, and conversation_id are required for thinking mode.'
        });
        return;
      }

      const request_id = uuidv4();
      logger.info(`开始思考模式处理 - 请求ID: ${request_id}, 模型: ${modelList}, 对话ID: ${cid}`);

      // 更新用户活动时间
      this.updateLastActivity(socket.id);

      // 标记生成开始
      socket.emit('generation_started', {
        request_id,
        models: modelList,
        conversation_id: cid
      });

      // 处理每个模型
      for (const modelName of modelList) {
        try {
          logger.info(`开始使用模型 ${modelName} 进行思考模式生成`);

          // 标记模型开始
          socket.emit('model_start', {
            request_id,
            model: modelName,
            conversation_id: cid
          });

          // 创建流式回调来发送思考过程和回复
          const streamCallback = (data) => {
            socket.emit('ai_thinking_response', {
              request_id,
              model: modelName,
              conversation_id: cid,
              ...data
            });
          };

          // 调用思考模式生成
          const result = await aiService.generateWithThinking(
            modelName,
            prompt,
            conversation_history,
            streamCallback
          );

          // 标记模型完成
          socket.emit('model_complete', {
            request_id,
            model: modelName,
            conversation_id: cid,
            content: result.answer,
            thinking_content: result.reasoning,
            is_thinking: result.isThinking
          });

          logger.info(`模型 ${modelName} 思考模式生成完成`);

        } catch (error) {
          logger.error(`模型 ${modelName} 思考模式生成失败:`, error);
          socket.emit('model_error', {
            request_id,
            model: modelName,
            conversation_id: cid,
            error: error.message
          });
        }
      }

      // 标记生成完成
      socket.emit('generation_finished', {
        request_id,
        conversation_id: cid
      });

      logger.info(`思考模式处理完成 - 请求ID: ${request_id}`);

    } catch (error) {
      logger.error('思考模式处理失败:', error);
      socket.emit('error', {
        message: error.message,
        conversation_id: data.conversation_id
      });
    }
  }
}

module.exports = new SocketHandlers();
