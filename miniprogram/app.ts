import { ensureSession } from './utils/api'

App<IAppOption>({
  globalData: {},
  onLaunch() {
    Promise.resolve().then(() => ensureSession()).catch((error: Error) => wx.showToast({ title: error.message, icon: 'none' }))
  },
})
