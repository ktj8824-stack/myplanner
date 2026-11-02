import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'kr.myplanner.app',
  appName: 'MyPlanner',
  webDir: 'www',
  plugins: {
    LocalNotifications: {
      iconColor: '#2563eb'
    }
  }
};

export default config;
