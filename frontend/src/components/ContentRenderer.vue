<template>
  <div class="content-renderer">
    <!-- 完整HTML页面 - 使用Shadow DOM或iframe渲染 -->
    <div v-if="contentType === 'html'" class="html-content-container">
      <div class="content-type-badge">HTML页面</div>
      
      <!-- 渲染模式切换按钮 -->
      <div class="render-mode-controls">
        <button 
          class="render-mode-btn" 
          :class="{ active: htmlRenderMode === 'preview' }"
          @click="setHtmlRenderMode('preview')"
          title="HTML预览">
          🌐 预览
        </button>
        <button 
          class="render-mode-btn" 
          :class="{ active: htmlRenderMode === 'code' }"
          @click="setHtmlRenderMode('code')"
          title="源代码">
          📝 代码
        </button>
      </div>
      
      <!-- HTML预览渲染 -->
      <div v-if="htmlRenderMode === 'preview'" class="html-preview-container">
        <!-- 优先使用Shadow DOM渲染 -->
        <div 
          v-if="supportsShadowDOM" 
          ref="shadowRoot"
          class="shadow-dom-container">
        </div>
        
        <!-- 回退到iframe渲染 -->
        <iframe 
          v-else
          :srcdoc="sanitizedContent"
          class="html-iframe"
          sandbox="allow-same-origin allow-scripts"
          @load="handleIframeLoad($event, 'html')"
          frameborder="0">
        </iframe>
      </div>
      
      <!-- HTML源代码显示 -->
      <div v-else class="html-source-container">
        <pre class="source-code">{{ originalContent }}</pre>
      </div>
    </div>
    
    <!-- HTML片段内容 -->
    <div v-else-if="contentType === 'html-fragment'" class="html-fragment-container">
      <div class="content-type-badge">HTML片段</div>
      
      <!-- 渲染模式切换按钮 -->
      <div class="render-mode-controls">
        <button 
          class="render-mode-btn" 
          :class="{ active: htmlFragmentRenderMode === 'preview' }"
          @click="setHtmlFragmentRenderMode('preview')"
          title="HTML预览">
          🌐 预览
        </button>
        <button 
          class="render-mode-btn" 
          :class="{ active: htmlFragmentRenderMode === 'code' }"
          @click="setHtmlFragmentRenderMode('code')"
          title="源代码">
          📝 代码
        </button>
      </div>
      
      <!-- HTML片段预览渲染 -->
      <div v-if="htmlFragmentRenderMode === 'preview'" class="html-preview-container">
        <!-- 优先使用Shadow DOM渲染 -->
        <div 
          v-if="supportsShadowDOM" 
          ref="shadowRootFragment"
          class="shadow-dom-container">
        </div>
        
        <!-- 回退到iframe渲染 -->
        <iframe 
          v-else
          :srcdoc="htmlWrapperContent"
          class="html-iframe"
          sandbox="allow-same-origin allow-scripts"
          @load="handleIframeLoad($event, 'html-fragment')"
          frameborder="0">
        </iframe>
      </div>
      
      <!-- HTML片段源代码显示 -->
      <div v-else class="html-source-container">
        <pre class="source-code">{{ originalContent }}</pre>
      </div>
    </div>
    
    <!-- SVG内容 -->
    <div v-else-if="contentType === 'svg'" class="svg-content-container">
      <div class="content-type-badge">SVG</div>
      
      <!-- 渲染模式切换按钮 -->
      <div class="render-mode-controls">
        <button 
          class="render-mode-btn" 
          :class="{ active: renderMode === 'image' }"
          @click="setRenderMode('image')"
          title="Show as image">
          图像显示
        </button>
        <button 
          class="render-mode-btn" 
          :class="{ active: renderMode === 'code' }"
          @click="setRenderMode('code')"
          title="Show as code">
          代码显示
        </button>
      </div>
      
      <!-- 图像渲染模式 -->
      <iframe 
        v-if="renderMode === 'image'"
        :srcdoc="svgWrapperContent"
        class="svg-iframe"
        sandbox="allow-same-origin"
        @load="handleIframeLoad($event, 'svg')"
        frameborder="0">
      </iframe>
      
      <!-- 代码显示模式 -->
      <pre 
        v-else-if="renderMode === 'code'"
        class="svg-code-display"><code>{{ originalContent }}</code></pre>
      
      <button 
        class="view-source-btn" 
        @click="toggleSource"
        :title="showSource ? 'Hide code' : 'Show code'">
        {{ showSource ? 'Hide code' : 'Show code' }}
      </button>
      <pre v-if="showSource" class="source-code">{{ originalContent }}</pre>
    </div>
    
    <!-- HTML片段 -->
    <div v-else-if="contentType === 'html-fragment'" class="html-fragment-container">
      <div class="content-type-badge">HTML</div>
      <iframe 
        :srcdoc="htmlWrapperContent"
        class="html-iframe"
        sandbox="allow-same-origin"
        @load="handleIframeLoad($event, 'html')"
        frameborder="0">
      </iframe>
      <button 
        class="view-source-btn" 
        @click="toggleSource"
        :title="showSource ? 'Hide code' : 'Show code'">
        {{ showSource ? 'Hide code' : 'Show code' }}
      </button>
      <pre v-if="showSource" class="source-code">{{ originalContent }}</pre>
    </div>
    
    <!-- 默认Markdown渲染 -->
    <div v-else class="markdown-content" v-html="renderedContent"></div>
  </div>
</template>

<script>
import { contentProcessor } from '../utils/contentProcessor'
import { markdownRenderer } from '../utils/markdownRenderer'

export default {
  name: 'ContentRenderer',
  props: {
    content: {
      type: String,
      default: ''
    },
    modelId: {
      type: String,
      default: ''
    }
  },
  data() {
    return {
      showSource: false,
      renderMode: 'image', // 'image' 或 'code' (for SVG)
      htmlRenderMode: 'preview', // 'preview' 或 'code' (for HTML)
      htmlFragmentRenderMode: 'preview', // 'preview' 或 'code' (for HTML fragments)
      shadowRoot: null,
      shadowRootFragment: null
    }
  },
  computed: {
    isR1Model() {
      console.log('ContentRenderer - checking modelId:', this.modelId)
      const isR1 = this.modelId && this.modelId.toLowerCase().includes('r1')
      console.log('ContentRenderer - isR1Model result:', isR1)
      return isR1
    },
    processedContent() {
      return contentProcessor.processContent(this.content)
    },
    contentType() {
      return this.processedContent.type
    },
    sanitizedContent() {
      return this.processedContent.sanitized
    },
    originalContent() {
      return this.processedContent.content
    },
    supportsShadowDOM() {
      return contentProcessor.supportsShadowDOM()
    },
    renderedContent() {
      if (this.contentType === 'markdown') {
        // For R1 models, process thinking tags before markdown rendering
        if (this.isR1Model) {
          return this.processR1Content(this.content)
        }
        return markdownRenderer.render(this.content)
      }
      return ''
    },
    svgWrapperContent() {
      return this.createSvgWrapper(this.sanitizedContent)
    },
    htmlWrapperContent() {
      return this.createHtmlWrapper(this.sanitizedContent)
    }
  },
  methods: {
    toggleSource() {
      this.showSource = !this.showSource
    },
    
    setRenderMode(mode) {
      this.renderMode = mode
    },
    
    setHtmlRenderMode(mode) {
      this.htmlRenderMode = mode
      // 当切换到预览模式且支持Shadow DOM时，渲染内容
      if (mode === 'preview' && this.supportsShadowDOM && this.contentType === 'html') {
        this.$nextTick(() => {
          this.renderWithShadowDOM()
        })
      }
    },
    
    setHtmlFragmentRenderMode(mode) {
      this.htmlFragmentRenderMode = mode
      // 当切换到预览模式且支持Shadow DOM时，渲染内容
      if (mode === 'preview' && this.supportsShadowDOM && this.contentType === 'html-fragment') {
        this.$nextTick(() => {
          this.renderFragmentWithShadowDOM()
        })
      }
    },
    
    renderWithShadowDOM() {
      if (!this.supportsShadowDOM || !this.$refs.shadowRoot) return
      
      // 清除之前的Shadow DOM
      if (this.shadowRoot) {
        try {
          this.shadowRoot.innerHTML = ''
        } catch (e) {
          console.warn('Failed to clear shadow DOM:', e)
        }
      }
      
      try {
        // 创建Shadow DOM
        this.shadowRoot = this.$refs.shadowRoot.attachShadow({ mode: 'closed' })
        
        // 创建样式隔离
        const style = document.createElement('style')
        style.textContent = `
          :host {
            display: block;
            contain: layout style paint;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
          }
          * {
            box-sizing: border-box;
          }
        `
        this.shadowRoot.appendChild(style)
        
        // 渲染HTML内容
        const contentDiv = document.createElement('div')
        contentDiv.innerHTML = this.sanitizedContent
        this.shadowRoot.appendChild(contentDiv)
        
        console.log('HTML rendered with Shadow DOM')
      } catch (error) {
        console.error('Failed to render with Shadow DOM:', error)
        // 降级到iframe方案
        this.htmlRenderMode = 'iframe-fallback'
      }
    },
    
    renderFragmentWithShadowDOM() {
      if (!this.supportsShadowDOM || !this.$refs.shadowRootFragment) return
      
      // 清除之前的Shadow DOM
      if (this.shadowRootFragment) {
        try {
          this.shadowRootFragment.innerHTML = ''
        } catch (e) {
          console.warn('Failed to clear fragment shadow DOM:', e)
        }
      }
      
      try {
        // 创建Shadow DOM
        this.shadowRootFragment = this.$refs.shadowRootFragment.attachShadow({ mode: 'closed' })
        
        // 创建样式隔离
        const style = document.createElement('style')
        style.textContent = `
          :host {
            display: block;
            contain: layout style paint;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
            padding: 15px;
            background: white;
          }
          * {
            box-sizing: border-box;
          }
        `
        this.shadowRootFragment.appendChild(style)
        
        // 渲染HTML片段内容
        const contentDiv = document.createElement('div')
        contentDiv.innerHTML = this.sanitizedContent
        this.shadowRootFragment.appendChild(contentDiv)
        
        console.log('HTML fragment rendered with Shadow DOM')
      } catch (error) {
        console.error('Failed to render fragment with Shadow DOM:', error)
        // 降级到iframe方案
        this.htmlFragmentRenderMode = 'iframe-fallback'
      }
    },
    
    processR1Content(content) {
      // Process content for R1 models to handle <think> tags
      console.log('processR1Content called with content:', content.substring(0, 200) + '...')
      if (!content) return ''
      
      // Extract thinking parts and regular content separately
      const thinkingRegex = /<think>([\s\S]*?)<\/think>/gi
      const thinkingParts = []
      let match
      
      console.log('Looking for <think> tags in content...')
      
      // Collect all thinking parts
      while ((match = thinkingRegex.exec(content)) !== null) {
        thinkingParts.push(match[1].trim())
        console.log('Found thinking part:', match[1].substring(0, 100) + '...')
      }
      
      // Remove <think> tags to get the regular content (answer)
      const answerContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
      
      // Build the final HTML structure
      let result = ''
      
      // Add thinking processes if they exist
      if (thinkingParts.length > 0) {
        thinkingParts.forEach((thinkingContent, index) => {
          const renderedThinking = markdownRenderer.render(thinkingContent)
          result += `<div class="thinking-process">
            <div class="thinking-header">🤔 思考过程${thinkingParts.length > 1 ? ` (${index + 1})` : ''}</div>
            <div class="thinking-content">${renderedThinking}</div>
          </div>`
        })
      }
      
      // Add the final answer if it exists
      if (answerContent) {
        const renderedAnswer = markdownRenderer.render(answerContent)
        result += `<div class="answer-content">
          <div class="answer-header">💡 最终回答</div>
          <div class="answer-text">${renderedAnswer}</div>
        </div>`
      }
      
      return result || markdownRenderer.render(content)
    },
    
    setRenderMode(mode) {
      this.renderMode = mode
    },
    
    handleIframeLoad(event, contentType) {
      const iframe = event.target
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document
        const height = Math.max(
          iframeDoc.body.scrollHeight,
          iframeDoc.documentElement.scrollHeight
        )
        const maxHeight = contentType === 'svg' ? 400 : 600
        iframe.style.height = Math.min(height + 20, maxHeight) + 'px'
      } catch (e) {
        console.warn('无法调整iframe高度:', e)
        iframe.style.height = contentType === 'svg' ? '300px' : '400px'
      }
    },
    
    createSvgWrapper(svgContent) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { margin: 0; padding: 20px; background: white; }
            svg { max-width: 100%; height: auto; }
          </style>
        </head>
        <body>
          ${svgContent}
        </body>
        </html>
      `
    },
    
    createHtmlWrapper(htmlContent) {
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              margin: 0; 
              padding: 20px; 
              background: white; 
              font-family: Arial, sans-serif;
              line-height: 1.4;
            }
            * {
              max-width: 100%;
              box-sizing: border-box;
            }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
        </html>
      `
    }
  },
  
  mounted() {
    // 如果内容是HTML且默认显示预览，初始化Shadow DOM渲染
    if (this.contentType === 'html' && this.htmlRenderMode === 'preview' && this.supportsShadowDOM) {
      this.$nextTick(() => {
        this.renderWithShadowDOM()
      })
    }
    // 如果内容是HTML片段且默认显示预览，初始化Shadow DOM渲染
    if (this.contentType === 'html-fragment' && this.htmlFragmentRenderMode === 'preview' && this.supportsShadowDOM) {
      this.$nextTick(() => {
        this.renderFragmentWithShadowDOM()
      })
    }
  },
  
  watch: {
    content: {
      handler(newContent) {
        // 当内容变化时，重新渲染Shadow DOM
        if (this.contentType === 'html' && this.htmlRenderMode === 'preview' && this.supportsShadowDOM) {
          this.$nextTick(() => {
            this.renderWithShadowDOM()
          })
        }
        // 当内容变化时，重新渲染HTML片段Shadow DOM
        if (this.contentType === 'html-fragment' && this.htmlFragmentRenderMode === 'preview' && this.supportsShadowDOM) {
          this.$nextTick(() => {
            this.renderFragmentWithShadowDOM()
          })
        }
      },
      immediate: false
    }
  }
}
</script>

<style scoped>
.content-renderer {
  position: relative;
}

/* HTML/SVG内容容器样式 */
.html-content-container,
.svg-content-container,
.html-fragment-container {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  margin: 10px 0;
  position: relative;
}

.content-type-badge {
  background: #4a9ff5;
  color: white;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: bold;
  display: inline-block;
}

/* 渲染模式控制按钮 */
.render-mode-controls {
  display: inline-block;
  margin-left: 10px;
  vertical-align: top;
}

.render-mode-btn {
  background: #6c757d;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
  cursor: pointer;
  margin-right: 4px;
  transition: background-color 0.3s;
}

.render-mode-btn:hover {
  background: #5a6268;
}

.render-mode-btn.active {
  background: #28a745;
}

/* HTML预览容器 */
.html-preview-container {
  margin-top: 10px;
}

.shadow-dom-container {
  min-height: 200px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background: white;
}

.html-source-container {
  margin-top: 10px;
}

/* iframe样式 */
.html-iframe,
.svg-iframe {
  width: 100%;
  min-height: 300px;
  border: none;
  background: white;
  display: block;
}

.html-iframe {
  max-height: 600px;
}

.svg-iframe {
  max-height: 600px;
}

/* HTML片段样式 */
.html-fragment,
.svg-html-fragment {
  padding: 15px;
  background: #fafafa;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  overflow: auto;
  max-height: 600px;
}

.svg-html-fragment {
  text-align: center;
  background: white;
}

.svg-html-fragment svg {
  max-width: 100%;
  height: auto;
  display: inline-block;
}

/* SVG代码显示样式 */
.svg-code-display {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 4px;
  padding: 15px;
  margin: 0;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  overflow-x: auto;
  max-height: 600px;
  overflow-y: auto;
  line-height: 1.4;
  color: #333;
}

/* 查看源码按钮 */
.view-source-btn {
  position: absolute;
  top: 8px;
  right: 50px;
  background: #28a745;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  z-index: 3;
}

.view-source-btn:hover {
  background: #218838;
}

/* 源码显示 */
.source-code {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 4px;
  padding: 10px;
  margin: 10px;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
}

/* Markdown内容样式 */
.markdown-content {
  line-height: 1.5;
}

/* R1思考过程样式 */
.thinking-process {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-left: 4px solid #6f42c1;
  border-radius: 8px;
  margin: 15px 0;
  padding: 0;
  overflow: hidden;
}

.thinking-header {
  background: #6f42c1;
  color: white;
  padding: 8px 15px;
  font-weight: bold;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.thinking-content {
  padding: 15px;
  background: #f8f9fa;
  color: #495057;
  font-style: italic;
  line-height: 1.6;
}

.thinking-content pre {
  background: #e9ecef;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 10px;
  margin: 10px 0;
  overflow-x: auto;
}

.thinking-content code {
  background: #e9ecef;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}

/* R1最终回答样式 */
.answer-content {
  background: #ffffff;
  border: 1px solid #28a745;
  border-left: 4px solid #28a745;
  border-radius: 8px;
  margin: 15px 0;
  padding: 0;
  overflow: hidden;
}

.answer-header {
  background: #28a745;
  color: white;
  padding: 8px 15px;
  font-weight: bold;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.answer-text {
  padding: 15px;
  background: #ffffff;
  color: #212529;
  line-height: 1.6;
}

.answer-text pre {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  padding: 10px;
  margin: 10px 0;
  overflow-x: auto;
}

.answer-text code {
  background: #e9ecef;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 0.9em;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .html-iframe,
  .svg-iframe {
    min-height: 250px;
  }
  
  .view-source-btn {
    position: static;
    margin: 5px;
    display: block;
    width: fit-content;
  }
}
</style>
