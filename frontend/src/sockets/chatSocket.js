// filepath: frontend/src/sockets/chatSocket.js
import { io } from "socket.io-client";

const chatSocket = (() => {
  let socket = null;
  const listeners = [];

  const connect = () => {
    if (socket && socket.connected) {
      console.log("Socket already connected");
      return;
    }
    
    console.log("Connecting to WebSocket server...");
    
    // 根据环境和当前页面路径判断Socket.IO连接地址
    const getSocketURL = () => {
      if (process.env.NODE_ENV === 'production') {
        // 生产环境使用当前域名
        return window.location.origin;
      } else {
        // 开发环境直接连接后端
        return 'http://localhost:5001';
      }
    };

    const getSocketPath = () => {
      if (process.env.NODE_ENV === 'production') {
        // 生产环境：使用统一的Socket.IO路径
        console.log('生产环境Socket.IO端点: /socket.io/');
        return '/socket.io/';
      } else {
        console.log('开发环境Socket.IO端点: /socket.io/');
        return '/socket.io/';
      }
    };

    const socketURL = getSocketURL();
    const socketPath = getSocketPath();
    
    console.log('Socket连接配置:', { url: socketURL, path: socketPath });

    socket = io(socketURL, {
      path: socketPath,
      transports: ['websocket'],
      upgrade: false,
      pingTimeout: 60000,    // 60秒无响应才断开
      pingInterval: 15000    // 15秒发一次心跳
    });

    socket.on("connect", () => {
      console.log("Socket.IO connected successfully");
    });
    
    socket.on("disconnect", () => {
      console.log("Socket.IO disconnected");
    });

    socket.on("connect_error", (error) => {
      console.error("Socket.IO connection error:", error);
    });

    socket.on("response", (data) => {
      console.log("Received response:", data);
      listeners.forEach((listener) => listener({ type: "response", ...data }));
    });

    // 处理AI流式响应
    socket.on("ai_response", (data) => {
      // 防止监听器为空或未及时注册
      if (listeners.length === 0) {
        console.warn("No listeners for ai_response:", data);
      }
      console.log("AI response:", data);
      listeners.forEach((listener) => listener({ type: "ai_response", ...data }));
    });

    // 处理模型开始响应
    socket.on("model_start", (data) => {
      console.log("Model started:", data);
      listeners.forEach((listener) => listener({ type: "model_start", ...data }));
    });

    // 处理模型完成响应
    socket.on("model_complete", (data) => {
      console.log("Model completed:", data);
      listeners.forEach((listener) => listener({ type: "model_complete", ...data }));
    });

    // 处理模型错误
    socket.on("model_error", (data) => {
      console.log("Model error:", data);
      listeners.forEach((listener) => listener({ type: "model_error", ...data }));
    });

    // 处理消息完成
    socket.on("message_complete", (data) => {
      console.log("Message completed:", data);
      listeners.forEach((listener) => listener({ type: "message_complete", ...data }));
    });

    // 处理生成开始
    socket.on("generation_started", (data) => {
      console.log("Generation started:", data);
      listeners.forEach((listener) => listener({ type: "generation_started", ...data }));
    });

    // 处理生成完成
    socket.on("generation_finished", (data) => {
      console.log("Generation finished:", data);
      listeners.forEach((listener) => listener({ type: "generation_finished", ...data }));
    });

    // 处理生成停止
    socket.on("generation_stopped", (data) => {
      console.log("Generation stopped:", data);
      listeners.forEach((listener) => listener({ type: "generation_stopped", ...data }));
    });

    // 新增错误监听
    socket.on("error", (err) => {
        console.error("Socket.IO error:", err);
    });
    // socket.onAny((event, data) => {
    //   console.log(`Received event: ${event}`, data);
    //   listeners.forEach((listener) => listener({ type: event, ...data }));
    // });
  };

  const sendMessage = (message) => {
    console.log("Sending message:", message);
    if (socket && socket.connected) {
      socket.emit("send_message", message);
    } else {
      console.error("Socket.IO is not connected.");
    }
  };

  const sendMessageWithImage = (message) => {
    console.log("Sending message with image:", message);
    if (socket && socket.connected) {
      socket.emit("send_message_with_image", message);
    } else {
      console.error("Socket.IO is not connected.");
    }
  };

  const sendMessageWithThinking = (message) => {
    console.log("Sending message with thinking mode:", message);
    if (socket && socket.connected) {
      socket.emit("send_message_with_thinking", message);
    } else {
      console.error("Socket.IO is not connected.");
    }
  };

  const sendStopGeneration = (data) => {
    console.log("Sending stop generation request:", data);
    if (socket && socket.connected) {
      socket.emit("stop_generation", data);
    } else {
      console.error("Socket.IO is not connected.");
    }
  };

  const isReady = () => socket && socket.connected;

  // const addListener = (listener) => listeners.push(listener);
    // 防止重复添加同一个监听器
  const addListener = (listener) => {
    if (!listeners.includes(listener)) listeners.push(listener);
  };
  const removeListener = (listener) => {
    const index = listeners.indexOf(listener);
    if (index > -1) listeners.splice(index, 1);
  };

  return { connect, sendMessage, sendMessageWithImage, sendStopGeneration, addListener, removeListener, isReady };
})();

export default chatSocket;
