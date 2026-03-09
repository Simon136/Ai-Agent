import axios from 'axios'
import { PublicClientApplication } from "@azure/msal-browser"

// 根据环境判断API基础路径
const getBaseURL = () => {
  if (process.env.NODE_ENV === 'production') {
    // 生产环境：使用统一的API端点
    console.log('生产环境API端点: /api');
    return "/api";
  } else {
    // 开发环境直接连接后端
    console.log('开发环境API端点: http://localhost:5001/api');
    return "http://localhost:5001/api";
  }
};

const api = axios.create({
    baseURL: getBaseURL(),
    timeout: 50000
})

// 添加请求拦截器，用于调试
api.interceptors.request.use(
  (config) => {
    console.log('API请求:', config.baseURL + config.url);
    return config;
  },
  (error) => {
    console.error('API请求错误:', error);
    return Promise.reject(error);
  }
);

// 添加响应拦截器，用于调试
api.interceptors.response.use(
  (response) => {
    console.log('API响应成功:', response.config.url, response.status);
    return response;
  },
  (error) => {
    console.error('API响应错误:', error.config?.url, error.response?.status, error.message);
    return Promise.reject(error);
  }
);

// 用户登记与更新记录
export function userRegistration(data) {
  return api.post('/registration', data)
}

// 加载与获取历史聊天记录
export function getConversations(user_id) {
  console.log("Fetching conversations for user:", user_id)
  return api.post('/conversations', {user_id})
}

export function getConversation(id) {
  console.log("Fetching conversation with ID:", `/conversation/${id}`)
  return api.get(`/conversation/${id}`)
}

export function createConversation(user_id, title) {
  return api.post('/conversation', {user_id, title })
}

export function updateConversationName(id, title) {
  return api.put(`/conversation/${id}`, title)
}

export function clearSession(id) {
  return api.post(`/clearsession/${id}`, id)
}

// 获取AI模型列表
export function getModels() {
  return api.get('/models')
}

// 记录用户选择的视图和AI模型
export function saveUserSelections(user_id, custom_metadata) {
  return api.post('/get_select', {user_id, custom_metadata})
}

// 记录用户选择的会话
export function saveUserConverstions(user_id, conversations) {
  console.log("Saving user conversations:", user_id, conversations)
  return api.post('/get_select_conversations', {user_id, conversations})
}

// 获取用户自定义元数据（视图和模型选择）
export function getCustomMetadata(user_id) {
  return api.post('/get_custom_metadata', {user_id});
}

// 删除会话
export function deleteConversation(conversation_id) {
  return api.post(`/delete_conversation`, {conversation_id});
}

// 单点登录验证处理
let msalInstance = null

export async function getAzureConfig() {
  return api.get('/azure_config').then(res => res.data);
}

export async function initMsalInstance() {
  const config = await getAzureConfig()
  console.log(config)
  msalInstance = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: config.authority,
      redirectUri: config.redirectUri || window.location.origin
    }
  })
  await msalInstance.initialize()
  return msalInstance
}

export function getMsalInstance() {
  return msalInstance
}

export async function azureLogin() {
  if (!msalInstance) await initMsalInstance()
  const loginResponse = await msalInstance.loginPopup({ scopes: ["User.Read"] })
  return loginResponse
}

export async function getAzureAccessToken(account) {
  if (!msalInstance) await initMsalInstance()
  const tokenResponse = await msalInstance.acquireTokenSilent({
    scopes: ["User.Read"],
    account
  })
  return tokenResponse.accessToken
}

export async function verifyAzureToken(accessToken) {
  return api.post('/azure_verify', { access_token: accessToken }).then(res => res.data);
}

// 上传图片到AWS S3
export function uploadImageToS3(imageFile, userId) {
  const formData = new FormData()
  formData.append('image', imageFile)
  formData.append('user_id', userId)
  return api.post('/upload_image_s3', formData, {
    headers: {
      'Content-Type': 'multipart/form-data'
    }
  })
}

export default api
