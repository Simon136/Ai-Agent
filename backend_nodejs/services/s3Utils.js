/**
 * S3工具服务 - Node.js版本
 * 对应原Python s3_utils.py
 */
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/config');
const logger = require('../utils/logger');

class S3Utils {
  constructor() {
    this.s3Client = null;
    this.bucket = config.aws.bucket;
    this.initializeS3Client();
  }

  initializeS3Client() {
    if (!config.aws.accessKeyId || !config.aws.secretAccessKey) {
      logger.warn('AWS凭证未配置，S3功能将不可用');
      return;
    }

    this.s3Client = new S3Client({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey
      }
    });

    logger.info('S3客户端初始化完成');
  }

  // 检查文件类型是否允许 (对应原Python allowed_file)
  allowedFile(filename) {
    if (!filename) return false;
    
    const ext = path.extname(filename).toLowerCase().slice(1);
    return config.upload.allowedExtensions.includes(ext);
  }

  // 生成S3键名 (对应原Python generate_s3_key)
  generateS3Key(userId, originalFilename) {
    const ext = path.extname(originalFilename);
    const timestamp = Date.now();
    const uuid = uuidv4().substring(0, 8);
    // 按照Python版本的格式：chat-images/{user_id}/{timestamp}_{uuid}.{extension}
    return `chat-images/${userId}/${timestamp}_${uuid}${ext}`;
  }

  // 原有的generateS3Key方法保持兼容性
  generateS3KeyLegacy(originalFilename) {
    const ext = path.extname(originalFilename);
    const timestamp = Date.now();
    const uuid = uuidv4().substring(0, 8);
    return `uploads/${timestamp}_${uuid}${ext}`;
  }

  // 上传文件到S3 (对应原Python upload_to_s3)
  async uploadToS3(fileBuffer, key, contentType) {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }

    if (!this.bucket) {
      throw new Error('S3存储桶未配置');
    }

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: fileBuffer,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
        CacheControl: 'max-age=31536000', // 1年缓存
        Metadata: {
          'uploaded-at': new Date().toISOString(),
          'original-name': key
        }
      });

      await this.s3Client.send(command);

      // 生成公共URL
      const s3Url = `https://${this.bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;
      
      logger.info(`文件上传成功: ${key}`);
      return s3Url;

    } catch (error) {
      logger.error('S3上传失败:', error);
      throw new Error(`文件上传失败: ${error.message}`);
    }
  }

  // 上传图片文件 (专门为图片上传设计的便捷方法)
  async uploadImage(file, userId) {
    if (!file) {
      throw new Error('文件对象不能为空');
    }

    if (!userId) {
      throw new Error('用户ID不能为空');
    }

    try {
      // 验证文件类型
      if (!this.allowedFile(file.originalname)) {
        throw new Error(`不支持的文件类型: ${file.originalname}`);
      }

      // 生成用户专属的S3键名
      const fileKey = this.generateS3Key(userId, file.originalname);
      
      // 上传到S3
      const s3Url = await this.uploadToS3(file.buffer, fileKey, file.mimetype);
      
      logger.info(`用户 ${userId} 图片上传成功: ${fileKey}`);
      
      return {
        url: s3Url,
        key: fileKey,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      };

    } catch (error) {
      logger.error(`用户 ${userId} 图片上传失败:`, error);
      throw error;
    }
  }

  // 删除S3对象 (对应原Python delete_s3_object)
  async deleteS3Object(key) {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }

    if (!this.bucket) {
      throw new Error('S3存储桶未配置');
    }

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      await this.s3Client.send(command);
      logger.info(`S3对象删除成功: ${key}`);

    } catch (error) {
      logger.error('S3删除失败:', error);
      throw new Error(`文件删除失败: ${error.message}`);
    }
  }

  // 删除S3对象（带用户权限验证）(对应原Python delete_s3_object的完整实现)
  async deleteS3ObjectWithUserValidation(imageUrl, userId) {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }

    try {
      // 从URL提取S3键
      let s3Key;
      if (this.bucket && imageUrl.includes(this.bucket)) {
        // 处理普通URL和预签名URL
        if (imageUrl.includes('X-Amz-Algorithm')) {
          // 从预签名URL中提取S3键
          const urlParts = imageUrl.split('amazonaws.com/');
          if (urlParts.length > 1) {
            s3Key = urlParts[1].split('?')[0];
          }
        } else {
          // 从普通URL中提取S3键
          const urlPattern = `${this.bucket}.s3.${config.aws.region}.amazonaws.com/`;
          const urlParts = imageUrl.split(urlPattern);
          if (urlParts.length > 1) {
            s3Key = urlParts[1];
          }
        }
        
        // 验证用户权限（确保只能删除自己上传的图片）
        if (!s3Key || !s3Key.startsWith(`chat-images/${userId}/`)) {
          return { success: false, message: '没有权限删除此图片' };
        }
        
        // 删除S3对象
        await this.deleteS3Object(s3Key);
        return { success: true, message: '图片删除成功' };
      } else {
        return { success: false, message: '无效的图片URL' };
      }
    } catch (error) {
      logger.error(`删除图片错误: ${error.message}`);
      return { success: false, message: `删除失败: ${error.message}` };
    }
  }

  // 从S3下载图片并转换为Base64 (对应原Python download_image_from_s3_to_base64)
  async downloadImageFromS3ToBase64(s3Url) {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }

    try {
      // 从URL提取键名
      const key = this.extractKeyFromUrl(s3Url);
      if (!key) {
        throw new Error('无法从URL提取S3键名');
      }

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);
      
      // 将流转换为Buffer
      const chunks = [];
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // 转换为Base64
      const base64String = buffer.toString('base64');
      
      logger.info(`图片下载并转换为Base64成功: ${key}`);
      return base64String;

    } catch (error) {
      logger.error('S3图片下载失败:', error);
      throw new Error(`图片下载失败: ${error.message}`);
    }
  }

  // 从S3 URL提取键名
  extractKeyFromUrl(s3Url) {
    try {
      const url = new URL(s3Url);
      // 处理不同格式的S3 URL
      if (url.hostname.includes('s3')) {
        return url.pathname.slice(1); // 移除开头的 '/'
      }
      return null;
    } catch (error) {
      logger.error('URL解析失败:', error);
      return null;
    }
  }

  // 生成预签名URL
  async generatePresignedUrl(key, expiresIn = 3600) {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresIn
      });

      logger.info(`预签名URL生成成功: ${key}`);
      return signedUrl;

    } catch (error) {
      logger.error('预签名URL生成失败:', error);
      throw new Error(`预签名URL生成失败: ${error.message}`);
    }
  }

  // 检查S3对象是否存在
  async objectExists(key) {
    if (!this.s3Client) {
      return false;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      await this.s3Client.send(command);
      return true;

    } catch (error) {
      if (error.name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  // 获取S3对象信息
  async getObjectInfo(key) {
    if (!this.s3Client) {
      throw new Error('S3客户端未初始化');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });

      const response = await this.s3Client.send(command);
      
      return {
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        lastModified: response.LastModified,
        etag: response.ETag,
        metadata: response.Metadata
      };

    } catch (error) {
      logger.error('获取S3对象信息失败:', error);
      throw new Error(`获取对象信息失败: ${error.message}`);
    }
  }

  // 批量删除S3对象
  async deleteBulkObjects(keys) {
    if (!this.s3Client || !keys || keys.length === 0) {
      return;
    }

    const deletePromises = keys.map(key => this.deleteS3Object(key));
    
    try {
      await Promise.all(deletePromises);
      logger.info(`批量删除完成，共删除 ${keys.length} 个对象`);
    } catch (error) {
      logger.error('批量删除失败:', error);
      throw error;
    }
  }

  // 获取配置状态
  getStatus() {
    return {
      initialized: !!this.s3Client,
      bucket: this.bucket,
      region: config.aws.region,
      hasCredentials: !!(config.aws.accessKeyId && config.aws.secretAccessKey)
    };
  }
}

module.exports = new S3Utils();
