import { create } from 'zustand'

export type Account = { id: number; username: string; nickname: string; admin: boolean }
export const useAccount = create(() => ({
  ready: false,
  enabled: false,
  user: null as Account | null,
  publicOrigin: '',
  dialog: null as 'login' | 'register' | 'password' | null,
}))
export const storageOwner = () => useAccount.getState().user?.id ?? null
export const isCloudMode = () => storageOwner() !== null
export const openAccountDialog = (dialog: 'login' | 'register' | 'password' = 'login') =>
  useAccount.setState({ dialog })
export const closeAccountDialog = () => useAccount.setState({ dialog: null })
