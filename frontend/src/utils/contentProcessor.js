/**
 * 内容处理器 - 用于检测和处理不同类型的内容
 */
export const contentProcessor = {
  /**
   * 处理内容并返回类型和处理后的内容
   */
  processContent(content) {
    if (!content) return { type: 'markdown', content: '', sanitized: '' }
    
    const trimmedContent = content.trim()
    
    // 检测完整HTML页面
    if (this.isCompleteHTML(trimmedContent)) {
      return { 
        type: 'html', 
        content: trimmedContent,
        sanitized: this.sanitizeHTML(trimmedContent)
      }
    }
    
    // 检测独立SVG内容（直接的SVG代码，非代码块）
    if (this.isSVGContent(trimmedContent)) {
      return { 
        type: 'svg', 
        content: trimmedContent,
        sanitized: this.sanitizeSVG(trimmedContent)
      }
    }
    
    // 检测HTML片段
    if (this.isHTMLFragment(trimmedContent)) {
      return { 
        type: 'html-fragment', 
        content: trimmedContent,
        sanitized: this.sanitizeHTML(trimmedContent)
      }
    }
    
    // 默认为Markdown
    return { type: 'markdown', content: trimmedContent, sanitized: trimmedContent }
  },

  /**
   * 检测是否为完整HTML页面
   */
  isCompleteHTML(content) {
    // 检测完整HTML页面的特征：必须包含DOCTYPE声明
    const htmlPattern = /^\s*<!DOCTYPE\s+html/i
    const hasHtmlStructure = /<html[\s>]/i.test(content) && /<\/html>/i.test(content)
    const hasBasicStructure = /<head[\s>]/i.test(content) && /<body[\s>]/i.test(content)
    
    // 只有当内容同时满足以下条件才认为是完整HTML页面：
    // 1. 包含DOCTYPE声明
    // 2. 包含html标签对
    // 3. 包含head和body结构
    return htmlPattern.test(content) && hasHtmlStructure && hasBasicStructure
  },

  /**
   * 检测是否为SVG内容
   */
  isSVGContent(content) {
    return /^\s*<svg[\s>]/i.test(content) && /<\/svg>\s*$/i.test(content)
  },

  /**
   * 检测是否为HTML片段
   */
  isHTMLFragment(content) {
    // 如果内容包含Markdown代码块，则不应被识别为HTML片段
    if (content.includes('```')) {
      return false
    }
    
    // 检查是否为完整的HTML页面（有DOCTYPE、html、head、body结构）
    const hasDoctype = /<!DOCTYPE\s+html/i.test(content)
    const hasHtmlStructure = /<html[\s>]/i.test(content) && /<\/html>/i.test(content)
    const hasHeadBody = /<head[\s>]/i.test(content) && /<body[\s>]/i.test(content)
    
    // 如果是完整HTML页面，不作为片段处理
    if (hasDoctype && hasHtmlStructure && hasHeadBody) {
      return false
    }
    
    // 检测HTML标签特征
    const htmlTags = /<\/?[a-z][\s\S]*>/i
    const hasMultipleTags = (content.match(/<[^>]+>/g) || []).length >= 2
    const isNotSingleTag = !(/^<[^>]+\/>$/.test(content.trim()))
    
    // 只有当内容包含多个HTML标签且不是单个自闭合标签时才认为是HTML片段
    return htmlTags.test(content) && hasMultipleTags && isNotSingleTag
  },

  /**
   * HTML安全处理 - 增强版
   */
  sanitizeHTML(content) {
    // 移除潜在危险的标签和属性
    const dangerousTags = /<script[\s\S]*?<\/script>/gi
    const dangerousAttrs = /on\w+\s*=\s*["'][^"']*["']/gi
    const dangerousLinks = /javascript:/gi
    const formTags = /<\/?form[\s\S]*?>/gi
    const inputTags = /<input[\s\S]*?>/gi
    const objectTags = /<\/?object[\s\S]*?>/gi
    const embedTags = /<\/?embed[\s\S]*?>/gi
    const iframeTags = /<\/?iframe[\s\S]*?>/gi
    
    return content
      .replace(dangerousTags, '') // 移除script标签
      .replace(dangerousAttrs, '') // 移除事件处理器
      .replace(dangerousLinks, '#') // 替换javascript链接
      .replace(formTags, '') // 移除form标签
      .replace(inputTags, '') // 移除input标签
      .replace(objectTags, '') // 移除object标签
      .replace(embedTags, '') // 移除embed标签
      .replace(iframeTags, '') // 移除iframe标签
  },

  /**
   * SVG安全处理
   */
  sanitizeSVG(content) {
    const dangerousElements = /<script[\s\S]*?<\/script>/gi
    const dangerousAttrs = /on\w+\s*=\s*["'][^"']*["']/gi
    const foreignObject = /<foreignObject[\s\S]*?<\/foreignObject>/gi
    
    return content
      .replace(dangerousElements, '')
      .replace(dangerousAttrs, '')
      .replace(foreignObject, '') // 移除可能包含HTML的foreignObject
  },

  /**
   * 创建安全的iframe内容
   */
  createIframeContent(content, type) {
    if (type === 'svg') {
      // SVG需要包装在HTML中
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
            }
            svg { 
              max-width: 100%; 
              height: auto; 
              display: block;
              margin: 0 auto;
            }
          </style>
        </head>
        <body>
          ${content}
        </body>
        </html>
      `
    }
    
    // HTML内容直接返回
    return content
  },

  /**
   * 检测是否支持Shadow DOM
   */
  supportsShadowDOM() {
    return 'attachShadow' in Element.prototype
  }
}
