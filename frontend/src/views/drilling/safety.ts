/**
 * 钻井安全边界规则与告警确认留痕服务
 *
 * 设计说明：
 * - 规则与告警均按井（wellId）隔离，持久化在 localStorage 中，
 *   切换井、返回日志列表（路由离开）或刷新页面后保持一致。
 * - 同一口井同一种事件在「未恢复」期间只会生成一条记录：
 *   数据持续超限不会重复触发；数据中断期间不会重复生成中断记录；
 *   修改阈值不会为当前仍超限的参数重复建单，仅在原记录上留痕。
 */

export type RuleKey = 'depth' | 'wob' | 'rpm' | 'spp'

export interface SafetyRule {
  /** 上限值，null 表示该参数不设限 */
  depthLimit: number | null
  wobLimit: number | null
  rpmLimit: number | null
  sppLimit: number | null
  /** 是否启用安全边界监控 */
  enabled: boolean
  updatedAt: string
  updatedBy: string
}

export type AlarmType = 'depth' | 'wob' | 'rpm' | 'spp' | 'data_gap'
export type AlarmLevel = '严重' | '警告'
export type AlarmStatus = 'active' | 'recovered' | 'confirmed'

/** 确认后可供选择的处理结果 */
export const DISPOSAL_RESULTS = ['已恢复正常', '继续观察', '已调整参数', '上报处理'] as const
export type DisposalResult = (typeof DISPOSAL_RESULTS)[number]

export interface SafetyAlarm {
  id: string
  wellId: number
  type: AlarmType
  level: AlarmLevel
  /** 触发内容（含触发时的当前值与阈值快照，阈值后续修改不影响历史记录） */
  content: string
  triggeredAt: string
  /** 最近一次仍在触发的时间，用于留痕，不新增记录 */
  lastSeenAt: string
  status: AlarmStatus
  recoveredAt: string | null
  /** 确认留痕 */
  confirmedBy: string | null
  confirmedAt: string | null
  disposalResult: DisposalResult | null
  disposalNote: string | null
}

const RULES_KEY = 'drilling:safety-rules'
const ALARMS_KEY = 'drilling:safety-alarms'
/** 数据中断记录复推节流间隔（毫秒），只更新 lastSeenAt 不生成新记录 */
const REPEAT_THROTTLE_MS = 10_000

export const PARAM_META: Record<RuleKey, { label: string; unit: string; max: number; decimals: number }> = {
  depth: { label: '井深', unit: 'm', max: 12000, decimals: 1 },
  wob: { label: '钻压', unit: 'kN', max: 500, decimals: 0 },
  rpm: { label: '转速', unit: 'rpm', max: 200, decimals: 0 },
  spp: { label: '立管压力', unit: 'MPa', max: 40, decimals: 1 }
}

export function getDefaultRule(): SafetyRule {
  return {
    depthLimit: 3000,
    wobLimit: 260,
    rpmLimit: 150,
    sppLimit: 30,
    enabled: true,
    updatedAt: '',
    updatedBy: ''
  }
}

/* ---------------------------------- 存储 ---------------------------------- */

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as Record<string, T>) : {}
  } catch {
    return {}
  }
}

function writeMap<T>(key: string, map: Record<string, T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map))
  } catch {
    // 存储不可用时降级为仅内存生效，不影响当前会话
  }
}

export function getRule(wellId: number): SafetyRule {
  const map = readMap<SafetyRule>(RULES_KEY)
  return map[String(wellId)] || getDefaultRule()
}

export function saveRule(wellId: number, rule: SafetyRule): void {
  const map = readMap<SafetyRule>(RULES_KEY)
  map[String(wellId)] = rule
  writeMap(RULES_KEY, map)
}

export function getAlarms(wellId: number): SafetyAlarm[] {
  const map = readMap<SafetyAlarm[]>(ALARMS_KEY)
  return (map[String(wellId)] || [])
    .slice()
    .sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : -1))
}

function persistAlarms(wellId: number, list: SafetyAlarm[]): void {
  const map = readMap<SafetyAlarm[]>(ALARMS_KEY)
  map[String(wellId)] = list
  writeMap(ALARMS_KEY, map)
}

/* ---------------------------------- 工具 ---------------------------------- */

export function nowText(): string {
  const d = new Date()
  const p = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 规则合法性校验（必须修正才能保存）：启用时四个上限必填、为正数且不超过量程。
 */
export function validateRule(rule: SafetyRule): string[] {
  const errors: string[] = []
  if (!rule.enabled) return errors

  const entries: [RuleKey, number | null][] = [
    ['depth', rule.depthLimit],
    ['wob', rule.wobLimit],
    ['rpm', rule.rpmLimit],
    ['spp', rule.sppLimit]
  ]

  for (const [key, limit] of entries) {
    if (limit === null || !isFiniteNumber(limit)) {
      errors.push(`请填写${PARAM_META[key].label}上限`)
      continue
    }
    if (limit <= 0) {
      errors.push(`${PARAM_META[key].label}上限必须大于 0`)
    }
    if (limit > PARAM_META[key].max) {
      errors.push(`${PARAM_META[key].label}上限不能超过设备量程 ${PARAM_META[key].max}${PARAM_META[key].unit}`)
    }
  }

  return errors
}

/**
 * 阈值冲突检测：所设上限低于当前实时值，保存后会立即触发告警。
 * 由界面二次确认后允许强制保存（不会绕过去重逻辑）。
 */
export function findThresholdConflicts(
  rule: SafetyRule,
  current: Record<RuleKey, number>
): string[] {
  if (!rule.enabled) return []
  const conflicts: string[] = []
  const entries: [RuleKey, number | null][] = [
    ['depth', rule.depthLimit],
    ['wob', rule.wobLimit],
    ['rpm', rule.rpmLimit],
    ['spp', rule.sppLimit]
  ]
  for (const [key, limit] of entries) {
    if (isFiniteNumber(limit) && isFiniteNumber(current[key]) && current[key] > limit) {
      conflicts.push(
        `当前${PARAM_META[key].label}为 ${current[key]}${PARAM_META[key].unit}，已高于所设上限 ${limit}${PARAM_META[key].unit}`
      )
    }
  }
  return conflicts
}

/* --------------------------------- 告警评估 -------------------------------- */

export interface RealtimeSample {
  wellDepth: number
  wob: number
  rpm: number
  spp: number
}

const LIMIT_KEY: Record<Exclude<AlarmType, 'data_gap'>, RuleKey> = {
  depth: 'depth',
  wob: 'wob',
  rpm: 'rpm',
  spp: 'spp'
}

function ruleLimitOf(rule: SafetyRule, key: RuleKey): number | null {
  switch (key) {
    case 'depth':
      return rule.depthLimit
    case 'wob':
      return rule.wobLimit
    case 'rpm':
      return rule.rpmLimit
    case 'spp':
      return rule.sppLimit
  }
}

function levelOf(type: AlarmType): AlarmLevel {
  // 井深、立管压力超限按严重处理；钻压、转速超限按警告
  return type === 'depth' || type === 'spp' ? '严重' : '警告'
}

function breachContent(type: Exclude<AlarmType, 'data_gap'>, value: number, limit: number): string {
  const meta = PARAM_META[LIMIT_KEY[type]]
  return `${meta.label}超出安全上限，当前值: ${value}${meta.unit}，上限: ${limit}${meta.unit}`
}

function upsertAlarm(
  list: SafetyAlarm[],
  wellId: number,
  type: AlarmType,
  level: AlarmLevel,
  content: string,
  now: string
): { alarm: SafetyAlarm; created: boolean } {
  const existing = list.find((a) => a.wellId === wellId && a.type === type && a.status !== 'recovered')
  if (existing) {
    // 数据中断 / 持续超限 / 阈值修改后仍超限：只更新最近发生时间，绝不重复建单
    if (Date.parse(now) - Date.parse(existing.lastSeenAt) >= REPEAT_THROTTLE_MS) {
      existing.lastSeenAt = now
    }
    return { alarm: existing, created: false }
  }
  const alarm: SafetyAlarm = {
    id: uid(),
    wellId,
    type,
    level,
    content,
    triggeredAt: now,
    lastSeenAt: now,
    status: 'active',
    recoveredAt: null,
    confirmedBy: null,
    confirmedAt: null,
    disposalResult: null,
    disposalNote: null
  }
  list.push(alarm)
  return { alarm, created: true }
}

/**
 * 根据最新实时数据评估阈值告警。
 * - 超限参数：存在活动记录则只更新 lastSeenAt，否则建单（重复触发不重复生成）。
 * - 恢复正常参数：未确认的记录自动标记为 recovered；已确认的记录保留确认状态与留痕。
 * 返回最新告警列表与本次是否新建记录。
 */
export function evaluateThresholds(
  wellId: number,
  sample: RealtimeSample,
  rule: SafetyRule
): { alarms: SafetyAlarm[]; created: SafetyAlarm[] } {
  const list = getAlarms(wellId)
  const now = nowText()
  const created: SafetyAlarm[] = []
  const valueOf: Record<Exclude<AlarmType, 'data_gap'>, number> = {
    depth: sample.wellDepth,
    wob: sample.wob,
    rpm: sample.rpm,
    spp: sample.spp
  }

  if (!rule.enabled) {
    // 停用安全边界：未确认的阈值告警自动关闭（已确认记录保留留痕）
    list
      .filter((a) => a.type !== 'data_gap' && a.status === 'active')
      .forEach((a) => {
        a.status = 'recovered'
        a.recoveredAt = now
      })
    persistAlarms(wellId, list)
    return { alarms: list, created }
  }

  ;(['depth', 'wob', 'rpm', 'spp'] as const).forEach((type) => {
    const limit = ruleLimitOf(rule, LIMIT_KEY[type])
    const value = valueOf[type]
    const active = list.find(
      (a) => a.wellId === wellId && a.type === type && a.status !== 'recovered'
    )

    if (isFiniteNumber(limit) && isFiniteNumber(value) && value > limit) {
      const { alarm, created: isCreated } = upsertAlarm(
        list,
        wellId,
        type,
        levelOf(type),
        breachContent(type, value, limit),
        now
      )
      if (isCreated) created.push(alarm)
    } else if (active && active.status === 'active') {
      // 恢复正常且用户尚未确认：自动关闭；已确认的记录不动，保留处理结果
      active.status = 'recovered'
      active.recoveredAt = now
    }
  })

  persistAlarms(wellId, list)
  return { alarms: list, created }
}

/**
 * 数据中断评估：lastSampleAt 为最近一次收到实时数据的时间。
 * 中断状态持续期间只会存在一条 data_gap 记录；恢复后自动关闭未确认的中断记录。
 */
export function evaluateDataGap(
  wellId: number,
  lastSampleAt: number | null,
  staleMs: number
): { alarms: SafetyAlarm[]; created: boolean } {
  const list = getAlarms(wellId)
  const now = nowText()
  const gap = list.find((a) => a.wellId === wellId && a.type === 'data_gap' && a.status !== 'recovered')

  const interrupted = lastSampleAt !== null && Date.now() - lastSampleAt >= staleMs
  if (interrupted) {
    const { created: isCreated } = upsertAlarm(
      list,
      wellId,
      'data_gap',
      '严重',
      '实时数据采集中断，未能收到最新钻井参数，请检查通讯链路',
      now
    )
    persistAlarms(wellId, list)
    return { alarms: list, created: isCreated }
  }

  if (gap && gap.status === 'active') {
    gap.status = 'recovered'
    gap.recoveredAt = now
    persistAlarms(wellId, list)
  }
  return { alarms: list, created: false }
}

/** 确认告警并留痕：确认人、确认时间、处理结果与处理说明 */
export function confirmAlarm(
  wellId: number,
  alarmId: string,
  payload: { confirmedBy: string; disposalResult: DisposalResult; disposalNote: string }
): SafetyAlarm[] {
  const list = getAlarms(wellId)
  const alarm = list.find((a) => a.id === alarmId)
  if (!alarm) return list
  if (alarm.status === 'confirmed') return list // 防重复确认

  alarm.status = 'confirmed'
  alarm.confirmedBy = payload.confirmedBy
  alarm.confirmedAt = nowText()
  alarm.disposalResult = payload.disposalResult
  alarm.disposalNote = payload.disposalNote
  persistAlarms(wellId, list)
  return list
}
