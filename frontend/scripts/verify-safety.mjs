// 逻辑自测：幂等评估、中断保护、阈值冲突、确认留痕、持久化
import { createServer } from 'vite'

// Node SSR 环境下补一个最小 localStorage
const mem = new Map()
const storage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear()
}
globalThis.localStorage = storage
globalThis.window = { localStorage: storage }

const server = await createServer({
  configFile: '/workspace/frontend/vite.config.ts',
  server: { middlewareMode: true },
  logLevel: 'error'
})

const api = await server.ssrLoadModule('/src/api/drillingSafety.ts')

const results = []
const check = (name, cond) => {
  results.push([name, !!cond])
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`)
}

// 清空存储
localStorage.clear()
api.ensureSeedData()

// 1. 种子数据
const seedAlarms = api.listAlarms(1)
check('种子: A-01井有3条历史告警', seedAlarms.length === 3)
check('种子: 其他井无告警', api.listAlarms(2).length === 0)

// 2. 超限命中种子中已有的待确认钻压告警（AL-SEED-001，阈值250），应合并而非新建
let r = api.evaluateSample(1, { wellDepth: 2856, wob: 280, rpm: 120, spp: 22 })
check('命中已有待确认: 合并种子钻压告警', r.created.length === 0 && r.updated.length === 1 && r.updated[0].id === 'AL-SEED-001')
check('严重级别保留: 种子为严重，只升不降', r.updated[0].level === '严重')

// 3. 重复触发不重复生成，只合并
r = api.evaluateSample(1, { wellDepth: 2856, wob: 270, rpm: 120, spp: 22 })
const listAfterRepeat = api.listAlarms(1)
const wobAlarm = listAfterRepeat.find(a => a.param === 'wob' && a.status === 'pending')
check('重复触发: 不新建记录', r.created.length === 0 && r.updated.length === 1)
check('重复触发: 次数累加到3(种子1+2)', wobAlarm.triggerCount === 3)
check('重复触发: 最近值更新为270', wobAlarm.value === 270)
check('重复触发: 总记录数不变(仍为3条种子)', listAfterRepeat.length === 3)

// 4. 多参数同时超限，各自一条
r = api.evaluateSample(1, { wellDepth: 2856, wob: 260, rpm: 155, spp: 31 })
check('多参数: 新建2条(rpm/spp)，钻压合并',
  r.created.length === 2 && r.updated.length === 1)
const list4 = api.listAlarms(1)
check('多参数: 总记录数=5(3种子+2)', list4.length === 5)
check('警告级: rpm 155 未超 150*1.1=165',
  list4.find(a => a.param === 'rpm').level === '警告')

// 5. 阈值冲突：非法阈值拒绝保存
let conflict = ''
try {
  api.saveSafetyRule(1, { enabled: true, limits: { wellDepth: null, wob: 5000, rpm: null, spp: null } }, '测试人')
} catch (e) { conflict = e.message }
check('阈值冲突: 超量程被拒绝', /阈值冲突/.test(conflict))
try {
  api.saveSafetyRule(1, { enabled: true, limits: { wellDepth: 0, wob: null, rpm: null, spp: null } }, '测试人')
  conflict = ''
} catch (e) { conflict = e.message }
check('阈值冲突: 非正数被拒绝', /阈值冲突/.test(conflict))

// 6. 合法改阈值：不生成新记录；超限合并到原记录并标记阈值已变更
api.saveSafetyRule(1, { enabled: true, limits: { wellDepth: 3000, wob: 240, rpm: 150, spp: 30 } }, '测试人')
r = api.evaluateSample(1, { wellDepth: 2856, wob: 245, rpm: 120, spp: 22 })
const wobAfter = api.listAlarms(1).find(a => a.param === 'wob' && a.status === 'pending')
check('改阈值后: 未重复生成', r.created.length === 0 && r.updated.length === 1)
check('改阈值后: 标记 thresholdChanged', wobAfter.thresholdChanged === true)
check('改阈值后: 阈值已更新为240', wobAfter.threshold === 240)

// 7. 禁用规则后不评估
api.saveSafetyRule(1, { enabled: false, limits: { wellDepth: 3000, wob: 240, rpm: 150, spp: 30 } }, '测试人')
r = api.evaluateSample(1, { wellDepth: 2856, wob: 999, rpm: 999, spp: 99 })
check('禁用规则: 不产生任何记录', r.created.length === 0 && r.updated.length === 0)
api.saveSafetyRule(1, { enabled: true, limits: { wellDepth: 3000, wob: 240, rpm: 150, spp: 30 } }, '测试人')

// 8. 确认留痕 + 重复确认拒绝
const beforeCount = api.listAlarms(1).length
const confirmed = api.confirmAlarm(wobAfter.id, '张三', '调整钻井参数', '已降低钻压至210kN')
check('确认: 状态与留痕字段完整',
  confirmed.status === 'confirmed' && confirmed.confirmedBy === '张三' &&
  confirmed.handleResult === '调整钻井参数' && confirmed.confirmedAt &&
  api.listAlarms(1).length === beforeCount)
let dupMsg = ''
try {
  api.confirmAlarm(wobAfter.id, '李四', '误报告警', '')
} catch (e) { dupMsg = e.message }
check('确认: 重复确认被拒绝', /已被确认/.test(dupMsg))
try {
  api.confirmAlarm('NOT-EXIST', '李四', 'x', '')
  dupMsg = ''
} catch (e) { dupMsg = e.message }
check('确认: 不存在记录被拒绝', /不存在/.test(dupMsg))
try {
  api.confirmAlarm(seedAlarms[0].id, '  ', 'x', '')
  dupMsg = ''
} catch (e) { dupMsg = e.message }
check('确认: 缺少确认人被拒绝', /确认人/.test(dupMsg))

// 9. 确认后再次超限 -> 允许生成一条新告警（旧记录已闭环）
r = api.evaluateSample(1, { wellDepth: 2856, wob: 260, rpm: 120, spp: 22 })
check('闭环后再超限: 生成新记录', r.created.length === 1 && r.created[0].param === 'wob')
check('闭环后再超限: 新记录从1次计', r.created[0].triggerCount === 1)

// 10. 井隔离
check('井隔离: 井2没有井1的告警', api.listAlarms(2).length === 0)
api.evaluateSample(2, { wellDepth: 6000, wob: 100, rpm: 100, spp: 10 })
check('井2井深超限(5000): 生成且不影响井1',
  api.listAlarms(2).length === 1 &&
  api.listAlarms(1).length === beforeCount + 1)

// 11. 持久化：模拟“刷新”重新加载模块存储（localStorage 未清）
const persistedRules = JSON.parse(localStorage.getItem('drilling_safety_rules'))
const persistedAlarms = JSON.parse(localStorage.getItem('drilling_alarm_records'))
check('持久化: 规则含井1井2', persistedRules['1'] && persistedRules['2'])
check('持久化: 井1规则更新人为测试人', persistedRules['1'].updatedBy === '测试人')
const persistedConfirmed = persistedAlarms.find(a => a.id === wobAfter.id)
check('持久化: 确认留痕已落盘',
  persistedConfirmed && persistedConfirmed.status === 'confirmed' &&
  persistedConfirmed.confirmedBy === '张三')
check('持久化: 历史种子告警仍在', persistedAlarms.some(a => a.id === 'AL-SEED-002'))

// 12. ensureSeedData 幂等：再次执行不覆盖已确认状态
api.ensureSeedData()
check('种子幂等: 刷新后不重复种子、确认状态保留',
  JSON.parse(localStorage.getItem('drilling_alarm_records')).find(a => a.id === wobAfter.id)
    .confirmedBy === '张三')

// 13. 数据中断语义：中断期调用方不调用 evaluateSample（页面 tick 已保证），
//     直接验证恢复首帧合并：清掉新生成的待确认 wob，制造中断后恢复场景
const pendingWob = api.listAlarms(1).find(a => a.param === 'wob' && a.status === 'pending')
// 中断期间不评估（模拟 3 帧缺失）——这里不调用 evaluateSample
// 恢复首帧仍超限：命中待确认记录合并，而不是新建
const beforeWobCount = api.listAlarms(1).filter(a => a.param === 'wob').length
r = api.evaluateSample(1, { wellDepth: 2856, wob: 255, rpm: 120, spp: 22 })
check('中断恢复: 合并原记录不新建',
  r.updated.length === 1 && r.updated[0].id === pendingWob.id &&
  api.listAlarms(1).filter(a => a.param === 'wob').length === beforeWobCount)

const failed = results.filter(([, ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await server.close()
if (failed.length) process.exit(1)
