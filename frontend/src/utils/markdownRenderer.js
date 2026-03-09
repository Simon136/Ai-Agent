import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

// HTML安全处理函数
function sanitizeHTMLForPreview(htmlContent) {
  // 移除潜在危险的标签和属性
  return htmlContent
    .replace(/<script[\s\S]*?<\/script>/gi, '') // 移除script标签
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // 移除事件处理器
    .replace(/javascript:/gi, '#') // 替换javascript链接
    .replace(/<\/?form[\s\S]*?>/gi, '') // 移除form标签
    .replace(/<input[\s\S]*?>/gi, '') // 移除input标签
    .replace(/<\/?object[\s\S]*?>/gi, '') // 移除object标签
    .replace(/<\/?embed[\s\S]*?>/gi, '') // 移除embed标签
    .replace(/<\/?iframe[\s\S]*?>/gi, '') // 移除iframe标签
}

/**
 * Markdown渲染器配置
 */
export const markdownRenderer = (() => {
  // 创建 Markdown 解析器实例
  const md = new MarkdownIt({
    html: false,       // 禁用HTML标签解析 - 确保HTML代码显示为代码而不是渲染
    linkify: true,      // 自动转换链接
    typographer: true,  // 美化排版
    breaks: true,        // 转换换行符为 <br>
    highlight: function (str, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang }).value}</code></pre>`
        } catch (__) {}
      }
      return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
    }
  })

  // 自定义代码块渲染
  const defaultFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
  }

  md.renderer.rules.fence = function(tokens, idx, options, env, self) {
    const token = tokens[idx]
    const code = token.content
    let lang = token.info.trim().toLowerCase()
    
    // 添加简单行号的辅助函数 - 使用左右分栏布局，过滤空行
    const addSimpleLineNumbers = (htmlCode) => {
      const lines = htmlCode.split('\n')
      
      // 去除末尾的空行
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop()
      }
      
      // 如果没有内容，返回空
      if (lines.length === 0) {
        return ''
      }
      
      // 过滤掉中间的完全空行，但保留有内容的行
      const filteredLines = lines.filter(line => line.trim() !== '')
      
      return filteredLines.map((line, index) => {
        const lineNumber = index + 1
        return `<span class="simple-line"><span class="simple-number">${lineNumber}</span><span class="simple-code">${line}</span></span>`
      }).join('\n')
    }
    
    // 特殊处理HTML代码块 - 支持代码/渲染切换
    if (lang === 'html') {
      const escapedCode = md.utils.escapeHtml(code)
      const numberedCode = addSimpleLineNumbers(escapedCode)
      const htmlId = 'html_' + Math.random().toString(36).substr(2, 9)
      
      // 安全处理HTML内容
      const sanitizedHtml = sanitizeHTMLForPreview(code)
      
      return `<div class="html-code-display" id="${htmlId}">
        <div class="html-display-controls">
          <span class="content-type-badge">HTML</span>
          <div class="html-mode-controls">
            <button class="html-mode-btn active" onclick="showHtmlCode('${htmlId}')" title="显示代码">
              📝 Code
            </button>
            <button class="html-mode-btn" onclick="showHtmlPreview('${htmlId}')" title="HTML预览">
              🌐 HTML
            </button>
          </div>
          <button class="copy-code-btn" data-code="${encodeURIComponent(code)}">Copy</button>
        </div>
        
        <!-- HTML代码显示 -->
        <div class="html-code-container" style="display: block;">
          <div class="html-code-frame">
            <pre><code>${numberedCode}</code></pre>
          </div>
        </div>
        
        <!-- HTML预览显示 -->
        <div class="html-preview-container" style="display: none;">
          <div class="html-preview-frame">
            <div class="html-preview-content" data-html="${encodeURIComponent(sanitizedHtml)}">
              <!-- HTML内容将在这里动态渲染 -->
            </div>
          </div>
        </div>
      </div>`
    }
    
    // 特殊处理SVG代码块 - 同时显示图像和代码，支持切换
    if (lang === 'svg') {
      const escapedCode = md.utils.escapeHtml(code)
      const numberedCode = addSimpleLineNumbers(escapedCode)
      const svgId = 'svg_' + Math.random().toString(36).substr(2, 9)
      
      return `<div class="svg-code-display" id="${svgId}">
        <div class="svg-display-controls">
          <span class="content-type-badge">SVG</span>
          <div class="svg-mode-controls">
            <button class="svg-mode-btn active" onclick="showSvgImage('${svgId}')" title="显示图像">
              图像显示
            </button>
            <button class="svg-mode-btn" onclick="showSvgCode('${svgId}')" title="显示代码">
              代码显示
            </button>
          </div>
          <button class="copy-code-btn" data-code="${encodeURIComponent(code)}">Copy</button>
        </div>
        
        <!-- SVG图像显示 -->
        <div class="svg-image-container" style="display: block;">
          <div class="svg-render-frame">
            ${code}
          </div>
        </div>
        
        
        <!-- SVG代码显示 -->
        <div class="svg-code-container" style="display: none;">
          <div class="html-code-frame">
            <pre><code>${numberedCode}</code></pre>
          </div>
        </div>
      </div>`
    }
    
    // 自动识别 Python 特征
    if (!lang && (
      code.trim().startsWith('import ') || 
      code.trim().startsWith('def ') || 
      code.trim().startsWith('class ') ||
      code.trim().startsWith('from ')
    )) {
      lang = 'python'
    }
    
    // 自动识别 JavaScript 特征
    if (!lang && (
      code.includes('function ') ||
      code.includes('const ') ||
      code.includes('let ') ||
      code.includes('var ') ||
      code.includes('=>')
    )) {
      lang = 'javascript'
    }

    if (lang && hljs.getLanguage(lang)) {
      const highlightedCode = hljs.highlight(code, { language: lang }).value
      // 移除特殊的 python-black 类，统一使用黑色主题
      const numberedCode = addSimpleLineNumbers(highlightedCode)
      
      // 创建语言标签显示名称
      const langDisplayName = {
        'python': 'py',
        'javascript': 'js',
        'typescript': 'ts',
        'html': 'html',
        'css': 'css',
        'json': 'json',
        'sql': 'sql',
        'bash': 'bash',
        'shell': 'sh'
      }[lang] || lang.toUpperCase()
      
      return `<div class="code-block-with-copy">
        <div class="code-language-tag">${langDisplayName}</div>
        <button class="copy-code-btn" data-code="${encodeURIComponent(code)}">Copy</button>
        <pre class="hljs" style="line-height: 0.9;"><code>${numberedCode}</code></pre>
      </div>`
    }    // 其他语言按默认处理
    return defaultFence(tokens, idx, options, env, self)
  }

  // 自定义链接渲染（安全处理）
  md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
    const token = tokens[idx]
    const href = token.attrGet('href')
    
    // 安全处理外部链接
    if (href && !href.startsWith('#') && !href.startsWith('/')) {
      token.attrSet('target', '_blank')
      token.attrSet('rel', 'noopener noreferrer')
    }
    
    return self.renderToken(tokens, idx, options)
  }

  return {
    /**
     * 渲染Markdown文本
     */
    render(text) {
      if (!text) return ''
      return md.render(text)
    },

    /**
     * 渲染内联Markdown
     */
    renderInline(text) {
      if (!text) return ''
      return md.renderInline(text)
    },

    /**
     * 获取Markdown解析器实例
     */
    getInstance() {
      return md
    }
  }
})()

// 用于在其他文件中直接使用的便捷函数
export function renderMarkdown(text) {
  return markdownRenderer.render(text)
}

export function renderInlineMarkdown(text) {
  return markdownRenderer.renderInline(text)
}

// HTML显示模式切换函数
window.showHtmlCode = function(htmlId) {
  const container = document.getElementById(htmlId)
  if (!container) return
  
  const codeContainer = container.querySelector('.html-code-container')
  const previewContainer = container.querySelector('.html-preview-container')
  const codeBtnContainer = container.querySelector('.html-mode-btn[onclick*="showHtmlCode"]')
  const previewBtnContainer = container.querySelector('.html-mode-btn[onclick*="showHtmlPreview"]')
  
  if (codeContainer && previewContainer) {
    codeContainer.style.display = 'block'
    previewContainer.style.display = 'none'
    
    if (codeBtnContainer && previewBtnContainer) {
      codeBtnContainer.classList.add('active')
      previewBtnContainer.classList.remove('active')
    }
  }
}

window.showHtmlPreview = function(htmlId) {
  const container = document.getElementById(htmlId)
  if (!container) return
  
  const codeContainer = container.querySelector('.html-code-container')
  const previewContainer = container.querySelector('.html-preview-container')
  const codeBtnContainer = container.querySelector('.html-mode-btn[onclick*="showHtmlCode"]')
  const previewBtnContainer = container.querySelector('.html-mode-btn[onclick*="showHtmlPreview"]')
  
  if (codeContainer && previewContainer) {
    codeContainer.style.display = 'none'
    previewContainer.style.display = 'block'
    
    if (codeBtnContainer && previewBtnContainer) {
      codeBtnContainer.classList.remove('active')
      previewBtnContainer.classList.add('active')
    }
    
    // 渲染HTML内容
    const previewContent = previewContainer.querySelector('.html-preview-content')
    if (previewContent && previewContent.dataset.html) {
      try {
        const htmlContent = decodeURIComponent(previewContent.dataset.html)
        
        // 检查是否支持Shadow DOM
        if ('attachShadow' in Element.prototype) {
          // 清除之前的Shadow DOM
          if (previewContent.shadowRoot) {
            previewContent.shadowRoot.innerHTML = ''
          } else {
            try {
              const shadowRoot = previewContent.attachShadow({ mode: 'open' })
              
              // 添加基础样式
              const style = document.createElement('style')
              style.textContent = `
                :host {
                  display: block;
                  padding: 15px;
                  background: white;
                  border-radius: 4px;
                  font-family: Arial, sans-serif;
                  line-height: 1.4;
                }
                * {
                  box-sizing: border-box;
                  max-width: 100%;
                }
              `
              shadowRoot.appendChild(style)
              
              // 渲染HTML内容
              const contentDiv = document.createElement('div')
              contentDiv.innerHTML = htmlContent
              shadowRoot.appendChild(contentDiv)
            } catch (e) {
              console.warn('Shadow DOM creation failed, using innerHTML:', e)
              previewContent.innerHTML = htmlContent
            }
          }
        } else {
          // 降级到innerHTML
          previewContent.innerHTML = htmlContent
        }
      } catch (e) {
        console.error('Failed to render HTML preview:', e)
        previewContent.innerHTML = '<p style="color: red;">HTML渲染失败</p>'
      }
    }
  }
}

// SVG显示模式切换函数
window.showSvgImage = function(svgId) {
  const container = document.getElementById(svgId)
  if (!container) return
  
  const imageContainer = container.querySelector('.svg-image-container')
  const codeContainer = container.querySelector('.svg-code-container')
  const imageBtnContainer = container.querySelector('.svg-mode-btn[onclick*="showSvgImage"]')
  const codeBtnContainer = container.querySelector('.svg-mode-btn[onclick*="showSvgCode"]')
  
  if (imageContainer && codeContainer) {
    imageContainer.style.display = 'block'
    codeContainer.style.display = 'none'
    
    if (imageBtnContainer && codeBtnContainer) {
      imageBtnContainer.classList.add('active')
      codeBtnContainer.classList.remove('active')
    }
  }
}

window.showSvgCode = function(svgId) {
  const container = document.getElementById(svgId)
  if (!container) return
  
  const imageContainer = container.querySelector('.svg-image-container')
  const codeContainer = container.querySelector('.svg-code-container')
  const imageBtnContainer = container.querySelector('.svg-mode-btn[onclick*="showSvgImage"]')
  const codeBtnContainer = container.querySelector('.svg-mode-btn[onclick*="showSvgCode"]')
  
  if (imageContainer && codeContainer) {
    imageContainer.style.display = 'none'
    codeContainer.style.display = 'block'
    
    if (imageBtnContainer && codeBtnContainer) {
      imageBtnContainer.classList.remove('active')
      codeBtnContainer.classList.add('active')
    }
  }
}
