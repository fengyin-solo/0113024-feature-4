<template>
  <div class="layout-container">
    <el-container class="h-full">
      <el-aside :width="isCollapse ? '64px' : '220px'" class="sidebar">
        <div class="logo">
          <h3 v-if="!isCollapse">单井全生命周期</h3>
          <h3 v-else>WLMS</h3>
        </div>
        <el-menu
          :default-active="$route.path"
          :collapse="isCollapse"
          router
          background-color="#0f172a"
          text-color="#94a3b8"
          active-text-color="#3b82f6"
        >
          <template v-for="item in menuList" :key="item.path">
            <el-sub-menu v-if="item.children && item.children.length > 0" :index="item.path">
              <template #title>
                <el-icon><component :is="item.meta.icon" /></el-icon>
                <span>{{ item.meta.title }}</span>
              </template>
              <el-menu-item v-for="child in item.children" :key="child.path" :index="`${item.path}/${child.path}`">
                {{ child.meta.title }}
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item v-else :index="item.path">
              <el-icon><component :is="item.meta.icon" /></el-icon>
              <template #title>{{ item.meta.title }}</template>
            </el-menu-item>
          </template>
        </el-menu>
      </el-aside>
      
      <el-container class="main-container">
        <el-header class="header">
          <div class="header-left">
            <el-icon class="collapse-icon" @click="isCollapse = !isCollapse">
              <Expand v-if="isCollapse" />
              <Fold v-else />
            </el-icon>
            <el-breadcrumb separator="/">
              <el-breadcrumb-item :to="{ path: '/' }">首页</el-breadcrumb-item>
              <el-breadcrumb-item>{{ currentTitle }}</el-breadcrumb-item>
            </el-breadcrumb>
          </div>
          <div class="header-right">
            <el-dropdown @command="handleCommand">
              <div class="user-info">
                <el-avatar :size="32" icon="User" />
                <span class="username">{{ username }}</span>
                <el-icon><ArrowDown /></el-icon>
              </div>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="profile">个人中心</el-dropdown-item>
                  <el-dropdown-item command="password">修改密码</el-dropdown-item>
                  <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </el-header>
        
        <el-main class="main-content">
          <router-view v-slot="{ Component }">
            <transition name="fade-transform" mode="out-in">
              <component :is="Component" />
            </transition>
          </router-view>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useUserStore } from '@/store/modules/user'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()
const isCollapse = ref(false)
const username = ref(localStorage.getItem('username') || '管理员')

const menuList = computed(() => {
  const routes = router.options.routes.find(r => r.path === '/')?.children || []
  return routes.filter(r => r.meta?.title && r.path !== '')
})

const currentTitle = computed(() => {
  return route.meta?.title || ''
})

const handleCommand = (command: string) => {
  if (command === 'logout') {
    ElMessageBox.confirm('确定要退出登录吗?', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    }).then(() => {
      userStore.logout()
      ElMessage.success('退出成功')
      router.push('/login')
    })
  }
}
</script>

<style scoped lang="scss">
.layout-container {
  width: 100%;
  height: 100%;
}

.sidebar {
  background-color: #0f172a;
  transition: width 0.3s;
  overflow: hidden;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #1e293b;
  
  h3 {
    color: #fff;
    font-size: 16px;
    margin: 0;
    white-space: nowrap;
  }
}

:deep(.el-menu) {
  border-right: none;
}

.main-container {
  display: flex;
  flex-direction: column;
  background-color: #f1f5f9;
}

.header {
  background-color: #fff;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  height: 60px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 20px;
}

.collapse-icon {
  font-size: 20px;
  cursor: pointer;
  color: #475569;
  
  &:hover {
    color: #3b82f6;
  }
}

.header-right {
  .user-info {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    
    .username {
      font-size: 14px;
      color: #334155;
    }
  }
}

.main-content {
  padding: 20px;
  overflow-y: auto;
}

.fade-transform-enter-active,
.fade-transform-leave-active {
  transition: all 0.3s;
}

.fade-transform-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.fade-transform-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
