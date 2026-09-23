<template>
  <div class="drilling-container">
    <el-row :gutter="20" class="mb-20">
      <el-col :span="8">
        <el-select v-model="selectedWell" placeholder="请选择井" style="width: 100%">
          <el-option v-for="well in wellList" :key="well.id" :label="well.wellName" :value="well.id" />
        </el-select>
      </el-col>
      <el-col :span="16">
        <div class="drilling-status">
          <span class="status-label">当前井深:</span>
          <span class="status-value" :class="{ breach: breachSet.has('depth') }">{{ realTimeData.wellDepth }}m</span>
          <span class="status-label">机械钻速:</span>
          <span class="status-value">{{ realTimeData.rop }}m/h</span>
          <el-tag :type="dataInterrupted ? 'danger' : 'success'" size="large" effect="dark">
            {{ dataInterrupted ? '数据采集中断' : '正常钻井中' }}
          </el-tag>
          <el-button type="warning" plain size="small" @click="openRuleDialog">
            <el-icon><Aim /></el-icon>安全边界
          </el-button>
          <el-tooltip content="模拟采集链路中断：中断期间不重复生成中断记录，且暂停阈值判定" placement="bottom">
            <el-switch
              v-model="simulateGap"
              inline-prompt
              active-text="中断"
              inactive-text="正常"
              style="--el-switch-on-color: #ef4444"
            />
          </el-tooltip>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="mb-20">
      <el-col v-for="p in paramDefs" :key="p.key" :span="6">
        <div class="param-card" :class="{ breach: breachSet.has(p.key) }">
          <div class="param-title">
            {{ p.meta.label }}
            <span v-if="rule.enabled && getLimit(p.key) !== null" class="param-limit">
              上限 {{ getLimit(p.key) }}{{ p.meta.unit }}
            </span>
          </div>
          <div class="param-value">{{ valueOf(p.key) }} {{ p.meta.unit }}</div>
          <el-progress :percentage="paramPercent(p.key)" :color="breachSet.has(p.key) ? '#ef4444' : '#3b82f6'" />
          <div v-if="breachSet.has(p.key)" class="breach-tip">
            <el-icon><WarningFilled /></el-icon> 已超出安全上限
          </div>
        </div>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="mb-20">
      <el-col :span="24">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>实时参数曲线</span>
              <el-radio-group v-model="chartPeriod" size="small">
                <el-radio-button label="1h">1小时</el-radio-button>
                <el-radio-button label="6h">6小时</el-radio-button>
                <el-radio-button label="24h">24小时</el-radio-button>
              </el-radio-group>
            </div>
          </template>
          <div ref="realTimeChart" class="chart-large"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20">
      <el-col :span="14">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>钻井日志</span>
              <el-button type="primary" size="small">导出日志</el-button>
            </div>
          </template>
          <el-table :data="logList" size="small" max-height="400">
            <el-table-column prop="time" label="时间" width="180" />
            <el-table-column prop="wellDepth" label="井深(m)" width="100" />
            <el-table-column prop="bitDepth" label="钻头深度(m)" width="120" />
            <el-table-column prop="wob" label="钻压(kN)" width="100" />
            <el-table-column prop="rpm" label="转速(rpm)" width="100" />
            <el-table-column prop="rop" label="钻速(m/h)" width="100" />
            <el-table-column prop="remark" label="备注" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>告警信息</span>
              <div class="alarm-tools">
                <el-radio-group v-model="alarmFilter" size="small">
                  <el-radio-button label="active">
                    待处理<el-badge v-if="activeCount" :value="activeCount" type="danger" class="alarm-badge" />
                  </el-radio-button>
                  <el-radio-button label="all">全部({{ alarmList.length }})</el-radio-button>
                </el-radio-group>
              </div>
            </div>
          </template>
          <div class="alarm-list">
            <el-empty v-if="filteredAlarms.length === 0" description="暂无告警" :image-size="60" />
            <div
              v-for="alarm in filteredAlarms"
              :key="alarm.id"
              class="alarm-item"
              :class="['level-' + alarm.level, 'status-' + alarm.status]"
            >
              <div class="alarm-header">
                <div class="alarm-tags">
                  <el-tag :type="alarm.level === '严重' ? 'danger' : 'warning'" size="small">{{ alarm.level }}</el-tag>
                  <el-tag :type="statusTagType(alarm.status)" size="small" effect="plain">{{ statusText(alarm.status) }}</el-tag>
                </div>
                <span class="alarm-time">{{ alarm.triggeredAt }}</span>
              </div>
              <div class="alarm-content">{{ alarm.content }}</div>
              <div v-if="alarm.status === 'confirmed'" class="alarm-trace">
                <div>确认人：{{ alarm.confirmedBy }} ｜ 确认时间：{{ alarm.confirmedAt }}</div>
                <div>处理结果：{{ alarm.disposalResult }}<template v-if="alarm.disposalNote"> ｜ 说明：{{ alarm.disposalNote }}</template></div>
              </div>
              <div v-else-if="alarm.status === 'recovered'" class="alarm-trace recovered">
                已于 {{ alarm.recoveredAt }} 自动恢复，无需处理
              </div>
              <div class="alarm-footer">
                <el-button
                  v-if="alarm.status !== 'confirmed'"
                  type="primary"
                  size="small"
                  @click="openConfirmDialog(alarm)"
                >确认处理</el-button>
                <el-button size="small" text @click="viewAlarm(alarm)">详情</el-button>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 安全边界规则配置 -->
    <el-dialog v-model="ruleDialogVisible" title="安全边界规则配置" width="560px" @closed="onRuleDialogClosed">
      <el-alert
        title="为当前井配置参数上限，实时数据超出上限将生成告警；同一事件持续超限只保留一条记录。"
        type="info"
        :closable="false"
        show-icon
        class="mb-20"
      />
      <el-form label-width="130px">
        <el-form-item label="启用安全边界">
          <el-switch v-model="ruleForm.enabled" />
        </el-form-item>
        <template v-if="ruleForm.enabled">
          <el-form-item v-for="p in paramDefs" :key="p.key" :label="`${p.meta.label}上限`">
            <el-input-number
              v-model="ruleForm[p.limitProp]"
              :min="0"
              :max="p.meta.max"
              :precision="p.meta.decimals"
              :step="p.key === 'depth' ? 10 : 1"
              controls-position="right"
              style="width: 220px"
            />
            <span class="form-unit">{{ p.meta.unit }}</span>
          </el-form-item>
        </template>
        <el-form-item v-if="rule.updatedAt" label="最近更新">
          <span class="rule-meta">{{ rule.updatedBy || '—' }} 于 {{ rule.updatedAt }} 更新</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="ruleSaving" @click="saveRuleConfig">保存规则</el-button>
      </template>
    </el-dialog>

    <!-- 告警确认留痕 -->
    <el-dialog v-model="confirmDialogVisible" title="告警确认处理" width="520px">
      <el-descriptions :column="1" border size="small" class="mb-20">
        <el-descriptions-item label="告警级别">{{ currentAlarm?.level }}</el-descriptions-item>
        <el-descriptions-item label="触发时间">{{ currentAlarm?.triggeredAt }}</el-descriptions-item>
        <el-descriptions-item label="告警内容">{{ currentAlarm?.content }}</el-descriptions-item>
      </el-descriptions>
      <el-form :model="confirmForm" :rules="confirmRules" ref="confirmFormRef" label-width="90px">
        <el-form-item label="确认人" prop="confirmedBy">
          <el-input v-model="confirmForm.confirmedBy" placeholder="请输入确认人姓名" />
        </el-form-item>
        <el-form-item label="处理结果" prop="disposalResult">
          <el-select v-model="confirmForm.disposalResult" placeholder="请选择处理结果" style="width: 100%">
            <el-option v-for="r in disposalResults" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理说明" prop="disposalNote">
          <el-input v-model="confirmForm.disposalNote" type="textarea" :rows="3" placeholder="请填写现场处置情况" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="confirmDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitConfirm">提交确认</el-button>
      </template>
    </el-dialog>

    <!-- 告警详情 -->
    <el-dialog v-model="detailDialogVisible" title="告警详情" width="520px">
      <el-descriptions v-if="currentAlarm" :column="1" border size="small">
        <el-descriptions-item label="告警级别">{{ currentAlarm.level }}</el-descriptions-item>
        <el-descriptions-item label="告警状态">{{ statusText(currentAlarm.status) }}</el-descriptions-item>
        <el-descriptions-item label="首次触发">{{ currentAlarm.triggeredAt }}</el-descriptions-item>
        <el-descriptions-item label="最近发生">{{ currentAlarm.lastSeenAt }}</el-descriptions-item>
        <el-descriptions-item label="告警内容">{{ currentAlarm.content }}</el-descriptions-item>
        <el-descriptions-item label="恢复时间" v-if="currentAlarm.recoveredAt">{{ currentAlarm.recoveredAt }}</el-descriptions-item>
        <el-descriptions-item label="确认人">{{ currentAlarm.confirmedBy || '—' }}</el-descriptions-item>
        <el-descriptions-item label="确认时间">{{ currentAlarm.confirmedAt || '—' }}</el-descriptions-item>
        <el-descriptions-item label="处理结果">{{ currentAlarm.disposalResult || '—' }}</el-descriptions-item>
        <el-descriptions-item label="处理说明">{{ currentAlarm.disposalNote || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts'
import { ElMessage, ElMessageBox, FormInstance } from 'element-plus'
import {
  SafetyRule,
  SafetyAlarm,
  RuleKey,
  DisposalResult,
  DISPOSAL_RESULTS,
  PARAM_META,
  nowText,
  getRule,
  saveRule,
  getAlarms,
  validateRule,
  findThresholdConflicts,
  evaluateThresholds,
  evaluateDataGap,
  confirmAlarm
} from './safety'

const wellList = [
  { id: 1, wellName: 'A-01井' },
  { id: 2, wellName: 'B-03井' },
  { id: 3, wellName: 'C-02井' }
]

const selectedWell = ref(Number(localStorage.getItem('drilling:selected-well')) || 1)
const chartPeriod = ref('1h')
const realTimeChart = ref<HTMLElement>()
let chartInstance: echarts.ECharts | null = null
let dataTimer: ReturnType<typeof setInterval> | null = null
let watchdogTimer: ReturnType<typeof setInterval> | null = null
const STALE_MS = 6000

/* ------------------------------ 实时数据（按井） ------------------------------ */

// 各井独立的模拟数据基线，切井后各自延续
const wellData: Record<number, any> = {
  1: { wellDepth: 2998.2, bitDepth: 2992.0, wob: 220, rpm: 120, torque: 35.5, rop: 8.5, spp: 22.5, seed: 1 },
  2: { wellDepth: 1820.0, bitDepth: 1815.4, wob: 150, rpm: 95, torque: 22.0, rop: 6.2, spp: 18.0, seed: 2 },
  3: { wellDepth: 3450.6, bitDepth: 3445.1, wob: 300, rpm: 140, torque: 42.0, rop: 5.5, spp: 28.5, seed: 3 }
}

const realTimeData = reactive({ ...wellData[selectedWell.value] })
const lastSampleAt = ref<number | null>(null)
const simulateGap = ref(false)
const dataInterrupted = computed(() => lastSampleAt.value !== null && Date.now() - lastSampleAt.value >= STALE_MS)

/* -------------------------------- 规则与告警 -------------------------------- */

const rule = reactive<SafetyRule>(getRule(selectedWell.value))
const alarmList = ref<SafetyAlarm[]>(getAlarms(selectedWell.value))
const alarmFilter = ref<'active' | 'all'>('active')

const paramDefs = computed(() => [
  { key: 'depth' as RuleKey, limitProp: 'depthLimit' as const, meta: PARAM_META.depth, full: PARAM_META.depth.max },
  { key: 'wob' as RuleKey, limitProp: 'wobLimit' as const, meta: PARAM_META.wob, full: 500 },
  { key: 'rpm' as RuleKey, limitProp: 'rpmLimit' as const, meta: PARAM_META.rpm, full: 200 },
  { key: 'spp' as RuleKey, limitProp: 'sppLimit' as const, meta: PARAM_META.spp, full: 40 }
])

function getLimit(key: RuleKey): number | null {
  if (key === 'depth') return rule.depthLimit
  if (key === 'wob') return rule.wobLimit
  if (key === 'rpm') return rule.rpmLimit
  return rule.sppLimit
}

function valueOf(key: RuleKey): number {
  const v = key === 'depth' ? realTimeData.wellDepth : (realTimeData as any)[key]
  const decimals = PARAM_META[key].decimals
  return Number(Number(v).toFixed(decimals))
}

function paramPercent(key: RuleKey): number {
  const meta = PARAM_META[key]
  return Math.min(100, Math.round((Number(valueOf(key)) / meta.max) * 100))
}

const breachSet = computed(() => {
  const set = new Set<RuleKey>()
  if (rule.enabled) {
    ;(['depth', 'wob', 'rpm', 'spp'] as RuleKey[]).forEach((key) => {
      const limit = getLimit(key)
      if (limit !== null && Number(valueOf(key)) > limit) set.add(key)
    })
  }
  return set
})

const filteredAlarms = computed(() =>
  alarmFilter.value === 'active'
    ? alarmList.value.filter((a) => a.status !== 'recovered' && a.status !== 'confirmed')
    : alarmList.value
)
const activeCount = computed(() => alarmList.value.filter((a) => a.status === 'active').length)

function statusText(status: SafetyAlarm['status']): string {
  return { active: '待处理', recovered: '已恢复', confirmed: '已确认' }[status]
}
function statusTagType(status: SafetyAlarm['status']): 'danger' | 'success' | 'primary' {
  return ({ active: 'danger', recovered: 'success', confirmed: 'primary' } as const)[status]
}

/* ---------------------------------- 日志 ---------------------------------- */

const logList = ref([
  { time: '2024-01-15 10:30:00', wellDepth: 2856.5, bitDepth: 2850.2, wob: 220, rpm: 120, rop: 8.5, remark: '正常钻进' },
  { time: '2024-01-15 10:25:00', wellDepth: 2855.8, bitDepth: 2849.5, wob: 218, rpm: 118, rop: 8.2, remark: '正常钻进' },
  { time: '2024-01-15 10:20:00', wellDepth: 2855.1, bitDepth: 2848.8, wob: 215, rpm: 120, rop: 8.0, remark: '正常钻进' },
  { time: '2024-01-15 10:15:00', wellDepth: 2854.5, bitDepth: 2848.2, wob: 222, rpm: 122, rop: 8.3, remark: '正常钻进' },
  { time: '2024-01-15 10:10:00', wellDepth: 2853.8, bitDepth: 2847.5, wob: 218, rpm: 120, rop: 8.1, remark: '正常钻进' }
])

/* ---------------------------------- 图表 ---------------------------------- */

function limitMarkLine(limit: number | null, color: string) {
  if (limit === null) return undefined
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color, type: 'dashed' as const },
    label: { formatter: `上限 ${limit}`, color, position: 'insideEndTop' as const },
    data: [{ yAxis: limit }]
  }
}

const initChart = () => {
  if (!realTimeChart.value) return
  chartInstance = echarts.init(realTimeChart.value)
  renderChart()
  window.addEventListener('resize', resizeChart)
}

function renderChart() {
  if (!chartInstance) return
  const times = Array.from({ length: 60 }, (_, i) => {
    const d = new Date(Date.now() - (59 - i) * 60000)
    return `${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`
  })
  chartInstance.setOption(
    {
      tooltip: { trigger: 'axis' },
      legend: { data: ['钻压', '转速', '扭矩', '机械钻速'] },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: times },
      yAxis: [
        { type: 'value', name: '钻压(kN)', position: 'left', axisLine: { lineStyle: { color: '#3b82f6' } } },
        { type: 'value', name: '转速(rpm)', position: 'left', offset: 60, axisLine: { lineStyle: { color: '#22c55e' } } },
        { type: 'value', name: '扭矩(kN·m)', position: 'right', axisLine: { lineStyle: { color: '#f59e0b' } } },
        { type: 'value', name: '钻速(m/h)', position: 'right', offset: 60, axisLine: { lineStyle: { color: '#ef4444' } } }
      ],
      series: [
        {
          name: '钻压',
          type: 'line',
          smooth: true,
          data: Array.from({ length: 60 }, () => 200 + Math.random() * 50),
          yAxisIndex: 0,
          itemStyle: { color: '#3b82f6' },
          markLine: limitMarkLine(rule.enabled ? rule.wobLimit : null, '#3b82f6')
        },
        {
          name: '转速',
          type: 'line',
          smooth: true,
          data: Array.from({ length: 60 }, () => 100 + Math.random() * 40),
          yAxisIndex: 1,
          itemStyle: { color: '#22c55e' },
          markLine: limitMarkLine(rule.enabled ? rule.rpmLimit : null, '#22c55e')
        },
        {
          name: '扭矩',
          type: 'line',
          smooth: true,
          data: Array.from({ length: 60 }, () => 30 + Math.random() * 10),
          yAxisIndex: 2,
          itemStyle: { color: '#f59e0b' }
        },
        {
          name: '机械钻速',
          type: 'line',
          smooth: true,
          data: Array.from({ length: 60 }, () => 6 + Math.random() * 5),
          yAxisIndex: 3,
          itemStyle: { color: '#ef4444' }
        }
      ]
    },
    { notMerge: true }
  )
}

function resizeChart() {
  chartInstance?.resize()
}

/* -------------------------------- 实时更新 -------------------------------- */

const updateData = () => {
  // 模拟数据采集中断：不刷新数据、不做阈值判定，watchdog 负责生成/维持唯一中断记录
  if (simulateGap.value) return

  const base = wellData[selectedWell.value]
  const spike = (rate: number) => Math.random() < rate
  base.wellDepth = +(base.wellDepth + 0.1).toFixed(1)
  base.bitDepth = +(base.bitDepth + 0.1).toFixed(1)
  // 偶发越上限波动，便于演示触发
  base.wob = Math.round(200 + Math.random() * 50 + (spike(0.12) ? 80 : 0))
  base.rpm = Math.round(100 + Math.random() * 40 + (spike(0.08) ? 45 : 0))
  base.torque = +(30 + Math.random() * 10).toFixed(1)
  base.rop = +(6 + Math.random() * 5).toFixed(1)
  base.spp = +(22 + Math.random() * 4 + (spike(0.06) ? 8 : 0)).toFixed(1)

  Object.assign(realTimeData, base)
  lastSampleAt.value = Date.now()

  const { alarms, created } = evaluateThresholds(selectedWell.value, realTimeData, rule)
  alarmList.value = alarms
  created.forEach((a) => ElMessage.warning(`告警触发：${a.content}`))
}

const watchdog = () => {
  const { alarms, created } = evaluateDataGap(selectedWell.value, lastSampleAt.value, STALE_MS)
  alarmList.value = alarms
  if (created) ElMessage.error('实时数据采集中断，请检查通讯链路')
}

watch(simulateGap, (gap) => {
  if (!gap) {
    // 恢复采集：刷新时间戳并立即评估，watchdog 不会重复生成中断记录
    lastSampleAt.value = Date.now()
    const { alarms } = evaluateDataGap(selectedWell.value, lastSampleAt.value, STALE_MS)
    alarmList.value = alarms
  }
})

/* ------------------------------ 规则配置弹窗 ------------------------------ */

const ruleDialogVisible = ref(false)
const ruleSaving = ref(false)
const ruleForm = reactive<SafetyRule>({ ...getRule(selectedWell.value) })

const openRuleDialog = () => {
  Object.assign(ruleForm, getRule(selectedWell.value))
  ruleDialogVisible.value = true
}

const onRuleDialogClosed = () => {
  ruleSaving.value = false
}

const currentUser = () => localStorage.getItem('username') || '管理员'

const saveRuleConfig = async () => {
  const errors = validateRule(ruleForm)
  if (errors.length) {
    ElMessage.error(errors[0])
    return
  }

  const current: Record<RuleKey, number> = {
    depth: realTimeData.wellDepth,
    wob: realTimeData.wob,
    rpm: realTimeData.rpm,
    spp: realTimeData.spp
  }
  const conflicts = findThresholdConflicts(ruleForm, current)
  if (conflicts.length) {
    try {
      await ElMessageBox.confirm(
        `存在阈值冲突，保存后会立即触发告警：\n${conflicts.map((c) => '· ' + c).join('\n')}\n\n仍要保存吗？`,
        '阈值冲突确认',
        { confirmButtonText: '强制保存', cancelButtonText: '返回修改', type: 'warning' }
      )
    } catch {
      return
    }
  }

  ruleSaving.value = true
  const saved: SafetyRule = { ...ruleForm, updatedAt: nowText(), updatedBy: currentUser() }
  saveRule(selectedWell.value, saved)
  Object.assign(rule, saved)
  renderChart()
  // 保存后立即评估：当前仍超限只会复用/更新已有记录，不会因阈值修改重复建单
  if (!dataInterrupted.value) {
    const { alarms, created } = evaluateThresholds(selectedWell.value, realTimeData, rule)
    alarmList.value = alarms
    created.forEach((a) => ElMessage.warning(`告警触发：${a.content}`))
  }
  ruleDialogVisible.value = false
  ElMessage.success('安全边界规则已保存')
}

/* ------------------------------ 告警确认弹窗 ------------------------------ */

const disposalResults = DISPOSAL_RESULTS
const confirmDialogVisible = ref(false)
const detailDialogVisible = ref(false)
const currentAlarm = ref<SafetyAlarm | null>(null)
const confirmFormRef = ref<FormInstance>()
const confirmForm = reactive({
  confirmedBy: currentUser(),
  disposalResult: '' as DisposalResult | '',
  disposalNote: ''
})
const confirmRules = {
  confirmedBy: [{ required: true, message: '请输入确认人姓名', trigger: 'blur' }],
  disposalResult: [{ required: true, message: '请选择处理结果', trigger: 'change' }],
  disposalNote: [{ required: true, message: '请填写处理说明', trigger: 'blur' }]
}

function openConfirmDialog(alarm: SafetyAlarm) {
  currentAlarm.value = alarm
  confirmForm.confirmedBy = currentUser()
  confirmForm.disposalResult = ''
  confirmForm.disposalNote = ''
  confirmDialogVisible.value = true
}

const submitConfirm = async () => {
  if (!confirmFormRef.value || !currentAlarm.value) return
  await confirmFormRef.value.validate((valid) => {
    if (!valid) return
    alarmList.value = confirmAlarm(selectedWell.value, currentAlarm.value!.id, {
      confirmedBy: confirmForm.confirmedBy,
      disposalResult: confirmForm.disposalResult as DisposalResult,
      disposalNote: confirmForm.disposalNote
    })
    confirmDialogVisible.value = false
    ElMessage.success('告警已确认，处理结果已留痕')
  })
}

const viewAlarm = (alarm: SafetyAlarm) => {
  currentAlarm.value = alarm
  detailDialogVisible.value = true
}

/* -------------------------------- 切井/卸载 -------------------------------- */

const loadWellState = (wellId: number) => {
  localStorage.setItem('drilling:selected-well', String(wellId))
  Object.assign(rule, getRule(wellId))
  alarmList.value = getAlarms(wellId)
  Object.assign(realTimeData, wellData[wellId])
  // 切井视为重新建立采集，等首个数据周期到来前不误报中断
  lastSampleAt.value = Date.now()
  renderChart()
}

watch(selectedWell, (wellId) => loadWellState(wellId))

onMounted(() => {
  initChart()
  lastSampleAt.value = Date.now()
  dataTimer = setInterval(updateData, 2000)
  watchdogTimer = setInterval(watchdog, 1000)
})

onUnmounted(() => {
  // 返回日志列表（路由离开）后规则与确认状态仍在 localStorage 中，再次进入保持一致
  if (dataTimer) clearInterval(dataTimer)
  if (watchdogTimer) clearInterval(watchdogTimer)
  window.removeEventListener('resize', resizeChart)
  if (chartInstance) chartInstance.dispose()
})
</script>

<style scoped lang="scss">
.drilling-container {
  width: 100%;
}

.drilling-status {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: linear-gradient(135deg, #1e3a8a, #3b82f6);
  border-radius: 8px;
  color: #fff;

  .status-label {
    font-size: 14px;
    opacity: 0.8;
  }

  .status-value {
    font-size: 20px;
    font-weight: 600;
    margin-left: 4px;

    &.breach {
      color: #fecaca;
    }
  }
}

.param-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.08);
  border: 1px solid transparent;
  transition: border-color 0.2s;

  &.breach {
    border-color: #ef4444;
    box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.15);

    .param-value {
      color: #ef4444;
    }
  }

  .param-title {
    font-size: 14px;
    color: #64748b;
    margin-bottom: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .param-limit {
    font-size: 12px;
    color: #94a3b8;
  }

  .param-value {
    font-size: 32px;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 15px;
  }

  .breach-tip {
    margin-top: 8px;
    font-size: 12px;
    color: #ef4444;
    display: flex;
    align-items: center;
    gap: 4px;
  }
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.alarm-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}

.alarm-badge {
  margin-left: 4px;
}

.chart-large {
  width: 100%;
  height: 350px;
}

.alarm-list {
  max-height: 420px;
  overflow-y: auto;
}

.alarm-item {
  padding: 12px 15px;
  border-radius: 6px;
  margin-bottom: 10px;
  background: #f8fafc;
  border-left: 4px solid #94a3b8;

  &.level-严重 {
    background: rgba(239, 68, 68, 0.08);
    border-left-color: #ef4444;
  }

  &.level-警告 {
    background: rgba(245, 158, 11, 0.08);
    border-left-color: #f59e0b;
  }

  &.status-recovered,
  &.status-confirmed {
    opacity: 0.85;
  }

  .alarm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .alarm-tags {
    display: flex;
    gap: 6px;
  }

  .alarm-time {
    font-size: 12px;
    color: #64748b;
  }

  .alarm-content {
    font-size: 14px;
    color: #1e293b;
  }

  .alarm-trace {
    margin-top: 8px;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.8;
    color: #1d4ed8;
    background: rgba(59, 130, 246, 0.08);
    border-radius: 4px;

    &.recovered {
      color: #047857;
      background: rgba(16, 185, 129, 0.08);
    }
  }

  .alarm-footer {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
}

.form-unit {
  margin-left: 10px;
  color: #64748b;
}

.rule-meta {
  font-size: 12px;
  color: #94a3b8;
}
</style>
