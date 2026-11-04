import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'kr.myplanner.app',
  appName: '마이플래너',
  webDir: 'www',
  plugins: {
    LocalNotifications: {
      iconColor: '#1F2A44'
    }
  }
};

export default config;
