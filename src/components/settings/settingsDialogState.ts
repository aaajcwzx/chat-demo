import { create } from 'zustand'
import { isChannelConfigured } from '../../services/channels.js'

/** 设置弹窗的分组：通用设置 / 数据管理 */
export type SettingsSection = 'general' | 'service' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
  channelId: undefined as string | undefined,
}))

export const openSettings = (section: SettingsSection, channelId?: string) =>
  useSettingsDialog.setState({ open: true, section, channelId })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有 API Key 时打开设置并选中 API Key 所在的「数据管理」，返回是否已有 Key */
export const ensureApiKey = () => {
  if (isChannelConfigured()) {
    return true
  }
  openSettings('service')
  return false
}
