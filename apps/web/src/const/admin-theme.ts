import type { ThemeConfig } from 'antd'

/** Admin 区域固定浅色经典中后台主题，不受用户端 dark 模式影响。 */
export const adminTheme: ThemeConfig = {
  cssVar: { key: 'aigateway-admin' },
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 6,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif",
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      bodyBg: '#f5f5f5',
      siderBg: '#ffffff',
      triggerBg: '#fafafa',
      triggerColor: 'rgba(0, 0, 0, 0.65)',
    },
    Menu: {
      itemBorderRadius: 8,
      itemHeight: 40,
      itemSelectedBg: '#e6f4ff',
      itemSelectedColor: '#1677ff',
      itemHoverBg: 'rgba(0, 0, 0, 0.04)',
      iconSize: 16,
      activeBarBorderWidth: 0,
    },
  },
}
