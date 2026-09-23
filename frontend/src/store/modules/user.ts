import { defineStore } from 'pinia'
import { login, getUserInfo } from '@/api/user'

interface UserState {
  token: string
  userInfo: any
  roles: string[]
  permissions: string[]
}

export const useUserStore = defineStore('user', {
  state: (): UserState => ({
    token: localStorage.getItem('token') || '',
    userInfo: {},
    roles: [],
    permissions: []
  }),

  actions: {
    async login(username: string, password: string) {
      const res = await login({ username, password })
      this.token = res.data.token
      localStorage.setItem('token', res.data.token)
      return res
    },

    async getUserInfo() {
      const res = await getUserInfo()
      this.userInfo = res.data.user
      this.roles = res.data.roles || []
      this.permissions = res.data.permissions || []
      return res
    },

     logout() {
      this.token = ''
      this.userInfo = {}
      this.roles = []
      this.permissions = []
      localStorage.removeItem('token')
      localStorage.removeItem('username')
    }
  }
})
