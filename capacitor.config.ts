import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.harimovies.app',
  appName: 'HM',
  webDir: 'build',
  server: {
    url: 'https://hari-movies.vercel.app',
    cleartext: true,
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false
  }
};

export default config;
