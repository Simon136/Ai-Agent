<template>
  <div class="chat-container">
    <div class="question-answer-view" ref="chatBox">
      <!-- 对话历史区域 -->
      <ConversationHistory
        :conversation-history="conversationHistory"
        :view-type="viewType"
        :answering-models="answeringModels"
        :hovered-box="hoveredBox"
        @hover="handleHover"
        @copy="handleCopy"
      />
    </div>

    <!-- 底部固定区域 -->
    <div class="bottom-fixed-area">
      <!-- 模型选择器 -->
      <ModelSelector
        :available-models="availableModels"
        :selected-models="selectedModels"
        :has-uploaded-image="hasUploadedImage"
        @toggle-model="toggleModel"
      />
      
      <!-- 输入区域 -->
      <InputArea
        :loading="loading"
        :user-id="userId"
        :has-uploaded-image="hasUploadedImage"
        :is-generating="isGenerating"
        @send-message="handleSendMessage"
        @upload-success="handleImageUpload"
        @image-removed="handleImageRemoved"
        @stop-generation="handleStopGeneration"
      />
    </div>
  </div>
  
  <!-- 复制成功弹窗 -->
  <div v-if="copySuccess" class="copy-success-popup">
    Copied
  </div>
  
  <!-- 图片上传完成弹窗 -->
  <div v-if="showImageUploadSuccess" class="copy-success-popup">
    Upload Complete
  </div>
</template>

<script>
import chatSocket from '../sockets/chatSocket'
import ConversationHistory from './ConversationHistory.vue'
import InputArea from './InputArea.vue'
import ModelSelector from './ModelSelector.vue'
import { getConversation, updateConversationName, getModels, saveUserSelections, getCustomMetadata } from '../api/api'

export default {
  name: 'QuestionAnswerView',
  components: {
    ConversationHistory,
    InputArea,
    ModelSelector
  },
  emits: ['update-title', 'models-changed'],
  props: {
    viewType: {
      type: Number,
      default: 1,
      validator: value => [1, 2, 3].includes(value)
    },
    conversationId: {
      type: Number,
      required: true
    },
    userId: {
      type: String,
      required: true
    },
  },
  
  data() {
    return {
      selectedModels: [], // 默认选中模型
      availableModels: [],
      conversationHistory: [],
      answeringModels: {}, // 记录正在回答的模型
      loading: false, // 判断是否正在回答
      isGenerating: false, // 当前对话是否正在生成回复
      hoveredBox: null,
      copySuccess: false,
      copyTimer: null,
      showImageUploadSuccess: false, // 图片上传完成弹窗
      hasUploadedImage: false, // 标记是否有上传的图片
      isInitializing: true, // 标记是否正在初始化，避免初始化期间触发保存
    }
  },

  async mounted() {
    console.log('QuestionAnswerView mounted, conversation ID:', this.conversationId);
    
    this.loadConversationById(this.conversationId)
    
    console.log('Connecting to chat socket...');
    chatSocket.connect()
    chatSocket.addListener(this.handleSocketMessage)
    
    // 确保先获取模型列表，再加载用户选择
    await this.fetchModels()
    
    // 等待父组件完成初始化后再加载用户选择
    setTimeout(async () => {
      await this.fetchUserSelections()
      // 初始化完成，允许触发保存
      this.isInitializing = false
      
      // 初始化完成后第一次通知父组件当前模型选择，以确保状态同步
      console.log('🎯 初始化完成，第一次通知父组件模型选择:', this.selectedModels);
      this.$emit('models-changed', this.selectedModels);
    }, 100)
    
    document.addEventListener('click', this.handleCopyCodeClick)
    
    // 添加滚动监听器以检测用户手动滚动
    this.$nextTick(() => {
      const chatBox = this.$refs.chatBox
      if (chatBox) {
        chatBox.addEventListener('scroll', this.handleUserScroll)
      }
    })
    
    console.log('QuestionAnswerView mounted completed');
  },

  beforeUnmount() {
    chatSocket.removeListener(this.handleSocketMessage)
    document.removeEventListener('click', this.handleCopyCodeClick)
    
    // 移除滚动监听器
    const chatBox = this.$refs.chatBox
    if (chatBox) {
      chatBox.removeEventListener('scroll', this.handleUserScroll)
    }
  },

  watch: {
    conversationId: {
      immediate: false,
      handler(newId) {
        // 切换对话时重置生成状态
        this.isGenerating = false
        this.loading = false
        this.loadConversationById(newId)
      }
    }
    // 移除viewType的watch，因为它是props，应该由父组件管理保存
  },

  methods: {
    // 处理发送消息
    async handleSendMessage({ question, imageUrl }) {
      console.log('Handling send message:', { question, imageUrl, selectedModels: this.selectedModels });
      
      if (!question.trim() && !imageUrl) return
      if (this.selectedModels.length === 0) {
        alert('请至少选择一个模型')
        return
      }
      if (!chatSocket.isReady()) {
        alert('WebSocket 连接未就绪，请稍后再试')
        return
      }

      // 检查是否正在生成回复（防止重复发送）
      if (this.isGenerating) {
        alert('当前对话正在生成回复，请等待完成后再发送新消息')
        return
      }

      // 新建会话时，将第一个问题作为会话标题
      if (this.conversationHistory.length === 0 && question.trim()) {
        try {
          // 使用完整的问题作为标题，不在这里截取
          const fullTitle = question.trim();
          
          console.log('Updating conversation title from question:', fullTitle);
          
          await updateConversationName(this.conversationId, { title: fullTitle })
          this.$emit('update-title', fullTitle)
          
          console.log('Title update completed successfully');
        } catch (e) {
          console.warn('会话标题更新失败', e)
        }
      } else {
        console.log('Skipping title update - conversationHistory.length:', this.conversationHistory.length, 'question:', question.trim());
      }

      this.loading = true
      this.isGenerating = true
      this.answeringModels = {}
      this.selectedModels.forEach(model => {
        this.answeringModels[model] = true // 标记为"正在流式"
      })

      // 发送消息前重置图片标志
      this.hasUploadedImage = false
      
      // 发送消息
      console.log('Sending message via WebSocket...');
      if (imageUrl) {
        console.log('Sending message with image');
        chatSocket.sendMessageWithImage({
          prompt: question,
          image_url: imageUrl,
          models: this.selectedModels,
          conversation_id: this.conversationId
        })
      } else {
        console.log('Sending regular message');
        chatSocket.sendMessage({
          prompt: question,
          models: this.selectedModels,
          conversation_id: this.conversationId
        })
      }

      // 添加到对话历史
      const answers = {}
      this.selectedModels.forEach(model => {
        answers[model] = ""
      })
      this.conversationHistory.push({
        question: `Q: ${question}`,
        answers,
        models: [...this.selectedModels],
        imageUrl: imageUrl || null
      })
      
      console.log('Added to conversation history, total items:', this.conversationHistory.length);
      
      // 每次发送消息后都自动滚动到底部
      this.scrollToBottom()
    },

    // 处理图片上传成功
    handleImageUpload(imageUrl) {
      this.hasUploadedImage = true
      // 图片上传时自动切换到支持视觉的GPT模型
      this.switchToVisionModels()
      
      this.showImageUploadSuccess = true
      setTimeout(() => {
        this.showImageUploadSuccess = false
      }, 1200)
    },

    // 处理图片移除
    handleImageRemoved() {
      this.hasUploadedImage = false
    },

    // 处理停止生成
    handleStopGeneration() {
      console.log('Stopping generation for conversation:', this.conversationId);
      
      if (!this.isGenerating) {
        console.warn('No generation in progress to stop');
        return;
      }

      // 发送停止生成请求
      if (chatSocket.isReady()) {
        chatSocket.sendStopGeneration({
          conversation_id: this.conversationId
        });
      } else {
        console.error('WebSocket not ready for stop generation request');
        // 即使WebSocket不可用，也要重置本地状态
        this.isGenerating = false;
        this.loading = false;
        // 清除所有模型的回答状态
        Object.keys(this.answeringModels).forEach(model => {
          this.answeringModels[model] = false;
        });
      }
    },

    // 切换到支持视觉的模型
    switchToVisionModels() {
      const visionModels = ['GPT-4.1', 'GPT-5-chat']
      // 过滤出当前可用的视觉模型
      const availableVisionModels = visionModels.filter(model => 
        this.isModelAvailable(model)
      )
      
      if (availableVisionModels.length > 0) {
        this.selectedModels = availableVisionModels
        // 重新排序以匹配界面显示顺序
        this.sortSelectedModels()
        console.log('切换到视觉模型:', this.selectedModels);
        
        // 自动切换视觉模型，立即通知父组件（只在非初始化期间）
        if (!this.isInitializing) {
          this.$emit('models-changed', this.selectedModels);
        }
      }
    },

    // 检查模型是否可用
    isModelAvailable(modelName) {
      return this.availableModels.some(modelGroup => {
        return Object.keys(modelGroup).some(groupName => {
          const variants = modelGroup[groupName]
          return Object.keys(variants).some(variantName => {
            return `${groupName}-${variantName}` === modelName
          })
        })
      })
    },

    // 处理悬停状态
    handleHover(index, model, isHovered) {
      this.hoveredBox = isHovered ? `${index}-${model}` : null
    },

    // 处理复制
    handleCopy(success) {
      this.copySuccess = success
      if (success) {
        clearTimeout(this.copyTimer)
        this.copyTimer = setTimeout(() => {
          this.copySuccess = false
        }, 1200)
      }
    },

    // 加载会话内容
    async loadConversationById(cid) {
      if (!cid) return
      try {
        const res = await getConversation(cid)
        console.log('Loaded conversation:', res.data)
        
        // 处理消息数据，转换为组件期望的格式
        const messages = res.data.messages || []
        this.conversationHistory = this.convertMessagesToHistory(messages)
        this.scrollToBottom()
      } catch (error) {
        console.error('Failed to load conversation:', error)
      }
    },

    // 获取AI模型
    async fetchModels() {
      try {
        const response = await getModels()
        this.availableModels = response.data
        // 获取到新的模型列表后，重新排序现有的选择
        this.sortSelectedModels()
      } catch (error) {
        console.error('Failed to fetch models:', error)
        // Fallback to default models if API fails
        this.availableModels = [
          {"DeepSeek": {"R1": "deepseek-r1", "V3": "deepseek-v3"}},
          {"Qwen": {"Q-plus": "qwen-plus-latest", "Q3": "qwen3-235b-a22b"}},
          {"GPT": {"4.1": "gpt-4.1", "5-chat": "gpt-5-chat"}}
        ]
        // 获取到新的模型列表后，重新排序现有的选择
        this.sortSelectedModels()
      }
    },

    // 获取用户上一次选择的模型
    async fetchUserSelections() {
      try {
        console.log('🔄 开始获取用户偏好设置, userId:', this.userId, '初始化状态:', this.isInitializing);
        
        const response = await getCustomMetadata(this.userId)
        console.log('📡 API响应:', response.data)
        
        // 注意：后端返回的结构是 { data: { view_type, selected_models, ... } }
        const userPreferences = response.data?.data || response.data;
        console.log('📋 解析的用户偏好:', userPreferences);
        
        if (userPreferences) {
          // 设置选择的模型
          if (userPreferences.selected_models && userPreferences.selected_models.length > 0) {
            console.log('🔍 验证模型可用性...');
            console.log('可用模型列表:', this.availableModels);
            
            // 验证恢复的模型是否仍然可用
            const validModels = userPreferences.selected_models.filter(model => {
              const isValid = this.isModelAvailable(model);
              console.log(`模型 ${model} 是否可用: ${isValid}`);
              return isValid;
            });
            
            if (validModels.length > 0) {
              this.selectedModels = validModels;
              // 重新排序以匹配界面显示顺序
              this.sortSelectedModels();
              console.log('✅ 恢复的用户模型选择:', this.selectedModels);
            } else {
              this.selectedModels = ['DeepSeek-R1'];
              // 重新排序以匹配界面显示顺序
              this.sortSelectedModels();
              console.log('⚠️ 用户保存的模型不可用，使用默认模型选择:', this.selectedModels);
            }
          } else {
            this.selectedModels = ['DeepSeek-R1']
            // 重新排序以匹配界面显示顺序
            this.sortSelectedModels()
            console.log('📝 使用默认模型选择:', this.selectedModels)
          }
          
          // 注意：不在这里设置viewType，因为它是props，应该由父组件管理
          // 父组件MenuBarView会处理view_type的恢复
          
        } else {
          this.selectedModels = ['DeepSeek-R1']
          // 重新排序以匹配界面显示顺序
          this.sortSelectedModels()
          console.log('❌ 没有找到用户偏好设置，使用默认模型选择:', this.selectedModels)
        }
        
        // 重要：在初始化期间，任何情况下都不触发emit，避免覆盖用户真正的选择
        console.log('🚫 初始化期间不触发models-changed事件，等待初始化完成');
        
      } catch (error) {
        console.error('❌ Failed to fetch user selections:', error)
        this.selectedModels = ['DeepSeek-R1']
        // 重新排序以匹配界面显示顺序
        this.sortSelectedModels()
        console.log('🔧 获取用户偏好设置失败，使用默认模型选择:', this.selectedModels)
      }
    },

    // WebSocket消息处理
    handleSocketMessage(data){
      console.log('Received WebSocket message:', data);
      
      switch (data.type) {
        case "ai_response":
          console.log('Handling ai_response:', data);
          let lastItem = this.conversationHistory[this.conversationHistory.length - 1]
          if (lastItem && lastItem.answers && data.model) {
            if (typeof lastItem.answers[data.model] !== 'string') {
              lastItem.answers[data.model] = ""
            }
            lastItem.answers[data.model] += data.text
            console.log('Updated answer for model', data.model, ':', lastItem.answers[data.model]);
          } else {
            console.warn('Cannot update answer - no last item or invalid structure');
          }
          this.$nextTick(() => {
            // AI回答过程中使用条件性滚动，避免打断用户查看历史
            this.conditionalScrollToBottom()
          })
          break

        case 'model_start':
          console.log('Model started:', data.model);
          // 标记模型开始响应
          if (data.model) {
            this.answeringModels[data.model] = true
          }
          break

        case 'model_complete':
          console.log('Model completed:', data.model);
          // 标记模型完成响应
          if (data.model) {
            this.answeringModels[data.model] = false
          }
          // 检查是否所有模型都结束
          if (Object.values(this.answeringModels).every(v => v === false)) {
            this.loading = false
            console.log('All models completed');
            // 流式回答结束后使用条件性滚动
            this.conditionalScrollToBottom()
          }
          break

        case 'model_error':
          console.error('Model error:', data);
          // 处理模型错误
          if (data.model) {
            this.answeringModels[data.model] = false
            let lastItem = this.conversationHistory[this.conversationHistory.length - 1]
            if (lastItem && lastItem.answers) {
              lastItem.answers[data.model] = `错误: ${data.error}`
            }
          }
          // 检查是否所有模型都结束
          if (Object.values(this.answeringModels).every(v => v === false)) {
            this.loading = false
          }
          break

        case 'message_complete':
          console.log('Message complete:', data);
          // 消息处理完成
          this.loading = false
          this.conditionalScrollToBottom()
          break

        case 'generation_started':
          console.log('Generation started:', data);
          // 标记开始生成
          this.isGenerating = true
          break

        case 'generation_finished':
          console.log('Generation finished:', data);
          // 标记生成完成
          this.isGenerating = false
          this.loading = false
          break

        case 'generation_stopped':
          console.log('Generation stopped:', data);
          // 标记生成停止
          this.isGenerating = false
          this.loading = false
          // 清除所有模型的回答状态
          Object.keys(this.answeringModels).forEach(model => {
            this.answeringModels[model] = false;
          });
          // 显示停止消息
          if (data.message) {
            // 可以选择在界面上显示停止消息
            console.log('Stop message:', data.message);
          }
          break
        
        case 'response':
          console.log('Generic response:', data);
          this.conversationHistory.push({
            text: data.text,
            color: data.color
          })
          this.conditionalScrollToBottom()
          break
          
        default:
          console.log('Unknown socket message type:', data.type, data)
          break
      }
    },

    // 将数据库格式的消息转换为组件期望的历史记录格式
    convertMessagesToHistory(messages) {
      console.log('Converting messages to history format:', messages);
      
      if (!Array.isArray(messages)) {
        console.warn('Messages is not an array:', messages);
        return [];
      }
      
      const history = []
      let currentQuestion = null
      let currentAnswers = {}
      let currentModels = []
      
      // 按消息顺序排序
      const sortedMessages = messages.sort((a, b) => (a.message_order || 0) - (b.message_order || 0))
      
      console.log('Sorted messages:', sortedMessages);
      
      for (const message of sortedMessages) {
        console.log('Processing message:', message);
        
        if (message.role === 'user') {
          // 如果之前有未完成的问答对，先保存
          if (currentQuestion) {
            history.push({
              question: `Q: ${currentQuestion}`,
              answers: { ...currentAnswers }, // 创建副本
              models: [...currentModels] // 创建副本
            })
          }
          
          // 开始新的问答对
          currentQuestion = message.content
          currentAnswers = {}
          currentModels = []
        } else if (message.role === 'assistant') {
          // 助手回答，使用数据库中保存的模型名称
          const modelName = message.name || 'AI Assistant' // 使用name字段，如果没有则使用默认名称
          currentAnswers[modelName] = message.content
          if (!currentModels.includes(modelName)) {
            currentModels.push(modelName)
          }
        }
      }
      
      // 保存最后一个问答对
      if (currentQuestion) {
        history.push({
          question: `Q: ${currentQuestion}`,
          answers: { ...currentAnswers },
          models: [...currentModels]
        })
      }
      
      console.log('Converted conversation history:', history)
      return history
    },

    // 由MenuBarView调用的方法，用于加载对话内容
    loadConversation(messages) {
      console.log('Loading conversation with messages:', messages)
      if (Array.isArray(messages)) {
        this.conversationHistory = this.convertMessagesToHistory(messages)
        this.scrollToBottom()
      } else {
        console.warn('loadConversation: messages is not an array:', messages)
        this.conversationHistory = []
      }
    },

    // 清空对话内容
    clearConversation() {
      this.conversationHistory = []
    },

    // 滚动到底部
    scrollToBottom() {
      this.$nextTick(() => {
        const chatBox = this.$refs.chatBox
        if (!chatBox) return
        chatBox.scrollTop = chatBox.scrollHeight
      })
    },

    // 条件性滚动到底部（只在用户已经在底部附近时才滚动）
    conditionalScrollToBottom() {
      this.$nextTick(() => {
        const chatBox = this.$refs.chatBox
        if (!chatBox) return
        
        // 检查用户是否已经滚动到底部附近（允许50px的误差）
        const isNearBottom = (chatBox.scrollTop + chatBox.clientHeight) >= (chatBox.scrollHeight - 50)
        
        if (isNearBottom) {
          chatBox.scrollTop = chatBox.scrollHeight
        }
      })
    },

    // 处理用户手动滚动
    handleUserScroll() {
      // 这个方法现在主要用于条件性滚动的判断
      // 实际的滚动控制逻辑在conditionalScrollToBottom中处理
    },

    // 切换模型选择
    toggleModel(modelId) {
      // 如果有上传的图片，只允许选择视觉模型
      if (this.hasUploadedImage && !this.isVisionModel(modelId)) {
        alert('图片模式下只能选择支持视觉的GPT模型（GPT-4.1 或 GPT-5-chat）')
        return
      }
      
      if (this.selectedModels.includes(modelId)) {
        this.selectedModels = this.selectedModels.filter(id => id !== modelId)
      } else {
        this.selectedModels.push(modelId)
      }
      
      // 重新排序以匹配界面显示顺序
      this.sortSelectedModels()
      
      console.log('模型选择已更新:', this.selectedModels);
      
      // 用户主动切换模型，立即通知父组件保存（只在非初始化期间）
      if (!this.isInitializing) {
        this.$emit('models-changed', this.selectedModels);
      }
    },

    // 根据availableModels的顺序重新排序selectedModels
    sortSelectedModels() {
      // 如果没有可用模型或选中模型，则不需要排序
      if (!this.availableModels || this.availableModels.length === 0 || !this.selectedModels || this.selectedModels.length === 0) {
        return
      }
      
      // 构建模型在界面中的顺序映射
      const modelOrder = {}
      let orderIndex = 0
      
      this.availableModels.forEach(modelGroup => {
        Object.keys(modelGroup).forEach(groupName => {
          const variants = modelGroup[groupName]
          Object.keys(variants).forEach(variantName => {
            const modelId = `${groupName}-${variantName}`
            modelOrder[modelId] = orderIndex++
          })
        })
      })
      
      // 根据界面顺序重新排序selectedModels
      this.selectedModels.sort((a, b) => {
        const orderA = modelOrder[a] ?? 999999
        const orderB = modelOrder[b] ?? 999999
        return orderA - orderB
      })
    },

    // 检查是否为支持视觉的模型
    isVisionModel(modelName) {
      const visionModels = ['GPT-4.1', 'GPT-5-chat']
      return visionModels.includes(modelName)
    },

    // 处理代码复制点击
    handleCopyCodeClick(e) {
      const btn = e.target.closest('.copy-code-btn')
      if (btn) {
        const code = decodeURIComponent(btn.getAttribute('data-code'))
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = 'Copied'
          setTimeout(() => {
            btn.textContent = 'Copy'
          }, 1200)
        })
      }
    }
  }
}
</script>

<style scoped>
/* 外层容器（Flex 布局） */
.chat-container {
  display: flex;
  flex-direction: column;
  height: 90vh; /* 占满整个视口 */
}

.question-answer-view {
  flex: 1; /* 占据剩余空间 */
  overflow-y: auto; /* 允许滚动 */
  padding: 20px;
}

.bottom-fixed-area{
  flex-shrink: 0; /* 防止被压缩 */
  padding: 10px 20px;
  background: white;
  border-top: 1px solid #eee;
}

.copy-success-popup {
  position: fixed;
  top: 20%;
  left: 50%;
  transform: translate(-50%, 0);
  background: #4a9ff5;
  color: #fff;
  padding: 10px 24px;
  border-radius: 6px;
  font-size: 16px;
  z-index: 9999;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  animation: fadeInOut 1.2s;
}

@keyframes fadeInOut {
  0% { opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { opacity: 0; }
}

/* 全局代码块样式 */
:global(.code-block-with-copy) {
  position: relative;
  margin: 16px 0;
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24);
}

/* 代码块容器 - GitHub风格左右分栏布局 */
:global(.simple-line) {
  display: flex;
  line-height: 0.9;
  min-height: 0.9em;
  margin: 0;
  padding: 0;
}

:global(.simple-number) {
  flex-shrink: 0;
  width: 40px;
  text-align: right;
  padding: 0 16px 0 8px;
  color: #6e7681;
  font-size: 12px;
  user-select: none;
  background: transparent;
  border: none;
  line-height: 0.9;
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
}

:global(.simple-code) {
  flex: 1;
  padding: 0;
  line-height: 0.9;
  white-space: pre;
  overflow: visible;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  word-wrap: normal; /* 不允许自动换行，保持代码原始格式 */
  min-width: max-content; /* 确保内容不会被压缩 */
}

/* 通用代码块容器样式 - 统一黑色背景 */
:global(.code-block-with-copy pre) {
  border-radius: 6px;
  padding: 16px 0;
  margin: 16px 0;
  font-size: 14px;
  line-height: 0.9;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  border: 1px solid #30363d;
  background: #0d1117 !important;
  color: #e6edf3 !important;
  display: flex;
  flex-direction: column;
  overflow-x: auto; /* 允许水平滚动 */
  overflow-y: hidden; /* 隐藏垂直滚动 */
  max-width: 100%;
}

/* 统一的行号和代码样式 */
:global(.code-block-with-copy .simple-number) {
  background: transparent;
  border: none;
  color: #6e7681;
}

:global(.code-block-with-copy .simple-code) {
  background: transparent;
  color: #e6edf3;
}

:global(.copy-code-btn) {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
  background: #21262d;
  color: #f0f6fc;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.8;
  transition: all 0.2s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  font-weight: 500;
}

:global(.copy-code-btn:hover) {
  opacity: 1;
  background: #30363d;
  border-color: #8b949e;
}

/* 基本代码块样式 */
:global(pre) {
  white-space: pre;
  overflow-x: auto; /* 允许水平滚动 */
  overflow-y: hidden; /* 隐藏垂直滚动 */
  line-height: 0.9 !important;
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  max-width: 100%;
}

:global(code) {
  white-space: pre;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  word-wrap: normal; /* 不允许自动换行 */
}

/* 自定义滚动条样式 */
:global(.code-block-with-copy pre::-webkit-scrollbar) {
  height: 8px;
}

:global(.code-block-with-copy pre::-webkit-scrollbar-track) {
  background: #161b22;
  border-radius: 4px;
}

:global(.code-block-with-copy pre::-webkit-scrollbar-thumb) {
  background: #30363d;
  border-radius: 4px;
  border: 1px solid #21262d;
}

:global(.code-block-with-copy pre::-webkit-scrollbar-thumb:hover) {
  background: #484f58;
}

/* 为Firefox浏览器提供滚动条样式 */
:global(.code-block-with-copy pre) {
  scrollbar-width: thin;
  scrollbar-color: #30363d #161b22;
}

/* 语言标识标签 */
:global(.code-language-tag) {
  position: absolute;
  top: 8px;
  right: 60px;
  background: rgba(110, 118, 129, 0.2);
  color: #8b949e;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  z-index: 1;
}

/* 代码块悬停效果 */
:global(.code-block-with-copy:hover) {
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1), 0 1px 3px rgba(0, 0, 0, 0.08);
  transition: box-shadow 0.2s ease;
}

/* HTML代码块特殊样式 */
:global(.html-code-display) {
  position: relative;
  margin: 20px 0; /* 增加上下间距 */
  border: 2px solid #000;
  border-radius: 8px;
  background: #fff;
  padding: 0; /* 移除padding，让控制栏贴边 */
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  display: block; /* 确保块级显示 */
  clear: both; /* 清除浮动 */
}

/* HTML显示控制栏 */
:global(.html-display-controls) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  border-radius: 6px 6px 0 0;
}

:global(.html-mode-controls) {
  display: flex;
  gap: 4px;
}

:global(.html-mode-btn) {
  background: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.3s;
}

:global(.html-mode-btn:hover) {
  background: #5a6268;
}

:global(.html-mode-btn.active) {
  background: #28a745;
}

:global(.html-mode-btn.active:hover) {
  background: #218838;
}

/* HTML代码显示容器 */
:global(.html-code-container) {
  padding: 15px;
}

:global(.html-code-frame) {
  background: #fff;
  border: none;
  overflow: auto;
  line-height: 1.4;
  max-height: 300px;
}

:global(.html-code-frame pre) {
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-wrap: break-word;
}

:global(.html-code-frame code) {
  background: transparent;
  padding: 0;
  color: #333;
}

/* HTML预览显示容器 */
:global(.html-preview-container) {
  padding: 15px;
}

:global(.html-preview-frame) {
  border: 1px solid #e9ecef;
  border-radius: 4px;
  background: white;
  min-height: 100px;
  overflow: auto;
  max-height: 400px;
}

:global(.html-preview-content) {
  display: block;
  width: 100%;
  min-height: 80px;
}

:global(.html-code-display .copy-code-btn) {
  background: #333;
  color: #fff;
  border: 1px solid #000;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
}

:global(.html-code-display .copy-code-btn:hover) {
  background: #555;
}

/* SVG代码块特殊样式 */
:global(.svg-code-display) {
  position: relative;
  margin: 20px 0;
  border: 2px solid #000;
  border-radius: 8px;
  background: #fff;
  padding: 0;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  display: block;
  clear: both;
}

:global(.svg-display-controls) {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 15px;
  background: #f8f9fa;
  border-bottom: 1px solid #e9ecef;
  border-radius: 6px 6px 0 0;
}

:global(.svg-mode-controls) {
  display: flex;
  gap: 4px;
}

:global(.svg-mode-btn) {
  background: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  transition: background-color 0.3s;
}

:global(.svg-mode-btn:hover) {
  background: #5a6268;
}

:global(.svg-mode-btn.active) {
  background: #007bff;
}

:global(.svg-mode-btn.active:hover) {
  background: #0056b3;
}

:global(.svg-image-container) {
  padding: 15px;
  text-align: center;
  background: white;
}

:global(.svg-render-frame) {
  display: inline-block;
  max-width: 100%;
  overflow: auto;
}

:global(.svg-render-frame svg) {
  max-width: 100%;
  max-height: 400px;
  height: auto;
  display: block;
  margin: 0 auto;
}

:global(.svg-code-container) {
  padding: 15px;
}

:global(.svg-code-display .copy-code-btn) {
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  margin-left: auto;
}

:global(.svg-code-display .copy-code-btn:hover) {
  background: #218838;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .chat-container {
    height: 100vh;
  }
}
</style>
