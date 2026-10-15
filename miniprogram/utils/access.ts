export type AppRole = 'user' | 'creator' | 'super_admin' | 'model_admin' | 'content_reviewer' | 'operator' | 'data_viewer'

export const roleLabels: Record<AppRole, string> = {
  user: '普通用户',
  creator: '创作者',
  super_admin: '超级管理员',
  model_admin: '模型管理员',
  content_reviewer: '内容审核员',
  operator: '运营人员',
  data_viewer: '数据查看员',
}

export const permissionLabels: Record<string, string> = {
  'work.read.own': '查看自己的作品',
  'work.edit.own': '编辑自己的作品',
  'content.review': '审核内容',
  'user.manage': '管理用户与角色',
  'model.manage': '管理模型供应商',
  'audit.read': '查看操作审计',
  'analytics.read': '查看数据报表',
}

export function getSession() {
  return wx.getStorageSync('mojing_session') || { userId: '', role: 'user' as AppRole, name: '墨境读者' }
}

export function isAdmin(role: AppRole) {
  return ['super_admin', 'model_admin', 'content_reviewer', 'operator', 'data_viewer'].indexOf(role) >= 0
}

export function can(permission: string, role: AppRole = getSession().role as AppRole) {
  const matrix: Record<AppRole, string[]> = {
    user: ['work.read.own'],
    creator: ['work.read.own', 'work.edit.own'],
    super_admin: Object.keys(permissionLabels),
    model_admin: ['model.manage', 'audit.read', 'analytics.read'],
    content_reviewer: ['work.read.own', 'content.review', 'analytics.read'],
    operator: ['work.read.own', 'content.review', 'analytics.read'],
    data_viewer: ['work.read.own', 'analytics.read', 'audit.read'],
  }
  return matrix[role]?.indexOf(permission) >= 0
}

export function requireAdmin() {
  const session = getSession()
  if (isAdmin(session.role as AppRole)) return true
  wx.showModal({ title: '无权限', content: '当前账号没有管理员后台权限。', showCancel: false })
  return false
}

export function isWorkOwner(workId: string, userId = getSession().userId) {
  return workId === 'work_demo' && userId === 'u_1001'
}
