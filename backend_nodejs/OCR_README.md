# Node.js 后端图片OCR识别功能文档

## 功能概述

根据 Python 后端的 `ai_models.py` 和 `s3_utils.py` 文件，为 Node.js 后端添加了完整的图片上传和OCR识别功能。

## 新增功能

### 1. AI服务增强 (services/aiService.js)

#### 新增方法：
- `analyzeImageWithOCR(modelName, prompt, imageData)` - 主要OCR识别接口
- `generateAzureOpenAIOCR(modelInfo, prompt, imageData)` - Azure OpenAI OCR识别
- `generateOpenAIOCR(modelInfo, prompt, imageData)` - OpenAI OCR识别

#### 支持的模型类型：
- Azure OpenAI (对应Python的 `AZURE_AIMODELS_OCR`)
- OpenAI (对应Python的 `ALL_AIMODELS` 和 `GPT_AIMODELS`)

### 2. S3工具增强 (services/s3Utils.js)

#### 新增方法：
- `generateS3Key(userId, originalFilename)` - 用户专属存储路径
- `generateS3KeyLegacy(originalFilename)` - 传统存储路径（兼容性）
- `deleteS3ObjectWithUserValidation(imageUrl, userId)` - 带权限验证的删除

#### 存储结构：
```
chat-images/
  ├── {user_id}/
  │   ├── {timestamp}_{uuid}.{ext}
  │   └── ...
  └── ...
```

### 3. REST API接口 (routes/api.js)

#### 新增接口：

1. **图片OCR识别**
   ```
   POST /api/analyze_image
   Content-Type: application/json
   
   {
     "model_name": "GPT-5-chat",
     "prompt": "请识别图片中的文字",
     "image_url": "https://...", // 或使用 image_base64
     "image_base64": "base64数据"
   }
   ```

2. **上传并识别图片**
   ```
   POST /api/upload_and_analyze_image
   Content-Type: multipart/form-data
   
   image: 图片文件
   user_id: 用户ID
   model_name: 模型名称
   prompt: 识别提示词
   ```

3. **删除用户图片**
   ```
   POST /api/delete_user_image
   Content-Type: application/json
   
   {
     "user_id": "用户ID",
     "image_url": "图片URL"
   }
   ```

#### 更新的接口：

1. **图片上传**（增强版）
   ```
   POST /api/upload_image
   Content-Type: multipart/form-data
   
   image: 图片文件
   user_id: 用户ID (可选，提供则使用用户专属路径)
   ```

### 4. WebSocket 事件 (socket/handlers.js)

#### 新增事件：

1. **OCR识别请求**
   ```javascript
   socket.emit('analyze_image_ocr', {
     model_name: 'GPT-5-chat',
     prompt: '请识别图片内容',
     image_url: 'https://...',  // 或使用 image_base64
     user_id: 'user123',
     request_id: 'req_123'
   });
   ```

2. **OCR识别响应**
   ```javascript
   // 开始识别
   socket.on('ocr_started', (data) => {
     // { request_id, model_name }
   });
   
   // 识别结果
   socket.on('ocr_result', (data) => {
     // { request_id, model_name, result, success: true }
   });
   
   // 识别错误
   socket.on('ocr_error', (data) => {
     // { request_id, message, success: false }
   });
   ```

## 配置要求

### 环境变量
确保以下环境变量已配置：

```bash
# Azure OpenAI (用于OCR)
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_VERSION=2024-02-01

# AWS S3 (用于图片存储)
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-bucket-name

# OpenAI (备用)
OPENAI_API_KEY=your_openai_key
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 数据库要求
确保数据库中的 `ai_models` 表包含OCR支持的模型配置。

## 使用示例

### 1. REST API 示例

```javascript
// 图片OCR识别
const response = await fetch('/api/analyze_image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model_name: 'GPT-5-chat',
    prompt: '请识别这张图片中的所有文字',
    image_url: 'https://your-image-url.com/image.jpg'
  })
});

const result = await response.json();
console.log(result.result); // OCR识别结果
```

### 2. WebSocket 示例

```javascript
const socket = io('http://localhost:5001');

socket.emit('analyze_image_ocr', {
  model_name: 'GPT-5-chat',
  prompt: '分析图片内容',
  image_url: 'https://example.com/image.jpg',
  user_id: 'user123'
});

socket.on('ocr_result', (data) => {
  console.log('识别结果:', data.result);
});
```

### 3. 文件上传并识别

```javascript
const formData = new FormData();
formData.append('image', fileInput.files[0]);
formData.append('user_id', 'user123');
formData.append('model_name', 'GPT-5-chat');
formData.append('prompt', '请识别图片中的文字');

const response = await fetch('/api/upload_and_analyze_image', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('上传结果:', result.upload_info);
console.log('识别结果:', result.analysis_result);
```

## 测试

运行测试脚本：
```bash
node test_ocr_api.js
```

## 权限和安全

1. **用户权限验证**：只能删除自己上传的图片
2. **文件类型限制**：支持 png, jpg, jpeg, gif, webp, bmp, tiff, svg
3. **文件大小限制**：最大 10MB
4. **存储隔离**：用户图片存储在专属目录中

## 错误处理

所有API都包含完整的错误处理和日志记录，便于调试和监控。

## 兼容性

新功能完全兼容现有的图片上传和处理功能，不会影响现有业务逻辑。
