export type Role = 'super_admin' | 'model_admin' | 'content_reviewer' | 'operator' | 'data_viewer'
export type Section = 'overview' | 'users' | 'moderation' | 'models' | 'audit' | 'system' | 'imports' | 'comments' | 'production' | 'comics'

export interface AdminUser {
  id: string
  name: string
  account: string
  role: Role | 'creator' | 'user'
  status: 'active' | 'limited'
  works: number
}

export const roleLabels: Record<AdminUser['role'], string> = {
  super_admin: '超级管理员', model_admin: '模型管理员', content_reviewer: '内容审核员',
  operator: '运营人员', data_viewer: '数据查看员', creator: '创作者', user: '普通用户'
}

export const permissions: Record<Role, Section[]> = {
  super_admin: ['overview', 'users', 'moderation', 'models', 'audit', 'system', 'imports', 'comments', 'production', 'comics'],
  model_admin: ['overview', 'models', 'audit', 'system', 'production'],
  content_reviewer: ['overview', 'moderation', 'system', 'imports', 'comments', 'production', 'comics'],
  operator: ['overview', 'moderation', 'system', 'imports', 'comments', 'production', 'comics'],
  data_viewer: ['overview', 'audit', 'system', 'production']
}
