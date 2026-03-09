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

    // 处理停止生成请求
    socket.on('stop_generation', (data) => {
      this.handleStopGeneration(socket, data);
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

      logger.info(`处理带图片的消息 - 对话: ${cid}, 模型: ${modelList.join(', ')}`);

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

      // 发送完成信号（不再需要调用旧的addMessage方法）
      socket.emit('message_complete', {
        message_id: messageId,
        user_message_id: associatedId,
        answers: answers
      });

      this.updateLastActivity(socket.id);

    } catch (error) {
      logger.error('处理带图片消息失败:', error);
      socket.emit('error', {
        message: '处理消息失败',
        details: error.message
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

      logger.info(`处理普通消息 - 对话: ${cid}, 模型: ${modelList.join(', ')}`);

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

      // 发送完成信号（不再需要调用旧的addMessage方法）
      socket.emit('message_complete', {
        message_id: messageId,
        user_message_id: associatedId,
        answers: answers
      });

      this.updateLastActivity(socket.id);

    } catch (error) {
      logger.error('处理消息失败:', error);
      socket.emit('error', {
        message: '处理消息失败',
        details: error.message
      });
    }
  }

  handleStopGeneration(socket, data) {
    const { conversation_id } = data;
    logger.info(`停止生成请求 - 对话: ${conversation_id}`);
    
    // 这里可以实现停止生成的逻辑
    // Node.js中可以使用AbortController来取消请求
    socket.emit('generation_stopped', { conversation_id });
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
}

module.exports = new SocketHandlers();
