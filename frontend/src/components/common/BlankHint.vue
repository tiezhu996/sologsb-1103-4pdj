<script setup lang="ts">
/**
 * BlankHint 空态引导：说明当前为什么是空的，并给出新建入口。
 * 被场次编排与排演表页共同消费。
 */
const props = withDefaults(
  defineProps<{
    /** 空态标题 */
    title: string
    /** 补充说明 */
    description?: string
    /** 主按钮文案，留空则不渲染按钮 */
    actionText?: string
    /** 次要说明（快捷键、注意事项） */
    tip?: string
  }>(),
  {
    description: '',
    actionText: '',
    tip: ''
  }
)

const emit = defineEmits<{
  (event: 'action'): void
}>()
</script>

<template>
  <div class="blank-hint">
    <div class="blank-hint__icon" aria-hidden="true">
      <svg viewBox="0 0 64 64" width="44" height="44">
        <path d="M32 6 L50 30 H14 Z" fill="none" stroke="#f2b544" stroke-width="2.5" stroke-linejoin="round" />
        <circle cx="32" cy="40" r="7" fill="none" stroke="#f2b544" stroke-width="2.5" opacity="0.7" />
        <path d="M18 54 h28" stroke="#3fbf9f" stroke-width="2.5" stroke-linecap="round" opacity="0.8" />
      </svg>
    </div>
    <div class="blank-hint__body">
      <p class="blank-hint__title">{{ props.title }}</p>
      <p v-if="props.description" class="blank-hint__description">{{ props.description }}</p>
      <p v-if="props.tip" class="blank-hint__tip">{{ props.tip }}</p>
    </div>
    <div class="blank-hint__actions">
      <slot name="action">
        <button v-if="props.actionText" type="button" class="blank-hint__button" @click="emit('action')">
          {{ props.actionText }}
        </button>
      </slot>
    </div>
    <div v-if="$slots.default" class="blank-hint__extra">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.blank-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 42px 24px;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  text-align: center;
}

.blank-hint__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(242, 181, 68, 0.08);
  border: 1px solid rgba(242, 181, 68, 0.22);
}

.blank-hint__body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: 520px;
}

.blank-hint__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
}

.blank-hint__description {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.55);
}

.blank-hint__tip {
  margin: 0;
  font-size: 12px;
  color: rgba(242, 181, 68, 0.8);
}

.blank-hint__button {
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  background: linear-gradient(135deg, #f2b544, #e0932c);
  color: #1a1408;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.2s ease, transform 0.15s ease;
}

.blank-hint__button:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.blank-hint__extra {
  width: 100%;
  display: flex;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
