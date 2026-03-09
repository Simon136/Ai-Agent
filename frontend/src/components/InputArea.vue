<template>
  <div class="input-area">
    <!-- 图片预览区域 -->
    <div v-if="imageUrl" class="image-preview-container">
      <div class="image-preview">
        <img :src="imageUrl" alt="Uploaded image" class="preview-image" />
        <button class="remove-image-btn" @click="removeImage" title="移除图片">
          ×
        </button>
      </div>
    </div>
    
    <textarea
      v-model="questionText"
      class="question-textarea"
      :rows="1"
      ref="questionTextarea"
      @keydown.enter="handleEnter"
      @compositionstart="onCompositionStart"
      @compositionend="onCompositionEnd"
      @input="autoResize"
      @paste="handlePaste"
      :disabled="fileLoading"
      placeholder="Type your question… (Enter to send, Shift+Enter for line break) / 输入您的问题...(回车发送，Shift+回车换行)"
    ></textarea>
    
    <button
      class="send-btn-custom"
      :disabled="(!questionText.trim() && !imageUrl) || loading || fileLoading || isGenerating"
      @click="sendQuestion"
    >
      {{ isGenerating ? 'GENERATING...' : 'SEND TO:' }}
    </button>
    
    <!-- 停止生成按钮 -->
    <button
      v-if="isGenerating"
      class="stop-btn"
      @click="stopGeneration"
      title="停止生成"
    >
      ⏹
    </button>
    
    <input
      type="file"
      accept="image/*"
      ref="imageInput"
      style="display:none"
      @change="onImageChange"
    />
    
    <button class="upload-btn" @click="triggerImageUpload" :disabled="loading || fileLoading || isGenerating">
      <template v-if="fileLoading">
        <span class="loading-spinner"></span>
      </template>
      <template v-else>
        <img src="/uploading.png" alt="upload" class="upload-icon" />
      </template>
    </button>
  </div>
</template>

<script>
import { uploadImageToS3 } from '../api/api'

export default {
  name: 'InputArea',
  props: {
    loading: {
      type: Boolean,
      default: false
    },
    userId: {
      type: String,
      required: true
    },
    hasUploadedImage: {
      type: Boolean,
      default: false
    },
    isGenerating: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      questionText: '',
      imageUrl: '',
      imageFile: null,
      fileLoading: false,
      isComposing: false, // 输入法组合状态标志
      defaultHeight: 44, // 默认高度
      maxHeight: 200 // 最大高度，将根据容器计算
    }
  },
  emits: ['send-message', 'upload-success', 'image-removed', 'stop-generation'],
  watch: {
    questionText(newVal) {
      this.$emit('update:question', newVal)
    }
  },
  mounted() {
    // 初始化最大高度计算
    setTimeout(() => {
      this.calculateMaxHeight()
    }, 100) // 延迟一下确保DOM已完全渲染
    
    // 创建防抖版本的计算方法
    this.debouncedCalculateMaxHeight = this.debounce(this.calculateMaxHeight, 250)
    
    // 监听窗口大小变化
    window.addEventListener('resize', this.debouncedCalculateMaxHeight)
  },
  beforeUnmount() {
    // 清理事件监听器
    window.removeEventListener('resize', this.debouncedCalculateMaxHeight)
  },
  methods: {
    triggerImageUpload() {
      if (this.fileLoading || this.loading || this.isGenerating) return
      this.$refs.imageInput && this.$refs.imageInput.click()
    },
    
    async onImageChange(e) {
      const file = e.target.files[0]
      if (!file) return
      
      // 验证文件类型
      if (!file.type.startsWith('image/')) {
        alert('请选择图片文件')
        return
      }
      
      // 验证文件大小 (10MB)
      const maxSize = 10 * 1024 * 1024
      if (file.size > maxSize) {
        alert('图片文件大小不能超过10MB')
        return
      }
      
      this.fileLoading = true
      this.imageFile = file
      
      try {
        const response = await uploadImageToS3(file, this.userId)
        
        if (response.data && response.data.status === 'success') {
          this.imageUrl = response.data.image_url
          this.$emit('upload-success', this.imageUrl)
        } else {
          throw new Error(response.data?.message || '上传失败')
        }
      } catch (error) {
        console.error('图片上传失败:', error)
        alert(`图片上传失败: ${error.message || '请重试'}`)
        this.imageUrl = ''
        this.imageFile = null
      } finally {
        this.fileLoading = false
        e.target.value = ''
      }
    },
    
    removeImage() {
      this.imageUrl = ''
      this.imageFile = null
      if (this.$refs.imageInput) {
        this.$refs.imageInput.value = ''
      }
      // 通知父组件图片已移除
      this.$emit('image-removed')
    },
    
    sendQuestion() {
      if (!this.questionText.trim() && !this.imageUrl) return
      
      this.$emit('send-message', {
        question: this.questionText,
        imageUrl: this.imageUrl
      })
      
      this.questionText = ''
      this.imageUrl = ''
      this.imageFile = null
      
      // 发送后恢复默认高度
      this.resetTextareaHeight()
    },
    
    handleEnter(e) {
      // 如果正在使用输入法，不处理回车键
      if (this.isComposing) {
        return
      }
      
      if (e.ctrlKey || e.shiftKey) {
        // Ctrl+Enter 或 Shift+Enter 换行
        const textarea = this.$refs.questionTextarea
        const value = this.questionText
        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        this.questionText = value.slice(0, start) + '\n' + value.slice(end)
        this.$nextTick(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 1
        })
        e.preventDefault()
      } else {
        // 普通 Enter 发送
        e.preventDefault()
        this.sendQuestion()
      }
    },

    // 输入法开始组合
    onCompositionStart() {
      this.isComposing = true
      console.log('输入法组合开始')
    },

    // 输入法结束组合
    onCompositionEnd() {
      this.isComposing = false
      console.log('输入法组合结束')
      // 组合结束后调整高度
      this.autoResize()
    },

    // 处理粘贴事件
    handlePaste() {
      // 延迟调整高度，确保粘贴的内容已经插入
      this.$nextTick(() => {
        this.autoResize()
      })
    },
    
    autoResize() {
      this.$nextTick(() => {
        const textarea = this.$refs.questionTextarea
        if (textarea) {
          // 如果内容为空，直接恢复默认高度
          if (!this.questionText.trim()) {
            textarea.style.height = this.defaultHeight + 'px'
            textarea.style.overflowY = 'hidden'
            return
          }
          
          // 暂时设置高度为1px以获取准确的scrollHeight
          textarea.style.height = '1px'
          
          // 计算需要的高度
          const scrollHeight = textarea.scrollHeight
          const lineHeight = parseInt(window.getComputedStyle(textarea).lineHeight) || 24
          const padding = parseInt(window.getComputedStyle(textarea).paddingTop) + 
                         parseInt(window.getComputedStyle(textarea).paddingBottom)
          
          // 计算实际需要的高度
          const contentHeight = Math.max(scrollHeight, this.defaultHeight)
          const finalHeight = Math.min(contentHeight, this.maxHeight)
          
          // 设置最终高度
          textarea.style.height = finalHeight + 'px'
          
          // 根据是否超过最大高度决定是否显示滚动条
          if (scrollHeight > this.maxHeight) {
            textarea.style.overflowY = 'auto'
          } else {
            textarea.style.overflowY = 'hidden'
          }
        }
      })
    },

    // 重置文本框高度到默认值
    resetTextareaHeight() {
      this.$nextTick(() => {
        const textarea = this.$refs.questionTextarea
        if (textarea) {
          textarea.style.height = this.defaultHeight + 'px'
          textarea.style.overflowY = 'hidden'
        }
      })
    },

    // 计算最大高度
    calculateMaxHeight() {
      this.$nextTick(() => {
        // 使用窗口高度作为基准
        let baseHeight = window.innerHeight
        
        // 尝试获取更精确的容器高度
        const possibleContainers = [
          '.chat-container',
          '.question-answer-view',
          '.main-content',
          '.content-area'
        ]
        
        for (const selector of possibleContainers) {
          const container = document.querySelector(selector)
          if (container && container.offsetHeight > 0) {
            baseHeight = container.offsetHeight
            break
          }
        }
        
        // 计算2/3高度，确保不小于最小值120px
        const calculatedMaxHeight = Math.floor(baseHeight * 2 / 3)
        this.maxHeight = Math.max(calculatedMaxHeight, 120)
        
        console.log(`输入框最大高度设置为: ${this.maxHeight}px (基于容器高度: ${baseHeight}px)`)
      })
    },

    stopGeneration() {
      this.$emit('stop-generation')
    },

    // 防抖函数
    debounce(func, wait) {
      let timeout
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout)
          func(...args)
        }
        clearTimeout(timeout)
        timeout = setTimeout(later, wait)
      }
    }
  }
}
</script>

<style scoped>
.input-area {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
}

.question-textarea {
  flex: 1;
  min-height: 44px;
  height: 44px; /* 初始高度 */
  resize: none;
  overflow-y: hidden; /* 默认隐藏滚动条，会根据内容动态调整 */
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 15px;
  line-height: 1.5;
  box-sizing: border-box;
  transition: height 0.2s ease; /* 高度变化的平滑过渡效果 */
  font-family: inherit;
  /* 最大高度由JavaScript动态计算为页面2/3高度 */
}

.question-textarea:focus {
  outline: none;
  border-color: #1477ff;
  box-shadow: 0 0 0 2px rgba(20, 119, 255, 0.1);
}

.send-btn-custom {
  width: 120px;
  height: 44px;
  border: none;
  border-radius: 8px;
  background: #eff3f7;
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
  white-space: nowrap;
}

.send-btn-custom:disabled {
  background: #e0f0ff;
  color: #b9d6f8;
  cursor: not-allowed;
}

.send-btn-custom:not(:disabled) {
  background: #1370f3;
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
  cursor: pointer;
}

.upload-btn:disabled {
  background: #1477ff;
  cursor: not-allowed;
}

.stop-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: #ff4757;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  cursor: pointer;
  font-size: 18px;
  transition: background 0.2s;
}

.stop-btn:hover {
  background: #ff3742;
}

.upload-icon {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.loading-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #fff;
  border-top: 2px solid transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
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
</style>
