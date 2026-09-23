<template>
  <div class="drilling-container">
    <el-row :gutter="20" class="mb-20">
      <el-col :span="8">
        <el-select v-model="selectedWell" placeholder="请选择井" style="width: 100%" @change="onWellChange">
          <el-option v-for="well in wellList" :key="well.id" :label="well.wellName" :value="well.id" />
        </el-select>
      </el-col>
      <el-col :span="16">
        <div class="drilling-status">
          <span class="status-label">当前井深:</span>
          <span class="status-value" :class="{ 'value-danger': depthOverLimit }">
            {{ realTimeData.wellDepth }}m
            <span v-if="depthLimitText" class="limit-inline">上限 {{ depthLimitText }}</span>
          </span>
          <span class="status-label">机械钻速:</span>
          <span class="status-value">{{ realTimeData.rop }}m/h</span>
          <el-tag :type="interrupted ? 'danger' : 'success'" size="large">
            {{ interrupted ? '数据中断' : '实时连接' }}
          </el-tag>
          <el-tag v-if="!interrupted && hasOverLimit" type="danger" size="large">参数超限</el-tag>
          <el-tag v-else-if="!interrupted" type="success" size="large">正常钻井中</el-tag>
          <el-tag :type="pendingCount > 0 ? 'danger' : 'info'" size="large">
            待确认告警 {{ pendingCount }}
          </el-tag>
          <el-button size="small" plain :type="interrupted ? 'success' : 'warning'" @click="toggleInterruption">
            {{ interrupted ? '恢复数据' : '模拟数据中断' }}
          </el-button>
        </div>
      </el-col>
    </el-row>

    <el-alert
      v-if="interrupted"
      class="mb-20"
      type="error"
      :closable="false"
      show-icon
      :title="`数据采集中断（${interruptedSince}）：期间暂停阈值评估，不会生成或重复生成告警记录；恢复后未解除的异常仍合并至原待确认记录。`"
    />

    <el-row :gutter="20" class="mb-20">
      <el-col :span="6">
        <div class="param-card" :class="{ 'card-danger': isOver('wob') }">
          <div class="param-title">
            钻压 (WOB)
            <span v-if="limitText('wob')" class="limit-tag" :class="{ 'limit-tag-danger': isOver('wob') }">
              上限 {{ limitText('wob') }}
            </span>
          </div>
          <div class="param-value">{{ realTimeData.wob }} kN</div>
          <el-progress :percentage="(realTimeData.wob / 500) * 100" :color="paramColor('wob')" />
        </div>
      </el-col>
      <el-col :span="6">
        <div class="param-card" :class="{ 'card-danger': isOver('rpm') }">
          <div class="param-title">
            转速 (RPM)
            <span v-if="limitText('rpm')" class="limit-tag" :class="{ 'limit-tag-danger': isOver('rpm') }">
              上限 {{ limitText('rpm') }}
            </span>
          </div>
          <div class="param-value">{{ realTimeData.rpm }} rpm</div>
          <el-progress :percentage="(realTimeData.rpm / 200) * 100" :color="paramColor('rpm')" />
        </div>
      </el-col>
      <el-col :span="6">
        <div class="param-card">
          <div class="param-title">扭矩 (Torque)</div>
          <div class="param-value">{{ realTimeData.torque }} kN·m</div>
          <el-progress :percentage="(realTimeData.torque / 60) * 100" :color="progressColor" />
        </div>
      </el-col>
      <el-col :span="6">
        <div class="param-card" :class="{ 'card-danger': isOver('spp') }">
          <div class="param-title">
            立管压力
            <span v-if="limitText('spp')" class="limit-tag" :class="{ 'limit-tag-danger': isOver('spp') }">
              上限 {{ limitText('spp') }}
            </span>
          </div>
          <div class="param-value">{{ realTimeData.spp }} MPa</div>
          <el-progress :percentage="(realTimeData.spp / 40) * 100" :color="paramColor('spp')" />
        </div>
      </el-col>
    </el-row>

    <el-card class="mb-20">
      <template #header>
        <div class="card-header">
          <span>安全边界规则（{{ currentWellName }}）</span>
          <div>
            <el-tag :type="ruleForm.enabled ? 'success' : 'info'" size="small" class="mr-10">
              {{ ruleForm.enabled ? '已启用' : '未启用' }}
            </el-tag>
            <span class="rule-updated" v-if="rule">最近更新：{{ rule.updatedAt }} / {{ rule.updatedBy }}</span>
          </div>
        </div>
      </template>
      <el-form :model="ruleForm" label-width="150px" class="rule-form">
        <el-form-item>
          <el-switch v-model="ruleForm.enabled" active-text="启用该井的安全边界监控" />
        </el-form-item>
        <el-row :gutter="20">
          <el-col v-for="key in paramOrder" :key="key" :span="6">
            <el-form-item :label="`${paramMeta[key].label}上限(${paramMeta[key].unit})`">
              <el-input-number
                v-model="ruleForm.limits[key]"
                :min="0.1"
                :max="paramMeta[key].hardMax"
                :precision="1"
                :value-on-clear="null"
                controls-position="right"
                style="width: 100%"
                placeholder="留空=不设限"
              />
              <div class="rule-hint">仪表量程 0~{{ paramMeta[key].hardMax }}{{ paramMeta[key].unit }}</div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item>
          <el-button type="primary" @click="handleSaveRule">保存规则</el-button>
          <el-button @click="resetRuleForm">重置</el-button>
          <span class="rule-tip">保存后立即对实时数据生效；阈值冲突（非正数或超出仪表量程）将拒绝保存。</span>
        </el-form-item>
      </el-form>
    </el-card>

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
              <el-badge :value="pendingCount" :hidden="pendingCount === 0" type="danger" />
            </div>
          </template>
          <el-radio-group v-model="alarmFilter" size="small" class="mb-10">
            <el-radio-button label="all">全部 ({{ alarmList.length }})</el-radio-button>
            <el-radio-button label="pending">待确认 ({{ pendingCount }})</el-radio-button>
            <el-radio-button label="confirmed">已确认 ({{ confirmedCount }})</el-radio-button>
          </el-radio-group>
          <div class="alarm-list">
            <el-empty v-if="filteredAlarms.length === 0" description="暂无告警" :image-size="60" />
            <div
              v-for="alarm in filteredAlarms"
              :key="alarm.id"
              class="alarm-item"
              :class="[
                'level-' + alarm.level,
                { 'alarm-confirmed': alarm.status === 'confirmed' }
              ]"
            >
              <div class="alarm-header">
                <div class="alarm-tags">
                  <el-tag :type="alarm.level === '严重' ? 'danger' : 'warning'" size="small">{{ alarm.level }}</el-tag>
                  <el-tag type="info" size="small">{{ paramLabel(alarm.param) }}</el-tag>
                  <el-tag :type="alarm.status === 'pending' ? 'danger' : 'success'" size="small">
                    {{ alarm.status === 'pending' ? '待确认' : '已确认' }}
                  </el-tag>
                  <el-tag v-if="alarm.thresholdChanged" type="warning" size="small">规则阈值已变更</el-tag>
                </div>
                <span class="alarm-time">{{ alarm.lastTriggeredAt }}</span>
              </div>
              <div class="alarm-content">{{ alarm.content }}</div>
              <div class="alarm-meta">
                <span v-if="alarm.threshold != null">触发阈值: {{ alarm.threshold }}{{ paramUnit(alarm.param) }}</span>
                <span v-if="alarm.value != null">最近值: {{ alarm.value }}{{ paramUnit(alarm.param) }}</span>
                <span>累计触发: {{ alarm.triggerCount }} 次</span>
                <span>首次: {{ alarm.firstTriggeredAt }}</span>
              </div>
              <div v-if="alarm.status === 'confirmed'" class="alarm-confirm-trace">
                <div>确认人：{{ alarm.confirmedBy }}</div>
                <div>确认时间：{{ alarm.confirmedAt }}</div>
                <div>处理结果：{{ alarm.handleResult }}</div>
                <div v-if="alarm.handleRemark">处理备注：{{ alarm.handleRemark }}</div>
              </div>
              <div class="alarm-actions">
                <el-button
                  v-if="alarm.status === 'pending'"
                  type="primary"
                  size="small"
                  @click="openConfirmDialog(alarm)"
                >确认告警</el-button>
                <el-button size="small" text @click="openDetailDialog(alarm)">查看详情</el-button>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 告警确认留痕弹窗 -->
    <el-dialog v-model="confirmDialogVisible" title="确认告警" width="520px">
      <el-descriptions :column="1" border size="small" class="mb-20">
        <el-descriptions-item label="告警内容">{{ confirmTarget?.content }}</el-descriptions-item>
        <el-descriptions-item label="最近触发">{{ confirmTarget?.lastTriggeredAt }}（累计 {{ confirmTarget?.triggerCount }} 次）</el-descriptions-item>
      </el-descriptions>
      <el-form :model="confirmForm" label-width="90px">
        <el-form-item label="确认人" required>
          <el-input v-model="confirmForm.confirmedBy" placeholder="请输入确认人姓名" maxlength="20" />
        </el-form-item>
        <el-form-item label="处理结果" required>
          <el-select v-model="confirmForm.handleResult" placeholder="请选择处理结果" style="width: 100%">
            <el-option v-for="r in handleResultOptions" :key="r" :label="r" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="处理备注">
          <el-input v-model="confirmForm.handleRemark" type="textarea" :rows="3" placeholder="可补充处理过程（选填）" maxlength="200" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="confirmDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="confirmSubmitting" @click="submitConfirm">提交确认</el-button>
      </template>
    </el-dialog>

    <!-- 告警详情 -->
    <el-dialog v-model="detailDialogVisible" title="告警详情" width="600px">
      <el-descriptions v-if="detailTarget" :column="1" border size="small">
        <el-descriptions-item label="告警编号">{{ detailTarget.id }}</el-descriptions-item>
        <el-descriptions-item label="所属井">{{ currentWellName }}</el-descriptions-item>
        <el-descriptions-item label="参数 / 级别">{{ paramLabel(detailTarget.param) }} / {{ detailTarget.level }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="detailTarget.status === 'pending' ? 'danger' : 'success'" size="small">
            {{ detailTarget.status === 'pending' ? '待确认' : '已确认' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="告警内容">{{ detailTarget.content }}</el-descriptions-item>
        <el-descriptions-item label="触发阈值">
          {{ detailTarget.threshold != null ? `${detailTarget.threshold}${paramUnit(detailTarget.param)}` : '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="最近实测值">
          {{ detailTarget.value != null ? `${detailTarget.value}${paramUnit(detailTarget.param)}` : '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="首次触发时间">{{ detailTarget.firstTriggeredAt }}</el-descriptions-item>
        <el-descriptions-item label="最近触发时间">{{ detailTarget.lastTriggeredAt }}</el-descriptions-item>
        <el-descriptions-item label="累计触发次数">{{ detailTarget.triggerCount }} 次</el-descriptions-item>
        <el-descriptions-item v-if="detailTarget.status === 'confirmed'" label="确认人">{{ detailTarget.confirmedBy }}</el-descriptions-item>
        <el-descriptions-item v-if="detailTarget.status === 'confirmed'" label="确认时间">{{ detailTarget.confirmedAt }}</el-descriptions-item>
        <el-descriptions-item v-if="detailTarget.status === 'confirmed'" label="处理结果">{{ detailTarget.handleResult }}</el-descriptions-item>
        <el-descriptions-item v-if="detailTarget.status === 'confirmed'" label="处理备注">{{ detailTarget.handleRemark || '—' }}</el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button
          v-if="detailTarget && detailTarget.status === 'pending'"
          type="primary"
          @click="confirmFromDetail"
        >去确认</el-button>
        <el-button @click="detailDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import {
  ensureSeedData,
  getSafetyRule,
  saveSafetyRule,
  listAlarms,
  evaluateSample,
  confirmAlarm,
  formatDateTime,
  PARAM_META,
  PARAM_ORDER,
  HANDLE_RESULT_OPTIONS,
  type SafetyRule,
  type SafetyParamKey,
  type AlarmRecord,
  type DrillingSample
} from '@/api/drillingSafety'

interface WellBase extends DrillingSample {
  bitDepth: number
  torque: number
  rop: number
}

const wellList = ref([
  { id: 1, wellName: 'A-01井' },
  { id: 2, wellName: 'B-03井' },
  { id: 3, wellName: 'C-02井' }
])

const WELL_BASE: Record<number, WellBase> = {
  1: { wellDepth: 2856.5, bitDepth: 2850.2, wob: 220, rpm: 120, torque: 35.5, rop: 8.5, spp: 22.5 },
  2: { wellDepth: 4210.0, bitDepth: 4205.4, wob: 230, rpm: 130, torque: 40.2, rop: 7.2, spp: 25.0 },
  3: { wellDepth: 1530.2, bitDepth: 1526.8, wob: 180, rpm: 100, torque: 28.1, rop: 9.8, spp: 18.0 }
}

const selectedWell = ref(1)
const chartPeriod = ref('1h')
const realTimeChart = ref<HTMLElement>()
let chartInstance: any = null
let timer: any = null
let resizeHandler: (() => void) | null = null

const paramMeta = PARAM_META
const paramOrder = PARAM_ORDER
const handleResultOptions = HANDLE_RESULT_OPTIONS

const realTimeData = reactive({
  wellDepth: WELL_BASE[1].wellDepth,
  bitDepth: WELL_BASE[1].bitDepth,
  wob: WELL_BASE[1].wob,
  rpm: WELL_BASE[1].rpm,
  torque: WELL_BASE[1].torque,
  rop: WELL_BASE[1].rop,
  spp: WELL_BASE[1].spp,
  mudFlowIn: 32.5,
  mudFlowOut: 31.8,
  mudDensityIn: 1.25,
  mudDensityOut: 1.28,
  mudTemperature: 45.6
})

const logList = ref([
  { time: '2024-01-15 10:30:00', wellDepth: 2856.5, bitDepth: 2850.2, wob: 220, rpm: 120, rop: 8.5, remark: '正常钻进' },
  { time: '2024-01-15 10:25:00', wellDepth: 2855.8, bitDepth: 2849.5, wob: 218, rpm: 118, rop: 8.2, remark: '正常钻进' },
  { time: '2024-01-15 10:20:00', wellDepth: 2855.1, bitDepth: 2848.8, wob: 215, rpm: 120, rop: 8.0, remark: '正常钻进' },
  { time: '2024-01-15 10:15:00', wellDepth: 2854.5, bitDepth: 2848.2, wob: 222, rpm: 122, rop: 8.3, remark: '正常钻进' },
  { time: '2024-01-15 10:10:00', wellDepth: 2853.8, bitDepth: 2847.5, wob: 218, rpm: 120, rop: 8.1, remark: '正常钻进' }
])

// —— 安全边界规则 ——

const rule = ref<SafetyRule | null>(null)
const ruleForm = reactive<{ enabled: boolean; limits: Record<SafetyParamKey, number | null> }>({
  enabled: false,
  limits: { wellDepth: null, wob: null, rpm: null, spp: null }
})

const currentWellName = computed(() => wellList.value.find(w => w.id === selectedWell.value)?.wellName || '')

function applyRuleToForm(r: SafetyRule | null) {
  ruleForm.enabled = r?.enabled ?? false
  for (const key of PARAM_ORDER) {
    ruleForm.limits[key] = r ? r[key] : null
  }
}

function resetRuleForm() {
  applyRuleToForm(rule.value)
}

function handleSaveRule() {
  try {
    const saved = saveSafetyRule(
      selectedWell.value,
      { enabled: ruleForm.enabled, limits: { ...ruleForm.limits } },
      '管理员'
    )
    rule.value = saved
    ElMessage.success('安全边界规则已保存并立即生效')
    renderChart()
  } catch (e: any) {
    // 阈值冲突：拒绝写入，不触发任何告警记录
    ElMessage.error(e?.message || '规则保存失败')
  }
}

function limitOf(key: SafetyParamKey): number | null {
  return rule.value?.enabled && rule.value[key] != null ? (rule.value[key] as number) : null
}

function isOver(key: SafetyParamKey): boolean {
  const limit = limitOf(key)
  return limit != null && realTimeData[key] > limit
}

function limitText(key: SafetyParamKey): string {
  const limit = limitOf(key)
  return limit == null ? '' : `${limit}${PARAM_META[key].unit}`
}

function paramColor(key: SafetyParamKey): string {
  return isOver(key) ? '#ef4444' : '#3b82f6'
}

const depthLimitText = computed(() => limitText('wellDepth'))
const depthOverLimit = computed(() => isOver('wellDepth'))
const hasOverLimit = computed(() => PARAM_ORDER.some(k => isOver(k)))

// —— 告警与确认 ——

const alarmList = ref<AlarmRecord[]>([])
const alarmFilter = ref<'all' | 'pending' | 'confirmed'>('all')

const filteredAlarms = computed(() => {
  if (alarmFilter.value === 'all') return alarmList.value
  return alarmList.value.filter(a => a.status === alarmFilter.value)
})
const pendingCount = computed(() => alarmList.value.filter(a => a.status === 'pending').length)
const confirmedCount = computed(() => alarmList.value.filter(a => a.status === 'confirmed').length)

function refreshAlarms() {
  alarmList.value = listAlarms(selectedWell.value)
}

function paramLabel(param: SafetyParamKey | 'other'): string {
  return param === 'other' ? '其他' : PARAM_META[param].label
}

function paramUnit(param: SafetyParamKey | 'other'): string {
  return param === 'other' ? '' : PARAM_META[param].unit
}

const confirmDialogVisible = ref(false)
const confirmSubmitting = ref(false)
const confirmTargetId = ref<string | null>(null)
const confirmForm = reactive({ confirmedBy: '管理员', handleResult: '', handleRemark: '' })
const confirmTarget = computed(() => alarmList.value.find(a => a.id === confirmTargetId.value) || null)

function openConfirmDialog(alarm: AlarmRecord) {
  confirmTargetId.value = alarm.id
  confirmForm.confirmedBy = '管理员'
  confirmForm.handleResult = ''
  confirmForm.handleRemark = ''
  confirmDialogVisible.value = true
}

function submitConfirm() {
  if (!confirmTargetId.value) return
  if (!confirmForm.confirmedBy.trim()) {
    ElMessage.warning('请填写确认人')
    return
  }
  if (!confirmForm.handleResult) {
    ElMessage.warning('请选择处理结果')
    return
  }
  confirmSubmitting.value = true
  try {
    confirmAlarm(
      confirmTargetId.value,
      confirmForm.confirmedBy,
      confirmForm.handleResult,
      confirmForm.handleRemark
    )
    ElMessage.success('告警已确认，确认人与处理结果已留痕')
    confirmDialogVisible.value = false
    refreshAlarms()
  } catch (e: any) {
    // 记录已被确认（重复提交）时拒绝
    ElMessage.error(e?.message || '确认失败')
  } finally {
    confirmSubmitting.value = false
  }
}

const detailDialogVisible = ref(false)
const detailTargetId = ref<string | null>(null)
const detailTarget = computed(() => alarmList.value.find(a => a.id === detailTargetId.value) || null)

function openDetailDialog(alarm: AlarmRecord) {
  detailTargetId.value = alarm.id
  detailDialogVisible.value = true
}

function confirmFromDetail() {
  if (!detailTarget.value) return
  const target = detailTarget.value
  detailDialogVisible.value = false
  openConfirmDialog(target)
}

// —— 数据中断 ——

const interrupted = ref(false)
const interruptedSince = ref('')

function toggleInterruption() {
  interrupted.value = !interrupted.value
  if (interrupted.value) {
    interruptedSince.value = formatDateTime()
    ElMessage.warning('已模拟数据采集中断，阈值评估暂停')
  } else {
    ElMessage.success('数据采集已恢复，恢复后首帧若仍超限将合并至原待确认记录')
  }
}

// —— 实时评估（幂等：中断不评估，重复超限合并，不重复生成记录） ——

const mergeNotified = new Set<string>()

function round1(n: number) {
  return Math.round(n * 10) / 10
}

function advanceData() {
  const d = realTimeData
  d.wellDepth = round1(d.wellDepth + 0.1)
  d.bitDepth = round1(d.bitDepth + 0.1)
  // 小概率出现越限尖峰，用于演示阈值触发与重复合并
  d.wob = round1(Math.random() < 0.12 ? 255 + Math.random() * 25 : 200 + Math.random() * 45)
  d.rpm = round1(Math.random() < 0.08 ? 152 + Math.random() * 15 : 105 + Math.random() * 35)
  d.spp = round1(Math.random() < 0.08 ? 30.5 + Math.random() * 2.5 : 20 + Math.random() * 5)
  d.torque = round1(30 + Math.random() * 10)
  d.rop = round1(6 + Math.random() * 5)
}

function tick() {
  // 数据中断：不采样、不评估，因此不会生成或重复生成任何告警记录
  if (interrupted.value) return

  advanceData()

  const sample: DrillingSample = {
    wellDepth: realTimeData.wellDepth,
    wob: realTimeData.wob,
    rpm: realTimeData.rpm,
    spp: realTimeData.spp
  }
  const result = evaluateSample(selectedWell.value, sample)

  pushHistory(sample)
  updateChart()

  if (result.created.length > 0) {
    refreshAlarms()
    for (const a of result.created) {
      ElMessage({
        message: `触发${a.level}告警：${a.content}`,
        type: a.level === '严重' ? 'error' : 'warning',
        duration: 4000
      })
    }
  } else if (result.updated.length > 0) {
    refreshAlarms()
    for (const a of result.updated) {
      if (!mergeNotified.has(a.id)) {
        mergeNotified.add(a.id)
        ElMessage.info(`「${paramLabel(a.param)}超限」持续触发，已合并至同一条待确认记录（第 ${a.triggerCount} 次），不重复生成`)
      }
    }
  }
}

// —— 切井：规则、告警、实时数据均按井加载 ——

function loadWell(wellId: number) {
  rule.value = getSafetyRule(wellId)
  applyRuleToForm(rule.value)
  refreshAlarms()

  const base = WELL_BASE[wellId] || WELL_BASE[1]
  Object.assign(realTimeData, {
    wellDepth: base.wellDepth,
    bitDepth: base.bitDepth,
    wob: base.wob,
    rpm: base.rpm,
    torque: base.torque,
    rop: base.rop,
    spp: base.spp
  })
  interrupted.value = false
  resetHistory(base)
  renderChart()
}

function onWellChange(wellId: number) {
  loadWell(wellId)
}

// —— 曲线图 ——

const progressColor = '#3b82f6'
const history: Record<'wob' | 'rpm' | 'torque' | 'rop', number[]> = {
  wob: [],
  rpm: [],
  torque: [],
  rop: []
}
const timeLabels: string[] = []

function makeTimeLabels() {
  timeLabels.length = 0
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.now() - (59 - i) * 60000)
    timeLabels.push(`${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`)
  }
}

function resetHistory(base: WellBase) {
  history.wob = Array.from({ length: 60 }, () => round1(base.wob - 20 + Math.random() * 40))
  history.rpm = Array.from({ length: 60 }, () => round1(base.rpm - 15 + Math.random() * 30))
  history.torque = Array.from({ length: 60 }, () => round1(base.torque - 5 + Math.random() * 10))
  history.rop = Array.from({ length: 60 }, () => round1(base.rop - 2 + Math.random() * 4))
  makeTimeLabels()
}

function pushHistory(sample: DrillingSample) {
  history.wob.push(sample.wob)
  history.wob.shift()
  history.rpm.push(sample.rpm)
  history.rpm.shift()
  history.torque.push(realTimeData.torque)
  history.torque.shift()
  history.rop.push(realTimeData.rop)
  history.rop.shift()
  const d = new Date()
  timeLabels.push(`${d.getHours()}:${d.getMinutes().toString().padStart(2, '0')}`)
  timeLabels.shift()
}

function limitMarkLine(key: SafetyParamKey) {
  const limit = limitOf(key)
  if (limit == null) return undefined
  return {
    silent: true,
    symbol: 'none',
    lineStyle: { color: '#ef4444', type: 'dashed' },
    label: { formatter: `上限 ${limit}`, position: 'insideEndTop' as const },
    data: [{ yAxis: limit }]
  }
}

function renderChart() {
  if (!realTimeChart.value) return
  if (!chartInstance) {
    chartInstance = echarts.init(realTimeChart.value)
  }
  chartInstance.setOption(
    {
      tooltip: { trigger: 'axis' },
      legend: { data: ['钻压', '转速', '扭矩', '机械钻速'] },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: [...timeLabels] },
      yAxis: [
        { type: 'value', name: '钻压(kN)', position: 'left', axisLine: { lineStyle: { color: '#3b82f6' } } },
        { type: 'value', name: '转速(rpm)', position: 'left', offset: 60, axisLine: { lineStyle: { color: '#22c55e' } } },
        { type: 'value', name: '扭矩(kN·m)', position: 'right', axisLine: { lineStyle: { color: '#f59e0b' } } },
        { type: 'value', name: '钻速(m/h)', position: 'right', offset: 60, axisLine: { lineStyle: { color: '#ef4444' } } }
      ],
      series: [
        { name: '钻压', type: 'line', smooth: true, data: [...history.wob], yAxisIndex: 0, itemStyle: { color: '#3b82f6' }, markLine: limitMarkLine('wob') },
        { name: '转速', type: 'line', smooth: true, data: [...history.rpm], yAxisIndex: 1, itemStyle: { color: '#22c55e' }, markLine: limitMarkLine('rpm') },
        { name: '扭矩', type: 'line', smooth: true, data: [...history.torque], yAxisIndex: 2, itemStyle: { color: '#f59e0b' } },
        { name: '机械钻速', type: 'line', smooth: true, data: [...history.rop], yAxisIndex: 3, itemStyle: { color: '#ef4444' } }
      ]
    },
    { notMerge: true }
  )
}

function updateChart() {
  if (!chartInstance) return
  chartInstance.setOption({
    xAxis: { data: [...timeLabels] },
    series: [
      { data: [...history.wob] },
      { data: [...history.rpm] },
      { data: [...history.torque] },
      { data: [...history.rop] }
    ]
  })
}

onMounted(() => {
  ensureSeedData()
  resetHistory(WELL_BASE[selectedWell.value])
  loadWell(selectedWell.value)
  renderChart()
  resizeHandler = () => chartInstance?.resize()
  window.addEventListener('resize', resizeHandler)
  timer = setInterval(tick, 2000)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
  if (chartInstance) chartInstance.dispose()
  chartInstance = null
})
</script>

<style scoped lang="scss">
.drilling-container {
  width: 100%;
}

.mb-20 {
  margin-bottom: 20px;
}

.mr-10 {
  margin-right: 10px;
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
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .limit-inline {
    font-size: 12px;
    font-weight: 400;
    opacity: 0.85;
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 4px;
    padding: 0 6px;
  }

  .value-danger {
    color: #fecaca;
  }
}

.param-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.08);
  border: 1px solid transparent;
  transition: border-color 0.2s;

  &.card-danger {
    border-color: #ef4444;
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.25);
  }

  .param-title {
    font-size: 14px;
    color: #64748b;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .param-value {
    font-size: 32px;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 15px;
  }
}

.limit-tag {
  font-size: 12px;
  font-weight: 400;
  color: #3b82f6;
  background: #eff6ff;
  border-radius: 4px;
  padding: 2px 8px;
  white-space: nowrap;

  &.limit-tag-danger {
    color: #ef4444;
    background: #fef2f2;
  }
}

.rule-form {
  .rule-hint {
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.4;
  }

  .rule-tip {
    font-size: 12px;
    color: #94a3b8;
    margin-left: 12px;
  }
}

.rule-updated {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 400;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.chart-large {
  width: 100%;
  height: 350px;
}

.alarm-list {
  max-height: 460px;
  overflow-y: auto;
}

.alarm-item {
  padding: 12px 15px;
  border-radius: 6px;
  margin-bottom: 10px;

  &.level-严重 {
    background: rgba(239, 68, 68, 0.08);
    border-left: 4px solid #ef4444;
  }

  &.level-警告 {
    background: rgba(245, 158, 11, 0.08);
    border-left: 4px solid #f59e0b;
  }

  &.alarm-confirmed {
    opacity: 0.75;
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
    flex-wrap: wrap;
  }

  .alarm-time {
    font-size: 12px;
    color: #64748b;
    white-space: nowrap;
  }

  .alarm-content {
    font-size: 14px;
    color: #1e293b;
    margin-bottom: 6px;
  }

  .alarm-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 12px;
    color: #64748b;
    margin-bottom: 6px;
  }

  .alarm-confirm-trace {
    font-size: 12px;
    color: #334155;
    background: rgba(34, 197, 94, 0.08);
    border-radius: 4px;
    padding: 8px 10px;
    line-height: 1.8;
  }

  .alarm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }
}
</style>
