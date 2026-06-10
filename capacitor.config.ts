import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.harimovies.app',
  appName: 'HM',
  webDir: 'build',
  server: {
    url: 'https://frontend-livid-nu-32.vercel.app',
    cleartext: false
  }
};

export default config;