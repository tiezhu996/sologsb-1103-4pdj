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
  NTag,
  useDialog,
  useMessage
} from 'naive-ui'
import BlankHint from '@/components/common/BlankHint.vue'
import ChannelChip from '@/components/common/ChannelChip.vue'
import { useChannelConflict } from '@/hooks/useChannelConflict'
import { useFixtureStore } from '@/stores/fixtureStore'
import { useLevelStore } from '@/stores/levelStore'
import { useSessionStore } from '@/stores/sessionStore'
import {
  DMX_CHANNEL_MAX,
  DMX_CHANNEL_MIN,
  FIXTURE_POSITIONS,
  FIXTURE_TYPES,
  POSITION_COLORS,
  type Fixture,
  type FixtureDraft,
  type FixturePosition,
  type FixtureType
} from '@/types/fixture'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const sessionStore = useSessionStore()
const fixtureStore = useFixtureStore()
const levelStore = useLevelStore()

const sessionId = computed(() => String(route.params.id ?? ''))
const session = computed(() => sessionStore.sessionById(sessionId.value))

const { messages, conflictChannels, conflictFixtureIds, loads, hasConflict, hasOverload } = useChannelConflict(sessionId)

const viewMode = ref<'group' | 'channel'>('group')
const collapsed = ref<FixturePosition[]>([])

const groups = computed(() => fixtureStore.groupedFixturesOfSession(sessionId.value))
const flatFixtures = computed(() => fixtureStore.sortedFixturesOfSession(sessionId.value))

const positionOptions = FIXTURE_POSITIONS.map((position) => ({ label: position, value: position }))
const typeOptions = FIXTURE_TYPES.map((type) => ({ label: type, value: type }))

const showModal = ref(false)
const editingId = ref<string | null>(null)

/** 弹窗表单单独持有可空值，提交时再收敛为 FixtureDraft，避免组件类型与模型类型互相污染 */
const form = reactive<{
  channel: number | null
  position: FixturePosition
  fixtureType: FixtureType
  gel: string
  patchNote: string
}>({
  channel: DMX_CHANNEL_MIN,
  position: '面光',
  fixtureType: '成像灯',
  gel: '',
  patchNote: ''
})

const modalTitle = computed(() => (editingId.value ? '编辑灯位通道' : '新建灯位通道'))

const duplicateChannel = computed(
  () => form.channel !== null && flatFixtures.value.some((fixture) => fixture.id !== editingId.value && fixture.channel === form.channel)
)

function isCollapsed(position: FixturePosition): boolean {
  return collapsed.value.includes(position)
}

function toggleGroup(position: FixturePosition): void {
  collapsed.value = isCollapsed(position)
    ? collapsed.value.filter((item) => item !== position)
    : [...collapsed.value, position]
}

function expandAll(): void {
  collapsed.value = []
}

function collapseAll(): void {
  collapsed.value = [...FIXTURE_POSITIONS]
}

function averageIntensityOf(fixtureId: string): number | null {
  return levelStore.averageIntensityOfFixture(fixtureId)
}

function openCreate(position?: FixturePosition): void {
  editingId.value = null
  const nextChannel = flatFixtures.value.reduce((max, fixture) => Math.max(max, fixture.channel), 0) + 1
  form.channel = Math.min(nextChannel, DMX_CHANNEL_MAX)
  form.position = position ?? '面光'
  form.fixtureType = '成像灯'
  form.gel = ''
  form.patchNote = ''
  showModal.value = true
}

function openEdit(fixture: Fixture): void {
  editingId.value = fixture.id
  form.channel = fixture.channel
  form.position = fixture.position
  form.fixtureType = fixture.fixtureType
  form.gel = fixture.gel
  form.patchNote = fixture.patchNote
  showModal.value = true
}

function handlePositionChange(value: string | number | Array<string | number> | null): void {
  if (typeof value === 'string' && (FIXTURE_POSITIONS as readonly string[]).includes(value)) {
    form.position = value as FixturePosition
  }
}

function handleTypeChange(value: string | number | Array<string | number> | null): void {
  if (typeof value === 'string' && (FIXTURE_TYPES as readonly string[]).includes(value)) {
    form.fixtureType = value as FixtureType
  }
}

async function submitForm(): Promise<void> {
  if (form.channel === null) {
    message.error('请填写 DMX 通道号')
    return
  }
  const payload: FixtureDraft = {
    sessionId: sessionId.value,
    channel: form.channel,
    position: form.position,
    fixtureType: form.fixtureType,
    gel: form.gel.trim(),
    patchNote: form.patchNote.trim()
  }
  const result = editingId.value
    ? await fixtureStore.updateFixture(editingId.value, payload)
    : await fixtureStore.addFixture(payload)
  if (!result.ok) {
    message.error(result.message)
    return
  }
  message.success(result.message)
  showModal.value = false
}

function confirmRemove(fixture: Fixture): void {
  const levelCount = levelStore.levels.filter((level) => level.fixtureId === fixture.id).length
  dialog.warning({
    title: '删除灯位通道',
    content: `将删除 CH${fixture.channel}（${fixture.position} · ${fixture.fixtureType}）${
      levelCount > 0 ? `，并清理 ${levelCount} 条通道电平记录` : ''
    }。`,
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await fixtureStore.removeFixture(fixture.id)
      message.success('灯位通道已删除')
    }
  })
}

function goCues(): void {
  void router.push(`/sessions/${sessionId.value}/cues`)
}

function goSessions(): void {
  void router.push('/sessions')
}

function channelLoadText(position: FixturePosition): string {
  const load = loads.value.find((item) => item.position === position)
  if (!load) return '0/0'
  return `${load.count}/${load.limit}`
}

function isPositionOverloaded(position: FixturePosition): boolean {
  return loads.value.find((item) => item.position === position)?.overloaded ?? false
}

function handleChipClick(fixture: Fixture): void {
  openEdit(fixture)
}

function positionColor(position: FixturePosition): string {
  return POSITION_COLORS[position]
}
</script>

<template>
  <div class="page">
    <header class="page__header">
      <div>
        <h1 class="page__title">灯位通道配置台</h1>
        <p class="page__subtitle">
          {{ session ? `${session.order}. ${session.title}` : '场次不存在或已删除' }} ·
          按通道号排布、按灯位分组折叠，重复通道号会被高亮。
        </p>
      </div>
      <div class="page__actions">
        <NButton @click="goSessions">返回场次</NButton>
        <NButton @click="goCues">Cue 时间轴</NButton>
        <NButton type="primary" :disabled="!session" @click="openCreate()">新建灯位通道</NButton>
      </div>
    </header>

    <NAlert v-if="!session" type="warning" :bordered="false">
      该场次不存在，可能已被删除。请返回场次编排重新选择。
    </NAlert>

    <template v-else>
      <div class="toolbar">
        <span class="toolbar__label">视图</span>
        <NButton size="small" :type="viewMode === 'group' ? 'primary' : 'default'" @click="viewMode = 'group'">
          按灯位分组
        </NButton>
        <NButton size="small" :type="viewMode === 'channel' ? 'primary' : 'default'" @click="viewMode = 'channel'">
          按通道号序列
        </NButton>
        <span class="toolbar__divider" />
        <NButton size="small" quaternary @click="expandAll">全部展开</NButton>
        <NButton size="small" quaternary @click="collapseAll">全部折叠</NButton>
        <span class="toolbar__spacer" />
        <NTag size="small" :bordered="false" :type="hasConflict ? 'error' : 'success'">
          {{ hasConflict ? `${conflictChannels.length} 个通道号重复` : '通道号唯一' }}
        </NTag>
        <NTag size="small" :bordered="false" :type="hasOverload ? 'warning' : 'success'">
          {{ hasOverload ? '存在灯位过载' : '灯位负载正常' }}
        </NTag>
      </div>

      <NAlert v-for="(text, index) in messages" :key="index" type="error" :bordered="false" class="alert-line">
        {{ text }}
      </NAlert>

      <section class="panel">
        <h2 class="panel__title">灯位负载<span class="panel__title-tag">单灯位上限 6 个通道</span></h2>
        <div class="load-grid">
          <div v-for="load in loads" :key="load.position" class="load-item" :class="{ 'load-item--over': load.overloaded }">
            <span class="load-item__dot" :style="{ background: positionColor(load.position) }" />
            <span class="load-item__name">{{ load.position }}</span>
            <span class="load-item__count mono">{{ load.count }}/{{ load.limit }}</span>
          </div>
        </div>
      </section>

      <BlankHint
        v-if="flatFixtures.length === 0"
        title="还没有灯位通道"
        description="灯位通道记录 DMX 通道号、灯位方位、灯具类型与色纸编号，是 Cue 电平设定的对象。"
        tip="提示：同一场次内通道号必须唯一，重复项会被标红。"
        action-text="新建第一个通道"
        @action="openCreate()"
      />

      <template v-else-if="viewMode === 'group'">
        <section v-for="group in groups" :key="group.position" class="panel group">
          <button type="button" class="group__head" @click="toggleGroup(group.position)">
            <span class="group__caret" :class="{ 'group__caret--closed': isCollapsed(group.position) }">▾</span>
            <span class="group__dot" :style="{ background: positionColor(group.position) }" />
            <span class="group__name">{{ group.position }}</span>
            <span class="group__count mono">{{ group.fixtures.length }} 个通道</span>
            <span class="group__load mono" :class="{ 'group__load--over': isPositionOverloaded(group.position) }">
              负载 {{ channelLoadText(group.position) }}
            </span>
            <span class="toolbar__spacer" />
            <NButton size="tiny" quaternary @click.stop="openCreate(group.position)">+ 新增</NButton>
          </button>

          <div v-if="!isCollapsed(group.position)" class="group__body">
            <p v-if="group.fixtures.length === 0" class="empty-line">该灯位暂无通道</p>
            <div
              v-for="fixture in group.fixtures"
              :key="fixture.id"
              class="fixture-row"
              :class="{ 'fixture-row--conflict': conflictFixtureIds.includes(fixture.id) }"
            >
              <ChannelChip
                :channel="fixture.channel"
                :position="fixture.position"
                :intensity="averageIntensityOf(fixture.id)"
                :gel="fixture.gel"
                :fixture-type="fixture.fixtureType"
                :duplicate="conflictChannels.includes(fixture.channel)"
                clickable
                @click="handleChipClick(fixture)"
              />
              <span class="fixture-row__type">{{ fixture.fixtureType }}</span>
              <span class="fixture-row__note">{{ fixture.patchNote || '无配接备注' }}</span>
              <span class="toolbar__spacer" />
              <NButton size="tiny" quaternary @click="openEdit(fixture)">编辑</NButton>
              <NButton size="tiny" quaternary type="error" @click="confirmRemove(fixture)">删除</NButton>
            </div>
          </div>
        </section>
      </template>

      <section v-else class="panel">
        <h2 class="panel__title">通道号序列<span class="panel__title-tag">共 {{ flatFixtures.length }} 个通道</span></h2>
        <div class="channel-table">
          <div class="channel-table__head">
            <span>通道</span>
            <span>灯位</span>
            <span>灯具</span>
            <span>色纸</span>
            <span>配接备注</span>
            <span>操作</span>
          </div>
          <div
            v-for="fixture in flatFixtures"
            :key="fixture.id"
            class="channel-table__row"
            :class="{ 'channel-table__row--conflict': conflictFixtureIds.includes(fixture.id) }"
          >
            <ChannelChip
              :channel="fixture.channel"
              :position="fixture.position"
              :intensity="averageIntensityOf(fixture.id)"
              :gel="fixture.gel"
              :duplicate="conflictChannels.includes(fixture.channel)"
              size="small"
            />
            <span>{{ fixture.position }}</span>
            <span>{{ fixture.fixtureType }}</span>
            <span class="mono">{{ fixture.gel || '—' }}</span>
            <span class="channel-table__note">{{ fixture.patchNote || '—' }}</span>
            <span class="channel-table__actions">
              <NButton size="tiny" quaternary @click="openEdit(fixture)">编辑</NButton>
              <NButton size="tiny" quaternary type="error" @click="confirmRemove(fixture)">删除</NButton>
            </span>
          </div>
        </div>
      </section>
    </template>

    <NModal v-model:show="showModal" preset="card" :title="modalTitle" class="form-modal" :mask-closable="false">
      <NForm label-placement="left" label-width="92">
        <NFormItem label="DMX 通道">
          <div class="channel-picker">
            <NInputNumber
              v-model:value="form.channel"
              :min="DMX_CHANNEL_MIN"
              :max="DMX_CHANNEL_MAX"
              :show-button="false"
              style="width: 140px"
            />
            <span class="channel-picker__hint mono">{{ DMX_CHANNEL_MIN }}-{{ DMX_CHANNEL_MAX }}</span>
          </div>
        </NFormItem>
        <NFormItem v-if="duplicateChannel" label=" ">
          <span class="channel-picker__warn">该通道号在本场次已存在，保存后会形成重复通道并高亮提示。</span>
        </NFormItem>
        <NFormItem label="灯位方位">
          <NSelect :value="form.position" :options="positionOptions" @update:value="handlePositionChange" />
        </NFormItem>
        <NFormItem label="灯具类型">
          <NSelect :value="form.fixtureType" :options="typeOptions" @update:value="handleTypeChange" />
        </NFormItem>
        <NFormItem label="色纸编号">
          <NInput v-model:value="form.gel" placeholder="例如 R02 / L201" />
        </NFormItem>
        <NFormItem label="配接备注">
          <NInput v-model:value="form.patchNote" type="textarea" :rows="3" placeholder="灯号、吊杆位置、调光回路等" />
        </NFormItem>
      </NForm>
      <template #footer>
        <div class="modal-footer">
          <NButton @click="showModal = false">取消</NButton>
          <NButton type="primary" @click="submitForm">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.toolbar__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.toolbar__divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.12);
}

.alert-line {
  margin: 0;
}

.load-grid {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.load-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.load-item--over {
  border-color: rgba(232, 168, 84, 0.7);
  background: rgba(232, 168, 84, 0.12);
  color: #ffd79a;
}

.load-item__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.load-item__count {
  color: rgba(255, 255, 255, 0.6);
}

.group {
  padding: 0;
  overflow: hidden;
}

.group__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 14px 18px;
  background: transparent;
  border: none;
  color: inherit;
  font-size: 14px;
  cursor: pointer;
  text-align: left;
}

.group__head:hover {
  background: rgba(255, 255, 255, 0.03);
}

.group__caret {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  transition: transform 0.18s ease;
}

.group__caret--closed {
  transform: rotate(-90deg);
}

.group__dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}

.group__name {
  font-weight: 600;
}

.group__count {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.group__load {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
}

.group__load--over {
  color: #ffd79a;
}

.group__body {
  padding: 4px 18px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.fixture-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-radius: 10px;
  transition: background 0.16s ease;
}

.fixture-row:hover {
  background: rgba(255, 255, 255, 0.035);
}

.fixture-row--conflict {
  background: rgba(232, 84, 84, 0.07);
}

.fixture-row__type {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.62);
  min-width: 56px;
}

.fixture-row__note {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-table__head,
.channel-table__row {
  display: grid;
  grid-template-columns: 190px 80px 90px 90px 1fr 130px;
  align-items: center;
  gap: 10px;
  padding: 9px 6px;
  font-size: 13px;
}

.channel-table__head {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.42);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.channel-table__row {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.channel-table__row--conflict {
  background: rgba(232, 84, 84, 0.07);
}

.channel-table__note {
  color: rgba(255, 255, 255, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.channel-table__actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
}

.channel-picker {
  display: flex;
  align-items: center;
  gap: 12px;
}

.channel-picker__hint {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.38);
}

.channel-picker__warn {
  font-size: 12px;
  color: #ff9a9a;
  line-height: 1.6;
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
