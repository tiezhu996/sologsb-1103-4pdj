<script setup lang="ts">
import { computed } from 'vue'
import type { FixturePosition } from '@/types/fixture'
import { POSITION_COLORS } from '@/types/fixture'

/**
 * ChannelChip 通道标签：通道号 + 灯位色块 + 亮度百分比。
 * 被灯位配置台、Cue 时间轴与电平编辑页共同消费。
 */
const props = withDefaults(
  defineProps<{
    /** DMX 通道号 */
    channel: number
    /** 灯位方位，决定色块颜色 */
    position?: FixturePosition | null
    /** 亮度百分比 0-100，未设定时传 null */
    intensity?: number | null
    /** 色纸编号 */
    gel?: string
    /** 灯具类型 */
    fixtureType?: string
    /** 是否为重复通道号 */
    duplicate?: boolean
    /** 是否为选中态 */
    selected?: boolean
    /** 是否显示悬停手型并可点击 */
    clickable?: boolean
    /** 尺寸 */
    size?: 'small' | 'medium'
  }>(),
  {
    position: null,
    intensity: null,
    gel: '',
    fixtureType: '',
    duplicate: false,
    selected: false,
    clickable: false,
    size: 'medium'
  }
)

const emit = defineEmits<{
  (event: 'click'): void
}>()

const dotColor = computed(() => (props.position ? POSITION_COLORS[props.position] : '#8a8f9c'))

const intensityText = computed(() => (props.intensity === null || props.intensity === undefined ? '—' : `${props.intensity}%`))

const intensityWidth = computed(() => `${Math.min(100, Math.max(0, props.intensity ?? 0))}%`)

function handleClick(): void {
  if (props.clickable) emit('click')
}
</script>

<template>
  <span
    class="channel-chip"
    :class="[
      `channel-chip--${props.size}`,
      {
        'channel-chip--duplicate': props.duplicate,
        'channel-chip--selected': props.selected,
        'channel-chip--clickable': props.clickable
      }
    ]"
    :title="`CH${props.channel}${props.position ? ` · ${props.position}` : ''}${props.fixtureType ? ` · ${props.fixtureType}` : ''}`"
    @click="handleClick"
  >
    <span class="channel-chip__dot" :style="{ background: dotColor }" />
    <span class="channel-chip__no">CH{{ props.channel }}</span>
    <span v-if="props.gel" class="channel-chip__gel">{{ props.gel }}</span>
    <span class="channel-chip__intensity">
      <span class="channel-chip__intensity-track">
        <span class="channel-chip__intensity-fill" :style="{ width: intensityWidth }" />
      </span>
      <span class="channel-chip__intensity-text">{{ intensityText }}</span>
    </span>
  </span>
</template>

<style scoped>
.channel-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
  font-variant-numeric: tabular-nums;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
  white-space: nowrap;
}

.channel-chip--small {
  padding: 1px 6px;
  font-size: 11px;
  gap: 4px;
}

.channel-chip--clickable {
  cursor: pointer;
}

.channel-chip--clickable:hover {
  border-color: rgba(242, 181, 68, 0.6);
  transform: translateY(-1px);
}

.channel-chip--selected {
  border-color: rgba(242, 181, 68, 0.85);
  background: rgba(242, 181, 68, 0.14);
}

.channel-chip--duplicate {
  border-color: rgba(232, 84, 84, 0.85);
  background: rgba(232, 84, 84, 0.14);
  color: #ffbdbd;
}

.channel-chip__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.25);
}

.channel-chip__no {
  font-weight: 600;
  letter-spacing: 0.4px;
}

.channel-chip__gel {
  padding: 0 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 10px;
}

.channel-chip__intensity {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.channel-chip__intensity-track {
  display: inline-block;
  width: 32px;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.channel-chip__intensity-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #f2b544, #ffe6b0);
}

.channel-chip__intensity-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  min-width: 30px;
  text-align: right;
}
</style>
