function getTimeGreeting(date = new Date()) {
  const hour = date.getHours()
  if (hour >= 5 && hour < 11) return '早上好'
  if (hour >= 11 && hour < 18) return '下午好'
  return '晚上好'
}

module.exports = { getTimeGreeting }
