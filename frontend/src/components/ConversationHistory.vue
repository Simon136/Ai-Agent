<template>
  <div class="conversation-history">
    <template v-for="(item, index) in conversationHistory" :key="index">
      <!-- 问题框 -->
      <div class="message-box question">
        <div class="message-header">Question</div>
        <div class="message-content">{{ item.question }}</div>
        <!-- 显示图片如果有 -->
        <div v-if="item.imageUrl" class="question-image">
          <img :src="item.imageUrl" alt="Question image" class="question-image-preview" />
        </div>
      </div>
      
      <!-- 回答框容器 -->
      <div class="answers-container" :class="`view-${viewType}`">
        <template v-if="viewType === 1">
          <!-- 视图1：垂直排列 -->
          <MessageBox
            v-for="model in (item.models || Object.keys(item.answers || {}))"
            :key="model"
            :model-id="model"
            :content="item.answers && item.answers[model]"
            :is-loading="answeringModels[model] && index === conversationHistory.length - 1"
            :show-copy-button="hoveredBox === `${index}-${model}`"
            @hover="(isHovered) => handleHover(index, model, isHovered)"
            @copy="handleCopy"
          />
        </template>
        
        <template v-else-if="viewType === 2">
          <!-- 视图2：每行2个 -->
          <div v-for="row in Math.ceil(((item.models || Object.keys(item.answers || {})).length) / 2)" :key="row" class="answer-row">
            <MessageBox
              v-for="model in (item.models || Object.keys(item.answers || {})).slice((row-1)*2, row*2)"
              :key="model"
              :model-id="model"
              :content="item.answers && item.answers[model]"
              :is-loading="answeringModels[model] && index === conversationHistory.length - 1"
              :show-copy-button="hoveredBox === `${index}-${model}`"
              :style="{ width: '50%' }"
              @hover="(isHovered) => handleHover(index, model, isHovered)"
              @copy="handleCopy"
            />
          </div>
        </template>
        
        <template v-else-if="viewType === 3">
          <!-- 视图3：每行3个 -->
          <div v-for="row in Math.ceil(((item.models || Object.keys(item.answers || {})).length) / 3)" :key="row" class="answer-row">
            <MessageBox
              v-for="model in (item.models || Object.keys(item.answers || {})).slice((row-1)*3, row*3)"
              :key="model"
              :model-id="model"
              :content="item.answers && item.answers[model]"
              :is-loading="answeringModels[model] && index === conversationHistory.length - 1"
              :show-copy-button="hoveredBox === `${index}-${model}`"
              :style="{ width: '33.33%' }"
              @hover="(isHovered) => handleHover(index, model, isHovered)"
              @copy="handleCopy"
            />
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script>
import MessageBox from './MessageBox.vue'

export default {
  name: 'ConversationHistory',
  components: {
    MessageBox
  },
  props: {
    conversationHistory: {
      type: Array,
      default: () => []
    },
    viewType: {
      type: Number,
      default: 1
    },
    answeringModels: {
      type: Object,
      default: () => ({})
    },
    hoveredBox: {
      type: String,
      default: null
    }
  },
  emits: ['hover', 'copy'],
  methods: {
    handleHover(index, model, isHovered) {
      this.$emit('hover', index, model, isHovered)
    },
    
    handleCopy(success) {
      this.$emit('copy', success)
    }
  }
}
</script>

<style scoped>
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

/* 问题图片样式 */
.question-image {
  margin-top: 10px;
}

.question-image-preview {
  max-width: 200px;
  max-height: 150px;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

/* 答案容器布局 */
.answers-container {
  flex: 1;
  overflow-y: auto;
}

.answers-container.view-1 {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

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
