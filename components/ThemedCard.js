import React from 'react';
import { StyleSheet, View } from 'react-native';
import { getSurfaceBorderColor, getSurfaceColor, useThemeStore } from '../store/themeStore';

// Surface that follows the theme: light translucent over a light backdrop,
// dark translucent once dark mode is on with a picture behind it.
export default function ThemedCard({ children, style, padded = true, ...rest }) {
  const backgroundColor = useThemeStore(getSurfaceColor);
  const borderColor = useThemeStore(getSurfaceBorderColor);
  return <View {...rest} style={[styles.card, padded ? styles.padded : null, { backgroundColor, borderColor }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth },
  padded: { padding: 18 },
});
