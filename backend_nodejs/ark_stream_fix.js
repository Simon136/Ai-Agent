/**
 * aiService.js修复补丁
 * 专门修复Ark模型的流式响应处理问题
 */

// 这个函数应该替换aiService.js中generateArkText方法的流式处理部分
function fixedArkStreamProcessing(response, streamCallback, fullResponse, inThinkBlock) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    
    response.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      
      // 保留最后一个可能不完整的行
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.trim() && line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          
          if (jsonStr === '[DONE]') {
            streamCallback('', true);
            resolve(fullResponse);
            return;
          }
          
          if (jsonStr) {
            try {
              const chunkData = JSON.parse(jsonStr);
              
              if (chunkData.choices && chunkData.choices.length > 0) {
                const delta = chunkData.choices[0].delta || {};
                
                if (delta.content) {
                  const content = delta.content;
                  fullResponse += content;
                  
                  // 处理 DeepSeek-R1 的思考标签
                  if (content.includes('<think>')) {
                    inThinkBlock = true;
                    const beforeThink = content.split('<think>')[0];
                    if (beforeThink) {
                      streamCallback(beforeThink, false);
                    }
                    continue;
                  }
                  
                  if (content.includes('</think>')) {
                    inThinkBlock = false;
                    const afterThink = content.split('</think>').pop();
                    if (afterThink) {
                      streamCallback(afterThink, false);
                    }
                    continue;
                  }
                  
                  // 正常输出内容（跳过思考部分）
                  if (!inThinkBlock) {
                    streamCallback(content, false);
                  }
                }
              }
            } catch (e) {
              // 静默处理JSON解析错误，避免日志噪音
              // 这是正常现象，因为流式数据可能被分割
            }
          }
        }
      }
    });

    response.data.on('end', () => {
      if (!fullResponse) {
        // 如果没有收到任何内容，尝试调用完成回调
        streamCallback('', true);
      }
      resolve(fullResponse);
    });

    response.data.on('error', (error) => {
      console.error('Ark流式响应错误:', error);
      reject(error);
    });
  });
}

// 创建一个简化的测试用流式处理函数
async function testArkStreamFixed() {
  const axios = require('axios');
  
  const mockModelInfo = {
    model_key: '93aca710-15b7-4b33-95e1-2a63cce815af',
    model_url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    api_model_name: 'deepseek-v3-250324'
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${mockModelInfo.model_key}`
  };

  const requestData = {
    model: mockModelInfo.api_model_name,
    messages: [
      {
        role: 'user',
        content: '你好，请简单介绍一下自己。'
      }
    ],
    stream: true,
    max_tokens: 500,
    temperature: 0.7
  };

  try {
    console.log('=== 测试修复后的流式处理 ===');
    
    const response = await axios({
      method: 'post',
      url: mockModelInfo.model_url,
      headers: headers,
      data: requestData,
      responseType: 'stream'
    });

    let fullResponse = '';
    let inThinkBlock = false;
    
    const streamCallback = (content, isComplete) => {
      if (!isComplete && content) {
        process.stdout.write(content);
        fullResponse += content;
      } else if (isComplete) {
        console.log('\n[流式响应完成]');
      }
    };

    // 使用修复后的处理逻辑
    const result = await fixedArkStreamProcessing(response, streamCallback, '', inThinkBlock);
    
    console.log(`\n完整响应长度: ${result.length} 字符`);
    return result;
    
  } catch (error) {
    console.error('测试失败:', error.message);
    return null;
  }
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
  testArkStreamFixed().then(result => {
    if (result) {
      console.log('\n✅ 流式处理修复成功！');
    } else {
      console.log('\n❌ 流式处理修复失败');
    }
    process.exit(0);
  });
}

module.exports = {
  fixedArkStreamProcessing,
  testArkStreamFixed
};
