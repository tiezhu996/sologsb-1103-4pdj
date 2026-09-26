<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  NButton,
  NCard,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NTag,
  useDialog,
  useMessage,
  type FormInst,
  type FormItemRule,
  type FormRules
} from 'naive-ui'
import BlankHint from '@/components/common/BlankHint.vue'
import FadeBar from '@/components/common/FadeBar.vue'
import { useCueOrder } from '@/hooks/useCueOrder'
import { useCueStore } from '@/stores/cueStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { CueOrderSummary } from '@/types/cue'
import { createEmptySessionDraft, type Session, type SessionDraft, type SessionStat } from '@/types/session'
import { formatSeconds, sumCues } from '@/utils/fade'

const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const sessionStore = useSessionStore()
const cueStore = useCueStore()

const currentSessionId = computed(() => sessionStore.currentSessionId ?? '')
const { summary: currentSummary, hardCutCount } = useCueOrder(currentSessionId)

const currentSessionLabel = computed(() => {
  const session = sessionStore.currentSession
  return session ? `${session.order}. ${session.title}` : '尚未选择场次'
})

/** 每个场次的统计（Cue 数 / 通道数 / 过渡总时长） */
const stats = computed<Record<string, SessionStat>>(() => {
  const map: Record<string, SessionStat> = {}
  sessionStore.sortedSessions.forEach((session) => {
    map[session.id] = sessionStore.statOf(session.id)
  })
  return map
})

/** 每个场次的过渡拆分，用于卡片上的渐变条 */
const summaries = computed<Record<string, CueOrderSummary>>(() => {
  const map: Record<string, CueOrderSummary> = {}
  sessionStore.sortedSessions.forEach((session) => {
    map[session.id] = sumCues(cueStore.cuesOfSession(session.id))
  })
  return map
})

const hardCutList = computed(() => currentSummary.value.adjacent.filter((item) => item.overlap))

const showModal = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInst | null>(null)
const form = reactive<SessionDraft>(createEmptySessionDraft())

const timeRule: FormItemRule = {
  trigger: ['blur'],
  validator: (_rule: FormItemRule, value: string) => {
    if (!value) return true
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? true : new Error('时间格式需为 HH:mm')
  }
}

const rules: FormRules = {
  title: { required: true, message: '请填写场次名称', trigger: ['blur', 'input'] },
  plannedStart: timeRule,
  plannedEnd: timeRule
}

function openCreate(): void {
  editingId.value = null
  Object.assign(form, createEmptySessionDraft(sessionStore.sortedSessions.length + 1))
  showModal.value = true
}

function openEdit(session: Session): void {
  editingId.value = session.id
  Object.assign(form, {
    title: session.title,
    order: session.order,
    scriptPage: session.scriptPage,
    plannedStart: session.plannedStart,
    plannedEnd: session.plannedEnd,
    stageNote: session.stageNote
  })
  showModal.value = true
}

async function submitForm(): Promise<void> {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  saving.value = true
  try {
    if (editingId.value) {
      await sessionStore.updateSession(editingId.value, { ...form })
      message.success('场次已更新')
    } else {
      const created = await sessionStore.createSession({ ...form })
      message.success(`已新建场次「${created.title}」`)
    }
    showModal.value = false
  } finally {
    saving.value = false
  }
}

async function moveSession(id: string, direction: -1 | 1): Promise<void> {
  await sessionStore.moveSession(id, direction)
}

function confirmRemove(session: Session): void {
  const stat: SessionStat = sessionStore.statOf(session.id)
  dialog.warning({
    title: '删除场次',
    content: `将同时删除「${session.title}」的 ${stat.fixtureCount} 个灯位通道、${stat.cueCount} 条 Cue（含通道电平）与相关排演表，且无法恢复。`,
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await sessionStore.removeSession(session.id)
      message.success('场次已删除')
    }
  })
}

function goFixtures(id: string): void {
  sessionStore.setCurrentSession(id)
  void router.push(`/sessions/${id}/fixtures`)
}

function goCues(id: string): void {
  sessionStore.setCurrentSession(id)
  void router.push(`/sessions/${id}/cues`)
}

function focusSession(id: string): void {
  sessionStore.setCurrentSession(id)
}
</script>

<template>
  <div class="page">
    <header class="page__header">
      <div>
        <h1 class="page__title">场次编排</h1>
        <p class="page__subtitle">
          按演出顺序建场次、调序，每张卡片显示该场的 Cue 数量与过渡总时长；新建后进入灯位通道配置。
        </p>
      </div>
      <div class="page__actions">
        <NButton type="primary" @click="openCreate">新建场次</NButton>
      </div>
    </header>

    <section v-if="sessionStore.sortedSessions.length > 0" class="panel">
      <h2 class="panel__title">
        当前场次过渡总览
        <span class="panel__title-tag">{{ currentSessionLabel }}</span>
      </h2>
      <div class="stat-row">
        <div class="stat">
          <span class="stat__value mono">{{ stats[currentSessionId]?.cueCount ?? 0 }}</span>
          <span class="stat__label">Cue 数</span>
        </div>
        <div class="stat">
          <span class="stat__value mono">{{ stats[currentSessionId]?.fixtureCount ?? 0 }}</span>
          <span class="stat__label">灯位通道</span>
        </div>
        <div class="stat">
          <span class="stat__value mono">{{ formatSeconds(currentSummary.totalSec) }}</span>
          <span class="stat__label">过渡总时长</span>
        </div>
        <div class="stat">
          <span class="stat__value mono">{{ hardCutCount }}</span>
          <span class="stat__label">硬切衔接</span>
        </div>
      </div>

      <div class="overview-bar">
        <FadeBar
          v-if="currentSummary.totalSec > 0"
          :fade-in-sec="currentSummary.totalFadeInSec"
          :hold-sec="currentSummary.totalHoldSec"
          :fade-out-sec="currentSummary.totalFadeOutSec"
        />
        <p v-else class="empty-line">当前场次还没有 Cue，先到 Cue 编排时间轴插入提示点。</p>
      </div>

      <div v-if="hardCutList.length > 0" class="hard-cut">
        <p class="hard-cut__title">近乎硬切的相邻衔接（渐暗 + 渐亮 &lt; 1s）</p>
        <p v-for="item in hardCutList" :key="`${item.fromCueId}-${item.toCueId}`" class="hard-cut__item mono">
          {{ item.fromCueNo }} → {{ item.toCueNo }}：{{ formatSeconds(item.gapSec) }}
        </p>
      </div>
    </section>

    <BlankHint
      v-if="sessionStore.sortedSessions.length === 0"
      title="还没有场次"
      description="场次是灯位通道、Cue 提示点与排演表的归属单元。先建第一场，再配接灯位通道并插入 Cue。"
      tip="数据保存在浏览器本地，刷新或关闭页面都不会丢失。"
      action-text="新建第一个场次"
      @action="openCreate"
    />

    <div v-else class="session-grid">
      <NCard
        v-for="session in sessionStore.sortedSessions"
        :key="session.id"
        class="session-card"
        :class="{ 'session-card--current': session.id === sessionStore.currentSessionId }"
        size="small"
        @click="focusSession(session.id)"
      >
        <div class="session-card__head">
          <span class="session-card__order mono">{{ session.order }}</span>
          <div class="session-card__titles">
            <p class="session-card__title">{{ session.title }}</p>
            <p class="session-card__meta">
              剧本 {{ session.scriptPage || '—' }} · 计划 {{ session.plannedStart || '—' }} ~ {{ session.plannedEnd || '—' }}
            </p>
          </div>
          <NTag v-if="session.id === sessionStore.currentSessionId" size="small" type="warning" :bordered="false">
            当前场次
          </NTag>
        </div>

        <p class="session-card__note">{{ session.stageNote || '未填写舞台状态说明' }}</p>

        <div class="stat-row">
          <div class="stat">
            <span class="stat__value mono">{{ stats[session.id]?.cueCount ?? 0 }}</span>
            <span class="stat__label">Cue 数</span>
          </div>
          <div class="stat">
            <span class="stat__value mono">{{ stats[session.id]?.fixtureCount ?? 0 }}</span>
            <span class="stat__label">通道数</span>
          </div>
          <div class="stat">
            <span class="stat__value mono">{{ formatSeconds(stats[session.id]?.totalFadeSec ?? 0) }}</span>
            <span class="stat__label">过渡总时长</span>
          </div>
        </div>

        <FadeBar
          v-if="(summaries[session.id]?.totalSec ?? 0) > 0"
          :fade-in-sec="summaries[session.id]?.totalFadeInSec ?? 0"
          :hold-sec="summaries[session.id]?.totalHoldSec ?? 0"
          :fade-out-sec="summaries[session.id]?.totalFadeOutSec ?? 0"
          compact
        />
        <p v-else class="empty-line">尚未插入 Cue</p>

        <div class="session-card__actions">
          <NButton size="small" @click.stop="goFixtures(session.id)">灯位通道</NButton>
          <NButton size="small" type="primary" ghost @click.stop="goCues(session.id)">Cue 编排</NButton>
          <NButton size="small" quaternary :disabled="session.order === 1" @click.stop="moveSession(session.id, -1)">
            上移
          </NButton>
          <NButton
            size="small"
            quaternary
            :disabled="session.order === sessionStore.sortedSessions.length"
            @click.stop="moveSession(session.id, 1)"
          >
            下移
          </NButton>
          <NButton size="small" quaternary @click.stop="openEdit(session)">编辑</NButton>
          <NButton size="small" quaternary type="error" @click.stop="confirmRemove(session)">删除</NButton>
        </div>
      </NCard>
    </div>

    <NModal
      v-model:show="showModal"
      preset="card"
      :title="editingId ? '编辑场次' : '新建场次'"
      class="form-modal"
      :mask-closable="false"
    >
      <NForm ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="92">
        <NFormItem label="场次名称" path="title">
          <NInput v-model:value="form.title" placeholder="例如：第一幕 · 宫廷舞会" />
        </NFormItem>
        <NFormItem label="剧本页码" path="scriptPage">
          <NInput v-model:value="form.scriptPage" placeholder="P12 或 P12-14" />
        </NFormItem>
        <NFormItem label="计划起始" path="plannedStart">
          <NInput v-model:value="form.plannedStart" placeholder="19:30" />
        </NFormItem>
        <NFormItem label="计划结束" path="plannedEnd">
          <NInput v-model:value="form.plannedEnd" placeholder="19:42" />
        </NFormItem>
        <NFormItem label="舞台状态" path="stageNote">
          <NInput
            v-model:value="form.stageNote"
            type="textarea"
            :rows="3"
            placeholder="换景、道具、演员走位等舞台状态说明"
          />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="modal-footer">
          <NButton @click="showModal = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="submitForm">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.overview-bar {
  margin-top: 14px;
  max-width: 620px;
}

.hard-cut {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(232, 84, 84, 0.08);
  border: 1px solid rgba(232, 84, 84, 0.28);
}

.hard-cut__title {
  margin: 0 0 6px;
  font-size: 12px;
  color: #ff9a9a;
}

.hard-cut__item {
  margin: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.8;
}

.session-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 14px;
}

.session-card {
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.16s ease;
  background: rgba(255, 255, 255, 0.02);
}

.session-card:hover {
  transform: translateY(-2px);
  border-color: rgba(242, 181, 68, 0.45);
}

.session-card--current {
  border-color: rgba(242, 181, 68, 0.6);
  box-shadow: 0 0 0 1px rgba(242, 181, 68, 0.25) inset;
}

.session-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.session-card__order {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: 8px;
  background: rgba(242, 181, 68, 0.14);
  color: #f2b544;
  font-weight: 600;
}

.session-card__titles {
  flex: 1;
  min-width: 0;
}

.session-card__title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-card__meta {
  margin: 4px 0 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.session-card__note {
  margin: 10px 0 12px;
  font-size: 12px;
  line-height: 1.7;
  color: rgba(255, 255, 255, 0.5);
  min-height: 34px;
}

.session-card__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.form-modal {
  width: 520px;
  max-width: 92vw;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
