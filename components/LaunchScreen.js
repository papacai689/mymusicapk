import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { Image } from 'expo-image';

// 红色启动页：白色图案 + 白色文字，最短停留 3.5 秒再淡出。
// 首页的数据正好在这段时间里加载，用户看到的是「有意的启动页」而不是白屏等待。
//
// 这一屏必须和 app.json 里的原生启动屏长得一模一样（同底色 #EC4141、同样 200px
// 的居中图标），并且图标不能被文字挤上去——否则原生屏收起的瞬间图标会跳一下，
// 看起来就是「先一屏、再一屏」。所以文字用绝对定位浮在图标下方，只做淡入。
const MIN_VISIBLE_MS = 3500;
export const LAUNCH_BACKGROUND = '#EC4141';

export default function LaunchScreen({ onDone }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(textOpacity, { toValue: 1, duration: 500, delay: 250, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(({ finished }) => {
        if (finished) onDone?.();
      });
    }, MIN_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [opacity, textOpacity, onDone]);
  return <Animated.View style={[styles.host, { opacity }]} pointerEvents="none">
    <Image source={require('../assets/splash-icon.png')} style={styles.logo} contentFit="contain" />
    <Animated.View style={[styles.textBlock, { opacity: textOpacity }]}>
      <Text style={styles.title}>音乐</Text>
      <Text style={styles.slogan}>随时随地，听见喜欢</Text>
    </Animated.View>
  </Animated.View>;
}

const styles = StyleSheet.create({
  host: { ...StyleSheet.absoluteFillObject, zIndex: 10, backgroundColor: LAUNCH_BACKGROUND, alignItems: 'center', justifyContent: 'center' },
  // 与 app.json 的 imageWidth 保持一致，两屏交接时图标尺寸不变。
  logo: { width: 200, height: 200 },
  // 绝对定位：文字出现时图标不会被顶上去，位置与原生启动屏完全重合。
  textBlock: { position: 'absolute', top: '50%', left: 0, right: 0, marginTop: 112, alignItems: 'center' },
  title: { fontSize: 30, fontWeight: '800', color: '#fff' },
  slogan: { marginTop: 10, fontSize: 13, color: 'rgba(255,255,255,.88)' },
});
