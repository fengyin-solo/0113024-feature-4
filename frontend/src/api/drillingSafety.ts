/**
 * 安全边界规则与告警确认留痕 —— 本地持久化服务
 *
 * 当前为前端演示环境，后端接口尚未就绪，使用 localStorage 模拟服务端存储：
 * 1. 规则与告警均按井存储，切换井、离开页面后返回、刷新浏览器，状态保持一致；
 * 2. 阈值评估为幂等操作：同一井同一参数存在“待确认”告警时，重复触发 / 数据中断恢复 /
 *    阈值被修改，只会更新原记录（最近触发时间、次数、当前值），绝不重复生成记录；
 * 3. 告警确认同样幂等：已确认的记录不能再次确认，确认人、确认时间、处理结果全程留痕。
 */

export type SafetyParamKey = 'wellDepth' | 'wob' | 'rpm' | 'spp'

export type AlarmLevel = '严重' | '警告'

export type AlarmStatus = 'pending' | 'confirmed'

export interface SafetyRule {
  wellId: number
  /** 是否启用阈值评估 */
  enabled: boolean
  /** 井深上限(m)，null 表示不设限 */
  wellDepth: number | null
  /** 钻压上限(kN) */
  wob: number | null
  /** 转速上限(rpm) */
  rpm: number | null
  /** 立管压力上限(MPa) */
  spp: number | null
  updatedAt: string
  updatedBy: string
}

export interface AlarmRecord {
  id: string
  wellId: number
  /** 触发参数，other 为接入规则引擎前的历史遗留告警 */
  param: SafetyParamKey | 'other'
  level: AlarmLevel
  /** 触发时适用的阈值；历史遗留告警可能为空 */
  threshold: number | null
  /** 最近一次触发时的实测值 */
  value: number | null
  content: string
  firstTriggeredAt: string
  lastTriggeredAt: string
  /** 累计触发次数，用于体现“重复触发合并为一条记录” */
  triggerCount: number
  /** 告警首次触发后规则阈值被调整过 */
  thresholdChanged?: boolean
  status: AlarmStatus
  // —— 确认留痕字段 ——
  confirmedBy?: string
  confirmedAt?: string
  handleResult?: string
  handleRemark?: string
}

export interface DrillingSample {
  wellDepth: number
  wob: number
  rpm: number
  spp: number
}

interface ParamMeta {
  label: string
  unit: string
  /** 物理/仪表量程上限，超过该值视为阈值冲突（非法配置） */
  hardMax: number
}

export const PARAM_META: Record<SafetyParamKey, ParamMeta> = {
  wellDepth: { label: '井深', unit: 'm', hardMax: 15000 },
  wob: { label: '钻压', unit: 'kN', hardMax: 1000 },
  rpm: { label: '转速', unit: 'rpm', hardMax: 300 },
  spp: { label: '立管压力', unit: 'MPa', hardMax: 100 }
}

export const PARAM_ORDER: SafetyParamKey[] = ['wellDepth', 'wob', 'rpm', 'spp']

export const HANDLE_RESULT_OPTIONS = [
  '参数已回调至安全范围',
  '调整钻井参数',
  '停钻检查',
  '误报告警'
]

const RULES_KEY = 'drilling_safety_rules'
const ALARMS_KEY = 'drilling_alarm_records'
const SEED_KEY = 'drilling_safety_seed_v1'

/** 实测值超过阈值的比例达到该倍数时升级为严重告警 */
const SERIOUS_RATIO = 1.1

// —— 基础存储（localStorage 不可用时降级到内存，保证页面不崩） ——

const memoryStore = new Map<string, string>()

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    const mem = memoryStore.get(key)
    return mem == null ? fallback : (JSON.parse(mem) as T)
  }
}

function writeJSON(key: string, value: unknown) {
  const raw = JSON.stringify(value)
  memoryStore.set(key, raw)
  try {
    window.localStorage.setItem(key, raw)
  } catch {
    // 隐私模式等场景下降级为内存存储
  }
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

export function formatDateTime(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function round1(n: number) {
  return Math.round(n * 10) / 10
}

// —— 安全边界规则 ——

export function getSafetyRule(wellId: number): SafetyRule | null {
  const map = readJSON<Record<string, SafetyRule>>(RULES_KEY, {})
  return map[String(wellId)] || null
}

function getAllRules(): Record<string, SafetyRule> {
  return readJSON<Record<string, SafetyRule>>(RULES_KEY, {})
}

export interface SafetyRuleInput {
  enabled: boolean
  limits: Record<SafetyParamKey, number | null>
}

/**
 * 保存某口井的安全边界规则。
 * 阈值冲突（非正数、超出仪表量程）时直接拒绝写入，不触发任何告警记录。
 */
export function saveSafetyRule(
  wellId: number,
  input: SafetyRuleInput,
  operator: string
): SafetyRule {
  for (const key of PARAM_ORDER) {
    const v = input.limits[key]
    if (v == null) continue
    const meta = PARAM_META[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > meta.hardMax) {
      throw new Error(`阈值冲突：${meta.label}上限必须为 0~${meta.hardMax}${meta.unit} 之间的数值，请重新配置`)
    }
  }

  const rule: SafetyRule = {
    wellId,
    enabled: input.enabled,
    wellDepth: input.limits.wellDepth,
    wob: input.limits.wob,
    rpm: input.limits.rpm,
    spp: input.limits.spp,
    updatedAt: formatDateTime(),
    updatedBy: operator
  }

  const map = getAllRules()
  map[String(wellId)] = rule
  writeJSON(RULES_KEY, map)
  return rule
}

// —— 告警记录 ——

function getAllAlarms(): AlarmRecord[] {
  return readJSON<AlarmRecord[]>(ALARMS_KEY, [])
}

function writeAllAlarms(list: AlarmRecord[]) {
  writeJSON(ALARMS_KEY, list)
}

/** 按井读取告警，最近触发的在前 */
export function listAlarms(wellId: number): AlarmRecord[] {
  return getAllAlarms()
    .filter(a => a.wellId === wellId)
    .sort((a, b) => (a.lastTriggeredAt < b.lastTriggeredAt ? 1 : -1))
}

function buildAlarmContent(param: SafetyParamKey, value: number, threshold: number): string {
  const meta = PARAM_META[param]
  return `${meta.label}超出上限阈值，当前值: ${round1(value)}${meta.unit}，阈值: ${threshold}${meta.unit}`
}

export interface EvaluationResult {
  /** 本次采样新生成的告警 */
  created: AlarmRecord[]
  /** 本次采样命中已有待确认告警、被合并更新的记录 */
  updated: AlarmRecord[]
}

/**
 * 对一帧实时采样进行阈值评估（幂等）。
 * 调用方负责在数据中断时不要传入采样帧——中断期间不评估即不会产生任何记录；
 * 恢复后的第一帧若仍超限，会命中原有待确认记录进行合并，而不是新建。
 */
export function evaluateSample(wellId: number, sample: DrillingSample): EvaluationResult {
  const rule = getSafetyRule(wellId)
  if (!rule || !rule.enabled) return { created: [], updated: [] }

  const all = getAllAlarms()
  let changed = false
  const created: AlarmRecord[] = []
  const updated: AlarmRecord[] = []
  const now = formatDateTime()

  for (const param of PARAM_ORDER) {
    const threshold = rule[param]
    if (threshold == null) continue
    const value = sample[param]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= threshold) continue

    const level: AlarmLevel = value > threshold * SERIOUS_RATIO ? '严重' : '警告'
    const content = buildAlarmContent(param, value, threshold)
    // 同一井 + 同一参数只允许存在一条待确认告警，重复触发一律合并
    const index = all.findIndex(a => a.wellId === wellId && a.param === param && a.status === 'pending')

    if (index >= 0) {
      const existing = all[index]
      const merged: AlarmRecord = {
        ...existing,
        // 严重级别只升不降
        level: existing.level === '严重' ? '严重' : level,
        threshold,
        value: round1(value),
        content,
        lastTriggeredAt: now,
        triggerCount: existing.triggerCount + 1,
        thresholdChanged: existing.thresholdChanged === true || existing.threshold !== threshold
      }
      all[index] = merged
      updated.push(merged)
      changed = true
    } else {
      const record: AlarmRecord = {
        id: `AL-${now.replace(/[-: ]/g, '')}-${param.toUpperCase()}`,
        wellId,
        param,
        level,
        threshold,
        value: round1(value),
        content,
        firstTriggeredAt: now,
        lastTriggeredAt: now,
        triggerCount: 1,
        status: 'pending'
      }
      all.push(record)
      created.push(record)
      changed = true
    }
  }

  if (changed) writeAllAlarms(all)
  return { created, updated }
}

/**
 * 确认告警并留痕。已确认 / 不存在的记录再次提交会被拒绝，保证确认操作不重复。
 */
export function confirmAlarm(
  id: string,
  confirmedBy: string,
  handleResult: string,
  handleRemark: string
): AlarmRecord {
  const operator = confirmedBy.trim()
  const result = handleResult.trim()
  if (!operator) throw new Error('请填写确认人')
  if (!result) throw new Error('请选择处理结果')

  const all = getAllAlarms()
  const index = all.findIndex(a => a.id === id)
  if (index < 0) throw new Error('告警记录不存在或已被删除')
  if (all[index].status === 'confirmed') throw new Error('该告警已被确认，请勿重复提交')

  const confirmed: AlarmRecord = {
    ...all[index],
    status: 'confirmed',
    confirmedBy: operator,
    confirmedAt: formatDateTime(),
    handleResult: result,
    handleRemark: handleRemark.trim()
  }
  all[index] = confirmed
  writeAllAlarms(all)
  return confirmed
}

// —— 首次使用时写入演示种子数据（与旧版页面写死的三条告警保持一致） ——

export function ensureSeedData() {
  try {
    if (window.localStorage.getItem(SEED_KEY)) return
  } catch {
    if (memoryStore.has(SEED_KEY)) return
  }

  const rules: Record<string, SafetyRule> = {
    1: {
      wellId: 1,
      enabled: true,
      wellDepth: 3000,
      wob: 250,
      rpm: 150,
      spp: 30,
      updatedAt: '2024-01-15 09:00:00',
      updatedBy: '管理员'
    },
    2: {
      wellId: 2,
      enabled: true,
      wellDepth: 5000,
      wob: 260,
      rpm: 160,
      spp: 32,
      updatedAt: '2024-01-15 09:10:00',
      updatedBy: '管理员'
    }
  }

  const alarms: AlarmRecord[] = [
    {
      id: 'AL-SEED-001',
      wellId: 1,
      param: 'wob',
      level: '严重',
      threshold: 250,
      value: 285,
      content: '钻压超出上限阈值，当前值: 285kN，阈值: 250kN',
      firstTriggeredAt: '2024-01-15 10:25:00',
      lastTriggeredAt: '2024-01-15 10:25:00',
      triggerCount: 1,
      status: 'pending'
    },
    {
      id: 'AL-SEED-002',
      wellId: 1,
      param: 'other',
      level: '警告',
      threshold: null,
      value: null,
      content: '泥浆出口流量波动较大，需要关注',
      firstTriggeredAt: '2024-01-15 10:15:00',
      lastTriggeredAt: '2024-01-15 10:15:00',
      triggerCount: 1,
      status: 'pending'
    },
    {
      id: 'AL-SEED-003',
      wellId: 1,
      param: 'other',
      level: '警告',
      threshold: null,
      value: null,
      content: '扭矩接近上限阈值，当前值: 58kN·m',
      firstTriggeredAt: '2024-01-15 09:45:00',
      lastTriggeredAt: '2024-01-15 09:45:00',
      triggerCount: 1,
      status: 'pending'
    }
  ]

  writeJSON(RULES_KEY, rules)
  writeJSON(ALARMS_KEY, alarms)
  writeJSON(SEED_KEY, { seededAt: formatDateTime() })
}
