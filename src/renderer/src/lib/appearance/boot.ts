// Сначала стили приложения: наш <style> должен оказаться после них в <head>.
import '@renderer/assets/main.css'
import { applyBootCache } from './apply'

// Выполняется до первого рендера: применяем последнюю использованную тему из кэша.
applyBootCache()
