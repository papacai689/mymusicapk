import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getBarSurface, useThemeStore } from '../store/themeStore';
export const TOP_NAV_ITEMS = ['首页', '推荐', '排行榜', '歌单', '搜索'];
export default function TopNav({ navigation, active = '首页', onSelect }) {
  const barSurface = useThemeStore(getBarSurface);
  const select = (item) => {
    if (onSelect) return onSelect(item);
    return navigation?.navigate('Main', { screen: 'Discover', params: { initialNav: item, navKey: Date.now() } });
  };
  return <View style={[styles.wrap, { backgroundColor: barSurface, borderBottomColor: 'transparent' }]}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar}>{TOP_NAV_ITEMS.map((item) => <Pressable key={item} onPress={() => select(item)} style={[styles.item, active === item && styles.active]}><Text style={[styles.text, active === item && styles.activeText]}>{item}</Text></Pressable>)}</ScrollView></View>;
}
const styles = StyleSheet.create({wrap:{backgroundColor:'#fff',borderBottomWidth:1,borderBottomColor:'#F0F0F0'},bar:{paddingHorizontal:12,paddingVertical:8,gap:8},item:{paddingHorizontal:14,paddingVertical:9,borderRadius:20},active:{backgroundColor:'#fde8e8'},text:{color:'#777',fontSize:15,fontWeight:'700'},activeText:{color:'#EC4141'}});
