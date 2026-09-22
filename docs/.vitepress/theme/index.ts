import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import ThemePicker from '../components/ThemePicker.vue'
import './tokens.css'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h(ThemePicker),
      'nav-screen-content-after': () => h(ThemePicker),
    }),
}
