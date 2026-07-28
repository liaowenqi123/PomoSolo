/**
 * 成就通知工具
 */
const { Notification } = require('electron')

/**
 * 发送成就解锁通知
 * @param {Array} unlockedAchievements - 解锁的成就列表
 */
function sendAchievementNotifications(unlockedAchievements) {
  if (!unlockedAchievements || unlockedAchievements.length === 0) return

  unlockedAchievements.forEach(achievement => {
    if (Notification.isSupported()) {
      let body = achievement.description || ''
      if (achievement.rewards) {
        const rewardParts = []
        if (achievement.rewards.seeds) {
          Object.entries(achievement.rewards.seeds).forEach(([seedKey, count]) => {
            if (count > 0) rewardParts.push(`种子×${count}`)
          })
        }
        if (achievement.rewards.coins > 0) {
          rewardParts.push(`💰${achievement.rewards.coins}`)
        }
        if (rewardParts.length > 0) {
          body += ` - 获得 ${rewardParts.join('、')}`
        }
      }

      const notification = new Notification({
        title: `🏆 成就解锁：${achievement.name}`,
        body: body,
        silent: false
      })
      notification.show()
    }
  })
}

module.exports = { sendAchievementNotifications }
