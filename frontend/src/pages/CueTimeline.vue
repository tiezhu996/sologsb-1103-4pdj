<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NAlert,
  NButton,
  NForm,
  NFormItem,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  useDialog,
  useMessage
} from 'naive-ui'
import ChannelChip from '@/components/common/ChannelChip.vue'
import CueNoInput from '@/components/common/CueNoInput.vue'
import FadeBar from '@/components/common/FadeBar.vue'
import { useCueOrder } from '@/hooks/useCueOrder'
import { useCueStore, type CuePatch, type FadeShiftScope } from '@/stores/cueStore'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'
import { useSessionStore } from '@/stores/sessionStore'
import { CUE_TRIGGERS, type Cue, type CueTrigger } from '@/types/cue'
import type { FixturePosition } from '@/types/fixture'
import { cueTotalSeconds, formatSeconds, formatTransition } from '@/utils/fade'
import { isValidCueNo, normalizeCueNo } from '@/utils/cueOrder'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const sessionStore = useSessionStore()
const cueStore = useCueStore()
const fixtureStore = useFixtureStore()
const levelStore = useLevelStore()

const sessionId = computed(() => String(route.params.id ?? ''))
const session = computed(() => sessionStore.sessionById(sessionId.value))

const { cues, summary, nextCueNo, hardCutCount, reorder } = useCueOrder(sessionId)

const triggerOptions = CUE_TRIGGERS.map((trigger) => ({ label: trigger, value: trigger }))
const scopeOptions = [
  { label: '渐亮 + 渐暗', value: 'both' },
  { label: '仅渐亮', value: 'in' },
  { label: '仅渐暗', value: 'out' }
]

const fixtures = computed(() => fixtureStore.sortedFixturesOfSession(sessionId.value))
const cueNoList = computed(() => cues.value.map((cue) => cue.cueNo))
const totalDuration = computed(() => summary.value.totalSec)

/** 通道芯片的展示数据 */
interface CueChannelChip {
  fixtureId: string
  channel: number
  intensity: number
  position: FixturePosition | null
}

/** 一条 Cue 已设定电平的通道标签 */
function channelsOfCue(cueId: string): CueChannelChip[] {
  const chips: CueChannelChip[] = []
  levelStore.levelsOfCue(cueId).forEach((level) => {
    const fixture = fixtureStore.fixtureById(level.fixtureId)
    if (!fixture) return
    chips.push({
      fixtureId: level.fixtureId,
      channel: fixture.channel,
      intensity: level.intensity,
      position: fixture.position
    })
  })
  return chips.sort((a, b) => a.channel - b.channel)
}

/* ---------------- 新增 Cue ---------------- */
const showCreate = ref(false)
const createForm = reactive<{
  cueNo: string
  label: string
  trigger: CueTrigger
  fadeInSec: number | null
  fadeOutSec: number | null
  holdSec: number | null
  note: string
}>({
  cueNo: '',
  label: '',
  trigger: '手动',
  fadeInSec: 3,
  fadeOutSec: 3,
  holdSec: 5,
  note: ''
})

const createError = computed(() => {
  if (!isValidCueNo(createForm.cueNo)) return '编号需形如 Q12 或 Q12.5'
  if (cueStore.isCueNoTaken(sessionId.value, normalizeCueNo(createForm.cueNo))) return '该编号在本场次已存在'
  return null
})

function openCreate(): void {
  createForm.cueNo = nextCueNo.value
  createForm.label = ''
  createForm.trigger = '手动'
  createForm.fadeInSec = 3
  createForm.fadeOutSec = 3
  createForm.holdSec = 5
  createForm.note = ''
  showCreate.value = true
}

function handleCreateTrigger(value: string | number | Array<string | number> | null): void {
  if (typeof value === 'string' && (CUE_TRIGGERS as readonly string[]).includes(value)) {
    createForm.trigger = value as CueTrigger
  }
}

async function submitCreate(): Promise<void> {
  if (createError.value) {
    message.error(createError.value)
    return
  }
  await cueStore.addCue({
    sessionId: sessionId.value,
    cueNo: normalizeCueNo(createForm.cueNo),
    label: createForm.label.trim(),
    trigger: createForm.trigger,
    fadeInSec: createForm.fadeInSec ?? 0,
    fadeOutSec: createForm.fadeOutSec ?? 0,
    holdSec: createForm.holdSec ?? 0,
    note: createForm.note.trim()
  })
  message.success(`已插入 ${normalizeCueNo(createForm.cueNo)}`)
  showCreate.value = false
}

/* ---------------- 批量偏移 ---------------- */
const showShift = ref(false)
const shiftForm = reactive<{ deltaSec: number | null; scope: FadeShiftScope }>({ deltaSec: 0.5, scope: 'both' })

function handleScopeChange(value: string | number | Array<string | number> | null): void {
  if (value === 'both' || value === 'in' || value === 'out') shiftForm.scope = value
}

async function submitShift(): Promise<void> {
  const delta = shiftForm.deltaSec ?? 0
  const affected = await cueStore.shiftFades(sessionId.value, delta, shiftForm.scope)
  message.success(`已偏移 ${affected} 条 Cue 的过渡时间（${delta > 0 ? '+' : ''}${delta}s）`)
  showShift.value = false
}

/* ---------------- 行内编辑（失焦提交） ---------------- */
const labelDrafts = ref<Record<string, string>>({})
const noteDrafts = ref<Record<string, string>>({})

function labelValue(cue: Cue): string {
  return labelDrafts.value[cue.id] ?? cue.label
}

function noteValue(cue: Cue): string {
  return noteDrafts.value[cue.id] ?? cue.note
}

function onLabelInput(cue: Cue, value: string): void {
  labelDrafts.value = { ...labelDrafts.value, [cue.id]: value }
}

function onNoteInput(cue: Cue, value: string): void {
  noteDrafts.value = { ...noteDrafts.value, [cue.id]: value }
}

async function commitLabel(cue: Cue): Promise<void> {
  const draft = labelDrafts.value[cue.id]
  if (draft === undefined) return
  const next = { ...labelDrafts.value }
  delete next[cue.id]
  labelDrafts.value = next
  if (draft !== cue.label) await cueStore.updateCue(cue.id, { label: draft })
}

async function commitNote(cue: Cue): Promise<void> {
  const draft = noteDrafts.value[cue.id]
  if (draft === undefined) return
  const next = { ...noteDrafts.value }
  delete next[cue.id]
  noteDrafts.value = next
  if (draft !== cue.note) await cueStore.updateCue(cue.id, { note: draft })
}

type FadeField = 'fadeInSec' | 'fadeOutSec' | 'holdSec'

async function commitFade(cue: Cue, field: FadeField, value: number | null): Promise<void> {
  const next = Math.max(0, value ?? 0)
  if (next === cue[field]) return
  const patch: CuePatch = {}
  if (field === 'fadeInSec') patch.fadeInSec = next
  else if (field === 'fadeOutSec') patch.fadeOutSec = next
  else patch.holdSec = next
  await cueStore.updateCue(cue.id, patch)
}

async function commitTrigger(cue: Cue, value: string | number | Array<string | number> | null): Promise<void> {
  if (typeof value !== 'string' || !(CUE_TRIGGERS as readonly string[]).includes(value)) return
  if (value === cue.trigger) return
  await cueStore.updateCue(cue.id, { trigger: value as CueTrigger })
}

async function commitCueNo(cue: Cue, value: string): Promise<void> {
  const normalized = normalizeCueNo(value)
  if (normalized === cue.cueNo) return
  if (cueStore.isCueNoTaken(sessionId.value, normalized, cue.id)) {
    message.error(`${normalized} 已被占用`)
    return
  }
  await cueStore.updateCue(cue.id, { cueNo: normalized })
  message.success(`编号已改为 ${normalized}`)
}

function existingNosOf(cue: Cue): string[] {
  return cueNoList.value.filter((no) => no !== cue.cueNo)
}

/* ---------------- 行内动作 ---------------- */
async function duplicateCue(cue: Cue): Promise<void> {
  const created = await cueStore.duplicateCue(cue.id)
  if (created) message.success(`已复制为 ${created.cueNo}`)
}

async function copyPrevious(cue: Cue): Promise<void> {
  const ok = await cueStore.copyPreviousParams(cue.id)
  if (!ok) {
    message.warning('这是第一条 Cue，没有可沿用的上一条参数')
    return
  }
  message.success(`已沿用上一条 ${cue.cueNo} 的过渡参数`)
}

function confirmRemove(cue: Cue): void {
  const levelCount = levelStore.levelsOfCue(cue.id).length
  dialog.warning({
    title: '删除 Cue',
    content: `将删除 ${cue.cueNo}${levelCount > 0 ? ` 及其 ${levelCount} 条通道电平` : ''}。`,
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await cueStore.removeCue(cue.id)
      message.success('Cue 已删除')
    }
  })
}

async function move(cue: Cue, direction: -1 | 1): Promise<void> {
  await cueStore.moveCue(cue.id, direction)
}

async function sortByCueNo(): Promise<void> {
  await cueStore.sortByCueNo(sessionId.value)
  message.success('已按 Cue 号重新排序并落库')
}

/* ---------------- 拖拽排序 ---------------- */
const draggingId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)

function onDragStart(cue: Cue): void {
  draggingId.value = cue.id
}

function onDragOver(cue: Cue): void {
  if (draggingId.value && draggingId.value !== cue.id) dragOverId.value = cue.id
}

function onDragEnd(): void {
  draggingId.value = null
  dragOverId.value = null
}

async function onDrop(cue: Cue): Promise<void> {
  const sourceId = draggingId.value
  onDragEnd()
  if (!sourceId || sourceId === cue.id) return
  const ids = cues.value.map((item) => item.id)
  const from = ids.indexOf(sourceId)
  const to = ids.indexOf(cue.id)
  if (from < 0 || to < 0) return
  ids.splice(from, 1)
  ids.splice(to, 0, sourceId)
  await reorder(ids)
  message.success('已调整 Cue 前后顺序')
}

/* ---------------- 跳转 ---------------- */
function goLevels(cueId: string): void {
  void router.push(`/cues/${cueId}/levels`)
}

function goFixtures(): void {
  void router.push(`/sessions/${sessionId.value}/fixtures`)
}

function goSheets(): void {
  void router.push('/sheets')
}

function durationOf(cue: Cue): string {
  return formatSeconds(cueTotalSeconds(cue))
}

function transitionOf(cue: Cue): string {
  return formatTransition(cue)
}

function channelFilterDuplicate(fixtureId: string): boolean {
  const fixture = fixtureStore.fixtureById(fixtureId)
  if (!fixture) return false
  return fixtureStore.patchCheckOf(sessionId.value).conflicts.some((conflict) => conflict.channel === fixture.channel)
}
</script>

<template>
  <div class="page">
    <header class="page__header">
      <div>
        <h1 class="page__title">Cue 编排时间轴</h1>
        <p class="page__subtitle">
          {{ session ? `${session.order}. ${session.title}` : '场次不存在或已删除' }} ·
          插入提示点、拖动排序、复制上一条参数并批量偏移过渡时间。
        </p>
      </div>
      <div class="page__actions">
        <NButton @click="goFixtures">灯位通道</NButton>
        <NButton @click="goSheets">排演表</NButton>
        <NButton @click="showShift = true">批量偏移过渡</NButton>
        <NButton @click="sortByCueNo">按 Cue 号重排</NButton>
        <NButton type="primary" :disabled="!session" @click="openCreate">插入 Cue</NButton>
      </div>
    </header>

    <NAlert v-if="!session" type="warning" :bordered="false">
      该场次不存在，可能已被删除。请返回场次编排重新选择。
    </NAlert>

    <template v-else>
      <section class="panel">
        <h2 class="panel__title">过渡汇总<span class="panel__title-tag">共 {{ cues.length }} 条 Cue</span></h2>
        <div class="stat-row">
          <div class="stat">
            <span class="stat__value mono">{{ cues.length }}</span>
            <span class="stat__label">Cue 数</span>
          </div>
          <div class="stat">
            <span class="stat__value mono">{{ formatSeconds(totalDuration) }}</span>
            <span class="stat__label">过渡总时长</span>
          </div>
          <div class="stat">
            <span class="stat__value mono">{{ formatSeconds(summary.totalFadeInSec) }}</span>
            <span class="stat__label">渐亮合计</span>
          </div>
          <div class="stat">
            <span class="stat__value mono">{{ formatSeconds(summary.totalFadeOutSec) }}</span>
            <span class="stat__label">渐暗合计</span>
          </div>
          <div class="stat">
            <span class="stat__value mono">{{ hardCutCount }}</span>
            <span class="stat__label">硬切衔接</span>
          </div>
          <div class="stat">
            <span class="stat__value mono">{{ fixtures.length }}</span>
            <span class="stat__label">可调通道</span>
          </div>
        </div>

        <div class="overview-bar">
          <FadeBar
            v-if="totalDuration > 0"
            :fade-in-sec="summary.totalFadeInSec"
            :hold-sec="summary.totalHoldSec"
            :fade-out-sec="summary.totalFadeOutSec"
          />
        </div>

        <div v-if="summary.adjacent.length > 0" class="adjacent">
          <p class="adjacent__title">相邻过渡时长（上一条渐暗 + 下一条渐亮）</p>
          <div class="adjacent__list">
            <span
              v-for="item in summary.adjacent"
              :key="`${item.fromCueId}-${item.toCueId}`"
              class="adjacent__item mono"
              :class="{ 'adjacent__item--hard': item.overlap }"
            >
              {{ item.fromCueNo }} → {{ item.toCueNo }}：{{ formatSeconds(item.gapSec) }}
            </span>
          </div>
        </div>
      </section>

      <p v-if="cues.length === 0" class="empty-line">
        还没有 Cue。点击右上角「插入 Cue」开始编排，编号支持 Q12.5 形式。
      </p>

      <div v-else class="cue-list">
        <article
          v-for="(cue, index) in cues"
          :key="cue.id"
          class="cue-row"
          :class="{
            'cue-row--dragging': draggingId === cue.id,
            'cue-row--over': dragOverId === cue.id
          }"
          @dragover.prevent="onDragOver(cue)"
          @drop.prevent="onDrop(cue)"
        >
          <div class="cue-row__lead">
            <span class="cue-row__handle" draggable="true" title="拖动调整先后" @dragstart="onDragStart(cue)" @dragend="onDragEnd">
              ⠿
            </span>
            <span class="cue-row__index mono">{{ index + 1 }}</span>
          </div>

          <div class="cue-row__main">
            <div class="cue-row__head">
              <CueNoInput
                :model-value="cue.cueNo"
                :existing-nos="existingNosOf(cue)"
                @commit="(value) => commitCueNo(cue, value)"
              />
              <NInput
                :value="labelValue(cue)"
                size="small"
                placeholder="提示语，例如「国王入场，收面光」"
                class="cue-row__label"
                @update:value="(value) => onLabelInput(cue, value)"
                @blur="commitLabel(cue)"
                @keyup.enter="commitLabel(cue)"
              />
              <NSelect
                :value="cue.trigger"
                :options="triggerOptions"
                size="small"
                style="width: 118px"
                @update:value="(value) => commitTrigger(cue, value)"
              />
              <NButton size="tiny" type="primary" ghost @click="goLevels(cue.id)">
                电平编辑（{{ levelStore.levelsOfCue(cue.id).length }}）
              </NButton>
            </div>

            <div class="cue-row__body">
              <div class="fade-inputs">
                <label class="fade-inputs__item">
                  <span class="fade-inputs__label">渐亮</span>
                  <NInputNumber
                    :value="cue.fadeInSec"
                    size="small"
                    :min="0"
                    :step="0.5"
                    :show-button="false"
                    style="width: 88px"
                    @update:value="(value) => commitFade(cue, 'fadeInSec', value)"
                  />
                </label>
                <label class="fade-inputs__item">
                  <span class="fade-inputs__label">保持</span>
                  <NInputNumber
                    :value="cue.holdSec"
                    size="small"
                    :min="0"
                    :step="0.5"
                    :show-button="false"
                    style="width: 88px"
                    @update:value="(value) => commitFade(cue, 'holdSec', value)"
                  />
                </label>
                <label class="fade-inputs__item">
                  <span class="fade-inputs__label">渐暗</span>
                  <NInputNumber
                    :value="cue.fadeOutSec"
                    size="small"
                    :min="0"
                    :step="0.5"
                    :show-button="false"
                    style="width: 88px"
                    @update:value="(value) => commitFade(cue, 'fadeOutSec', value)"
                  />
                </label>
              </div>

              <FadeBar
                :fade-in-sec="cue.fadeInSec"
                :hold-sec="cue.holdSec"
                :fade-out-sec="cue.fadeOutSec"
                :height="14"
                compact
              />

              <span class="cue-row__total mono">{{ durationOf(cue) }}</span>
            </div>

            <div class="cue-row__foot">
              <div v-if="channelsOfCue(cue.id).length > 0" class="cue-row__channels">
                <ChannelChip
                  v-for="channel in channelsOfCue(cue.id)"
                  :key="channel.fixtureId"
                  :channel="channel.channel"
                  :position="channel.position"
                  :intensity="channel.intensity"
                  :duplicate="channelFilterDuplicate(channel.fixtureId)"
                  size="small"
                  clickable
                  @click="goLevels(cue.id)"
                />
              </div>
              <span v-else class="cue-row__channels-empty">未设定通道电平</span>

              <NInput
                :value="noteValue(cue)"
                size="small"
                placeholder="备注（失焦保存）"
                class="cue-row__note"
                @update:value="(value) => onNoteInput(cue, value)"
                @blur="commitNote(cue)"
                @keyup.enter="commitNote(cue)"
              />
            </div>

            <p class="cue-row__transition mono">{{ transitionOf(cue) }}</p>
          </div>

          <div class="cue-row__actions">
            <NButton size="tiny" quaternary :disabled="index === 0" @click="copyPrevious(cue)">沿用上一条</NButton>
            <NButton size="tiny" quaternary @click="duplicateCue(cue)">复制为新 Cue</NButton>
            <NButton size="tiny" quaternary :disabled="index === 0" @click="move(cue, -1)">上移</NButton>
            <NButton size="tiny" quaternary :disabled="index === cues.length - 1" @click="move(cue, 1)">下移</NButton>
            <NButton size="tiny" quaternary type="error" @click="confirmRemove(cue)">删除</NButton>
          </div>
        </article>
      </div>
    </template>

    <NModal v-model:show="showCreate" preset="card" title="插入 Cue" class="form-modal" :mask-closable="false">
      <NForm label-placement="left" label-width="92">
        <NFormItem label="Cue 编号">
          <div class="create-form__row">
            <NInput v-model:value="createForm.cueNo" placeholder="Q12 或 Q12.5" style="width: 160px" />
            <span class="create-form__hint">建议下一个编号：{{ nextCueNo }}</span>
          </div>
        </NFormItem>
        <NFormItem v-if="createError" label=" ">
          <span class="create-form__error">{{ createError }}</span>
        </NFormItem>
        <NFormItem label="提示语">
          <NInput v-model:value="createForm.label" placeholder="例如「国王入场，收面光」" />
        </NFormItem>
        <NFormItem label="触发方式">
          <NSelect :value="createForm.trigger" :options="triggerOptions" @update:value="handleCreateTrigger" />
        </NFormItem>
        <NFormItem label="过渡时间">
          <div class="create-form__triple">
            <NInputNumber v-model:value="createForm.fadeInSec" :min="0" :step="0.5" :show-button="false" style="width: 110px" />
            <NInputNumber v-model:value="createForm.holdSec" :min="0" :step="0.5" :show-button="false" style="width: 110px" />
            <NInputNumber v-model:value="createForm.fadeOutSec" :min="0" :step="0.5" :show-button="false" style="width: 110px" />
          </div>
        </NFormItem>
        <NFormItem label="备注">
          <NInput v-model:value="createForm.note" type="textarea" :rows="2" placeholder="走位、音乐小节、注意事项" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="modal-footer">
          <NButton @click="showCreate = false">取消</NButton>
          <NButton type="primary" :disabled="createError !== null" @click="submitCreate">插入</NButton>
        </div>
      </template>
    </NModal>

    <NModal v-model:show="showShift" preset="card" title="批量偏移过渡时间" class="form-modal" :mask-closable="false">
      <NForm label-placement="left" label-width="108">
        <NFormItem label="偏移量（秒）">
          <NInputNumber v-model:value="shiftForm.deltaSec" :step="0.5" :show-button="false" style="width: 160px" />
        </NFormItem>
        <NFormItem label="作用范围">
          <NSelect :value="shiftForm.scope" :options="scopeOptions" @update:value="handleScopeChange" />
        </NFormItem>
      </NForm>
      <p class="shift-tip">将对本场全部 {{ cues.length }} 条 Cue 生效，结果下限为 0 秒。</p>
      <template #footer>
        <div class="modal-footer">
          <NButton @click="showShift = false">取消</NButton>
          <NButton type="primary" @click="submitShift">应用偏移</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.overview-bar {
  margin-top: 14px;
  max-width: 640px;
}

.adjacent {
  margin-top: 14px;
}

.adjacent__title {
  margin: 0 0 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.adjacent__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.adjacent__item {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
}

.adjacent__item--hard {
  border-color: rgba(232, 84, 84, 0.55);
  background: rgba(232, 84, 84, 0.12);
  color: #ffbdbd;
}

.cue-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cue-row {
  display: flex;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  transition: border-color 0.16s ease, opacity 0.16s ease;
}

.cue-row--dragging {
  opacity: 0.45;
}

.cue-row--over {
  border-color: rgba(242, 181, 68, 0.75);
}

.cue-row__lead {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex: none;
}

.cue-row__handle {
  cursor: grab;
  color: rgba(255, 255, 255, 0.35);
  font-size: 15px;
  line-height: 1;
  user-select: none;
}

.cue-row__handle:active {
  cursor: grabbing;
}

.cue-row__index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: rgba(242, 181, 68, 0.14);
  color: #f2b544;
  font-size: 12px;
  font-weight: 600;
}

.cue-row__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cue-row__head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
}

.cue-row__label {
  flex: 1;
  min-width: 200px;
}

.cue-row__body {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.fade-inputs {
  display: flex;
  align-items: center;
  gap: 10px;
}

.fade-inputs__item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fade-inputs__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.cue-row__total {
  font-size: 13px;
  color: #f2b544;
}

.cue-row__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.cue-row__channels {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.cue-row__channels-empty {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.32);
}

.cue-row__note {
  flex: 1;
  min-width: 200px;
}

.cue-row__transition {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
}

.cue-row__actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: none;
  align-items: flex-end;
}

.form-modal {
  width: 560px;
  max-width: 92vw;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.create-form__row,
.create-form__triple {
  display: flex;
  align-items: center;
  gap: 10px;
}

.create-form__hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.create-form__error {
  font-size: 12px;
  color: #ff9a9a;
}

.shift-tip {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}
</style>
