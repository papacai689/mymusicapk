import './services/logFilters';
import React,{useEffect,useState} from 'react';
import * as SplashScreen from 'expo-splash-screen';
import {ActivityIndicator,Image,View} from 'react-native';
import {setAudioModeAsync,requestNotificationPermissionsAsync} from 'expo-audio';
import {LinearGradient} from 'expo-linear-gradient';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer,DefaultTheme} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {Ionicons} from '@expo/vector-icons';
import {useThemeStore,getThemeTextColor} from './store/themeStore';import {useSourceStore} from './store/sourceStore';
import AppBackground from './components/AppBackground';
import LaunchScreen from './components/LaunchScreen';
import {usePlayerStore} from './store/playerStore';
import DiscoverScreen from './screens/DiscoverScreen';import LocalScreen from './screens/LocalScreen';import DownloadsScreen from './screens/DownloadsScreen';import {useDownloadStore} from './store/downloadStore';import {useLibraryStore} from './store/libraryStore';import ProfileScreen from './screens/ProfileScreen';import ThemeSettingsScreen from './screens/ThemeSettingsScreen';import MusicSourceScreen from './screens/MusicSourceScreen';import PlaybackSettingsScreen from './screens/PlaybackSettingsScreen';import PlaylistDetailScreen from './screens/PlaylistDetailScreen';import RankingDetailScreen from './screens/RankingDetailScreen';import PlayerScreen from './screens/PlayerScreen';import MiniPlayer from './components/MiniPlayer';
// 原生启动屏默认在 React 挂载的瞬间就收起来，紧接着 JS 启动页又画一遍红底图标，
// 用户看到的就是「翻了两屏」。这里让它一直留着，等 JS 启动页淡出时才收，
// 两屏因此首尾相接，看上去就是一屏。
SplashScreen.preventAutoHideAsync().catch(()=>{});
const hideSplash=()=>SplashScreen.hideAsync().catch(()=>{});
const Tab=createBottomTabNavigator(),Stack=createNativeStackNavigator();
function MainTabs({navigation}){
  const icons={Discover:'home-outline',Local:'musical-notes-outline',Downloads:'download-outline',Profile:'person-outline'};
  const color=useThemeStore(getThemeTextColor);
  const primary=useThemeStore(s=>s.primaryColor);
  const inactive=color==='#fff'?'rgba(255,255,255,.7)':'#6b7280';
  const bg=color==='#fff'?'rgba(0,0,0,.35)':'rgba(255,255,255,.9)';
  return <View style={{flex:1}}>
    <Tab.Navigator screenOptions={({route})=>({headerShown:false,tabBarActiveTintColor:primary,tabBarInactiveTintColor:inactive,tabBarStyle:{height:68,paddingBottom:10,paddingTop:8,backgroundColor:bg,borderTopWidth:0},tabBarLabelStyle:{fontSize:12,fontWeight:'600'},sceneStyle:{backgroundColor:'transparent'},tabBarIcon:({color,size})=><Ionicons name={icons[route.name]} color={color} size={size}/>})}>
      <Tab.Screen name="Discover" component={DiscoverScreen} options={{title:'首页'}}/>
      <Tab.Screen name="Local" component={LocalScreen} options={{title:'本地音乐'}}/>
      <Tab.Screen name="Downloads" component={DownloadsScreen} options={{title:'下载管理'}}/>
      <Tab.Screen name="Profile" component={ProfileScreen} options={{title:'我的'}}/>
    </Tab.Navigator>
    <MiniPlayer onPress={()=>navigation.navigate('Player')}/>
  </View>;
}
export default function App(){
  const th=useThemeStore(s=>s.hydrated),sh=useSourceStore(s=>s.hydrated),dh=useDownloadStore(s=>s.hydrated),lh=useLibraryStore(s=>s.hydrated),ph=usePlayerStore(s=>s.hydrated);
  const hydrateT=useThemeStore(s=>s.hydrate),hydrateS=useSourceStore(s=>s.hydrate),hydrateD=useDownloadStore(s=>s.hydrate),hydrateL=useLibraryStore(s=>s.hydrate),hydrateP=usePlayerStore(s=>s.hydrate);
  useEffect(()=>{hydrateT();hydrateS();hydrateD();hydrateL();hydrateP()},[]);
  useEffect(()=>{
    setAudioModeAsync({playsInSilentMode:true,shouldPlayInBackground:true,interruptionMode:'doNotMix'}).catch((error)=>console.warn('[Audio] 音频模式配置失败',error));
    // Android 13+ 要在状态栏/通知栏显示媒体播放控制，必须先拿到 POST_NOTIFICATIONS。
    // 已授权时这个方法会直接返回 granted、不会重复弹窗；非 Android 会抛错，静默忽略即可。
    requestNotificationPermissionsAsync().catch((error)=>console.warn('[Audio] 通知权限请求失败',error));
  },[]);
  const [showLaunch,setShowLaunch]=useState(true);
  if(!th||!sh||!dh||!lh||!ph)return <SafeAreaProvider><LinearGradient colors={['#EC4141','#C62F38']} start={{x:0,y:0}} end={{x:1,y:1}} style={{flex:1,alignItems:'center',justifyContent:'center'}}><Image source={require('./assets/splash-icon.png')} style={{width:200,height:200}} resizeMode="contain"/><ActivityIndicator color="rgba(255,255,255,.85)"/></LinearGradient></SafeAreaProvider>;
  // Transparent navigator surfaces so the wallpaper painted in AppBackground
  // shows through every screen, including pushed stack screens.
  const navTheme={...DefaultTheme,colors:{...DefaultTheme.colors,background:'transparent'}};
  return <SafeAreaProvider><View style={{flex:1}}><AppBackground/><NavigationContainer theme={navTheme}><Stack.Navigator screenOptions={{headerShown:false,contentStyle:{backgroundColor:'transparent'}}}><Stack.Screen name="Main" component={MainTabs}/><Stack.Screen name="ThemeSettings" component={ThemeSettingsScreen}/><Stack.Screen name="MusicSource" component={MusicSourceScreen}/><Stack.Screen name="PlaybackSettings" component={PlaybackSettingsScreen}/><Stack.Screen name="PlaylistDetail" component={PlaylistDetailScreen}/><Stack.Screen name="RankingDetail" component={RankingDetailScreen}/><Stack.Screen name="Player" component={PlayerScreen}/></Stack.Navigator></NavigationContainer>{showLaunch?<LaunchScreen onDone={()=>{setShowLaunch(false);hideSplash()}}/>:null}</View></SafeAreaProvider>;
}
