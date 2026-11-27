import React from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Screens only render their content here.  The wallpaper, its blur and the veil
// are painted once at the app root (components/AppBackground) behind the whole
// navigation tree, so a screen can never end up hidden behind the background.
export default function BackgroundWrapper({ children, style }) {
  return <SafeAreaView edges={['top']} style={[styles.foreground, style]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({ foreground: { flex: 1, overflow: 'hidden' } });
