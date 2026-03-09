<template>
  <div class="nested-app">
    <!-- 顶部栏 -->
    <div class="top-bar">
      <div class="apm-title">
        <img src="/logo.png" alt="APM" class="apm-logo" />
      </div>
      <div class="menu-toggle"
           @click="toggleMenu"
           :title="isMenuCollapsed ? 'Show Menu' : 'Hide Menu'">
        <!-- <div class="hamburger-icon" :class="{ 'open': !isMenuCollapsed }"></div>
        <div class="hamburger-icon" :class="{ 'open': !isMenuCollapsed }"></div>
        <div class="hamburger-icon" :class="{ 'open': !isMenuCollapsed }"></div> -->
        <div class="hamburger-icon"></div>
        <div class="hamburger-icon"></div>
        <div class="hamburger-icon"></div>
      </div>
      <div class="toggle-container">
        <div
          v-for="view in views"
          :key="view.id"
          class="toggle-item"
          :class="{ 'active': currentView === view.id }"
          @click="changeView(view.id)"
        >
          <img :src="view.img" :alt="view.alt" :style="view.imgStyle" />
        </div>
      </div>
      <div class="action-buttons">
        <!-- 用户信息显示在右上角 -->
        <div class="user-info-top">
          <div
            class="user-name"
            :class="{ 'highlight': userNameHover }"
            @mouseenter="userNameHover = true"
            @mouseleave="userNameHover = false"
            @click="toggleLogout"
            tabindex="0"
          >
            {{ account && account.name ? account.name : '无认证信息' }}
            <transition name="fade">
              <button
                v-if="showLogout"
                class="logout-btn"
                @click.stop="logout"
              >退出账号</button>
            </transition>
          </div>
        </div>
      </div>
    </div>

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 左侧菜单栏 -->
      <div class="side-menu" :class="{ 'collapsed': isMenuCollapsed }">
        <button class="new-session-btn" @click="newSession">
          <img src="/plus.png" alt="plus" class="plus-icon" />
          New Chat
        </button>
        <div class="conversation-list">
          <div v-for="(item, index) in conversations"
               :key="item.id"
               class="conversation-item"
               :class="{ 'active': activeConversation === item.id }"
               @click="selectConversation(item.id)">
            <template v-if="editIndex === index">
              <input
                v-model="editTitle"
                @blur="saveTitle(item, index)"
                @keyup.enter="saveTitle(item, index)"
                class="edit-title-input"
                autofocus
              />
            </template>
            <template v-else>
              <div class="conversation-main">
                <img src="/chat.png" alt="chat" class="chat-icon" />
                <span 
                  @dblclick="startEditTitle(item, index)"
                  :title="item.title"
                >{{ truncateTitle(item.title) }}</span>
              </div>
              <div class="conversation-actions" v-if="activeConversation === item.id">
                <button
                  class="icon-btn"
                  @click.stop="startEditTitle(item, index)"
                  title="Edit Chat"
                >
                  <svg class="edit-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
                <button
                  class="share-btn"
                  @click.stop="shareConversation(item.id)"
                  title="Share Chat"
                >
                  <svg class="share-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18 16c-.8 0-1.5.3-2 .8l-6.4-3.6c0-.1 0-.3 0-.4s0-.3 0-.4L16 8.8c.5.4 1.2.7 2 .7 1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3c0 .1 0 .3 0 .4L8.6 10.4C8.1 10 7.4 9.7 6.6 9.7c-1.7 0-3 1.3-3 3s1.3 3 3 3c.8 0 1.5-.3 2-.8l6.4 3.6c0 .1 0 .3 0 .4 0 1.7 1.3 3 3 3s3-1.3 3-3-1.3-3-3-3z"/>
                  </svg>
                </button>
                <button
                  class="icon-btn delete-btn-with-icon"
                  @click.stop="askDeleteConversation(item.id)"
                  title="Delete Chat"
                >
                  <svg class="delete-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                  </svg>
                </button>
              </div>
            </template>
          </div>
        </div>

      </div>

      <!-- 右侧内容区 -->
      <div class="content-area">
        <QuestionAnswerView
          v-if="activeConversation && account && account.idTokenClaims && account.idTokenClaims.oid"
          ref="qav"
          :conversation-id=activeConversation
          :view-type="currentView"
          :user-id="account.idTokenClaims.oid"
          @update-title="handleUpdateTitle"
          @load-conversation="handleLoadConversation"
          @models-changed="handleModelsChanged"
        />
        <div v-else class="empty-state">
          Please select or create a chat
        </div>
      </div>
    </div>
  </div>
  <div v-if="showDeleteConfirm" class="delete-confirm-dialog">
    <div>Delete this chat?</div>
    <div style="margin-top:16px; text-align:right;">
      <button @click="showDeleteConfirm = false" class="cancel-btn">No</button>
      <button @click="confirmDeleteConversation" class="confirm-btn">Yes</button>
    </div>
  </div>
</template>

<script>
import QuestionAnswerView from './QuestionAnswerView.vue'
import { getConversations, getConversation, createConversation, updateConversationName, clearSession, getCustomMetadata, deleteConversation, saveUserConverstions, saveUserSelections} from '../api/api'
import { markdownRenderer } from '../utils/markdownRenderer'

export default {
  name: 'NestedApp',
  emits: ['logout'],
  components: {
    QuestionAnswerView
  },
  props: {
    account: Object
  },
  watch: {
    // 监听account对象的变化
    account: {
      handler: function(newAccount, oldAccount) {
        console.log('Account changed:', { newAccount, oldAccount });
        
        if (newAccount && newAccount.idTokenClaims && newAccount.idTokenClaims.oid) {
          console.log('Account is now available, loading conversations...');
          this.loadConversationsOnAccountChange();
        } else {
          console.log('Account is not available, clearing conversations');
          this.conversations = [];
          this.activeConversation = null;
        }
      },
      deep: true,
      immediate: false
    }
  },
  data() {
    return {
      isMenuCollapsed: false,
      activeConversation: null,
      currentView: 1,
      views: [
        { id: 1, img: '/one_view.png', alt: '视图1', imgStyle: { height: '30px', width: 'auto' } },
        { id: 2, img: '/two_view.png', alt: '视图2', imgStyle: { height: '30px', width: 'auto' } },
        { id: 3, img: '/three_view.png', alt: '视图3', imgStyle: { height: '30px', width: 'auto' } }
      ],
      conversations: [],
      editIndex: null,
      editTitle: '',
      showLogout: false,
      userNameHover: false,
      showDeleteConfirm: false,
      deleteTargetId: null
    }
  },
  methods: {
    // 截取会话标题，如果超过6个字符则显示省略号
    truncateTitle(title) {
      if (!title) return '';
      return title.length > 6 ? title.substring(0, 6) + '...' : title;
    },
    
    // 清理文件名，移除不安全字符
    sanitizeFilename(filename) {
      if (!filename) return 'untitled';
      // 移除不安全的文件名字符，保留中文、英文、数字、空格、短横线、下划线
      return filename
        .replace(/[<>:"/\\|?*]/g, '') // 移除Windows不允许的字符
        .replace(/\s+/g, '-') // 将空格替换为短横线（更美观）
        .replace(/\.\.\.$/, '') // 移除末尾的省略号（避免文件名混淆）
        .slice(0, 30); // 限制长度，适合截取后的标题
    },
    
    async loadConversationsOnAccountChange() {
      if (!this.account || !this.account.idTokenClaims || !this.account.idTokenClaims.oid) {
        console.error('Account change handler: User not authenticated');
        return;
      }
      
      console.log('=== Loading conversations due to account change ===');
      const userId = this.account.idTokenClaims.oid;
      console.log('User ID:', userId);
      
      // 获取用户自定义元数据
      let lastConversationId = null;
      try {
        const res = await getCustomMetadata(userId);
        console.log('Custom metadata response:', res);
        
        // 注意：后端返回的结构是 { data: { view_type, selected_models, ... } }
        const userPreferences = res.data?.data || res.data;
        
        if (userPreferences) {
          // 立即设置视图类型 - 这是最重要的恢复逻辑
          if (userPreferences.view_type) {
            console.log('恢复用户视图类型:', userPreferences.view_type);
            this.currentView = userPreferences.view_type;
          }
          
          // 设置上次选择的会话ID
          if (userPreferences.current_conversation_id) {
            lastConversationId = userPreferences.current_conversation_id;
          } else if (userPreferences.conversation_id) {
            lastConversationId = userPreferences.conversation_id;
          }
          
          console.log('加载用户偏好设置:', {
            view_type: userPreferences.view_type,
            selected_models: userPreferences.selected_models,
            conversation_id: userPreferences.conversation_id,
            current_conversation_id: userPreferences.current_conversation_id,
            lastConversationId: lastConversationId
          });
        }
      } catch (e) {
        console.warn('获取自定义视图失败，使用默认视图1', e);
        this.currentView = 1;
      }
      
      // 加载对话列表
      await this.loadConversations();
      
      // 选择对话
      if (this.conversations.length > 0) {
        const found = lastConversationId && this.conversations.find(c => c.id === lastConversationId);
        if (found) {
          console.log('✅ Selecting last conversation:', lastConversationId);
          this.selectConversation(lastConversationId);
        } else {
          console.log('✅ Selecting first conversation:', this.conversations[0].id);
          this.selectConversation(this.conversations[0].id);
        }
      } else {
        console.log('❌ No conversations found after account change');
      }
      
      // 用户偏好设置加载完成后，等待一会儿再通知子组件更新
      this.$nextTick(() => {
        console.log('📤 通知子组件用户偏好设置已加载完成');
        this.$emit('preferences-loaded');
      });
    },
    
    handleUpdateTitle(newTitle) {
      console.log('Handling title update:', newTitle);
      
      // 存储完整标题，不在这里截取
      const conv = this.conversations.find(c => c.id === this.activeConversation);
      if (conv) {
        conv.title = newTitle;
        console.log('Updated conversation title to:', newTitle);
      } else {
        console.warn('Could not find conversation to update title');
      }
    },
    
    // 处理子组件请求加载特定会话
    handleLoadConversation(conversationId) {
      console.log('收到子组件请求加载会话:', conversationId);
      if (conversationId && conversationId !== this.activeConversation) {
        this.selectConversation(conversationId);
      }
    },
    
    // 处理子组件模型选择变更
    async handleModelsChanged(selectedModels) {
      console.log('📥 收到子组件模型选择变更:', selectedModels);
      console.log('📋 当前父组件状态:', {
        currentView: this.currentView,
        activeConversation: this.activeConversation,
        account: this.account?.idTokenClaims?.oid
      });
      
      // 避免在页面刷新初始化期间保存空的模型列表
      if (!selectedModels || selectedModels.length === 0) {
        console.log('⚠️ 跳过保存空的模型列表');
        return;
      }
      
      // 防止保存默认模型覆盖用户真正的选择
      // 如果收到的是默认模型，并且当前有子组件的模型选择，先验证一下
      if (selectedModels.length === 1 && selectedModels[0] === 'DeepSeek-R1') {
        console.log('⚠️ 检测到默认模型，延迟保存以确保不覆盖用户真正的选择');
      }
      
      // 子组件模型变更时，延迟保存以确保状态稳定
      setTimeout(async () => {
        try {
          await this.saveCurrentUserPreferences();
        } catch (e) {
          console.warn('❌ 保存模型偏好失败:', e);
        }
      }, 300); // 增加延迟时间，确保状态稳定
    },
    // 删除会话
    askDeleteConversation(id) {
      // console.log('askDeleteConversation:', id);
      this.deleteTargetId = id;
      this.showDeleteConfirm = true;
    },
    
    // 分享会话
    async shareConversation(conversationId) {
      try {
        console.log('分享会话:', conversationId);
        
        // 检查会话ID是否有效
        if (!conversationId) {
          alert('无效的会话ID');
          return;
        }
        
        // 首先从当前会话列表中获取标题
        const conversationItem = this.conversations.find(c => c.id === conversationId);
        let conversationTitle = conversationItem ? conversationItem.title : null;
        
        console.log('从会话列表获取的标题:', conversationTitle);
        
        // 获取会话详细信息
        const response = await getConversation(conversationId);
        
        // 检查响应数据
        if (!response || !response.data) {
          alert('无法获取会话数据');
          return;
        }
        
        console.log('Share conversation response:', response);
        console.log('Response data structure:', {
          hasTitle: !!(response.data && response.data.title),
          hasDataTitle: !!(response.data && response.data.data && response.data.data.title),
          title: response.data?.title,
          dataTitle: response.data?.data?.title,
          fullResponseData: response.data
        });
        
        // 使用与 selectConversation 相同的数据结构检查逻辑
        let messagesData = null;
        if (response.data && response.data.data && response.data.data.messages) {
          // 新结构: res.data.data.messages
          messagesData = response.data.data.messages;
          console.log('✅ Using nested message structure for sharing (res.data.data.messages)');
        } else if (response.data && response.data.messages) {
          // 旧结构: res.data.messages
          messagesData = response.data.messages;
          console.log('✅ Using direct message structure for sharing (res.data.messages)');
        } else if (response.data && response.data.data && Array.isArray(response.data.data)) {
          // 如果res.data.data直接是消息数组
          messagesData = response.data.data;
          console.log('✅ Using direct data array structure for sharing');
        } else {
          console.error('❌ Cannot find messages in conversation response for sharing');
          console.error('Response structure:', response.data);
          messagesData = [];
        }
        
        // 检查消息数据
        if (!messagesData || messagesData.length === 0) {
          alert('该会话暂无聊天记录');
          return;
        }
        
        // 生成HTML内容
        // 优先使用会话列表中的标题，然后是API响应中的标题，最后是默认标题
        let originalTitle = conversationTitle || 
                           response.data.title || 
                           response.data.data?.title || 
                           `会话 ${conversationId}`;
        
        console.log('标题选择优先级:', {
          conversationTitle,
          apiTitle: response.data.title,
          apiDataTitle: response.data.data?.title,
          finalOriginalTitle: originalTitle
        });
        
        // 现在originalTitle是完整标题，我们需要截取用于显示
        const truncatedTitle = this.truncateTitle(originalTitle);
        
        const htmlContent = this.generateConversationHTML({
          messages: messagesData,
          title: truncatedTitle,
          conversation_id: conversationId
        });
        
        // 创建并下载HTML文件，使用截取后的会话标题作为文件名
        const safeTitle = this.sanitizeFilename(truncatedTitle);
        const timestamp = new Date().toISOString().split('T')[0];
        const filename = `${safeTitle}_${timestamp}.html`;
        this.downloadHTML(htmlContent, filename);
        
        // 显示成功提示
        console.log(`会话已成功导出为: ${filename}`);
        console.log(`原始标题: ${originalTitle}`);
        console.log(`截取后标题: ${truncatedTitle}`);
        
      } catch (error) {
        console.error('分享会话失败:', error);
        alert('分享失败，请重试。错误: ' + error.message);
      }
    },
    
    // 生成会话HTML内容
    generateConversationHTML(conversation) {
      const messages = conversation.messages || [];
      const title = this.escapeHtml(conversation.title || `Chat ${conversation.conversation_id || 'Unknown'}`);
      
      // 如果没有消息，显示空会话提示
      if (messages.length === 0) {
        return this.generateEmptyConversationHTML(title);
      }
      
      // 按消息顺序排序
      const sortedMessages = messages.sort((a, b) => (a.message_order || 0) - (b.message_order || 0));
      
      // 转换为对话格式
      const qaList = this.convertMessagesToQA(sortedMessages);
      
      // 如果转换后没有有效的QA对，显示空会话提示
      if (qaList.length === 0) {
        return this.generateEmptyConversationHTML(title);
      }
      
      // 收集所有使用的模型
      const allModels = new Set();
      qaList.forEach(qa => {
        Object.keys(qa.answers).forEach(model => {
          if (qa.answers[model] && qa.answers[model].trim()) {
            allModels.add(model);
          }
        });
      });
      
      const modelArray = Array.from(allModels);
      
      let htmlContent = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .chat-container {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .chat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid #4a9ff5;
            padding-bottom: 15px;
            margin-bottom: 25px;
            flex-wrap: wrap;
            gap: 15px;
        }
        .chat-title {
            color: #333;
            margin: 0;
            font-size: 1.5em;
        }
        .model-selector {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .model-selector label {
            font-size: 0.9em;
            color: #666;
            margin-right: 10px;
        }
        .model-btn {
            background: #e9ecef;
            border: 2px solid #dee2e6;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 0.85em;
            cursor: pointer;
            transition: all 0.2s;
            color: #495057;
            font-weight: 500;
        }
        .model-btn:hover {
            background: #dee2e6;
        }
        .model-btn.active {
            background: #4a9ff5;
            border-color: #4a9ff5;
            color: white;
        }
        .model-btn.deepseek.active { background: #4a9ff5; border-color: #4a9ff5; }
        .model-btn.qwen.active { background: #ff9800; border-color: #ff9800; }
        .model-btn.gpt.active { background: #9c27b0; border-color: #9c27b0; }
        .qa-item {
            margin-bottom: 30px;
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
        }
        .question {
            background-color: #f8f9fa;
            padding: 15px;
            border-bottom: 1px solid #e0e0e0;
            font-weight: 500;
        }
        .answers {
            padding: 0;
        }
        .answer-item {
            border-bottom: 1px solid #f0f0f0;
            display: none;
            position: relative;
        }
        .answer-item:last-child {
            border-bottom: none;
        }
        .answer-item.visible {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        .model-name {
            font-weight: bold;
            color: #4a9ff5;
            font-size: 0.9em;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 15px 8px 15px;
            background-color: #fff;
            border-bottom: 1px solid #f0f0f0;
            position: sticky;
            top: 0;
            z-index: 10;
            margin: 0;
        }
        .toggle-raw-btn {
            background: none;
            border: 1px solid #ddd;
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 12px;
            cursor: pointer;
            color: #666;
            transition: all 0.2s;
        }
        .toggle-raw-btn:hover {
            background: #f8f9fa;
            border-color: #4a9ff5;
            color: #4a9ff5;
        }
        .answer-content {
            line-height: 1.5;
            padding: 0 15px 15px 15px;
            flex: 1;
            overflow-y: auto;
            max-height: 400px;
        }
        .answer-content.markdown-content {
            white-space: normal;
        }
        /* 强制所有代码块为黑底白字 - 导出专用 */
        .answer-content.markdown-content pre,
        .answer-content.markdown-content pre[class*="language-"],
        .answer-content.markdown-content .code-block-with-copy,
        .answer-content.markdown-content .hljs {
            background: #1e1e1e !important;
            color: #f8f8f2 !important;
        }
        .answer-content.markdown-content pre {
            background: #1e1e1e !important;
            color: #f8f8f2 !important;
            border-radius: 6px;
            padding: 16px 0;
            margin: 10px 0;
            font-size: 14px;
            line-height: 1.3;
            white-space: pre;
            overflow-x: auto;
            overflow-y: hidden;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
            border: 1px solid #333;
            position: relative;
            display: flex;
            flex-direction: column;
            max-width: 100%;
        }
        .answer-content.markdown-content .code-block-with-copy pre {
            background: #1e1e1e !important;
            color: #f8f8f2 !important;
            border-radius: 6px;
            padding: 16px 0;
            margin: 0;
            font-size: 14px;
            line-height: 1.3;
            white-space: pre;
            overflow-x: auto;
            overflow-y: hidden;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
            border: 1px solid #333;
            position: relative;
            display: flex;
            flex-direction: column;
            max-width: 100%;
        }
        .answer-content.markdown-content pre code,
        .answer-content.markdown-content .code-block-with-copy pre code {
            display: flex;
            flex-direction: column;
            padding: 0;
            background: transparent;
            border-radius: 0;
            color: #f8f8f2; /* 确保代码文字为白色 */
            overflow-x: auto;
            overflow-y: hidden;
            max-width: 100%;
        }
        /* 简洁行号样式 - GitHub风格左右分栏布局 */
        .answer-content.markdown-content .simple-line {
            display: flex;
            line-height: 1.3;
            min-height: 1.3em;
            margin: 0;
            padding: 0;
        }
        .answer-content.markdown-content .simple-number {
            flex-shrink: 0;
            width: 40px;
            text-align: right;
            padding: 0 16px 0 8px;
            color: #6e7681; /* 行号颜色适配黑底 */
            font-size: 12px;
            user-select: none;
            background: transparent;
            border: none;
            line-height: 1.3;
            box-sizing: border-box;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
        }
        .answer-content.markdown-content .simple-code {
            flex: 1;
            padding: 0;
            line-height: 1.3;
            white-space: pre;
            overflow: visible;
            margin: 0;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
            word-wrap: normal;
            min-width: max-content;
            color: #f8f8f2 !important;
        }
        /* 为空行保持正确的高度 */
        .answer-content.markdown-content code {
            background: #333; /* 内联代码改为深色背景 */
            color: #f8f8f2; /* 内联代码白色文字 */
            padding: 2px 4px;
            border-radius: 3px;
            font-size: 0.9em;
            line-height: 1.3; /* 内联代码使用1.3行间距 */
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
        }
        .answer-content.markdown-content pre code {
            display: flex;
            flex-direction: column;
            padding: 0;
            background: transparent !important;
            border-radius: 0;
            color: #f8f8f2 !important; /* 确保代码块文字为白色 */
            overflow-x: auto;
            overflow-y: hidden;
            max-width: 100%;
            line-height: 1.3 !important; /* 确保代码内容行间距 */
        }
        
        /* 确保所有代码相关元素都使用1.3行间距 */
        .answer-content.markdown-content .hljs,
        .answer-content.markdown-content .code-block-with-copy,
        .answer-content.markdown-content .code-block-with-copy .hljs {
            line-height: 1.3 !important;
        }
        
        /* 强制覆盖任何内联样式 - 确保与页面显示区别化 */
        .answer-content.markdown-content pre[style*="line-height"] {
            line-height: 1.3 !important;
        }
        .answer-content.markdown-content code[style*="line-height"] {
            line-height: 1.3 !important;
        }
        .answer-content.markdown-content *[class*="simple-"] {
            line-height: 1.3 !important;
        }
        
        /* 最终强制覆盖 - 确保所有代码块元素都使用统一行间距 */
        .answer-content pre *,
        .answer-content code *,
        .answer-content .hljs *,
        .answer-content .code-block-with-copy *,
        .answer-content [class*="simple-"] {
            line-height: 1.3 !important;
        }
        
        /* 自定义滚动条样式 - 与页面显示一致 */
        .answer-content.markdown-content pre::-webkit-scrollbar {
            height: 8px;
        }
        .answer-content.markdown-content pre::-webkit-scrollbar-track {
            background: #161b22;
            border-radius: 4px;
        }
        .answer-content.markdown-content pre::-webkit-scrollbar-thumb {
            background: #30363d;
            border-radius: 4px;
            border: 1px solid #21262d;
        }
        .answer-content.markdown-content pre::-webkit-scrollbar-thumb:hover {
            background: #484f58;
        }
        /* 为Firefox浏览器提供滚动条样式 */
        .answer-content.markdown-content pre {
            scrollbar-width: thin;
            scrollbar-color: #30363d #161b22;
        }
        .answer-content.markdown-content blockquote {
            border-left: 4px solid #ddd;
            margin: 10px 0;
            padding: 0 15px;
            color: #666;
        }
        .answer-content.markdown-content h1,
        .answer-content.markdown-content h2,
        .answer-content.markdown-content h3,
        .answer-content.markdown-content h4,
        .answer-content.markdown-content h5,
        .answer-content.markdown-content h6 {
            margin: 15px 0 10px 0;
            color: #333;
        }
        .answer-content.markdown-content ul,
        .answer-content.markdown-content ol {
            margin: 10px 0;
            padding-left: 20px;
        }
        .answer-content.markdown-content li {
            margin: 5px 0;
        }
        .answer-content.markdown-content a {
            color: #4a9ff5;
            text-decoration: none;
        }
        .answer-content.markdown-content a:hover {
            text-decoration: underline;
        }
        .answer-content.markdown-content table {
            border-collapse: collapse;
            width: 100%;
            margin: 10px 0;
        }
        .answer-content.markdown-content th,
        .answer-content.markdown-content td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        .answer-content.markdown-content th {
            background-color: #f8f9fa;
            font-weight: bold;
        }
        /* 代码块高亮样式 - 黑色主题 */
        /* 确保所有代码块都是黑底白字 */
        .answer-content.markdown-content pre,
        .answer-content.markdown-content .code-block-with-copy pre,
        .answer-content.markdown-content .hljs {
            background: #1e1e1e !important;
            color: #f8f8f2 !important;
        }
        .answer-content.markdown-content .hljs,
        .answer-content.markdown-content .code-block-with-copy .hljs {
            color: #f8f8f2;
            background: transparent;
            padding: 0;
        }
        /* 直接应用于高亮元素，不依赖line-content包装器 */
        .answer-content.markdown-content .hljs-keyword,
        .answer-content.markdown-content .code-block-with-copy .hljs-keyword {
            color: #ff79c6;
        }
        .answer-content.markdown-content .hljs-string,
        .answer-content.markdown-content .code-block-with-copy .hljs-string {
            color: #f1fa8c;
        }
        .answer-content.markdown-content .hljs-comment,
        .answer-content.markdown-content .code-block-with-copy .hljs-comment {
            color: #6272a4;
        }
        .answer-content.markdown-content .hljs-number,
        .answer-content.markdown-content .code-block-with-copy .hljs-number {
            color: #bd93f9;
        }
        .answer-content.markdown-content .hljs-function,
        .answer-content.markdown-content .code-block-with-copy .hljs-function {
            color: #50fa7b;
        }
        .answer-content.markdown-content .hljs-variable,
        .answer-content.markdown-content .code-block-with-copy .hljs-variable {
            color: #8be9fd;
        }
        .answer-content.markdown-content .hljs-type,
        .answer-content.markdown-content .code-block-with-copy .hljs-type {
            color: #8be9fd;
        }
        .answer-content.markdown-content .hljs-built_in,
        .answer-content.markdown-content .code-block-with-copy .hljs-built_in {
            color: #8be9fd;
        }
        /* 同时保留line-content包装器的样式 */
        .answer-content.markdown-content .line-content .hljs-keyword,
        .answer-content.markdown-content .code-block-with-copy .line-content .hljs-keyword {
            color: #ff79c6;
        }
        .answer-content.markdown-content .line-content .hljs-string,
        .answer-content.markdown-content .code-block-with-copy .line-content .hljs-string {
            color: #f1fa8c;
        }
        .answer-content.markdown-content .line-content .hljs-comment,
        .answer-content.markdown-content .code-block-with-copy .line-content .hljs-comment {
            color: #6272a4;
        }
        .answer-content.markdown-content .line-content .hljs-number,
        .answer-content.markdown-content .code-block-with-copy .line-content .hljs-number {
            color: #bd93f9;
        }
        .answer-content.markdown-content .line-content .hljs-function,
        .answer-content.markdown-content .code-block-with-copy .line-content .hljs-function {
            color: #50fa7b;
        }
        .answer-content.markdown-content .line-content .hljs-variable,
        .answer-content.markdown-content .code-block-with-copy .line-content .hljs-variable {
            color: #8be9fd;
        }
        .answer-content.markdown-content .line-content .hljs-type,
        .answer-content.markdown-content .code-block-with-copy .line-content .hljs-type {
            color: #8be9fd;
        }
        .answer-content.markdown-content .line-content .hljs-built_in,
        .answer-content.markdown-content .code-block-with-copy .line-content .hljs-built_in {
            color: #8be9fd;
        }
        /* 确保复制按钮不受行号影响 */
        .answer-content.markdown-content .code-block-with-copy {
            position: relative;
        }
        .answer-content.markdown-content .copy-code-btn {
            position: absolute;
            top: 8px;
            right: 12px;
            z-index: 2;
            background: #50fa7b;
            color: #282a36;
            border: none;
            border-radius: 4px;
            padding: 2px 10px;
            font-size: 12px;
            cursor: pointer;
            opacity: 0.9;
            transition: opacity 0.2s;
            font-weight: 500;
        }
        .answer-content.markdown-content .copy-code-btn:hover {
            opacity: 1;
            background: #5af78e;
        }
        /* 原始内容样式 */
        .raw-content {
            margin-top: 20px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 6px;
            border: 1px solid #e9ecef;
        }
        .raw-content h4 {
            margin: 0 0 10px 0;
            color: #495057;
            font-size: 0.9em;
        }
        .markdown-raw {
            background: #fff;
            border: 1px solid #dee2e6;
            border-radius: 4px;
            padding: 0;
            margin: 0;
            font-size: 13px;
            line-height: 1.3; /* 原始内容也使用1.3行间距 */
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
            position: relative;
            counter-reset: raw-line-number;
        }
        .markdown-raw .raw-line {
            display: flex;
            min-height: 1.3em; /* 与代码块保持一致的最小高度 */
            line-height: 1.3; /* 确保行间距一致 */
        }
        .markdown-raw .raw-line-number {
            flex-shrink: 0;
            width: 35px;
            text-align: right;
            padding: 0 8px 0 5px;
            color: #999;
            background: #f8f9fa;
            border-right: 1px solid #dee2e6;
            font-size: 12px;
            line-height: 1.3; /* 与代码块保持一致的行间距 */
            user-select: none;
        }
        .markdown-raw .raw-line-content {
            flex: 1;
            padding: 0 10px;
            white-space: pre;
            line-height: 1.3; /* 与代码块保持一致的行间距 */
        }
        .markdown-raw .raw-line-content:empty::before {
            content: " ";
            white-space: pre;
        }
        .deepseek .model-name { color: #4a9ff5; }
        .qwen .model-name { color: #ff9800; }
        .gpt .model-name { color: #9c27b0; }
        .export-info {
            text-align: center;
            color: #666;
            font-size: 0.8em;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid #e0e0e0;
        }
        .empty-message {
            text-align: center;
            color: #999;
            padding: 40px 20px;
            font-style: italic;
        }
        .no-answer {
            color: #999;
            font-style: italic;
            text-align: center;
            padding: 20px;
        }
        @media (max-width: 768px) {
            .chat-header {
                flex-direction: column;
                align-items: flex-start;
            }
            .model-selector {
                width: 100%;
                justify-content: flex-start;
            }
        }
    <\/style>
<\/head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <h1 class="chat-title">${title}<\/h1>
            <div class="model-selector">
                <label>选择的模型：</label>`;

      // 生成模型按钮
      modelArray.forEach((model, index) => {
        const modelClass = this.getModelClass(model);
        const isActive = index === 0 ? 'active' : '';
        htmlContent += `
                <button class="model-btn ${modelClass} ${isActive}" onclick="switchModel('${model}')" data-model="${model}">
                    ${this.escapeHtml(model)}
                </button>`;
      });

      htmlContent += `
            </div>
        </div>
`;

      // 生成QA内容
      qaList.forEach((qa, index) => {
        htmlContent += `
        <div class="qa-item">
            <div class="question">${this.escapeHtml(qa.question)}</div>
            <div class="answers">`;
        
        const validAnswers = Object.entries(qa.answers).filter(([_, answer]) => answer && answer.trim());
        
        if (validAnswers.length === 0) {
          htmlContent += `
                <div class="answer-item visible">
                    <div class="no-answer">暂无回答</div>
                </div>`;
        } else {
          validAnswers.forEach(([modelName, answer], idx) => {
            const modelClass = this.getModelClass(modelName);
            const isVisible = idx === 0 ? 'visible' : '';
            // 渲染Markdown内容并添加行号
            let renderedAnswer = markdownRenderer.render(answer);
            console.log('Original rendered answer:', renderedAnswer);
            renderedAnswer = this.addLineNumbers(renderedAnswer);
            console.log('Answer with line numbers:', renderedAnswer);
            const answerId = `answer_${index}_${idx}`;
            htmlContent += `
                <div class="answer-item ${modelClass} ${isVisible}" data-model="${modelName}">
                    <div class="model-name">
                        ${this.escapeHtml(modelName)}
                        <button class="toggle-raw-btn" onclick="toggleRawContent('${answerId}')" title="显示/隐藏原始Markdown">
                            📝
                        </button>
                    </div>
                    <div class="answer-content markdown-content">${renderedAnswer}</div>
                    <div class="raw-content" id="raw_${answerId}" style="display: none;">
                        <h4>原始Markdown文本：</h4>
                        <pre class="markdown-raw">${this.addLineNumbersToRawText(this.escapeHtml(answer))}</pre>
                    </div>
                </div>`;
          });
        }
        
        htmlContent += `
            </div>
        </div>`;
      });
      
      htmlContent += `
        <div class="export-info">
            导出时间: ${new Date().toLocaleString('zh-CN')}<br>
            来源: AI Chat Application
        </div>
    </div>
    
    <script>
        // 当前选中的模型
        let currentModel = '${modelArray[0] || ''}';
        
        // 切换模型显示
        function switchModel(modelName) {
            currentModel = modelName;
            
            // 更新按钮状态
            document.querySelectorAll('.model-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            document.querySelector(\`[data-model="\${modelName}"]\`).classList.add('active');
            
            // 更新答案显示
            document.querySelectorAll('.answer-item').forEach(item => {
                if (item.dataset.model === modelName || (!item.dataset.model && modelName === '')) {
                    item.classList.add('visible');
                } else {
                    item.classList.remove('visible');
                }
            });
        }
        
        // 切换原始Markdown内容显示
        function toggleRawContent(answerId) {
            const rawElement = document.getElementById('raw_' + answerId);
            if (rawElement) {
                if (rawElement.style.display === 'none') {
                    rawElement.style.display = 'block';
                } else {
                    rawElement.style.display = 'none';
                }
            }
        }
        
        // 初始化显示第一个模型
        if (currentModel) {
            switchModel(currentModel);
        }
    <\/script>
<\/body>
<\/html>`;
      
      return htmlContent;
    },
    
    // 生成空会话HTML
    generateEmptyConversationHTML(title) {
      return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}<\/title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .chat-container {
            background: white;
            border-radius: 10px;
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .chat-title {
            color: #333;
            border-bottom: 2px solid #4a9ff5;
            padding-bottom: 10px;
            margin-bottom: 20px;
        }
        .empty-message {
            color: #999;
            padding: 40px 20px;
            font-style: italic;
        }
        .export-info {
            color: #666;
            font-size: 0.8em;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid #e0e0e0;
        }
    <\/style>
<\/head>
<body>
    <div class="chat-container">
        <h1 class="chat-title">${title}<\/h1>
        <div class="empty-message">此会话暂无消息记录<\/div>
        <div class="export-info">
            导出时间: ${new Date().toLocaleString('zh-CN')}<br>
            来源: AI Chat Application
        <\/div>
    <\/div>
<\/body>
<\/html>`;
    },
    
    // 转换消息为QA格式
    convertMessagesToQA(messages) {
      const qaList = [];
      let currentQuestion = null;
      let currentAnswers = {};
      
      for (const message of messages) {
        if (message.role === 'user') {
          // 如果之前有未完成的问答对，先保存
          if (currentQuestion) {
            qaList.push({
              question: currentQuestion,
              answers: { ...currentAnswers }
            });
          }
          
          // 开始新的问答对
          currentQuestion = message.content;
          currentAnswers = {};
        } else if (message.role === 'assistant') {
          const modelName = message.name || 'AI Assistant';
          currentAnswers[modelName] = message.content;
        }
      }
      
      // 保存最后一个问答对
      if (currentQuestion) {
        qaList.push({
          question: currentQuestion,
          answers: { ...currentAnswers }
        });
      }
      
      return qaList;
    },
    
    // 添加行号到原始文本
    addLineNumbersToRawText(text) {
      const lines = text.split('\n');
      return lines.map((line, index) => {
        const lineNumber = index + 1;
        return `<span class="raw-line"><span class="raw-line-number">${lineNumber}</span><span class="raw-line-content">${line}</span></span>`;
      }).join('\n');
    },
    
    // 添加行号到代码块
    addLineNumbers(htmlContent) {
      // 处理代码块，为代码添加简单行号
      return htmlContent.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g, (match, codeContent) => {
        // 检查代码内容是否已经包含行号结构
        if (codeContent.includes('<span class="simple-line">') || codeContent.includes('<span class="simple-number">')) {
          // 如果已经有行号结构，直接返回原始匹配，不重复添加
          return match;
        }
        
        // 分割代码为行
        const lines = codeContent.split('\n')
        
        // 去除末尾的空行
        while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
          lines.pop()
        }
        
        // 如果没有内容，返回原始匹配
        if (lines.length === 0) {
          return match
        }
        
        // 过滤掉中间的完全空行，但保留有内容的行
        const filteredLines = lines.filter(line => line.trim() !== '')
        
        // 为每行添加简单的行号
        const numberedLines = filteredLines.map((line, index) => {
          const lineNumber = index + 1
          return `<span class="simple-line"><span class="simple-number">${lineNumber}</span><span class="simple-code">${line}</span></span>`
        }).join('\n')
        
        // 返回包含行号的代码块
        return match.replace(codeContent, numberedLines)
      })
    },
    
    // 获取模型样式类
    getModelClass(modelName) {
      const name = modelName.toLowerCase();
      if (name.includes('deepseek')) return 'deepseek';
      if (name.includes('qwen')) return 'qwen';
      if (name.includes('gpt')) return 'gpt';
      return '';
    },
    
    // HTML转义
    escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    },
    
    // 下载HTML文件
    downloadHTML(content, filename) {
      const blob = new Blob([content], { type: 'text/html;charset=utf-8' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.href = url;
      link.download = filename;
      link.style.display = 'none';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // 清理URL对象
      URL.revokeObjectURL(url);
      
      console.log(`会话已导出为: ${filename}`);
    },
    async confirmDeleteConversation() {
      await this.deleteConversationItem(this.deleteTargetId);
      this.showDeleteConfirm = false;
      this.deleteTargetId = null;
    },

    async deleteConversationItem(id) {
      await deleteConversation(id);
      await this.loadConversations();
      // 如果删除的是当前激活会话，则重置
      if (this.activeConversation === id) {
        this.activeConversation = null;
      }
    },
    async loadConversations() {
      if (!this.account || !this.account.idTokenClaims || !this.account.idTokenClaims.oid) {
        console.error('User not authenticated');
        return;
      }
      
      const userId = this.account.idTokenClaims.oid;
      console.log('Attempting to load conversations for user ID:', userId);
      
      try {
        const res = await getConversations(userId);
        console.log('Raw API response:', res); // 调试信息
        console.log('Response data structure:', {
          hasData: !!res.data,
          hasDataData: !!(res.data && res.data.data),
          hasConversations: !!(res.data && res.data.data && res.data.data.conversations),
          directConversations: !!(res.data && res.data.conversations)
        });
        
        // 修复数据结构访问 - 检查两种可能的结构
        let conversationsData = null;
        if (res.data && res.data.data && res.data.data.conversations) {
          // 新的结构: res.data.data.conversations
          conversationsData = res.data.data.conversations;
          console.log('✅ Using nested data structure (res.data.data.conversations)');
        } else if (res.data && res.data.conversations) {
          // 旧的结构: res.data.conversations
          conversationsData = res.data.conversations;
          console.log('✅ Using direct data structure (res.data.conversations)');
        } else {
          console.error('❌ Cannot find conversations in response structure');
          console.error('Full response data:', res.data);
        }
        
        if (conversationsData && Array.isArray(conversationsData)) {
          console.log('Raw conversations data:', conversationsData);
          
          this.conversations = conversationsData.sort((a, b) => {
            // 如果有 created_at
            if (a.created_at && b.created_at) {
              return new Date(b.created_at) - new Date(a.created_at);
            }
            // 否则按 id 降序
            return b.id - a.id;
          });
          
          console.log(`✅ Successfully loaded ${this.conversations.length} conversations`);
          console.log('Sorted conversations:', this.conversations.map(c => ({
            id: c.id,
            title: c.title,
            created_at: c.created_at
          })));
        } else {
          console.error('❌ Invalid conversations data type or structure');
          console.error('Expected array, got:', typeof conversationsData, conversationsData);
          this.conversations = [];
        }
      } catch (error) {
        console.error('❌ Error loading conversations:', error);
        console.error('Error details:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });
        this.conversations = [];
      }
    },
    async selectConversation(id) {
      if (!this.account || !this.account.idTokenClaims || !this.account.idTokenClaims.oid) {
        console.error('User not authenticated');
        return;
      }
      
      console.log('选择会话:', id);
      this.activeConversation = id;
      
      // 保存当前会话id到用户偏好设置
      try {
        await this.saveCurrentUserPreferences();
      } catch (e) {
        console.warn('保存会话偏好失败:', e);
      }
      
      // 加载会话内容并传递给子组件
      try {
        const res = await getConversation(id);
        console.log('Conversation details response:', res); // 调试信息
        
        // 检查响应结构并获取消息数据
        let messagesData = null;
        if (res.data && res.data.data && res.data.data.messages) {
          // 新结构: res.data.data.messages
          messagesData = res.data.data.messages;
          console.log('✅ Using nested message structure (res.data.data.messages)');
        } else if (res.data && res.data.messages) {
          // 旧结构: res.data.messages
          messagesData = res.data.messages;
          console.log('✅ Using direct message structure (res.data.messages)');
        } else if (res.data && res.data.data && Array.isArray(res.data.data)) {
          // 如果res.data.data直接是消息数组
          messagesData = res.data.data;
          console.log('✅ Using direct data array structure');
        } else {
          console.error('❌ Cannot find messages in conversation response');
          console.error('Response structure:', res.data);
          messagesData = [];
        }
        
        console.log('Messages data to load:', messagesData);
        
        if (this.$refs.qav && this.$refs.qav.loadConversation) {
          this.$refs.qav.loadConversation(messagesData);
        } else {
          console.error('❌ QuestionAnswerView ref not found or loadConversation method not available');
        }
      } catch (error) {
        console.error('Error loading conversation details:', error);
        console.error('Error details:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });
      }
    },
    async newSession() {
      if (!this.account || !this.account.idTokenClaims || !this.account.idTokenClaims.oid) {
        console.error('User not authenticated');
        alert('Please login first');
        return;
      }
      
      try {
        const newIndex = this.conversations.length + 1
        const newTitle = `New Chat${newIndex}`;
        console.log('Creating new conversation with title:', newTitle);
        
        const res = await createConversation(this.account.idTokenClaims.oid, newTitle);
        console.log('Create conversation response:', res);
        
        await this.loadConversations();
        
        // 检查响应数据结构
        let conversationId = null;
        if (res.data && res.data.conversation && res.data.conversation.id) {
          conversationId = res.data.conversation.id;
        } else if (res.data && res.data.id) {
          conversationId = res.data.id;
        }
        
        if (conversationId) {
          console.log('Selecting new conversation with ID:', conversationId);
          this.selectConversation(conversationId);
        } else {
          console.error('Cannot find conversation ID in response:', res.data);
        }
      } catch (error) {
        console.error('Failed to create new conversation:', error);
        console.error('Error details:', {
          message: error.message,
          status: error.response?.status,
          data: error.response?.data
        });
        alert('Failed to create new conversation. Please try again.');
      }
    },

    async clearConversation() {
      if (this.activeConversation) {
        // 清空当前会话消息
        await clearSession(this.activeConversation);
        if (this.$refs.qav && this.$refs.qav.clearConversation) {
          this.$refs.qav.clearConversation();
        }
      }
    },
    search() {
      // 你的搜索逻辑
      console.log('执行搜索');
    },
    async changeView(viewId) {
      console.log('切换视图到:', viewId);
      this.currentView = viewId;
      
      // 保存视图状态到后端
      if (this.account && this.account.idTokenClaims && this.account.idTokenClaims.oid) {
        try {
          await this.saveCurrentUserPreferences();
        } catch (e) {
          console.warn('保存视图偏好失败:', e);
        }
      }
    },
    
    async saveCurrentUserPreferences() {
      // 保存完整的用户偏好设置，包括视图、会话ID等
      const preferences = {
        view_type: this.currentView,  // 使用view_type而不是view
        conversation_id: this.activeConversation,
        current_conversation_id: this.activeConversation  // 同时设置当前会话ID
      };
      console.log('当前用户偏好设置:', preferences);
      
      // 如果子组件存在，也获取其模型选择
      if (this.$refs.qav && this.$refs.qav.selectedModels) {
        preferences.selected_models = this.$refs.qav.selectedModels;  // 使用selected_models而不是models
        console.log('从子组件获取的模型选择:', this.$refs.qav.selectedModels);
      } else {
        console.warn('无法从子组件获取模型选择，qav ref:', this.$refs.qav);
      }
      
      console.log('保存用户偏好设置:', preferences);
      
      try {
        await saveUserSelections(this.account.idTokenClaims.oid, preferences);
        console.log('✅ 用户偏好设置保存成功');
      } catch (e) {
        console.error('❌ 保存用户偏好设置失败:', e);
      }
    },
    toggleMenu() {
      this.isMenuCollapsed = !this.isMenuCollapsed;
    },
    startEditTitle(item, index) {
      this.editIndex = index;
      this.editTitle = item.title;
      this.$nextTick(() => {
        const input = document.querySelector('.edit-title-input');
        if (input) input.focus();
      });
    },
    async saveTitle(item, index) {
      if (this.editTitle.trim() && this.editTitle !== item.title) {
        await updateConversationName(item.id, { title: this.editTitle.trim() });
        await this.loadConversations();
      }
      this.editIndex = null;
      this.editTitle = '';
    },
    toggleLogout() {
      this.showLogout = !this.showLogout;
    },
    logout() {
      // console.log("logout:True")
      this.$emit('logout')
      this.showLogout = false
    }
  },
  async mounted() {
    console.log('=== MenuBarView mounted ===');
    console.log('Account object:', this.account);
    
    // 如果在mounted时account已经可用，直接加载
    if (this.account && this.account.idTokenClaims && this.account.idTokenClaims.oid) {
      console.log('✅ Account available at mount time, loading conversations');
      await this.loadConversationsOnAccountChange();
    } else {
      console.log('⏳ Account not available at mount time, waiting for account change...');
    }
    
    console.log('=== MenuBarView mounted completed ===');
  }
}
</script>

<style scoped>
.nested-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  font-family: Arial, sans-serif;
  background: #f7f7f7;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 24px;
  background: linear-gradient(to bottom, #232323 0%, #48494b 60%, #818283 100%);
  color: #fff;
  position: relative;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.apm-title {
  font-size: 22px;
  font-weight: bold;
  letter-spacing: 2px;
  margin-left: 36px;
  color: #fff;
  display: flex;
  flex-direction: row; /* 横向排列 */
  align-items: center;
  gap: 16px; /* logo和账号之间的间距 */
}

.toggle-container {
  display: flex;
  margin: 0 16px;
  border-radius: 8px;
  padding: 4px 8px;
}

.toggle-item {
  padding: 8px 18px;
  cursor: pointer;
  border-radius: 6px;
  margin-right: 8px;
  /* background-color: #23272f; */
  color: #bbb;
  transition: background 0.2s, color 0.2s;
  font-weight: 500;
}

.toggle-item.active {
  background-color: #6190d8;
  color: #fff;
}

.action-buttons {
  display: flex;
  gap: 12px;
}

.action-btn {
  padding: 6px 18px;
  border: none;
  border-radius: 50%;
  background: none;
  color: #fff;
  cursor: pointer;
  font-weight: 500;
  transition: 
    background 0.2s,
    border 0.2s,
    color 0.2s,
    box-shadow 0.2s;
  box-shadow: none;
  outline: none;
  position: relative;
}

.action-btn:hover {
  background-color: #0085ba;
}

.menu-toggle {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 100;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px;
  background-color: transparent;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  transition: all 0.3s;
}

.menu-toggle:hover {
  background-color: rgba(255,255,255,0.08);
}

.hamburger-icon {
  width: 20px;
  height: 2px;
  background-color: #fff;
  transition: all 0.3s;
  border-radius: 2px;
}

.hamburger-icon.open:nth-child(1) {
  transform: translateY(7px) rotate(45deg);
}
.hamburger-icon.open:nth-child(2) {
  opacity: 0;
}
.hamburger-icon.open:nth-child(3) {
  transform: translateY(-7px) rotate(-45deg);
}

.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  background: #f7f7f7;
}

.side-menu {
  width: 220px;
  background-color: #363738;
  color: #fff;
  transition: all 0.3s;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #222;
  position: relative;
}

.side-menu.collapsed {
  width: 0;
  padding: 0;
  border: none;
}

.new-session-btn {
  padding: 10px;
  margin: 16px 12px 8px 12px;
  background-color: #6190d8;
  color: #fff;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  transition: background 0.2s;
}

.new-session-btn:hover {
  background-color: #6190d8;
}

.conversation-list {
  overflow-y: auto;
  flex: 1;
  margin-top: 8px;
}

.conversation-item {
  display: flex;
  align-items: center;
  justify-content: space-between; /* 让内容和按钮分两端 */
  padding: 10px 18px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 4px;
  margin: 2px 8px;
  transition: background 0.2s, color 0.2s;
  color: #bbb;
}

.conversation-main {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

.conversation-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 110px;
  display: inline-block;
}

.conversation-actions {
  display: flex;
  align-items: center;
  margin-left: 8px;
}

.conversation-item:hover {
  background-color: #2c313a;
  color: #fff;
}

.conversation-item.active {
  background-color: #6190d8;
  color: #fff;
}

.edit-title-input {
  width: 80%;
  border: 1px solid #bbb;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 15px;
  outline: none;
}

.content-area {
  flex: 1;
  padding: 24px 32px;
  overflow-y: auto;
  background-color: #f7f7f7;
}

.empty-state {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  color: #bbb;
  font-size: 18px;
  letter-spacing: 1px;
}

.apm-logo {
  height: 60px;
  /* max-width: 120px; */
  width: auto;
  display: block;
  object-fit: contain;
}

.besom-logo{
  height: 30px;
  width: auto;
  display: block;
  object-fit: contain;
}

.magnifying_glass-log{
  height: 30px;
  width: auto;
  display: block;
  object-fit: contain;
}


.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16px 12px 0 12px;
  border-bottom: 1px solid #444;
  margin-bottom: 8px;
}

/* 用户信息显示在顶部右侧 */
.user-info-top {
  display: flex;
  align-items: center;
  position: relative;
}

.user-info-top .user-name {
  font-size: 14px;
  color: #fff;
  opacity: 0.9;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s, box-shadow 0.2s;
  outline: none;
  border: 2px solid transparent;
  white-space: nowrap;
}

.user-info-top .user-name.highlight,
.user-info-top .user-name:focus {
  background: rgba(255, 255, 255, 0.1);
  border: 2px solid #00acce;
  color: #fff;
}

.user-info-top .logout-btn {
  position: absolute;
  top: 100%;
  right: 0;
  background: #e74c3c;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  margin-top: 4px;
  transition: background 0.2s;
  box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  z-index: 1000;
}

.user-info-top .logout-btn:hover {
  background: #c0392b;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter, .fade-leave-to {
  opacity: 0;
}

.delete-btn {
  background: transparent;
  border: none;
  color: #e74c3c;
  font-size: 16px;
  margin-left: 10px;
  cursor: pointer;
  transition: color 0.2s;
}
.delete-btn:hover {
  color: #c0392b;
}

.share-btn {
  background: transparent;
  border: none;
  color: #4a9ff5;
  font-size: 16px;
  margin-left: 10px;
  cursor: pointer;
  transition: color 0.2s;
  padding: 2px;
}
.share-btn:hover {
  color: #357abd;
}

.share-icon {
  width: 16px;
  height: 16px;
  display: block;
}
.share-btn:hover .share-icon {
  transform: scale(1.1);
  transition: transform 0.2s;
}

.delete-confirm-dialog {
  position: fixed;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
  min-width: 260px;
  background: #fff;
  border: none;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.18);
  padding: 24px 20px 16px 20px;
  z-index: 9999;
  color: #222;
}

.plus-icon {
  width: 18px;
  height: 18px;
  vertical-align: middle;
  margin-right: 6px;
  margin-bottom: 2px;
}

.chat-icon {
  width: 18px;
  height: 18px;
  margin-right: 6px;
  vertical-align: middle;
}
.icon-btn {
  background: transparent;
  border: none;
  padding: 0 2px;
  margin-left: 4px;
  cursor: pointer;
  vertical-align: middle;
  display: inline-flex;
  align-items: center;
}
.edit-icon, .delete-icon {
  width: 16px;
  height: 16px;
  display: block;
  color: #666;
  transition: color 0.2s;
}
.delete-icon {
  color: #999;
}
.icon-btn:hover .edit-icon {
  color: #4a9ff5;
}
.icon-btn:hover .delete-icon,
.delete-btn-with-icon:hover .delete-icon {
  color: #e74c3c;
}

.delete-btn-with-icon {
  background: transparent;
  border: none;
  padding: 0 2px;
  margin-left: 4px;
  cursor: pointer;
  vertical-align: middle;
  display: inline-flex;
  align-items: center;
}

.delete-btn-with-icon:hover .delete-icon {
  filter: none;
}

.apm-logo {
  height: 60px;
  /* max-width: 120px; */
  width: auto;
  display: block;
  object-fit: contain;
}

.besom-logo{
  height: 30px;
  width: auto;
  display: block;
  object-fit: contain;
}

.magnifying_glass-log{
  height: 30px;
  width: auto;
  display: block;
  object-fit: contain;
}


.user-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 16px 12px 0 12px;
  border-bottom: 1px solid #444;
  margin-bottom: 8px;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter, .fade-leave-to {
  opacity: 0;
}
/* 移动端适配 */
@media (max-width: 768px) {
  .menu-toggle {
    padding: 12px;
    width: 32px;
    height: 32px;
  }
  .hamburger-icon {
    width: 24px;
    height: 3px;
  }
  .action-btn {
    padding: 8px 16px;
    font-size: 14px;
  }
  .toggle-item {
    padding: 8px 12px;
    font-size: 14px;
  }
  .side-menu {
    position: absolute;
    z-index: 90;
    height: 100%;
  }
  .content-area {
    padding: 12px 4px;
  }
}
</style>