<template>
  <div class="model-selector">
    <div class="model-buttons">
      <template v-for="modelGroup in availableModels" :key="Object.keys(modelGroup)[0]">
        <template v-for="(variants, groupName) in modelGroup" :key="groupName">
          <button
            v-for="(modelId, variantName) in variants"
            :key="modelId"
            class="model-button"
            :class="{ 
              'selected': selectedModels.includes(`${groupName}-${variantName}`),
              'disabled': hasUploadedImage && !isVisionModel(`${groupName}-${variantName}`)
            }"
            :disabled="hasUploadedImage && !isVisionModel(`${groupName}-${variantName}`)"
            @click="$emit('toggle-model', `${groupName}-${variantName}`)"
          >
            {{ groupName }} {{ variantName }}
            <span v-if="hasUploadedImage && !isVisionModel(`${groupName}-${variantName}`)" class="disabled-hint">
              (No images supported)
            </span>
          </button>
        </template>
      </template>
    </div>
    
    <!-- 图片模式提示 -->
    <div v-if="hasUploadedImage" class="vision-mode-hint">
      <span class="hint-icon">🖼️</span>
      Images: GPT-4.1 & GPT-5-chat only
    </div>
  </div>
</template>

<script>
export default {
  name: 'ModelSelector',
  props: {
    availableModels: {
      type: Array,
      default: () => []
    },
    selectedModels: {
      type: Array,
      default: () => []
    },
    hasUploadedImage: {
      type: Boolean,
      default: false
    }
  },
  emits: ['toggle-model'],
  methods: {
    // 检查是否为支持视觉的模型
    isVisionModel(modelName) {
      const visionModels = ['GPT-4.1', 'GPT-5-chat']
      return visionModels.includes(modelName)
    }
  }
}
</script>

<style scoped>
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
  flex-shrink: 0;
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

.model-button.disabled {
  background-color: #f5f5f5;
  color: #999;
  border-color: #ddd;
  cursor: not-allowed;
  opacity: 0.6;
}

.model-button.disabled:hover {
  border-color: #ddd;
  color: #999;
}

.disabled-hint {
  font-size: 10px;
  display: block;
  margin-top: 2px;
}

/* 图片模式提示 */
.vision-mode-hint {
  background: #fff3cd;
  border: 1px solid #ffeaa7;
  border-radius: 4px;
  padding: 8px 12px;
  margin-top: 10px;
  font-size: 13px;
  color: #856404;
  display: flex;
  align-items: center;
  gap: 6px;
}

.hint-icon {
  font-size: 14px;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .model-buttons {
    flex-wrap: wrap;
  }
  
  .vision-mode-hint {
    font-size: 12px;
    padding: 6px 10px;
  }
}
</style>
