import React from 'react';
import { Text } from 'react-native';
import { getMutedTextColor, getThemeTextColor, useThemeStore } from '../store/themeStore';

const SIZES = { title: 20, subtitle: 16, body: 15, caption: 12 };
const WEIGHTS = { title: '800', subtitle: '700', body: '600', caption: '400' };

// Text that follows the theme: colour comes from the store, so switching text
// colour or dark mode re-renders every label automatically.
export default function ThemedText({ children, variant = 'body', muted = false, weight, style, ...rest }) {
  const color = useThemeStore(getThemeTextColor);
  const mutedColor = useThemeStore(getMutedTextColor);
  const size = SIZES[variant] || SIZES.body;
  return <Text
    {...rest}
    style={[{ fontSize: size, color: muted ? mutedColor : color, fontWeight: WEIGHTS[variant] || WEIGHTS.body }, weight ? { fontWeight: weight } : null, style]}
  >{children}</Text>;
}
