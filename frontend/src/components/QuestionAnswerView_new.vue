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
        @toggle-model="toggleModel"
      />
      
      <!-- 输入区域 -->
      <InputArea
        :loading="loading"
        :user-id="userId"
        @send-message="handleSendMessage"
        @upload-success="handleImageUpload"
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
  emits: ['update-title'],
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
      hoveredBox: null,
      copySuccess: false,
      copyTimer: null,
      showImageUploadSuccess: false, // 图片上传完成弹窗
    }
  },

  async mounted() {
    this.loadConversationById(this.conversationId)
    chatSocket.connect()
    chatSocket.addListener(this.handleSocketMessage)
    await this.fetchModels()
    await this.fetchUserSelections()
    document.addEventListener('click', this.handleCopyCodeClick)
  },

  beforeUnmount() {
    chatSocket.removeListener(this.handleSocketMessage)
    document.removeEventListener('click', this.handleCopyCodeClick)
  },

  watch: {
    conversationId: {
      immediate: false,
      handler(newId) {
        this.loadConversationById(newId)
      }
    },
    viewType(newVal) {
      // 视图切换时同步保存
      saveUserSelections(this.userId, { 
        view: newVal, 
        models: this.selectedModels, 
        conversationId: this.conversationId
      })
    }
  },

  methods: {
    // 处理发送消息
    async handleSendMessage({ question, imageUrl }) {
      if (!question.trim() && !imageUrl) return
      if (this.selectedModels.length === 0) {
        alert('请至少选择一个模型')
        return
      }
      if (!chatSocket.isReady()) {
        alert('WebSocket 连接未就绪，请稍后再试')
        return
      }

      // 新建会话时，将第一个问题作为会话标题
      if (this.conversationHistory.length === 0 && question.trim()) {
        try {
          // 使用完整的问题作为标题，不在这里截取
          const fullTitle = question.trim();
          
          await updateConversationName(this.conversationId, { title: fullTitle })
          this.$emit('update-title', fullTitle)
        } catch (e) {
          console.warn('会话标题更新失败', e)
        }
      }

      this.loading = true
      this.answeringModels = {}
      this.selectedModels.forEach(model => {
        this.answeringModels[model] = true // 标记为"正在流式"
      })

      // 发送消息
      if (imageUrl) {
        chatSocket.sendMessageWithImage({
          prompt: question,
          image_url: imageUrl,
          models: this.selectedModels,
          conversation_id: this.conversationId
        })
      } else {
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
      
      this.scrollToBottom()
    },

    // 处理图片上传成功
    handleImageUpload(imageUrl) {
      this.showImageUploadSuccess = true
      setTimeout(() => {
        this.showImageUploadSuccess = false
      }, 1200)
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
        this.conversationHistory = res.data.messages || []
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
      } catch (error) {
        console.error('Failed to fetch models:', error)
        // Fallback to default models if API fails
        this.availableModels = [
          {"DeepSeek": {"R1": "deepseek-r1", "V3": "deepseek-v3"}},
          {"Qwen": {"Q-plus": "qwen-plus-latest", "Q3": "qwen3-235b-a22b"}},
          {"GPT": {"4.1": "gpt-4.1"}}
        ]
      }
    },

    // 获取用户上一次选择的模型
    async fetchUserSelections() {
      try {
        const response = await getCustomMetadata(this.userId)
        if (response.data && response.data.custom_metadata.models) {
          this.selectedModels = response.data.custom_metadata.models
        } else {
          this.selectedModels = ['DeepSeek-R1']
        }
      } catch (error) {
        console.error('Failed to fetch user selections:', error)
        this.selectedModels = ['DeepSeek-R1']
      }
    },

    // WebSocket消息处理
    handleSocketMessage(data){
      switch (data.type) {
        case "stream_content":
          let lastItem = this.conversationHistory[this.conversationHistory.length - 1]
          if (lastItem && lastItem.answers && data.model) {
            if (typeof lastItem.answers[data.model] !== 'string') {
              lastItem.answers[data.model] = ""
            }
            lastItem.answers[data.model] += data.content
          }
          this.$nextTick(() => {
            this.scrollToBottom()
          })
          break

        case 'stream_end':
          if (data.answers && data.answers.model) {
            this.answeringModels[data.answers.model] = false
          }
          // 检查是否所有模型都结束
          if (Object.values(this.answeringModels).every(v => v === false)) {
            this.loading = false
          }
          this.scrollToBottom()
          break
        
        case 'response':
          this.conversationHistory.push({
            text: data.text,
            color: data.color
          })
          this.scrollToBottom()
          break
          
        default:
          break
      }
    },

    // 滚动到底部
    scrollToBottom() {
      this.$nextTick(() => {
        const chatBox = this.$refs.chatBox
        if (!chatBox) return
        chatBox.scrollTop = chatBox.scrollHeight
      })
    },

    // 切换模型选择
    toggleModel(modelId) {
      if (this.selectedModels.includes(modelId)) {
        this.selectedModels = this.selectedModels.filter(id => id !== modelId)
      } else {
        this.selectedModels.push(modelId)
      }
      saveUserSelections(this.userId, {
        'view': this.viewType, 
        'models': this.selectedModels, 
        'conversationId': this.conversationId
      })
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
  height: 88vh; /* 占满整个视口 */
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
  margin: 10px 0;
}

:global(.code-block-with-copy.python-black pre) {
  background: #222 !important;
  color: #fff !important;
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0;
  font-size: 15px;
  overflow-x: auto;
  font-family: 'Fira Mono', 'Consolas', 'Menlo', monospace;
  border: 1px solid #444;
}

:global(.copy-code-btn) {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 2;
  background: #4a9ff5;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.2s;
}

:global(.copy-code-btn:hover) {
  opacity: 1;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .chat-container {
    height: 100vh;
  }
}
</style>
