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
      <div class="model-buttons">
        <template v-for="modelGroup in availableModels" :key="Object.keys(modelGroup)[0]">
          <template v-for="(variants, groupName) in modelGroup" :key="groupName">
            <button
              v-for="(modelId, variantName) in variants"
              :key="modelId"
              class="model-button"
              :class="{ 'selected': selectedModels.includes(`${groupName}-${variantName}`) }"
              @click="toggleModel(`${groupName}-${variantName}`)"
            >
              {{ groupName }} {{ variantName }}
            </button>
          </template>
        </template>
      </div>
      
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
import MarkdownIt from 'markdown-it'
import { ref, watch } from 'vue'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import { getConversation, updateConversationName, getModels, saveUserSelections, getCustomMetadata, uploadImageToS3  } from '../api/api'

export default {
  name: 'QuestionAnswerView',
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
        currentQuestion: '',
        selectedModels: [], // 默认选中DeepSeek
        // availableModels: {
        //     "deepseek": { id: 'deepseek', name: 'DeepSeek' },
        //     "qwen": { id: 'qwen', name: 'Qwen' },
        //     "gpt": { id: 'gpt', name: 'GPT' }
        // },
        availableModels: [],
        conversationHistory: [],
        answeringModels: {}, // 记录正在回答的模型
        activeModels: new Set(),
        socket: null,
        loading: ref(false), // 判断是否正在回答
        hoveredBox: null,
        copySuccess: false,
        copyTimer: null,
        imageUrl: '', // 改为存储S3 URL
        imageFile: null, // 存储原始文件对象
        fileLoading: false, // 新增，图片上传中
        showImageUploadSuccess: false, // 新增，图片上传完成弹窗
        answeringModels: {}
        }
    },

  mounted() {
      // console.log('account:', this.account)
      this.loadConversationById(this.conversationId)
      chatSocket.connect()
      chatSocket.addListener(this.handleSocketMessage)
      this.fetchModels()
      this.fetchUserSelections()
      document.addEventListener('click', this.handleCopyCodeClick);
      // console.log("user_id:", this.userId)
  },

  beforeUnmount() {
      chatSocket.removeListener(this.handleSocketMessage);
      document.removeEventListener('click', this.handleCopyCodeClick);
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
      saveUserSelections(this.userId, { view: newVal, models: this.selectedModels, conversationId: this.conversationId});
    }
  },
  watch: {
    conversationId: {
      immediate: false,
      handler(newId) {
        this.loadConversationById(newId)
      }
    }
  },

  setup() {
    // 创建 Markdown 解析器实例
    const md = new MarkdownIt({
      html: true,        // 解析 HTML 标签
      linkify: true,      // 自动转换链接
      typographer: true,  // 美化排版
      breaks: true,        // 转换换行符为 <br>
      highlight: function (str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`;
        } catch (__) {}
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
    }
    })

    // 自定义代码块渲染
    const defaultFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.fence = function(tokens, idx, options, env, self) {
      const token = tokens[idx];
      const code = token.content;
      const lang = token.info.trim().toLowerCase();
      // 自动识别 python 特征
      if (!lang && (code.trim().startsWith('import ') || code.trim().startsWith('def ') || code.trim().startsWith('class '))) {
        lang = 'python';
      }
      if (lang && hljs.getLanguage(lang)) {
        return `<div class="code-block-with-copy python-black">
          <button class="copy-code-btn" data-code="${encodeURIComponent(code)}">Copy</button>
          <pre class="hljs"><code>${hljs.highlight(code, { language: lang }).value}</code></pre>
        </div>`;
      }
      // const isPython = lang === 'python' ||
      //   (!lang && (code.trim().startsWith('import os') || code.trim().startsWith('def ') || code.trim().startsWith('class ')));
      // if (isPython) {
      //   // 包裹一层div，添加复制按钮
      //   return `
      //     <div class="code-block-with-copy python-black">
      //       <button class="copy-code-btn" data-code="${encodeURIComponent(code)}">Copy</button>
      //       <pre><code class="language-python">${md.utils.escapeHtml(code)}</code></pre>
      //     </div>
      //   `;
      // }
      // 其他语言按默认处理
      return defaultFence(tokens, idx, options, env, self);
    };

    // Markdown 渲染方法
    const renderMarkdown = (text) => {
      if (!text) return '';
      return md.render(text);
    };

    return {
      renderMarkdown
    }
  },

  methods: {
    // 添加图片处理逻辑
    triggerImageUpload() {
      if (this.fileLoading || this.loading) return;
      this.$refs.imageInput && this.$refs.imageInput.click();
    },
    async onImageChange(e) {
      const file = e.target.files[0];
      if (!file) return;
      
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        alert('请选择图片文件');
        return;
      }
      
      // 验证文件大小 (例如限制为10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert('图片文件大小不能超过10MB');
        return;
      }
      
      this.fileLoading = true;
      this.imageFile = file;
      
      try {
        // 上传图片到S3
        const response = await uploadImageToS3(file, this.userId);
        
        if (response.data && response.data.status === 'success') {
          this.imageUrl = response.data.image_url;
          this.selectedModels = ['GPT-4.1', 'GPT-4o']; // 图片分析通常使用GPT模型
          this.showImageUploadSuccess = true;
          
          setTimeout(() => {
            this.showImageUploadSuccess = false;
          }, 1200);
        } else {
          throw new Error(response.data?.message || '上传失败');
        }
      } catch (error) {
        console.error('图片上传失败:', error);
        alert(`图片上传失败: ${error.message || '请重试'}`);
        this.imageUrl = '';
        this.imageFile = null;
      } finally {
        this.fileLoading = false;
        // 清空文件输入，允许重新选择同一文件
        e.target.value = '';
      }
    },

    async sendQuestion() {
      if (!this.currentQuestion.trim() && !this.imageUrl) return;
      if (this.selectedModels.length === 0) {
        alert('请至少选择一个模型');
        return;
      }
      if (!chatSocket.isReady()) {
        alert('WebSocket 连接未就绪，请稍后再试');
        return;
      }

      // 新建会话时，将第一个问题作为会话标题
      if (this.conversationHistory.length === 0 && this.currentQuestion.trim()) {
        try {
          // 使用完整的问题作为标题，不在这里截取
          const fullTitle = this.currentQuestion.trim();
          
          await updateConversationName(this.conversationId, { title: fullTitle });
          this.$emit('update-title', fullTitle)
        } catch (e) {
          console.warn('会话标题更新失败', e);
        }
      }

      this.loading = true;
      this.answeringModels = {};
      this.selectedModels.forEach(model => {
        this.answeringModels[model] = true; // 标记为“正在流式”
      })
      // console.log('Sending question:', this.currentQuestion, 'with models:', this.selectedModels, 'and image:', this.imageBase64);
      // 判断是否有图片
      if (this.imageUrl) {
        chatSocket.sendMessageWithImage({
          prompt: this.currentQuestion,
          image_url: this.imageUrl, // 发送S3的URL而不是base64
          models: this.selectedModels,
          conversation_id: this.conversationId
        });
      } else {
        chatSocket.sendMessage({
          prompt: this.currentQuestion,
          models: this.selectedModels,
          conversation_id: this.conversationId
        });
      }
      this.activeModels.clear();
      const answers = {};
      this.selectedModels.forEach(model => {
        answers[model] = "";
      });
      this.conversationHistory.push({
        question: `Q: ${ this.currentQuestion }`,
        answers,
        models: [...this.selectedModels],
        imageUrl: this.imageUrl // 记录图片URL
      });
      this.currentQuestion = '';
      this.imageUrl = '';
      this.imageFile = null;
      this.scrollToBottom();
    },

    // 外部可调用：加载会话内容
    async loadConversation(messages) {
      this.conversationHistory = messages || []
      this.currentQuestion = ''
      this.scrollToBottom()
    },
    // 内部：根据id加载
    async loadConversationById(cid) {
      if (!cid) return
      const res = await getConversation(cid)
      this.conversationHistory = res.data.messages || []
      // console.log('Loaded conversation:', this.conversationHistory)
      this.currentQuestion = ''
      this.scrollToBottom()
    },
    // 外部可调用：清空会话
    clearConversation() {
      this.conversationHistory = []
      this.currentQuestion = ''
      // this.saveHistory()
    },
    // 复制按钮
    copyAnswer(text) {
      if (!text) return;
      navigator.clipboard.writeText(text).then(() => {
        this.copySuccess = true;
        clearTimeout(this.copyTimer);
        this.copyTimer = setTimeout(() => {
          this.copySuccess = false;
        }, 1200);
      });
    },
    // 获取AI模型
    async fetchModels() {
      this.loadingModels = true
      this.modelsError = null
      try {
          const response = await getModels()
          // console.log('Available models:', response.data)
          this.availableModels = response.data
          // console.log('Available models:', this.availableModels)
      } catch (error) {
          console.error('Failed to fetch models:', error)
          this.modelsError = 'Failed to load models. Please try again later.'
          // Fallback to default models if API fails
          this.availableModels = [
              {"DeepSeek": {"R1": "deepseek-r1", "V3": "deepseek-v3"}},
              {"Qwen": {"Q-plus": "qwen-plus-latest", "Q3": "qwen3-235b-a22b"}},
              {"GPT": {"4.1": "gpt-4.1"}}
          ]
      } finally {
          this.loadingModels = false
      }
    },

    // 获取用户上一次选择的模型
    async fetchUserSelections() {
      try {
        const response = await getCustomMetadata(this.userId)
        // console.log('User selections:', response.data.custom_metadata.models)
        if (response.data && response.data.custom_metadata.models) {
          // console.log('Fetched user models:', response.data.models)
          this.selectedModels = response.data.custom_metadata.models
        } else {
          // 如果没有保存的选择，使用默认模型
          this.selectedModels = ['DeepSeek-R1']
        }
      } catch (error) {
        console.error('Failed to fetch user selections:', error)
        // 使用默认模型作为回退
        this.selectedModels = ['DeepSeek-R1']
      }
    },

    handleSocketMessage(data){
        switch (data.type) {
            // 只处理最后一条对话
            case "stream_content":
              let lastItem = this.conversationHistory[this.conversationHistory.length - 1];
              if (lastItem && lastItem.answers && data.model) {
                  if (typeof lastItem.answers[data.model] !== 'string') {
                      lastItem.answers[data.model] = "";
                  }
                  lastItem.answers[data.model] += data.content;
              }
              this.$nextTick(() => {
                  this.scrollToBottom();
              });
              break;

            
            case 'stream_end':
                // 标记该模型流式结束
                // let endMsg = this.conversationHistory.find(m => m.model === data.model && m.streaming);
                // if (endMsg) endMsg.streaming = false;
                // this.scrollToBottom();
                // this.loading = false
                // // this.saveHistory()
                // break;
                // 标记该模型流式结束
                if (data.answers.model) {
                  this.answeringModels[data.answers.model] = false;
                }
                // 检查是否所有模型都结束
                if (Object.values(this.answeringModels).every(v => v === false)) {
                  this.loading = false;
                }
                this.scrollToBottom();
                break;
            
            case 'response':
                this.conversationHistory.push({
                    text: data.text,
                    color: data.color
                });
                this.scrollToBottom();
                // this.saveHistory()
                break;
            default:
                break;
        }
    },

    // sendQuestion() {
    //     if (!this.currentQuestion.trim()) return
    //     if (this.selectedModels.length === 0) {
    //         alert('请至少选择一个模型');
    //         return;
    //     }

    //     if (!chatSocket.isReady()) {
    //         alert('WebSocket 连接未就绪，请稍后再试');
    //         return;
    //     }

    //     this.loading = true
    //     chatSocket.sendMessage({
    //         prompt: this.currentQuestion,
    //         models: this.selectedModels,
    //         conversation_id: this.conversationId // 关键：带上当前会话id
    //     })

    //     this.activeModels.clear()
    //     const answers = {}
    //     this.selectedModels.forEach(model => {
    //         answers[model] = "";
    //     })
    //     this.conversationHistory.push({
    //         question: `Q: ${ this.currentQuestion }`,
    //         answers,
    //         models: [...this.selectedModels] // 新增
    //     })
    //     this.currentQuestion = ''
    //     this.scrollToBottom()
    //     // this.saveHistory()
    // },

    scrollToBottom() {
      this.$nextTick(() => {
        const chatBox = this.$refs.chatBox;
        if (!chatBox) return;
          chatBox.scrollTop = chatBox.scrollHeight;
      });
    },

    toggleModel(modelId) {
      if (this.selectedModels.includes(modelId)) {
        this.selectedModels = this.selectedModels.filter(id => id !== modelId);
      } else {
        this.selectedModels.push(modelId);
      }
      saveUserSelections(this.userId, {'view':this.viewType, 'models': this.selectedModels, 'conversationId': this.conversationId});
    },

    // getModelName(modelId) {
    //   const model = this.availableModels[modelId];
    //   console.log('getModelName:', modelId, model);
    //   return modelId ? model.name : '';
    // },
    getModelName(modelId) {
      const model = this.availableModels[modelId];
      // console.log('getModelName:', modelId, model);
      return modelId;
    },

    handleEnter(e) {
      if (e.ctrlKey) {
        // Ctrl+Enter 换行
        const textarea = this.$refs.questionTextarea;
        const value = this.currentQuestion;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        this.currentQuestion = value.slice(0, start) + '\n' + value.slice(end);
        this.$nextTick(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1;
        });
        e.preventDefault();
      } else if (!e.shiftKey) {
        // 普通 Enter 发送
        e.preventDefault();
        this.sendQuestion();
      }
    },

    autoResize() {
      this.$nextTick(() => {
        const textarea = this.$refs.questionTextarea;
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'; // 最大120px
        }
      });
    },

    handleCopyCodeClick(e) {
      const btn = e.target.closest('.copy-code-btn');
      if (btn) {
        const code = decodeURIComponent(btn.getAttribute('data-code'));
        navigator.clipboard.writeText(code).then(() => {
          btn.textContent = 'Copied';
          setTimeout(() => {
            btn.textContent = 'Copy';
          }, 1200);
        });
      }
    },

    removeImage() {
      this.imageUrl = '';
      this.imageFile = null;
      // 清空文件输入
      if (this.$refs.imageInput) {
        this.$refs.imageInput.value = '';
      }
    },
    // async saveHistory() {
    //   if (this.conversationId) {
    //     await updateConversation(this.conversationId, { messages: this.conversationHistory })
    //   }
    // }
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

.model-selector {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 15px;
  max-height: 120px; /* 限制高度，防止占用太多空间 */
  overflow-y: auto; /* 如果模型太多，添加滚动条 */
}

.model-buttons {
  display: flex;
  gap: 8px;
  margin-bottom: 15px;
  overflow-x: auto;
  padding-bottom: 5px;
  white-space: nowrap;
}

.model-button {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 15px;
  background-color: #eee;
  color: #999;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;
}

.model-button:hover {
  border-color: #4a9ff5;
  color: #333;
}

.model-button.selected {
  background-color: #4a9ff5;
  color: white;
  border-color: #4a9ff5;
}

.model-tag {
  padding: 5px 10px;
  border-radius: 15px;
  background-color: #eee;
  color: #999;
  cursor: pointer;
  transition: all 0.3s;
}

.model-tag.selected {
  background-color: #4a9ff5;
  color: white;
}

.input-area {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.input-area input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.input-area button:disabled {
  padding: 8px 16px;
  background-color: #4a9ff5;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.answers-container {
  flex: 1;
  overflow-y: auto;
}

/* 视图1样式 - 垂直排列 */
.answers-container.view-1 {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.answers-container.view-1 .answer-column {
  border: 1px solid #eee;
  border-radius: 5px;
  padding: 15px;
}

/* 视图2和视图3样式 - 水平排列 */
.answers-container.view-2,
.answers-container.view-3 {
  display: flex;
  flex-direction: column;
}

.answer-row {
  display: flex;
  gap: 15px;
  margin-bottom: 15px;
}

.answer-cell {
  border: 1px solid #eee;
  border-radius: 5px;
  padding: 15px;
}

.model-name {
  font-weight: bold;
  margin-bottom: 10px;
  color: #4a9ff5;
}

.answer-content {
  line-height: 1.5;
}

/* 添加新的样式 */
.conversation-history {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: 20px;
}

.message-box {
  border-radius: 8px;
  padding: 12px 15px;
  margin-bottom: 10px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
}

.message-header {
  font-weight: bold;
  margin-bottom: 8px;
  font-size: 0.9em;
}

.message-content {
  line-height: 1.5;
}

/* 问题框样式 */
.question {
  background-color: #e6f7e6;
  border-left: 4px solid #4CAF50;
  align-self: flex-start;
  max-width: 80%;
}

/* 回答框基础样式 */
.answer {
  background-color: #f0f8ff;
  border-left: 4px solid #4a9ff5;
}

/* 不同模型的回答框可以有不同的边框颜色 */
.answer.deepseek {
  border-left-color: #4a9ff5;
}
.answer.qwen {
  border-left-color: #ff9800;
}
.answer.gpt {
  border-left-color: #9c27b0;
}

.message-box.empty {
  opacity: 0.7;
  background-color: #f9f9f9;
}

.message-box.empty .message-content {
  color: #999;
  font-style: italic;
}

.message-box.answer {
  max-height: 300px;      /* 你可以根据需要调整高度 */
  overflow-y: auto;
  position: relative; /* 让复制按钮定位于右上角 */
}

.loading-dots {
  display: inline-flex;
}

.loading-dots span {
  animation: blink 1.4s infinite both;
  margin-left: 2px;
}

.loading-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.loading-dots span:nth-child(3) {
  animation-delay: 0.4s;
}
.copy-btn {
  position: absolute;
  top: 8px;
  right: 12px;
  background: #4a9ff5;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.85;
  z-index: 2;
  transition: opacity 0.2s;
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

.question-textarea {
  flex: 1;
  min-height: 36px;
  max-height: 120px;
  resize: none;
  overflow-y: auto;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 15px;
  line-height: 1.5;
  box-sizing: border-box;
}

.loading-bar {
  width: 100%;
  height: 4px;
  background: linear-gradient(90deg, #4a9ff5 25%, #e0e7ef 50%, #4a9ff5 75%);
  background-size: 200% 100%;
  animation: loading-bar-move 1s linear infinite;
  border-radius: 2px 2px 0 0;
  margin-bottom: 8px;
}

.code-block-with-copy pre {
  background: #f5f5f5;      /* 浅灰色背景 */
  border-radius: 6px;
  padding: 14px 12px 12px 12px;
  margin: 0;
  font-size: 15px;
  overflow-x: auto;
  font-family: 'Fira Mono', 'Consolas', 'Menlo', monospace;
  border: 1px solid #e0e0e0;
}

/* 可选：让代码更像 Python 格式 */
.code-block-with-copy code.language-python {
  color: #2d3a4a;
  /* 你可以引入 highlight.js 或 prism.js 的 python 主题获得更好高亮 */
}

.copy-code-btn {
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
.copy-code-btn:hover {
  opacity: 1;
}

@keyframes loading-bar-move {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.waiting-text {
  color: #999;
  font-size: 14px;
  margin-bottom: 6px;
  text-align: center;
}

@keyframes fadeInOut {
  0% { opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes blink {
  0% { opacity: 0.2; }
  20% { opacity: 1; }
  100% { opacity: 0.2; }
}

.send-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: #f4f8fc;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  cursor: pointer;
  margin-left: 8px;
  font-size: 18px;
  padding: 0;
}
.send-btn:disabled {
  background: #f4f4f4;
  cursor: not-allowed;
}
.send-btn svg {
  display: block;
}
.loading-spinner {
  width: 28px;
  height: 28px;
  border: 10px solid #4a9ff5;
  border-top: 10px solid #e0e7ef;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  box-sizing: border-box;
}
@keyframes spin {
  0% { transform: rotate(0deg);}
  100% { transform: rotate(360deg);}
}

.send-btn-custom {
  width: 120px;
  height: 44px;
  border: none;
  border-radius: 8px;
  background: #eff3f7; /* 浅蓝色 */
  color: #1477ff;
  font-weight: bold;
  font-size: 16px;
  margin-left: 8px;
  transition: background 0.2s, color 0.2s;
  cursor: pointer;
  outline: none;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap; /* 防止换行 */
}
.send-btn-custom:disabled {
  background: #e0f0ff;
  color: #b9d6f8;
  cursor: not-allowed;
}
.send-btn-custom:not(:disabled) {
  background: #1370f3; /* 深蓝色 */
  color: #fff;
}

.upload-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: #1477ff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  font-size: 18px;
  padding: 0;
  cursor: pointer;
}
.upload-btn:disabled {
  background: #1477ff;
  cursor: not-allowed;
}

.upload-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

/* 图片预览样式 */
.image-preview-container {
  margin-bottom: 10px;
}

.image-preview {
  position: relative;
  display: inline-block;
  max-width: 200px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.preview-image {
  width: 100%;
  height: auto;
  max-height: 150px;
  object-fit: cover;
  display: block;
}

.remove-image-btn {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 24px;
  height: 24px;
  background: rgba(0,0,0,0.6);
  color: white;
  border: none;
  border-radius: 50%;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.remove-image-btn:hover {
  background: rgba(0,0,0,0.8);
}

:deep(.code-block-with-copy.python-black pre) {
  background: #222 !important;
  color: #fff !important;
  border-radius: 6px;
  padding: 14px 12px 12px 12px;
  margin: 0;
  font-size: 15px;
  overflow-x: auto;
  font-family: 'Fira Mono', 'Consolas', 'Menlo', monospace;
  border: 1px solid #444;
}


/* 响应式调整 */
@media (max-width: 768px) {
  .answer-row {
    flex-direction: column;
  }
  .answer-row .message-box {
    width: 100% !important;
  }
}
</style>