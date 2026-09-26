<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NInput } from 'naive-ui'
import { isValidCueNo, normalizeCueNo } from '@/utils/cueOrder'

/**
 * CueNoInput：Cue 编号输入与重号校验，支持 `Q12.5` 形式。
 * 被 Cue 时间轴与电平编辑页共同消费。
 */
const props = withDefaults(
  defineProps<{
    /** 当前编号 */
    modelValue: string
    /** 同场次已占用的编号（需自行排除自身） */
    existingNos?: string[]
    /** 尺寸 */
    size?: 'tiny' | 'small' | 'medium' | 'large'
    /** 是否禁用 */
    disabled?: boolean
    /** 提示占位 */
    placeholder?: string
    /** 是否展示校验反馈文案 */
    showFeedback?: boolean
    /** 宽度 */
    width?: string
  }>(),
  {
    existingNos: () => [],
    size: 'small',
    disabled: false,
    placeholder: 'Q12.5',
    showFeedback: true,
    width: '112px'
  }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void
  (event: 'commit', value: string): void
  (event: 'invalid', reason: string | null): void
}>()

const text = ref<string>(normalizeCueNo(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    const normalized = normalizeCueNo(value)
    if (normalized !== normalizeCueNo(text.value)) text.value = normalized
  }
)

const normalized = computed(() => normalizeCueNo(text.value))

const errorText = computed<string | null>(() => {
  if (!normalized.value) return '编号不能为空'
  if (!isValidCueNo(normalized.value)) return '编号需形如 Q12 或 Q12.5'
  if (props.existingNos.includes(normalized.value) && normalized.value !== normalizeCueNo(props.modelValue)) {
    return '编号已被占用'
  }
  return null
})

watch(errorText, (value) => emit('invalid', value), { immediate: true })

const status = computed<'error' | undefined>(() => (errorText.value ? 'error' : undefined))

function commit(): void {
  if (errorText.value) return
  text.value = normalized.value
  emit('update:modelValue', normalized.value)
  emit('commit', normalized.value)
}

function handleBlur(): void {
  commit()
}
</script>

<template>
  <div class="cue-no-input" :style="{ width: props.width }">
    <NInput
      v-model:value="text"
      :size="props.size"
      :disabled="props.disabled"
      :placeholder="props.placeholder"
      :status="status"
      :allow-input="(value: string) => /^[Qq0-9.]*$/.test(value)"
      @blur="handleBlur"
      @keyup.enter="commit"
    />
    <span v-if="props.showFeedback && errorText" class="cue-no-input__error">{{ errorText }}</span>
    <span v-else-if="props.showFeedback && normalized" class="cue-no-input__ok">{{ normalized }}</span>
  </div>
</template>

<style scoped>
.cue-no-input {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cue-no-input__error {
  font-size: 11px;
  color: #ff9a9a;
  line-height: 1.4;
}

.cue-no-input__ok {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.38);
  line-height: 1.4;
}
</style>
