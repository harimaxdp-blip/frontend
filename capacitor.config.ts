import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.harimovies.app',
  appName: 'HM',
  webDir: 'build',
  server: {
    url: 'https://hm-tau-eight.vercel.app',
    cleartext: true,
    androidScheme: 'https'
  }
};

export default config;
