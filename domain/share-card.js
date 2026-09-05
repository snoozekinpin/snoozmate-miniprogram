const SHARE_IMAGE = '/images/share-cover.jpg'

function buildDirectShare() {
  return {
    title: '好眠 SnoozMate｜月石床头主机',
    path: '/pages/home/index?from=share',
    imageUrl: SHARE_IMAGE,
  }
}

function buildTimelineShare() {
  return {
    title: '好眠 SnoozMate｜月石床头主机',
    query: 'from=timeline',
    imageUrl: SHARE_IMAGE,
  }
}

module.exports = { buildDirectShare, buildTimelineShare }
