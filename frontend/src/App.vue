<!-- <template>
  <MenuBarView />
</template>

<script>
import MenuBarView from './components/MenuBarView.vue'

export default {
  name: 'App',
  components: {
    MenuBarView
  }
}
</script>

<style>
/* 可选：全局样式，或留空 */
</style> -->

<template>
  <div>
    <div v-if="!isAuthenticated" class="login-bg">
      <div class="login-box">
        <img src="/logoin.png" alt="APM" class="login-logo" />
        <div class="login-title">AI-Chat 欢迎你</div>
        <button class="azure-login-btn" @click="loginWithAzure">
          使用 Azure 单点登录
        </button>
      </div>
    </div>
    <div v-else>
      <MenuBarView :account="account" @logout="handleLogout"/>
    </div>
  </div>
</template>

<script>
import MenuBarView from './components/MenuBarView.vue'
// 假设你已在 api.js 封装了登录相关方法
import { azureLogin, getAzureAccessToken, verifyAzureToken, userRegistration } from './api/api'

export default {
  name: 'App',
  components: { MenuBarView },
  data() {
    return {
      isAuthenticated: false,
      account: null,
      tokenCheckTimer: null
    }
  },
  async created() {
    document.title = "Ai Chat"
    const cached = localStorage.getItem('account')
    const cachedToken = localStorage.getItem('azure_access_token')
    const tokenExpiry = localStorage.getItem('token_expiry')
    
    if (cached && cachedToken && tokenExpiry) {
      // 检查token是否过期
      const now = new Date().getTime()
      const expiryTime = parseInt(tokenExpiry)
      
      if (now < expiryTime) {
        // Token未过期，直接使用缓存的账户信息
        this.account = JSON.parse(cached)
        this.isAuthenticated = true
        console.log('使用缓存的登录状态')
        
        // 启动token过期检查定时器
        this.startTokenExpiryCheck()
      } else {
        // Token已过期，清理缓存并要求重新登录
        console.log('Token已过期，需要重新登录')
        this.clearStoredData()
      }
    }
  },
  methods: {
    async loginWithAzure() {
      try {
        const loginResponse = await azureLogin()
        const accessToken = await getAzureAccessToken(loginResponse.account)
        console.log("accessToken：", accessToken)
        
        // 计算token过期时间（通常access token有效期为1小时）
        const expiryTime = new Date().getTime() + (24 * 60 * 60 * 1000) // 24小时后过期

        const verifyRes = await verifyAzureToken(accessToken)
        if (verifyRes.status === 'ok') {
          const regRes = await userRegistration({
            user_id: loginResponse.account.idTokenClaims.oid,
            user_name: loginResponse.account.name,
            email: loginResponse.account.username
          })
          
          if (regRes.data.status === 'ok' || regRes.data.status === 'success in creation') {
            this.isAuthenticated = true
            this.account = loginResponse.account
            
            // 保存账户信息、access token和过期时间
            localStorage.setItem('account', JSON.stringify(loginResponse.account))
            localStorage.setItem('azure_access_token', accessToken)
            localStorage.setItem('token_expiry', expiryTime.toString())
            
            // 启动token过期检查定时器
            this.startTokenExpiryCheck()
            
            console.log("登录成功，token将在1小时后过期")
          } else {
            alert('用户注册/验证失败')
          }
        } else {
          alert('Azure 验证失败')
        }
      } catch (e) {
        console.error('登录错误:', e)
        alert('登录失败: ' + e.message)
      }
    },
    handleLogout() {
      this.isAuthenticated = false
      this.account = null
      this.clearStoredData()
      this.stopTokenExpiryCheck()
    },
    
    clearStoredData() {
      // 清理所有本地存储的登录相关数据
      localStorage.removeItem('account')
      localStorage.removeItem('azure_access_token')
      localStorage.removeItem('token_expiry')
    },
    
    // 检查token是否即将过期，如果是则提示用户重新登录
    checkTokenExpiry() {
      const tokenExpiry = localStorage.getItem('token_expiry')
      if (tokenExpiry) {
        const now = new Date().getTime()
        const expiryTime = parseInt(tokenExpiry)
        const timeLeft = expiryTime - now

        // 如果token在30分钟内过期，提示用户
        if (timeLeft < 30 * 60 * 1000 && timeLeft > 0) {
          console.log('Token即将在30分钟内过期')
          // 可以在这里显示提示或自动刷新token
        } else if (timeLeft <= 0) {
          console.log('Token已过期，需要重新登录')
          this.handleLogout()
        }
      }
    },
    
    startTokenExpiryCheck() {
      // 每分钟检查一次token状态
      this.tokenCheckTimer = setInterval(() => {
        this.checkTokenExpiry()
      }, 60 * 1000) // 60秒检查一次
    },
    
    stopTokenExpiryCheck() {
      if (this.tokenCheckTimer) {
        clearInterval(this.tokenCheckTimer)
        this.tokenCheckTimer = null
      }
    }
  },
  
  beforeUnmount() {
    // 组件销毁时清理定时器
    this.stopTokenExpiryCheck()
  }
}
</script>

<style scoped>
.login-bg {
  min-height: 100vh;
  background: #f4f8fc;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-box {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  padding: 48px 36px 36px 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 320px;
}
.login-logo {
  width: 140px;
  height: 72px;
  margin-bottom: 18px;
}
.login-title {
  font-size: 22px;
  font-weight: bold;
  margin-bottom: 32px;
  color: #222;
}
.azure-login-btn {
  background: #1477ff;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 12px 32px;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.2s;
}
.azure-login-btn:hover {
  background: #125fcc;
}
</style>