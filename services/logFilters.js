import { LogBox } from 'react-native';
import Constants from 'expo-constants';

// Imported first from App.js so the filters are installed before any screen
// module is evaluated.
//
// Everything below is an Expo Go limitation whose real fix is a development or
// standalone build, and Expo Go shows them as red overlays that cover the UI and
// swallow taps — which makes working features look broken.  They are muted only
// inside Expo Go, so a genuine failure still surfaces in a real build.
if (Constants.appOwnership === 'expo') {
  LogBox.ignoreLogs([
    // expo-media-library warns simply because it is imported by LocalScreen;
    // that screen already refuses to scan the library here.
    /Expo Go can no longer provide full access to the media library/,
    // expo-audio's background service needs the enableBackgroundPlayback
    // config plugin, which Expo Go cannot apply.
    /Failed to start the expo-audio playback service/,
    /Failed to activate lock screen controls/,
    // Temporary diagnostics from BackgroundWrapper; they are forwarded to the
    // Metro terminal, which is where they are useful, not on the device.
    /^\[theme\]/,
  ]);
}
