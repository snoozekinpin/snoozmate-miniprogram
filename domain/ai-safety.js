const URGENT_PATTERN = /喘不上气|呼吸困难|呼吸不过来|胸痛|意识不清|嘴唇发紫|窒息|昏厥|晕厥|自伤|自杀|轻生/i
const MEDICATION_PATTERN = /吃药|药物|用药|剂量|停药|处方/i
const DIAGNOSIS_PATTERN = /呼吸暂停|OSA|疾病|诊断|治愈|治疗|手术|检查/i

function classifyAiQuestion(message) {
  const normalized = String(message || '').trim()
  if (URGENT_PATTERN.test(normalized)) return 'urgent'
  if (MEDICATION_PATTERN.test(normalized)) return 'medication'
  if (DIAGNOSIS_PATTERN.test(normalized)) return 'diagnosis'
  return 'trend'
}

module.exports = {
  classifyAiQuestion
}
