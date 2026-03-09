<template>
  <div 
    class="message-box answer"
    :class="[modelId, { 'empty': !content }]"
    @mouseenter="$emit('hover', true)"
    @mouseleave="$emit('hover', false)"
  >
    <!-- 加载线和等待提示 -->
    <template v-if="isLoading && !content">
      <div class="loading-bar"></div>
      <div class="waiting-text">Waiting...</div>
    </template>
    
    <!-- 复制按钮，仅在悬浮时显示 -->
    <button
      v-if="showCopyButton"
      class="copy-btn"
      @click="copyContent"
      title="复制内容"
    >
      Copy
    </button>
    
    <div class="message-header">{{ getModelDisplayName(modelId) }}</div>
    
    <div class="message-content">
      <ContentRenderer :content="content" :modelId="modelId" />
    </div>
  </div>
</template>

<script>
import ContentRenderer from './ContentRenderer.vue'

export default {
  name: 'MessageBox',
  components: {
    ContentRenderer
  },
  props: {
    modelId: {
      type: String,
      required: true
    },
    content: {
      type: String,
      default: ''
    },
    isLoading: {
      type: Boolean,
      default: false
    },
    showCopyButton: {
      type: Boolean,
      default: false
    }
  },
  emits: ['hover', 'copy'],
  methods: {
    getModelDisplayName(modelId) {
      // 简单的模型名称转换，可以根据需要扩展
      return modelId
    },
    
    copyContent() {
      if (!this.content) return
      
      navigator.clipboard.writeText(this.content).then(() => {
        this.$emit('copy', true)
      }).catch(() => {
        this.$emit('copy', false)
      })
    }
  }
}
</script>

<style scoped>
.message-box {
  border-radius: 8px;
  padding: 12px 15px;
  margin-bottom: 10px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.1);
  position: relative;
}

.message-header {
  font-weight: bold;
  font-size: 0.9em;
  padding: 0;
  margin: 0;
  background-color: inherit;
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid rgba(74, 159, 245, 0.2);
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.message-content {
  line-height: 1.5;
  flex: 1;
  overflow-y: auto;
  padding-right: 5px;
}

/* 滚动条美化 */
.message-content::-webkit-scrollbar {
  width: 6px;
}

.message-content::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.message-content::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.message-content::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

/* 回答框基础样式 */
.answer {
  background-color: #f0f8ff;
  border-left: 4px solid #4a9ff5;
  max-height: 850px;
  display: flex;
  flex-direction: column;
}

/* 不同模型的回答框颜色 */
.answer.deepseek {
  border-left-color: #4a9ff5;
}
.answer.deepseek .message-header {
  background-color: #f0f8ff;
  color: #4a9ff5;
}

.answer.qwen {
  border-left-color: #ff9800;
  background-color: #fff8f0;
}
.answer.qwen .message-header {
  background-color: #fff8f0;
  color: #ff9800;
}

.answer.gpt {
  border-left-color: #9c27b0;
  background-color: #f8f0ff;
}
.answer.gpt .message-header {
  background-color: #f8f0ff;
  color: #9c27b0;
}

.message-box.empty {
  opacity: 0.7;
  background-color: #f9f9f9;
}

.message-box.empty .message-content {
  color: #999;
  font-style: italic;
}

/* 加载动画 */
.loading-bar {
  width: 100%;
  height: 4px;
  background: linear-gradient(90deg, #4a9ff5 25%, #e0e7ef 50%, #4a9ff5 75%);
  background-size: 200% 100%;
  animation: loading-bar-move 1s linear infinite;
  border-radius: 2px 2px 0 0;
  margin-bottom: 8px;
}

.waiting-text {
  color: #999;
  font-size: 14px;
  margin-bottom: 6px;
  text-align: center;
}

@keyframes loading-bar-move {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 复制按钮 */
.copy-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: #4a9ff5;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
  opacity: 0.85;
  z-index: 11;
  transition: opacity 0.2s;
}

.copy-btn:hover {
  opacity: 1;
}
</style>
