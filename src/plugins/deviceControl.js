import { registerPlugin } from '@capacitor/core';

const DeviceControl = registerPlugin('DeviceControl');

// Enhance DeviceControl with utility for requesting microphone permission via the native plugin
DeviceControl.requestMicrophonePermissionNative = async () => {
  try {
    await DeviceControl.requestMicrophonePermission?.();
    return true;
  } catch (error) {
    console.warn('Native microphone permission request failed:', error);
    return false;
  }
};

export default DeviceControl;
